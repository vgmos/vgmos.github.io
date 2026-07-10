import { BUCK_LOSS_MODEL_VERSION, validateBuckLossInputsV2 } from "./buck-loss-schema-v2.js";
import { BUCK_LOSS_ADVISORY_METADATA_V2, BUCK_LOSS_TERM_METADATA_V2 } from "./buck-loss-equations-v2.js";

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

function invalidWaveform(errors, mode = "invalid") {
  return {
    valid: false,
    errors,
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
  if (!(dead >= 0) || 2 * dead >= period) return invalidWaveform(["dead-time-infeasible"], "ccm");

  const rInductor = inputs.dcr;
  const highVoltage = inputs.vin - inputs.vout - iout * (inputs.rdsHigh + rInductor);
  const lowVoltage = -inputs.vout - iout * (inputs.rdsLow + rInductor);
  const deadVoltage = -inputs.vout - inputs.diodeVf - iout * rInductor;
  const deadFraction = dead / period;
  if (!(highVoltage > 0)) return invalidWaveform(["dropout"], "ccm");
  const denominator = highVoltage - lowVoltage;
  if (!(denominator > 0)) return invalidWaveform(["dropout"], "ccm");

  const highFraction = -(lowVoltage + 2 * deadFraction * (deadVoltage - lowVoltage)) / denominator;
  const lowFraction = 1 - highFraction - 2 * deadFraction;
  if (!(highFraction > 0 && highFraction < 1) || lowFraction < -1e-10) {
    return invalidWaveform([lowFraction < 0 ? "low-side-window-negative" : "duty-infeasible"], "ccm");
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
    return invalidWaveform(["volt-second-solve"], "ccm");
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
  const tHigh = highFraction * period;
  const highNumerator = (inputs.vin - inputs.vout) * tHigh;
  const highDenominator = inputs.inductance + 0.5 * (inputs.rdsHigh + inputs.dcr) * tHigh;
  const peak = highDenominator > 0 ? highNumerator / highDenominator : 0;
  if (!(peak >= 0 && finite(peak))) return null;

  const deadRate = (inputs.vout + inputs.diodeVf + 0.5 * peak * inputs.dcr) / inputs.inductance;
  const timeToZeroInDead = deadRate > 0 ? peak / deadRate : Infinity;
  const tDead = Math.min(inputs.deadTime, timeToZeroInDead);
  const afterDead = Math.max(0, peak - deadRate * tDead);
  const lowRate = (inputs.vout + 0.5 * afterDead * (inputs.rdsLow + inputs.dcr)) / inputs.inductance;
  const tLow = afterDead > 0 && lowRate > 0 ? afterDead / lowRate : 0;
  const activeTime = tHigh + tDead + tLow;
  if (activeTime > period + 1e-12) return { feasible: false, average: Infinity };

  const zeroTime = Math.max(0, period - activeTime);
  const segments = [
    makeSegment("high-side", tHigh, 0, peak, { sourceConnected: true, slope: tHigh > 0 ? peak / tHigh : 0 }),
    makeSegment("dead-time", tDead, peak, afterDead, { sourceConnected: false, slope: -deadRate }),
    makeSegment("low-side", tLow, afterDead, 0, { sourceConnected: false, slope: -lowRate }),
    makeSegment("zero-current", zeroTime, 0, 0, { sourceConnected: false, slope: 0 })
  ].filter((segment) => segment.duration > EPSILON || segment.state === "zero-current");
  const average = sumSegments(segments, "currentIntegral") / period;
  return { feasible: true, average, segments, peak, tHigh, tDead, tLow, zeroTime, period };
}

function maximumDcmCandidate(inputs) {
  const period = 1 / inputs.fsw;
  let low = 0;
  let high = Math.max(0, 1 - inputs.deadTime / period);
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
    return invalidWaveform(["dcm-load-above-boundary"], "dcm");
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
    return invalidWaveform(["dcm-load-solve"], "dcm");
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
      deadTime: finalCandidate.tDead / period,
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
  const waveform = computeBuckWaveformV2(inputs, iout, { controlMode, ccmBoundary: context.ccmBoundary });
  const ccmBoundary = finite(context.ccmBoundary)
    ? context.ccmBoundary
    : waveform.valid ? findCcmBoundaryV2(inputs) : null;
  const losses = emptyLosses();
  const omitted = [];
  const warnings = [...waveform.errors];
  if (!waveform.valid) {
    return {
      valid: false,
      modelVersion: BUCK_LOSS_MODEL_VERSION,
      technology,
      deviceTemplate: context.deviceTemplate ?? null,
      parameterCorner: "typical-25c",
      controlMode,
      timingMode,
      iout,
      errors: waveform.errors,
      warnings,
      availability: "subtotal",
      omitted,
      waveform: { ...waveform, ccmBoundary },
      losses,
      groupedLosses: groupLosses(losses),
      provenance: context.provenance ?? {},
      equationProvenance: BUCK_LOSS_TERM_METADATA_V2,
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
  else omitted.push("inductorCoreResidual");

  losses.inputCapEsr = moments.inputCapRms2 * inputs.inputEsr;
  losses.outputCapEsr = moments.outputCapRms2 * inputs.esr;

  const transition = transitionModel(inputs, timingMode);
  const vSwing = inputs.vin + inputs.diodeVf;
  const turnOnCurrent = currentAtTransition(waveform, "turn-on");
  const turnOffCurrent = currentAtTransition(waveform, "turn-off");
  if (waveform.mode === "zero-load-unmodeled") {
    omitted.push("zeroLoadControlBehavior");
  } else if (!transition.available) {
    omitted.push("switchingTransitions");
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
    omitted.push("reverseRecovery");
  }

  const switchingActive = waveform.mode !== "zero-load-unmodeled";
  losses.gateDriveHigh = switchingActive && finite(inputs.qgHigh) ? inputs.qgHigh * inputs.vDrive * inputs.fsw : switchingActive ? null : 0;
  losses.gateDriveLow = switchingActive && finite(inputs.qgLow) ? inputs.qgLow * inputs.vDrive * inputs.fsw : switchingActive ? null : 0;
  if (switchingActive && (!finite(losses.gateDriveHigh) || !finite(losses.gateDriveLow))) omitted.push("gateDrive");

  const eossInDomain = finite(inputs.eossMaxVoltage) && inputs.vin <= inputs.eossMaxVoltage + EPSILON;
  if (!switchingActive) {
    losses.nodeEnergy = 0;
  } else if (finite(inputs.cossErHigh) && finite(inputs.cossErLow) && eossInDomain) {
    losses.nodeEnergy = 0.5 * (inputs.cossErHigh + inputs.cossErLow) * inputs.vin * inputs.vin * inputs.fsw;
  } else {
    omitted.push(eossInDomain ? "nodeEnergy" : "nodeEnergyOutsideVoltageDomain");
  }
  losses.controllerBias = inputs.vBias * inputs.iq;

  const groupedLosses = groupLosses(losses);
  const pOut = inputs.vout * iout;
  const pLoss = sumKnown(losses);
  const pInEstimated = pOut + pLoss;
  const efficiency = pOut > 0 ? pOut / pInEstimated : null;
  if (waveform.mode === "dcm") warnings.push("dcm");
  if (waveform.mode === "zero-load-unmodeled") warnings.push("zero-load-controller-dependent");
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
    technology,
    deviceTemplate: context.deviceTemplate ?? null,
    parameterCorner: "typical-25c",
    controlMode,
    timingMode,
    iout,
    errors: [],
    warnings: [...new Set(warnings)],
    availability: omitted.length ? "subtotal" : "total",
    omitted: [...new Set(omitted)],
    provenance: context.provenance ?? {},
    equationProvenance: BUCK_LOSS_TERM_METADATA_V2,
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
    fetSizingAdvisory: peak && finite(peak.insights?.fetAreaOptimumScale) ? {
      iout: peak.iout,
      scale: peak.insights.fetAreaOptimumScale,
      scope: peak.insights.fetAreaBalanceScope
    } : null,
    zeroLoadControllerDependent: true
  };
}
