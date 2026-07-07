const OPTIONAL_ZERO_KEYS = ["eossTotal", "qrr"];

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function optionalPositive(value) {
  if (value === "" || value === null || value === undefined) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function optionalBias(value, vin) {
  if (value === "" || value === null || value === undefined) return vin;
  const next = Number(value);
  return Number.isFinite(next) ? next : vin;
}

function makeNullCore() {
  return {
    D: null,
    Ts: null,
    ton: null,
    toff: null,
    deltaIL: null,
    iPeak: null,
    iValley: null,
    iLrms2: null,
    iCapRms2: null,
    iHighRms2: null,
    iLowRms2: null
  };
}

function makeNullLosses() {
  return {
    condHigh: null,
    condLow: null,
    dcr: null,
    esr: null,
    gate: null,
    switching: null,
    deadTime: null,
    bias: null,
    eoss: null,
    qrr: null
  };
}

function makeNullGroupedLosses() {
  return {
    fetConduction: null,
    inductorDcr: null,
    switchingOverlap: null,
    deadTime: null,
    gateDrive: null,
    bias: null,
    rippleOther: null
  };
}

function hasOnlyFiniteNumbers(value) {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumbers);
  if (typeof value === "object") return Object.values(value).every(hasOnlyFiniteNumbers);
  return true;
}

export function normalizeInputs(rawInputs = {}) {
  const vin = toNumber(rawInputs.vin);
  const normalized = {
    vin,
    vout: toNumber(rawInputs.vout),
    ioutMax: toNumber(rawInputs.ioutMax),
    fsw: toNumber(rawInputs.fsw) * 1e3,
    inductance: toNumber(rawInputs.inductance) * 1e-6,
    rdsHigh: toNumber(rawInputs.rdsHigh) * 1e-3,
    rdsLow: toNumber(rawInputs.rdsLow) * 1e-3,
    qgHigh: toNumber(rawInputs.qgHigh) * 1e-9,
    qgLow: toNumber(rawInputs.qgLow) * 1e-9,
    tOverlap: toNumber(rawInputs.tOverlap) * 1e-9,
    deadTime: toNumber(rawInputs.deadTime) * 1e-9,
    diodeVf: toNumber(rawInputs.diodeVf),
    dcr: toNumber(rawInputs.dcr) * 1e-3,
    esr: toNumber(rawInputs.esr) * 1e-3,
    vDrive: toNumber(rawInputs.vDrive),
    iq: toNumber(rawInputs.iq) * 1e-3,
    vBias: optionalBias(rawInputs.vBias ?? rawInputs.vbias, vin),
    eossTotal: toNumber(rawInputs.eossTotal) * 1e-9,
    qrr: toNumber(rawInputs.qrr) * 1e-9,
    inductorIsat: optionalPositive(rawInputs.inductorIsat ?? rawInputs.isat)
  };

  OPTIONAL_ZERO_KEYS.forEach((key) => {
    if (!Number.isFinite(normalized[key])) normalized[key] = 0;
  });

  return normalized;
}

export function validateInputs(inputs = {}) {
  const errors = [];
  const nonnegative = [
    "rdsHigh",
    "rdsLow",
    "qgHigh",
    "qgLow",
    "tOverlap",
    "deadTime",
    "diodeVf",
    "dcr",
    "esr",
    "vDrive",
    "vBias",
    "eossTotal",
    "qrr"
  ];

  if (!(inputs.vin > 0)) errors.push("vin");
  if (!(inputs.vout > 0)) errors.push("vout");
  if (!(inputs.vout < inputs.vin)) errors.push("vout-lt-vin");
  if (!(inputs.ioutMax > 0)) errors.push("ioutMax");
  if (!(inputs.fsw > 0)) errors.push("fsw");
  if (!(inputs.inductance > 0)) errors.push("inductance");

  nonnegative.forEach((key) => {
    if (!(inputs[key] >= 0)) errors.push(key);
  });
  if (!(inputs.iq >= 0)) errors.push("iq");
  if (!(inputs.inductorIsat === null || inputs.inductorIsat > 0)) errors.push("inductorIsat");

  return { valid: errors.length === 0, errors };
}

