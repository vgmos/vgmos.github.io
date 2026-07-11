import { BUCK_LOSS_MODEL_REVISION, BUCK_LOSS_MODEL_VERSION, validateBuckLossInputsV2 } from "./buck-loss-schema-v2.js";
import { BUCK_LOSS_ADVISORY_METADATA_V2, resolveBuckLossTermMetadataV2 } from "./buck-loss-equations-v2.js";

const EPSILON = 1e-12;
const ACTIVE_PATH_V2 = Object.freeze({
  "high-side": "high-side-channel",
  "low-side": "low-side-channel",
  "dead-time": "reverse-path",
  "zero-current": "open"
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value) {
  return Number.isFinite(value);
}

function linearIntegral(i0, i1, duration) {
  return duration * (i0 + i1) / 2;
}

function linearSquareIntegral(i0, i1, duration) {
  return duration * (i0 * i0 + i0 * i1 + i1 * i1) / 3;
}

function linearAbsIntegral(i0, i1, duration) {
  if (i0 === 0 && i1 === 0) return 0;
  if (i0 * i1 >= 0) return Math.abs(linearIntegral(i0, i1, duration));
  const crossing = duration * Math.abs(i0) / (Math.abs(i0) + Math.abs(i1));
  return 0.5 * Math.abs(i0) * crossing + 0.5 * Math.abs(i1) * (duration - crossing);
}

function makeSegment(state, duration, iStart, iEnd, extra = {}) {
  const safeDuration = Math.max(0, duration);
  return {
    state,
    activePath: ACTIVE_PATH_V2[state] ?? state,
    duration: safeDuration,
    iStart,
    iEnd,
    currentIntegral: linearIntegral(iStart, iEnd, safeDuration),
    currentSquareIntegral: linearSquareIntegral(iStart, iEnd, safeDuration),
    currentAbsIntegral: linearAbsIntegral(iStart, iEnd, safeDuration),
    ...extra
  };
}

function sumSegments(segments, key) {
  return segments.reduce((sum, segment) => sum + segment[key], 0);
}

function waveformMoments(segments, period, iout) {
  const currentIntegral = sumSegments(segments, "currentIntegral");
  const currentSquareIntegral = sumSegments(segments, "currentSquareIntegral");
  const sourceSegments = segments.filter((segment) => segment.sourceConnected);
  const sourceIntegral = sumSegments(sourceSegments, "currentIntegral");
  const inputAverage = sourceIntegral / period;
  let inputCapSquareIntegral = 0;
  let outputCapSquareIntegral = 0;
  for (const segment of segments) {
    const sourceI0 = segment.sourceConnected ? segment.iStart : 0;
    const sourceI1 = segment.sourceConnected ? segment.iEnd : 0;
    inputCapSquareIntegral += linearSquareIntegral(
      sourceI0 - inputAverage,
      sourceI1 - inputAverage,
      segment.duration
    );
    outputCapSquareIntegral += linearSquareIntegral(
      segment.iStart - iout,
      segment.iEnd - iout,
      segment.duration
    );
  }
  return {
    currentAverage: currentIntegral / period,
    iLrms2: currentSquareIntegral / period,
    inputAverage,
    inputCapRms2: inputCapSquareIntegral / period,
    outputCapRms2: outputCapSquareIntegral / period,
    highSideRms2: sumSegments(segments.filter((segment) => segment.state === "high-side"), "currentSquareIntegral") / period,
    lowSideRms2: sumSegments(segments.filter((segment) => segment.state === "low-side"), "currentSquareIntegral") / period,
    deadTimeCurrentAverage: sumSegments(segments.filter((segment) => segment.state === "dead-time"), "currentAbsIntegral") / period
  };
}

function invalidWaveform(errors, mode = "invalid", failure = null) {
  const structuredFailure = failure
    ? {
        code: failure.code,
        values: Object.freeze(Object.fromEntries(Object.entries(failure).filter(([key]) => key !== "code")))
      }
    : null;
  return {
    valid: false,
    errors,
    failure: structuredFailure,
    mode,
    segments: [],
    duties: { highSide: null, lowSide: null, deadTime: null, zeroCurrent: null },
    moments: null,
    period: null,
    iPeak: null,
    iValley: null,
    ripplePp: null
  };
}

function ccmWaveform(inputs, iout) {
  const period = 1 / inputs.fsw;
  const dead = inputs.deadTime;
  const deadFraction = dead / period;
  if (!(dead >= 0) || 2 * dead >= period) {
    return invalidWaveform(["dead-time-infeasible"], "ccm", {
      code: "dead-time-infeasible",
      period,
      deadFraction,
      availableSwitchFraction: 1 - 2 * deadFraction
    });
  }

  const rInductor = inputs.dcr;
  const highVoltage = inputs.vin - inputs.vout - iout * (inputs.rdsHigh + rInductor);
  const lowVoltage = -inputs.vout - iout * (inputs.rdsLow + rInductor);
  const deadVoltage = -inputs.vout - inputs.diodeVf - iout * rInductor;
  if (!(highVoltage > 0)) {
    return invalidWaveform(["dropout"], "ccm", {
      code: "dropout",
      period,
      highVoltage,
      deadFraction,
      availableSwitchFraction: 1 - 2 * deadFraction
    });
  }
  const denominator = highVoltage - lowVoltage;
  if (!(denominator > 0)) {
    return invalidWaveform(["dropout"], "ccm", {
      code: "dropout",
      period,
      highVoltage,
      lowVoltage,
      deadFraction,
      availableSwitchFraction: 1 - 2 * deadFraction
    });
  }

  const highFraction = -(lowVoltage + 2 * deadFraction * (deadVoltage - lowVoltage)) / denominator;
  const lowFraction = 1 - highFraction - 2 * deadFraction;
  if (!(highFraction > 0 && highFraction < 1) || lowFraction < -1e-10) {
    const code = lowFraction < 0 ? "low-side-window-negative" : "duty-infeasible";
    return invalidWaveform([code], "ccm", {
      code,
      period,
      deadFraction,
      requiredHighFraction: highFraction,
      availableSwitchFraction: 1 - 2 * deadFraction,
      lowFraction,
      highVoltage,
      lowVoltage
    });
  }

  const tHigh = highFraction * period;
  const tLow = Math.max(0, lowFraction * period);
  const slopeHigh = highVoltage / inputs.inductance;
  const slopeLow = lowVoltage / inputs.inductance;
  const slopeDead = deadVoltage / inputs.inductance;
  const relative = [
    { state: "high-side", duration: tHigh, slope: slopeHigh, sourceConnected: true },
    { state: "dead-time", duration: dead, slope: slopeDead, sourceConnected: false },
    { state: "low-side", duration: tLow, slope: slopeLow, sourceConnected: false },
    { state: "dead-time", duration: dead, slope: slopeDead, sourceConnected: false }
  ];

  let current = 0;
  let relativeArea = 0;
  for (const interval of relative) {
    const next = current + interval.slope * interval.duration;
    relativeArea += linearIntegral(current, next, interval.duration);
    current = next;
  }
  if (Math.abs(current) > Math.max(1e-9, Math.abs(iout) * 1e-7)) {
    return invalidWaveform(["volt-second-solve"], "ccm", {
      code: "volt-second-solve",
      period,
      residualCurrent: current,
      deadFraction,
      requiredHighFraction: highFraction,
      availableSwitchFraction: 1 - 2 * deadFraction
    });
  }

  const valley = iout - relativeArea / period;
  current = valley;
  const segments = relative.map((interval) => {
    const next = current + interval.slope * interval.duration;
    const segment = makeSegment(interval.state, interval.duration, current, next, {
      slope: interval.slope,
      sourceConnected: interval.sourceConnected
    });
    current = next;
    return segment;
  });
  const peak = Math.max(...segments.flatMap((segment) => [segment.iStart, segment.iEnd]));
  const moments = waveformMoments(segments, period, iout);
  return {
    valid: true,
    errors: [],
    mode: "ccm",
    period,
    segments,
    duties: {
      highSide: highFraction,
      lowSide: Math.max(0, lowFraction),
      deadTime: 2 * deadFraction,
      zeroCurrent: 0
    },
    moments,
    iPeak: peak,
    iValley: valley,
    ripplePp: peak - valley
  };
}

function dcmCandidate(inputs, highFraction) {
  const period = 1 / inputs.fsw;
  const dead = inputs.deadTime;
  const tHigh = highFraction * period;
  const commandedLowWindow = period - tHigh - 2 * dead;
  if (commandedLowWindow < -EPSILON) return { feasible: false, average: Infinity };
  const highNumerator = (inputs.vin - inputs.vout) * tHigh;
  const highDenominator = inputs.inductance + 0.5 * (inputs.rdsHigh + inputs.dcr) * tHigh;
  const peak = highDenominator > 0 ? highNumerator / highDenominator : 0;
  if (!(peak >= 0 && finite(peak))) return null;

  const leadingDeadRate = (inputs.vout + inputs.diodeVf + 0.5 * peak * inputs.dcr) / inputs.inductance;
  const timeToZeroInLeadingDead = leadingDeadRate > 0 ? peak / leadingDeadRate : Infinity;
  const tLeadingDead = Math.min(dead, timeToZeroInLeadingDead);
  const afterLeadingDead = Math.max(0, peak - leadingDeadRate * tLeadingDead);
  const lowRate = (inputs.vout + 0.5 * afterLeadingDead * (inputs.rdsLow + inputs.dcr)) / inputs.inductance;
  const timeToZeroInLow = afterLeadingDead > 0 && lowRate > 0 ? afterLeadingDead / lowRate : 0;
  const tLow = Math.min(Math.max(0, commandedLowWindow), timeToZeroInLow);
  const afterLow = Math.max(0, afterLeadingDead - lowRate * tLow);
  const trailingDeadRate = (inputs.vout + inputs.diodeVf + 0.5 * afterLow * inputs.dcr) / inputs.inductance;
  const timeToZeroInTrailingDead = afterLow > 0 && trailingDeadRate > 0 ? afterLow / trailingDeadRate : 0;
  const tTrailingDead = Math.min(dead, timeToZeroInTrailingDead);
  const afterTrailingDead = Math.max(0, afterLow - trailingDeadRate * tTrailingDead);
  if (afterTrailingDead > Math.max(1e-9, peak * 1e-7)) return { feasible: false, average: Infinity };

  const activeTime = tHigh + tLeadingDead + tLow + tTrailingDead;
  if (activeTime > period + EPSILON) return { feasible: false, average: Infinity };

  const zeroTime = Math.max(0, period - activeTime);
  const segments = [
    makeSegment("high-side", tHigh, 0, peak, { sourceConnected: true, slope: tHigh > 0 ? peak / tHigh : 0 }),
    makeSegment("dead-time", tLeadingDead, peak, afterLeadingDead, { sourceConnected: false, slope: -leadingDeadRate }),
    makeSegment("low-side", tLow, afterLeadingDead, afterLow, { sourceConnected: false, slope: -lowRate }),
    makeSegment("dead-time", tTrailingDead, afterLow, 0, { sourceConnected: false, slope: -trailingDeadRate }),
    makeSegment("zero-current", zeroTime, 0, 0, { sourceConnected: false, slope: 0 })
  ].filter((segment) => segment.duration > EPSILON || segment.state === "zero-current");
  const average = sumSegments(segments, "currentIntegral") / period;
  return {
    feasible: true,
    average,
    segments,
    peak,
    tHigh,
    tLeadingDead,
    tLow,
    tTrailingDead,
    zeroTime,
    period
  };
}

function maximumDcmCandidate(inputs) {
  const period = 1 / inputs.fsw;
  let low = 0;
  let high = Math.max(0, 1 - 2 * inputs.deadTime / period);
  let best = dcmCandidate(inputs, low);
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const mid = (low + high) / 2;
    const candidate = dcmCandidate(inputs, mid);
    if (candidate?.feasible) {
      low = mid;
      best = candidate;
    } else {
      high = mid;
    }
  }
  return best;
}

