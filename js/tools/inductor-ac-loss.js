const AXIS_KEYS = ["frequency_Hz", "dc_current_A", "ripple_pp_A"];

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function strictlyIncreasing(values) {
  return Array.isArray(values) && values.length >= 2 && values.every((value, index) => (
    Number.isFinite(value) && (index === 0 || value > values[index - 1])
  ));
}

function tensorIsValid(tensor, axes) {
  if (!Array.isArray(tensor) || tensor.length !== axes.frequency_Hz.length) return false;
  return tensor.every((frequencySlice) => (
    Array.isArray(frequencySlice) &&
    frequencySlice.length === axes.dc_current_A.length &&
    frequencySlice.every((currentSlice) => (
      Array.isArray(currentSlice) &&
      currentSlice.length === axes.ripple_pp_A.length &&
      currentSlice.every((value) => Number.isFinite(value) && value > 0)
    ))
  ));
}

function validateV1Surface(surface) {
  const errors = [];
  const axes = surface?.axes;
  if (!surface || typeof surface !== "object") return { valid: false, errors: ["surface"] };
  if (!Number.isFinite(surface.ambient_C)) errors.push("ambient_C");
  if (!axes || typeof axes !== "object") errors.push("axes");
  else {
    AXIS_KEYS.forEach((key) => {
      if (!strictlyIncreasing(axes[key])) errors.push(`axes.${key}`);
    });
    if (!errors.some((entry) => entry.startsWith("axes")) && !tensorIsValid(surface.ac_loss_W, axes)) {
      errors.push("ac_loss_W");
    }
    const interpolation = surface.interpolation;
    if (interpolation) {
      for (const key of ["frequency_by_interval", "ripple_by_interval"]) {
        const modes = interpolation[key];
        if (!Array.isArray(modes) || modes.length !== axes.frequency_Hz.length - 1 || modes.some((mode) => !["linear", "log"].includes(mode))) {
          errors.push(`interpolation.${key}`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function orderedPair(values, { positive = false } = {}) {
  return Array.isArray(values) && values.length === 2 && values.every((value) => Number.isFinite(value) && (!positive || value > 0)) && values[1] > values[0];
}

function validateV2Surface(surface) {
  const errors = [];
  if (!Number.isFinite(surface?.ambient_C)) errors.push("ambient_C");
  if (surface?.waveform !== "triangular") errors.push("waveform");
  if (!(surface?.reference_current_A > 0)) errors.push("reference_current_A");
  if (!(surface?.selected_isat_A > 0)) errors.push("selected_isat_A");
  if (!(surface?.dcr_typ_mOhm >= 0)) errors.push("dcr_typ_mOhm");
  if (!orderedPair(surface?.verified_domain?.frequency_Hz, { positive: true })) errors.push("verified_domain.frequency_Hz");
  if (!orderedPair(surface?.verified_domain?.ripple_pp_A, { positive: true })) errors.push("verified_domain.ripple_pp_A");
  if (!orderedPair(surface?.guarded_domain?.frequency_Hz, { positive: true })) errors.push("guarded_domain.frequency_Hz");
  if (!Array.isArray(surface?.guarded_domain?.ripple_pp_A) || surface.guarded_domain.ripple_pp_A.length !== 2 || surface.guarded_domain.ripple_pp_A[0] !== 0 || !(surface.guarded_domain.ripple_pp_A[1] > 0)) errors.push("guarded_domain.ripple_pp_A");
  if (orderedPair(surface?.verified_domain?.frequency_Hz, { positive: true }) && orderedPair(surface?.guarded_domain?.frequency_Hz, { positive: true })) {
    if (surface.guarded_domain.frequency_Hz[0] > surface.verified_domain.frequency_Hz[0] || surface.guarded_domain.frequency_Hz[1] < surface.verified_domain.frequency_Hz[1]) errors.push("guarded_domain.frequency_Hz-coverage");
  }
  if (orderedPair(surface?.verified_domain?.ripple_pp_A, { positive: true }) && Array.isArray(surface?.guarded_domain?.ripple_pp_A)) {
    if (surface.guarded_domain.ripple_pp_A[1] < surface.verified_domain.ripple_pp_A[1]) errors.push("guarded_domain.ripple_pp_A-coverage");
  }
  if (!Array.isArray(surface?.knots) || surface.knots.length < 2) errors.push("knots");
  else if (!surface.knots.every((knot, index) => (
    knot?.frequency_Hz > 0 && knot?.a_W_per_A_pow_B > 0 && knot?.b > 0 &&
    (index === 0 || knot.frequency_Hz > surface.knots[index - 1].frequency_Hz) &&
    orderedPair(knot.measured_ripple_pp_A, { positive: true })
  ))) errors.push("knots");
  return { valid: errors.length === 0, errors };
}

export function validateInductorAcSurface(surface) {
  if (surface?.model_schema_version === 2) return validateV2Surface(surface);
  return validateV1Surface(surface);
}

function bracket(axis, value, transform = (next) => next) {
  if (value < axis[0] || value > axis.at(-1)) return null;
  if (value === axis.at(-1)) return { lower: axis.length - 2, upper: axis.length - 1, t: 1 };
  let lower = 0;
  while (lower + 1 < axis.length && value > axis[lower + 1]) lower += 1;
  const upper = lower + 1;
  const start = transform(axis[lower]);
  const end = transform(axis[upper]);
  const t = end === start ? 0 : (transform(value) - start) / (end - start);
  return { lower, upper, t };
}

function intervalIndex(axis, value) {
  if (value === axis.at(-1)) return axis.length - 2;
  let lower = 0;
  while (lower + 1 < axis.length && value > axis[lower + 1]) lower += 1;
  return Math.min(lower, axis.length - 2);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function interpolateLogLoss(tensor, frequency, current, ripple) {
  const at = (fi, ci, ri) => Math.log(tensor[fi][ci][ri]);
  const c000 = at(frequency.lower, current.lower, ripple.lower);
  const c001 = at(frequency.lower, current.lower, ripple.upper);
  const c010 = at(frequency.lower, current.upper, ripple.lower);
  const c011 = at(frequency.lower, current.upper, ripple.upper);
  const c100 = at(frequency.upper, current.lower, ripple.lower);
  const c101 = at(frequency.upper, current.lower, ripple.upper);
  const c110 = at(frequency.upper, current.upper, ripple.lower);
  const c111 = at(frequency.upper, current.upper, ripple.upper);
  const lowFrequency = mix(
    mix(c000, c001, ripple.t),
    mix(c010, c011, ripple.t),
    current.t
  );
  const highFrequency = mix(
    mix(c100, c101, ripple.t),
    mix(c110, c111, ripple.t),
    current.t
  );
  return Math.exp(mix(lowFrequency, highFrequency, frequency.t));
}

function estimateV1Surface(surface, operatingPoint = {}) {
  if (!surface) {
    return { status: "not-characterized", lossW: null, outsideAxes: [], method: null };
  }
  const validation = validateV1Surface(surface);
  if (!validation.valid) {
    return { status: "invalid", lossW: null, outsideAxes: [], method: null, errors: validation.errors };
  }

  const frequencyHz = Number(operatingPoint.frequencyHz);
  const dcCurrentA = Number(operatingPoint.dcCurrentA);
  const ripplePpA = Number(operatingPoint.ripplePpA);
  const ambientC = operatingPoint.ambientC === undefined ? 25 : Number(operatingPoint.ambientC);
  if (!(frequencyHz > 0) || !finiteNonnegative(dcCurrentA) || !finiteNonnegative(ripplePpA) || !Number.isFinite(ambientC)) {
    return { status: "invalid", lossW: null, outsideAxes: [], method: null, errors: ["operating-point"] };
  }

  if (ripplePpA === 0) {
    return { status: "estimated", lossW: 0, outsideAxes: [], method: "analytical-zero-ripple" };
  }

  const outsideAxes = [];
  const { axes } = surface;
  if (frequencyHz < axes.frequency_Hz[0] || frequencyHz > axes.frequency_Hz.at(-1)) outsideAxes.push("frequency");
  if (dcCurrentA < axes.dc_current_A[0] || dcCurrentA > axes.dc_current_A.at(-1)) outsideAxes.push("dc-current");
  if (ripplePpA < axes.ripple_pp_A[0] || ripplePpA > axes.ripple_pp_A.at(-1)) outsideAxes.push("ripple-current");
  if (ambientC !== surface.ambient_C) outsideAxes.push("ambient-temperature");
  if (outsideAxes.length) {
    return { status: "out-of-domain", lossW: null, outsideAxes, method: null };
  }

  const log = (value) => Math.log(value);
  const identity = (value) => value;
  const frequencyInterval = intervalIndex(axes.frequency_Hz, frequencyHz);
  const frequencyMode = surface.interpolation?.frequency_by_interval?.[frequencyInterval] ?? "log";
  const rippleMode = surface.interpolation?.ripple_by_interval?.[frequencyInterval] ?? "log";
  const frequency = bracket(axes.frequency_Hz, frequencyHz, frequencyMode === "linear" ? identity : log);
  const current = bracket(axes.dc_current_A, dcCurrentA);
  const ripple = bracket(axes.ripple_pp_A, ripplePpA, rippleMode === "linear" ? identity : log);
  const lossW = interpolateLogLoss(surface.ac_loss_W, frequency, current, ripple);
  if (!finiteNonnegative(lossW)) {
    return { status: "invalid", lossW: null, outsideAxes: [], method: null, errors: ["interpolation"] };
  }
  return {
    status: "estimated",
    lossW,
    outsideAxes: [],
    method: `trilinear-${frequencyMode}-frequency-${rippleMode}-ripple-log-loss`
  };
}

function knotBracket(knots, frequencyHz) {
  if (frequencyHz <= knots[0].frequency_Hz) return { lower: 0, upper: 1 };
  if (frequencyHz >= knots.at(-1).frequency_Hz) return { lower: knots.length - 2, upper: knots.length - 1 };
  let lower = 0;
  while (lower + 1 < knots.length && frequencyHz > knots[lower + 1].frequency_Hz) lower += 1;
  return { lower, upper: lower + 1 };
}

function estimateV2Surface(surface, operatingPoint = {}) {
  const validation = validateV2Surface(surface);
  if (!validation.valid) return { status: "invalid", lossW: null, outsideAxes: [], method: null, errors: validation.errors };
  const frequencyHz = Number(operatingPoint.frequencyHz);
  const dcCurrentA = Number(operatingPoint.dcCurrentA);
  const ripplePpA = Number(operatingPoint.ripplePpA);
  const ambientC = operatingPoint.ambientC === undefined ? 25 : Number(operatingPoint.ambientC);
  const waveform = operatingPoint.waveform ?? "triangular";
  if (!(frequencyHz > 0) || !finiteNonnegative(dcCurrentA) || !finiteNonnegative(ripplePpA) || !Number.isFinite(ambientC)) {
    return { status: "invalid", lossW: null, outsideAxes: [], method: null, errors: ["operating-point"] };
  }
  const outsideAxes = [];
  const guardedFrequency = surface.guarded_domain.frequency_Hz;
  const guardedRipple = surface.guarded_domain.ripple_pp_A;
  if (frequencyHz < guardedFrequency[0] || frequencyHz > guardedFrequency[1]) outsideAxes.push("frequency");
  if (ripplePpA > guardedRipple[1]) outsideAxes.push("ripple-current");
  if (dcCurrentA + ripplePpA / 2 > surface.selected_isat_A) outsideAxes.push("peak-current");
  if (ambientC !== surface.ambient_C) outsideAxes.push("ambient-temperature");
  if (waveform !== surface.waveform) outsideAxes.push("waveform");
  if (outsideAxes.length) return { status: "out-of-domain", lossW: null, outsideAxes, method: null };
  if (ripplePpA === 0) {
    return {
      status: "interpolated",
      lossW: 0,
      vendorLossW: 0,
      rippleDcrLossW: 0,
      outsideAxes: [],
      method: "analytical-zero-ripple",
      guarded: false
    };
  }

  const { lower, upper } = knotBracket(surface.knots, frequencyHz);
  const low = surface.knots[lower];
  const high = surface.knots[upper];
  const denominator = Math.log(high.frequency_Hz) - Math.log(low.frequency_Hz);
  const fraction = denominator === 0 ? 0 : (Math.log(frequencyHz) - Math.log(low.frequency_Hz)) / denominator;
  const logA = Math.log(low.a_W_per_A_pow_B) + (Math.log(high.a_W_per_A_pow_B) - Math.log(low.a_W_per_A_pow_B)) * fraction;
  const b = low.b + (high.b - low.b) * fraction;
  const vendorLossW = Math.exp(logA) * ripplePpA ** b;
  const rippleDcrLossW = ripplePpA ** 2 / 12 * surface.dcr_typ_mOhm * 1e-3;
  const lossW = Math.max(0, vendorLossW - rippleDcrLossW);
  const verifiedFrequency = surface.verified_domain.frequency_Hz;
  const verifiedRipple = surface.verified_domain.ripple_pp_A;
  const guarded = frequencyHz < verifiedFrequency[0] || frequencyHz > verifiedFrequency[1] || ripplePpA < verifiedRipple[0] || ripplePpA > verifiedRipple[1];
  const frequencyKnot = surface.knots.find((knot) => Math.abs(knot.frequency_Hz - frequencyHz) <= 1e-9 * Math.max(1, frequencyHz));
  const measuredRipple = frequencyKnot?.measured_ripple_pp_A?.some((value) => Math.abs(value - ripplePpA) <= 1e-9 * Math.max(1, ripplePpA));
  const status = guarded ? "guarded-extrapolation" : frequencyKnot && measuredRipple ? "measured-knot" : "interpolated";
  return {
    status,
    lossW,
    vendorLossW,
    rippleDcrLossW,
    outsideAxes: [],
    method: "log-frequency-interpolated-ripple-power-law",
    guarded,
    interpolated: { a_W_per_A_pow_B: Math.exp(logA), b }
  };
}

export function estimateInductorAcLoss(surface, operatingPoint = {}) {
  if (!surface) return { status: "not-characterized", lossW: null, outsideAxes: [], method: null };
  if (surface.model_schema_version === 2) return estimateV2Surface(surface, operatingPoint);
  return estimateV1Surface(surface, operatingPoint);
}