export function computeBuckCore(inputs, iout) {
  const validation = validateInputs(inputs);
  if (!validation.valid || !(iout >= 0)) {
    return { valid: false, errors: validation.errors, core: makeNullCore() };
  }

  const D = inputs.vout / inputs.vin;
  const Ts = 1 / inputs.fsw;
  const ton = D * Ts;
  const toff = (1 - D) * Ts;
  const deltaIL = ((inputs.vin - inputs.vout) * D) / (inputs.fsw * inputs.inductance);
  const iPeak = iout + deltaIL / 2;
  const iValley = iout - deltaIL / 2;
  const iLrms2 = iout ** 2 + deltaIL ** 2 / 12;
  const iCapRms2 = deltaIL ** 2 / 12;
  const iHighRms2 = D * iLrms2;
  const iLowRms2 = (1 - D) * iLrms2;

  return {
    valid: true,
    errors: [],
    core: { D, Ts, ton, toff, deltaIL, iPeak, iValley, iLrms2, iCapRms2, iHighRms2, iLowRms2 }
  };
}

export function computeLossPoint(inputs, iout) {
  const coreResult = computeBuckCore(inputs, iout);
  if (!coreResult.valid) {
    return {
      valid: false,
      errors: coreResult.errors,
      iout,
      core: coreResult.core,
      losses: makeNullLosses(),
      groupedLosses: makeNullGroupedLosses(),
      pOut: null,
      pLoss: null,
      pInEstimated: null,
      efficiency: null,
      warnings: []
    };
  }

  const { core } = coreResult;
  const tr = inputs.tOverlap / 2;
  const tf = inputs.tOverlap / 2;
  const positiveValley = Math.max(core.iValley, 0);
  const positivePeak = Math.max(core.iPeak, 0);
  const losses = {
    condHigh: core.iHighRms2 * inputs.rdsHigh,
    condLow: core.iLowRms2 * inputs.rdsLow,
    dcr: core.iLrms2 * inputs.dcr,
    esr: core.iCapRms2 * inputs.esr,
    gate: (inputs.qgHigh + inputs.qgLow) * inputs.vDrive * inputs.fsw,
    switching: 0.5 * inputs.vin * inputs.fsw * (tr * positiveValley + tf * positivePeak),
    deadTime: inputs.diodeVf * inputs.fsw * inputs.deadTime * (positiveValley + positivePeak),
    bias: inputs.vBias * inputs.iq,
    eoss: inputs.eossTotal * inputs.fsw,
    qrr: inputs.vin * inputs.qrr * inputs.fsw
  };

  // With tr = tf and iValley >= 0:
  // switching = 0.5 * vin * fsw * tOverlap * iout, and
  // deadTime = 2 * diodeVf * fsw * deadTime * iout.
  const groupedLosses = {
    fetConduction: losses.condHigh + losses.condLow,
    inductorDcr: losses.dcr,
    switchingOverlap: losses.switching,
    deadTime: losses.deadTime,
    gateDrive: losses.gate,
    bias: losses.bias,
    rippleOther: losses.esr + losses.eoss + losses.qrr
  };
  const pOut = inputs.vout * iout;
  const pLoss = Object.values(losses).reduce((sum, value) => sum + value, 0);
  const pInEstimated = pOut + pLoss;
  const efficiency = pOut > 0 ? pOut / pInEstimated : 0;
  const warnings = [];

  if (core.iValley < 0) warnings.push("forced-ccm");
  if (core.deltaIL / inputs.ioutMax > 0.6) warnings.push("high-ripple");
  if (inputs.inductorIsat !== null && core.iPeak > inputs.inductorIsat) warnings.push("isat");
  if (pLoss > pOut) warnings.push("high-loss");
  if (core.D < 0.03 || core.D > 0.95) warnings.push("extreme-duty");

  return {
    valid: hasOnlyFiniteNumbers({ core, losses, groupedLosses, pOut, pLoss, pInEstimated, efficiency }),
    errors: [],
    iout,
    core,
    losses,
    groupedLosses,
    pOut,
    pLoss,
    pInEstimated,
    efficiency,
    warnings
  };
}