function dcmWaveform(inputs, iout) {
  const period = 1 / inputs.fsw;
  if (iout <= EPSILON) {
    const segments = [makeSegment("zero-current", period, 0, 0, { sourceConnected: false, slope: 0 })];
    return {
      valid: true,
      errors: [],
      mode: "zero-load-unmodeled",
      period,
      segments,
      duties: { highSide: 0, lowSide: 0, deadTime: 0, zeroCurrent: 1 },
      moments: waveformMoments(segments, period, 0),
      iPeak: 0,
      iValley: 0,
      ripplePp: 0
    };
  }

  const maximum = maximumDcmCandidate(inputs);
  if (!maximum?.feasible || iout > maximum.average * (1 + 1e-8)) {
    return invalidWaveform(["dcm-load-above-boundary"], "dcm", {
      code: "dcm-load-above-boundary",
      period,
      requestedCurrent: iout,
      boundaryCurrent: maximum?.average ?? null
    });
  }
  let low = 0;
  let high = maximum.tHigh / period;
  let best = null;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const mid = (low + high) / 2;
    const candidate = dcmCandidate(inputs, mid);
    if (!candidate || !candidate.feasible || candidate.average > iout) high = mid;
    else {
      low = mid;
      best = candidate;
    }
  }
  const midpointCandidate = dcmCandidate(inputs, (low + high) / 2);
  const finalCandidate = midpointCandidate?.feasible ? midpointCandidate : best;
  if (!finalCandidate?.feasible || Math.abs(finalCandidate.average - iout) > Math.max(1e-9, iout * 1e-6)) {
    return invalidWaveform(["dcm-load-solve"], "dcm", {
      code: "dcm-load-solve",
      period,
      requestedCurrent: iout,
      solvedCurrent: finalCandidate?.average ?? null
    });
  }
  const { segments, peak } = finalCandidate;
  return {
    valid: true,
    errors: [],
    mode: "dcm",
    period,
    segments,
    duties: {
      highSide: finalCandidate.tHigh / period,
      lowSide: finalCandidate.tLow / period,
      deadTime: (finalCandidate.tLeadingDead + finalCandidate.tTrailingDead) / period,
      zeroCurrent: finalCandidate.zeroTime / period
    },
    moments: waveformMoments(segments, period, iout),
    iPeak: peak,
    iValley: 0,
    ripplePp: peak
  };
}

export function computeBuckWaveformV2(inputs, iout, options = {}) {
  const validation = validateBuckLossInputsV2(inputs);
  const required = ["rdsHigh", "rdsLow", "diodeVf", "dcr"];
  const missing = required.filter((key) => !finite(inputs[key]));
  if (!validation.valid || missing.length || !finite(iout) || iout < 0 || iout > inputs.ioutMax + EPSILON) {
    return invalidWaveform([...validation.errors, ...missing, !finite(iout) || iout < 0 ? "iout" : null].filter(Boolean));
  }
  if (iout <= EPSILON) return dcmWaveform(inputs, 0);
  const ccm = ccmWaveform(inputs, iout);
  if (!ccm.valid) return ccm;
  if (options.controlMode === "forced-ccm") return ccm;
  const boundary = finite(options.ccmBoundary) ? options.ccmBoundary : maximumDcmCandidate(inputs)?.average;
  if (finite(boundary) && iout <= boundary * (1 + 1e-9)) return dcmWaveform(inputs, iout);
  return ccm;
}

export function findCcmBoundaryV2(inputs) {
  const maximum = maximumDcmCandidate(inputs);
  return maximum?.feasible ? maximum.average : null;
}

function transitionModel(inputs, timingMode) {
  if (timingMode === "effective" && finite(inputs.effectiveTurnOn) && finite(inputs.effectiveTurnOff)) {
    return {
      available: true,
      method: "effective-override",
      effectiveTurnOn: inputs.effectiveTurnOn,
      effectiveTurnOff: inputs.effectiveTurnOff
    };
  }
  const required = ["qgs2High", "qgdHigh", "plateauHigh", "gateResistanceOnHigh", "gateResistanceOffHigh"];
  if (required.some((key) => !finite(inputs[key]))) {
    return { available: false, method: null, missing: required.filter((key) => !finite(inputs[key])) };
  }
  const gateCurrentOn = (inputs.vDrive - inputs.plateauHigh) / inputs.gateResistanceOnHigh;
  const gateCurrentOff = inputs.plateauHigh / inputs.gateResistanceOffHigh;
  if (!(gateCurrentOn > 0 && gateCurrentOff > 0)) {
    return { available: false, method: null, missing: ["gate-drive-headroom"] };
  }
  return {
    available: true,
    method: "derived-gate-charge",
    currentRise: inputs.qgs2High / gateCurrentOn,
    voltageFall: inputs.qgdHigh / gateCurrentOn,
    voltageRise: inputs.qgdHigh / gateCurrentOff,
    currentFall: inputs.qgs2High / gateCurrentOff
  };
}