export function computeLossSweep(inputs, options = {}) {
  const points = Math.max(2, Math.floor(options.points ?? 200));
  const iMin = options.iMin ?? Math.max(inputs.ioutMax / 1000, 1e-3);
  const iMax = options.iMax ?? inputs.ioutMax;
  if (!(iMin > 0) || !(iMax > iMin)) {
    return Array.from({ length: points }, () => computeLossPoint(inputs, iMax));
  }
  const logMin = Math.log(iMin);
  const logMax = Math.log(iMax);
  return Array.from({ length: points }, (_, index) => {
    const t = points === 1 ? 0 : index / (points - 1);
    return computeLossPoint(inputs, Math.exp(logMin + (logMax - logMin) * t));
  });
}

const SENTENCES = {
  conduction: "Most loss here scales with current squared. Lower RDS(on) or inductor DCR helps more than lowering fSW.",
  fetConduction: "Most loss here scales with current squared. Lower RDS(on) or inductor DCR helps more than lowering fSW.",
  dcr: "The inductor's resistance owns this region. A larger or better wire gauge helps more than FET changes.",
  inductorDcr: "The inductor's resistance owns this region. A larger or better wire gauge helps more than FET changes.",
  frequency: "Most loss here is frequency- and edge-dependent. Lower fSW or faster effective edges help -- but ripple and EMI move too.",
  switching: "Most loss here is frequency- and edge-dependent. Lower fSW or faster effective edges help -- but ripple and EMI move too.",
  switchingOverlap: "Most loss here is frequency- and edge-dependent. Lower fSW or faster effective edges help -- but ripple and EMI move too.",
  deadTime: "Dead-time loss is noticeable here. Each edge spends time in a diode-like path instead of a low-RDS(on) channel.",
  floor: "Delivered power is small enough that gate drive and bias power dominate",
  gateDrive: "Delivered power is small enough that gate drive and bias power dominate",
  bias: "Delivered power is small enough that gate drive and bias power dominate",
  rippleOther: "No single mechanism dominates. This is the region where frequency, FET sizing, and inductor choice trade against each other.",
  balanced: "No single mechanism dominates. This is the region where frequency, FET sizing, and inductor choice trade against each other.",
  invalid: "Invalid inputs."
};

function sentenceFor(regime, forcedCCM, lightLoad) {
  let sentence = SENTENCES[regime] ?? SENTENCES.balanced;
  if (regime === "floor" && lightLoad) {
    sentence += " -- this is why real converters change modes at light load.";
  } else if (regime === "floor") {
    sentence += ".";
  }
  if (forcedCCM) {
    sentence = "The inductor current reverses here -- real converters may enter DCM, diode emulation, or PFM. " + sentence;
  }
  return sentence;
}

export function classifyRegime(result, inputs) {
  if (!result || result.valid === false || !(result.pLoss > 0)) {
    return { regime: "invalid", forcedCCM: false, lightLoad: false, sentence: SENTENCES.invalid };
  }

  const forcedCCM = result.core.iValley < 0;
  const lightLoad = result.iout < 0.1 * inputs.ioutMax;
  const shares = Object.fromEntries(
    Object.entries(result.groupedLosses).map(([key, value]) => [key, value / result.pLoss])
  );

  let regime = "balanced";
  if (shares.gateDrive + shares.bias >= 0.5) {
    regime = "floor";
  } else {
    const dominant = Object.entries(shares).find(([, share]) => share >= 0.45);
    if (dominant) {
      regime = dominant[0];
    } else if (shares.fetConduction + shares.inductorDcr >= 0.55) {
      regime = "conduction";
    } else {
      const frequencyShare =
        (result.losses.switching + result.losses.deadTime + result.losses.gate + result.losses.eoss + result.losses.qrr) /
        result.pLoss;
      if (frequencyShare >= 0.55) regime = "frequency";
    }
  }

  return {
    regime,
    forcedCCM,
    lightLoad,
    shares,
    sentence: sentenceFor(regime, forcedCCM, lightLoad)
  };
}