const LOSS_KEYS_V2 = Object.freeze([
  "highSideConduction", "lowSideConduction",
  "inductorDcCopper", "inductorAcCopper", "inductorCoreResidual",
  "inputCapEsr", "outputCapEsr",
  "turnOnOverlap", "turnOffOverlap",
  "deadTimeConduction", "reverseRecovery",
  "gateDriveHigh", "gateDriveLow",
  "nodeEnergy", "controllerBias"
]);

function emptyLosses() {
  return Object.fromEntries(LOSS_KEYS_V2.map((key) => [key, null]));
}

function sumKnown(values) {
  return Object.values(values).reduce((sum, value) => sum + (finite(value) ? value : 0), 0);
}

function groupLosses(losses) {
  return {
    mosfetConduction: sumKnown({ high: losses.highSideConduction, low: losses.lowSideConduction }),
    magnetics: sumKnown({ dc: losses.inductorDcCopper, ac: losses.inductorAcCopper, core: losses.inductorCoreResidual }),
    capacitors: sumKnown({ input: losses.inputCapEsr, output: losses.outputCapEsr }),
    switchingTransitions: sumKnown({ on: losses.turnOnOverlap, off: losses.turnOffOverlap }),
    deadTimeRecovery: sumKnown({ dead: losses.deadTimeConduction, qrr: losses.reverseRecovery }),
    gateDrive: sumKnown({ high: losses.gateDriveHigh, low: losses.gateDriveLow }),
    nodeEnergy: sumKnown({ eoss: losses.nodeEnergy }),
    controllerBias: sumKnown({ bias: losses.controllerBias })
  };
}

function currentAtTransition(waveform, kind) {
  if (kind === "turn-on") return Math.max(0, waveform.iValley);
  return Math.max(0, waveform.iPeak);
}

export function computeBuckLossPointV2(inputs, iout, context = {}) {
  const technology = context.technology ?? "gan";
  const controlMode = context.controlMode ?? "auto-dcm";
  const timingMode = context.timingMode ?? (finite(inputs.effectiveTurnOn) ? "effective" : "derived");
  const parameterCorner = context.parameterCorner ?? "typical-25c";
  const catalogKind = context.catalogKind ?? null;
  const waveform = computeBuckWaveformV2(inputs, iout, { controlMode, ccmBoundary: context.ccmBoundary });
  const ccmBoundary = finite(context.ccmBoundary)
    ? context.ccmBoundary
    : waveform.valid ? findCcmBoundaryV2(inputs) : null;
  const losses = emptyLosses();
  const omitted = [];
  const coverageGaps = [];
  const addGap = (term, code, scope = "whole-term", extra = {}) => {
    omitted.push(code);
    coverageGaps.push({ term, code, scope, ...extra });
  };
  const warnings = [...waveform.errors];
  if (!waveform.valid) {
    return {
      valid: false,
      modelVersion: BUCK_LOSS_MODEL_VERSION,
      modelRevision: BUCK_LOSS_MODEL_REVISION,
      technology,
      catalogKind,
      deviceTemplate: context.deviceTemplate ?? null,
      parameterCorner,
      controlMode,
      timingMode,
      iout,
      errors: waveform.errors,
      failure: waveform.failure,
      warnings,
      availability: "subtotal",
      omitted,
      coverageGaps,
      waveform: { ...waveform, ccmBoundary },
      losses,
      groupedLosses: groupLosses(losses),
      provenance: context.provenance ?? {},
      equationProvenance: resolveBuckLossTermMetadataV2(timingMode),
      pOut: null,
      pLoss: null,
      pInEstimated: null,
      efficiency: null,
      insights: {}
    };
  }

  const moments = waveform.moments;
  losses.highSideConduction = moments.highSideRms2 * inputs.rdsHigh;
  losses.lowSideConduction = moments.lowSideRms2 * inputs.rdsLow;
  losses.inductorDcCopper = iout * iout * inputs.dcr;
  losses.inductorAcCopper = Math.max(0, moments.iLrms2 - iout * iout) * inputs.rac;
  if (finite(context.inductorAcLossW)) losses.inductorCoreResidual = context.inductorAcLossW;
  else if (finite(inputs.inductorAcManual)) losses.inductorCoreResidual = inputs.inductorAcManual;
  if (context.inductorCatalogOutOfDomain) {
    addGap("inductorCoreResidual", "inductorCoreResidualDcmWaveform", "catalog-component");
  } else if (!finite(losses.inductorCoreResidual)) {
    addGap("inductorCoreResidual", "inductorCoreResidualMissingData");
  }

  losses.inputCapEsr = moments.inputCapRms2 * inputs.inputEsr;
  losses.outputCapEsr = moments.outputCapRms2 * inputs.esr;

  const transition = transitionModel(inputs, timingMode);
  const vSwing = inputs.vin + inputs.diodeVf;
  const turnOnCurrent = currentAtTransition(waveform, "turn-on");
  const turnOffCurrent = currentAtTransition(waveform, "turn-off");
  if (waveform.mode === "zero-load-unmodeled") {
    addGap("switchingTransitions", "zeroLoadControlBehavior");
  } else if (!transition.available) {
    addGap("switchingTransitions", "switchingTransitionsMissingData", "whole-term", { missingFields: transition.missing ?? [] });
  } else if (transition.method === "effective-override") {
    losses.turnOnOverlap = 0.5 * vSwing * turnOnCurrent * transition.effectiveTurnOn * inputs.fsw;
    losses.turnOffOverlap = 0.5 * vSwing * turnOffCurrent * transition.effectiveTurnOff * inputs.fsw;
  } else {
    losses.turnOnOverlap = vSwing * turnOnCurrent * inputs.fsw * (transition.currentRise / 3 + transition.voltageFall / 2);
    losses.turnOffOverlap = vSwing * turnOffCurrent * inputs.fsw * (transition.voltageRise / 2 + transition.currentFall / 3);
  }

  losses.deadTimeConduction = inputs.diodeVf * moments.deadTimeCurrentAverage;
  if (technology === "gan") {
    losses.reverseRecovery = 0;
  } else if (finite(inputs.qrrRef) && finite(inputs.qrrRefCurrent) && inputs.qrrRefCurrent > 0) {
    const scaledQrr = inputs.qrrRef * turnOnCurrent / inputs.qrrRefCurrent;
    losses.reverseRecovery = waveform.mode === "dcm" ? 0 : vSwing * scaledQrr * inputs.fsw;
  } else {
    addGap("reverseRecovery", "reverseRecoveryMissingData");
  }

  const switchingActive = waveform.mode !== "zero-load-unmodeled";
  losses.gateDriveHigh = switchingActive && finite(inputs.qgHigh) ? inputs.qgHigh * inputs.vDrive * inputs.fsw : switchingActive ? null : 0;
  losses.gateDriveLow = switchingActive && finite(inputs.qgLow) ? inputs.qgLow * inputs.vDrive * inputs.fsw : switchingActive ? null : 0;
  if (switchingActive && (!finite(losses.gateDriveHigh) || !finite(losses.gateDriveLow))) {
    addGap("gateDrive", "gateDriveMissingData");
  }

  if (!switchingActive) {
    losses.nodeEnergy = 0;
  } else if (waveform.mode === "dcm") {
    addGap("nodeEnergy", "nodeEnergyDcmCommutationUnmodeled");
  } else if (!finite(inputs.cossErHigh) || !finite(inputs.cossErLow) || !finite(inputs.eossMaxVoltage)) {
    addGap("nodeEnergy", "nodeEnergyMissingData", "whole-term", {
      missingFields: [
        !finite(inputs.cossErHigh) ? "cossErHigh" : null,
        !finite(inputs.cossErLow) ? "cossErLow" : null,
        !finite(inputs.eossMaxVoltage) ? "eossMaxVoltage" : null
      ].filter(Boolean)
    });
  } else if (inputs.vin <= inputs.eossMaxVoltage + EPSILON) {
    losses.nodeEnergy = 0.5 * (inputs.cossErHigh + inputs.cossErLow) * inputs.vin * inputs.vin * inputs.fsw;
  } else {
    addGap("nodeEnergy", "nodeEnergyOutsideVoltageDomain");
  }
  losses.controllerBias = inputs.vBias * inputs.iq;

  const groupedLosses = groupLosses(losses);
  const pOut = inputs.vout * iout;
  const pLoss = sumKnown(losses);
  const pInEstimated = pOut + pLoss;
  const efficiency = pOut > 0 ? pOut / pInEstimated : null;
  if (waveform.mode === "dcm") warnings.push("dcm");
  if (waveform.mode === "zero-load-unmodeled") warnings.push("zero-load-controller-dependent");
  if (controlMode === "forced-ccm" && waveform.iValley < -EPSILON) warnings.push("negative-current-commutation-approximate");
  if (inputs.inductorIsat !== null && waveform.iPeak > inputs.inductorIsat) warnings.push("isat");
  if (pOut > 0 && pLoss > pOut) warnings.push("high-loss");
  const gateLoss = (losses.gateDriveHigh ?? 0) + (losses.gateDriveLow ?? 0);
  const conductionLoss = (losses.highSideConduction ?? 0) + (losses.lowSideConduction ?? 0);
  const optimumScale = gateLoss > 0 && conductionLoss > 0 ? Math.sqrt(conductionLoss / gateLoss) : null;
  const coreResidualScaling = context.inductorCoreResidualScaling
    ?? (finite(inputs.inductorAcManual) ? "fixed" : "unclassified");
  const fixedCoreResidual = finite(context.inductorCoreResidualFixedW)
    ? clamp(context.inductorCoreResidualFixedW, 0, losses.inductorCoreResidual ?? 0)
    : coreResidualScaling === "fixed" ? losses.inductorCoreResidual : 0;
  const unclassifiedCoreResidual = Math.max(0, (losses.inductorCoreResidual ?? 0) - (fixedCoreResidual ?? 0));

  return {
    valid: true,
    modelVersion: BUCK_LOSS_MODEL_VERSION,
    modelRevision: BUCK_LOSS_MODEL_REVISION,
    technology,
    catalogKind,
    deviceTemplate: context.deviceTemplate ?? null,
    parameterCorner,
    controlMode,
    timingMode,
    iout,
    errors: [],
    failure: null,
    warnings: [...new Set(warnings)],
    availability: coverageGaps.length ? "subtotal" : "total",
    omitted: [...new Set(omitted)],
    coverageGaps,
    provenance: context.provenance ?? {},
    equationProvenance: resolveBuckLossTermMetadataV2(timingMode, transition),
    waveform: {
      ...waveform,
      ccmBoundary
    },
    transition,
    losses,
    groupedLosses,
    pOut,
    pLoss,
    pInEstimated,
    efficiency,
    insights: {
      fetAreaOptimumScale: optimumScale,
      fetAreaBalanceScope: "channel-conduction-vs-gate-drive-only",
      fetAreaProvenance: BUCK_LOSS_ADVISORY_METADATA_V2.fetAreaOptimum,
      lossScaling: {
        fixedLike: sumKnown({
          gate: groupedLosses.gateDrive,
          node: groupedLosses.nodeEnergy,
          bias: groupedLosses.controllerBias,
          manualCoreResidual: fixedCoreResidual
        }),
        currentLike: sumKnown({ transition: groupedLosses.switchingTransitions, dead: groupedLosses.deadTimeRecovery }),
        currentSquaredLike: sumKnown({
          conduction: groupedLosses.mosfetConduction,
          inductorDcCopper: losses.inductorDcCopper,
          inductorAcCopper: losses.inductorAcCopper
        }),
        unclassified: sumKnown({
          capacitors: groupedLosses.capacitors,
          characterizedCoreResidual: unclassifiedCoreResidual
        })
      }
    }
  };
}

export function computeBuckLossSweepV2(inputs, context = {}, options = {}) {
  const points = Math.max(2, Math.floor(options.points ?? 180));
  const iMin = options.iMin ?? 0;
  const iMax = options.iMax ?? inputs.ioutMax;
  const ccmBoundary = findCcmBoundaryV2(inputs);
  const sweepContext = { ...context, ccmBoundary };
  const values = Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    return computeBuckLossPointV2(inputs, iMin + (iMax - iMin) * t, sweepContext);
  });
  const validEfficiency = values.filter((point) => finite(point.efficiency));
  const peakEfficiencyPoint = validEfficiency.reduce(
    (best, point) => !best || point.efficiency > best.efficiency ? point : best,
    null
  );
  return {
    modelVersion: BUCK_LOSS_MODEL_VERSION,
    modelRevision: BUCK_LOSS_MODEL_REVISION,
    points: values,
    annotations: buildBuckLossSweepAnnotationsV2(values, ccmBoundary, peakEfficiencyPoint)
  };
}

function balancePair(points, leftKey, rightKey) {
  const candidates = points.filter((point) => {
    const scaling = point.insights?.lossScaling;
    return point.iout > 0 && scaling?.[leftKey] > 0 && scaling?.[rightKey] > 0;
  });
  const point = candidates.reduce((best, candidate) => {
    const scaling = candidate.insights.lossScaling;
    const distance = Math.abs(Math.log(scaling[leftKey] / scaling[rightKey]));
    return !best || distance < best.distance ? { candidate, distance } : best;
  }, null)?.candidate;
  if (!point) return null;
  return {
    iout: point.iout,
    [leftKey]: point.insights.lossScaling[leftKey],
    [rightKey]: point.insights.lossScaling[rightKey]
  };
}

const LOSS_SCALING_KEYS = Object.freeze(["fixedLike", "currentLike", "currentSquaredLike", "unclassified"]);

function dominantScaling(point) {
  const scaling = point.insights?.lossScaling;
  if (!scaling) return null;
  const total = LOSS_SCALING_KEYS.reduce((sum, key) => sum + Math.max(0, scaling[key] || 0), 0);
  if (!(total > 0)) return { kind: "unclassified", share: 1 };
  const kind = LOSS_SCALING_KEYS.reduce(
    (best, key) => (scaling[key] || 0) > (scaling[best] || 0) ? key : best,
    LOSS_SCALING_KEYS[0]
  );
  return { kind, share: Math.max(0, scaling[kind] || 0) / total };
}

function dominanceRegions(points) {
  const samples = points
    .filter((point) => point.valid && finite(point.iout))
    .map((point) => ({ point, dominant: dominantScaling(point) }))
    .filter((sample) => sample.dominant);
  if (!samples.length) return [];
  const regions = [];
  let start = samples[0].point.iout;
  let kind = samples[0].dominant.kind;
  let shares = [samples[0].dominant.share];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (current.dominant.kind === kind) {
      shares.push(current.dominant.share);
      continue;
    }
    const boundary = (previous.point.iout + current.point.iout) / 2;
    regions.push({
      kind,
      startIout: start,
      endIout: boundary,
      averageShare: shares.reduce((sum, share) => sum + share, 0) / shares.length
    });
    start = boundary;
    kind = current.dominant.kind;
    shares = [current.dominant.share];
  }
  regions.push({
    kind,
    startIout: start,
    endIout: samples.at(-1).point.iout,
    averageShare: shares.reduce((sum, share) => sum + share, 0) / shares.length
  });
  return regions;
}

export function buildBuckLossSweepAnnotationsV2(points, ccmBoundary, peakEfficiencyPoint = null) {
  const peak = peakEfficiencyPoint ?? points.reduce(
    (best, point) => finite(point.efficiency) && (!best || point.efficiency > best.efficiency) ? point : best,
    null
  );
  return {
    ccmBoundary,
    peakEfficiency: peak ? { iout: peak.iout, efficiency: peak.efficiency } : null,
    lossBalance: {
      fixedToCurrentLike: balancePair(points, "fixedLike", "currentLike"),
      currentLikeToCurrentSquared: balancePair(points, "currentLike", "currentSquaredLike"),
      fixedToCurrentSquared: balancePair(points, "fixedLike", "currentSquaredLike")
    },
    dominanceRegions: dominanceRegions(points),
    fetSizingAdvisory: peak && finite(peak.insights?.fetAreaOptimumScale) ? {
      iout: peak.iout,
      scale: peak.insights.fetAreaOptimumScale,
      scope: peak.insights.fetAreaBalanceScope
    } : null,
    zeroLoadControllerDependent: true
  };
}
