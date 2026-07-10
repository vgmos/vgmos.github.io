export const BUCK_LOSS_MODEL_VERSION = 2;

const field = (config) => Object.freeze(config);

export const BUCK_LOSS_SCHEMA_V2 = Object.freeze({
  vin: field({ url: "vin", group: "operating", label: "Input voltage", unit: "V", scale: 1, min: 1, max: 100, default: 12 }),
  vout: field({ url: "vout", group: "operating", label: "Output voltage", unit: "V", scale: 1, min: 0.3, max: 95, default: 3.3 }),
  ioutMax: field({ url: "imax", group: "operating", label: "Maximum load", unit: "A", scale: 1, min: 0.05, max: 60, default: 3 }),
  fsw: field({ url: "fsw", group: "operating", label: "Switching frequency", unit: "kHz", scale: 1e3, min: 50, max: 6000, default: 1000 }),
  inductance: field({ url: "l", group: "operating", label: "Inductance", unit: "µH", scale: 1e-6, min: 0.1, max: 470, default: 2.2 }),

  rdsHigh: field({ url: "rhs", group: "device", label: "High-side RDS(on)", unit: "mΩ", scale: 1e-3, min: 0.1, max: 500, default: null }),
  rdsLow: field({ url: "rls", group: "device", label: "Low-side RDS(on)", unit: "mΩ", scale: 1e-3, min: 0.1, max: 500, default: null }),
  qgHigh: field({ url: "qgh", group: "drive", label: "High-side QG", unit: "nC", scale: 1e-9, min: 0, max: 500, default: null }),
  qgLow: field({ url: "qgl", group: "drive", label: "Low-side QG", unit: "nC", scale: 1e-9, min: 0, max: 500, default: null }),
  qgs2High: field({ url: "qgs2h", group: "drive", timingMode: "derived", label: "High-side QGS2", unit: "nC", scale: 1e-9, min: 0, max: 200, default: null, optional: true }),
  qgs2Low: field({ url: "qgs2l", group: "drive", timingMode: "derived", label: "Low-side QGS2", unit: "nC", scale: 1e-9, min: 0, max: 200, default: null, optional: true }),
  qgdHigh: field({ url: "qgdh", group: "drive", timingMode: "derived", label: "High-side QGD", unit: "nC", scale: 1e-9, min: 0, max: 200, default: null, optional: true }),
  qgdLow: field({ url: "qgdl", group: "drive", timingMode: "derived", label: "Low-side QGD", unit: "nC", scale: 1e-9, min: 0, max: 200, default: null, optional: true }),
  plateauHigh: field({ url: "vplh", group: "drive", timingMode: "derived", label: "High-side plateau voltage", unit: "V", scale: 1, min: 0.1, max: 10, default: null, optional: true }),
  plateauLow: field({ url: "vpll", group: "drive", timingMode: "derived", label: "Low-side plateau voltage", unit: "V", scale: 1, min: 0.1, max: 10, default: null, optional: true }),
  gateResistanceOnHigh: field({ url: "rgonh", group: "drive", timingMode: "derived", label: "High-side turn-on gate resistance", unit: "Ω", scale: 1, min: 0.05, max: 100, default: null, optional: true }),
  gateResistanceOffHigh: field({ url: "rgoffh", group: "drive", timingMode: "derived", label: "High-side turn-off gate resistance", unit: "Ω", scale: 1, min: 0.05, max: 100, default: null, optional: true }),
  gateResistanceOnLow: field({ url: "rgonl", group: "drive", timingMode: "derived", label: "Low-side turn-on gate resistance", unit: "Ω", scale: 1, min: 0.05, max: 100, default: null, optional: true }),
  gateResistanceOffLow: field({ url: "rgoffl", group: "drive", timingMode: "derived", label: "Low-side turn-off gate resistance", unit: "Ω", scale: 1, min: 0.05, max: 100, default: null, optional: true }),
  effectiveTurnOn: field({ url: "teon", group: "drive", timingMode: "effective", label: "Effective turn-on overlap", unit: "ns", scale: 1e-9, min: 0, max: 500, default: null, optional: true }),
  effectiveTurnOff: field({ url: "teoff", group: "drive", timingMode: "effective", label: "Effective turn-off overlap", unit: "ns", scale: 1e-9, min: 0, max: 500, default: null, optional: true }),
  deadTime: field({ url: "td", group: "timing", label: "Dead time per edge", unit: "ns", scale: 1e-9, min: 0, max: 500, default: 20 }),
  diodeVf: field({ url: "vsd", group: "timing", label: "Reverse-path voltage", unit: "V", scale: 1, min: 0, max: 5, default: null }),
  qrrRef: field({ url: "qrr", group: "timing", technology: "silicon", label: "QRR at reference current", unit: "nC", scale: 1e-9, min: 0, max: 1000, default: 0 }),
  qrrRefCurrent: field({ url: "qrri", group: "timing", technology: "silicon", label: "QRR reference current", unit: "A", scale: 1, min: 0.01, max: 200, default: 10 }),

  dcr: field({ url: "rdc", group: "magnetics", label: "Inductor RDC", unit: "mΩ", scale: 1e-3, min: 0, max: 1000, default: 20 }),
  rac: field({ url: "rac", group: "magnetics", label: "Inductor ripple RAC", unit: "mΩ", scale: 1e-3, min: 0, max: 5000, default: null, optional: true }),
  inductorAcManual: field({ url: "pcore", group: "magnetics", label: "Manual AC/core residual", unit: "mW", scale: 1e-3, min: 0, max: 100000, default: null, optional: true }),
  inductorIsat: field({ url: "isat", group: "magnetics", label: "Inductor ISAT", unit: "A", scale: 1, min: 0.1, max: 200, default: null, optional: true }),

  inputEsr: field({ url: "esrin", group: "capacitors", label: "Input capacitor ESR", unit: "mΩ", scale: 1e-3, min: 0, max: 1000, default: 5 }),
  esr: field({ url: "esrout", group: "capacitors", label: "Output capacitor ESR", unit: "mΩ", scale: 1e-3, min: 0, max: 1000, default: 5 }),
  cossErHigh: field({ url: "cossh", group: "device", label: "High-side COSS(ER)", unit: "pF", scale: 1e-12, min: 0, max: 100000, default: null, optional: true }),
  cossErLow: field({ url: "cossl", group: "device", label: "Low-side COSS(ER)", unit: "pF", scale: 1e-12, min: 0, max: 100000, default: null, optional: true }),
  eossMaxVoltage: field({ url: "eossv", group: "device", label: "EOSS characterization limit", unit: "V", scale: 1, min: 0.1, max: 1000, default: null, optional: true }),

  vDrive: field({ url: "vdrv", group: "drive", uiOrder: -1, label: "Gate drive voltage", unit: "V", scale: 1, min: 1, max: 15, default: 5 }),
  iq: field({ url: "iq", group: "controller", label: "Controller quiescent current", unit: "mA", scale: 1e-3, min: 0, max: 100, default: 2 }),
  vBias: field({ url: "vbias", group: "controller", label: "Controller bias voltage", unit: "V", scale: 1, min: 0.1, max: 100, default: null, optional: true })
});

export const BUCK_LOSS_ENUMS_V2 = Object.freeze({
  technology: Object.freeze(["gan", "silicon"]),
  controlMode: Object.freeze(["auto-dcm", "forced-ccm"]),
  timingMode: Object.freeze(["derived", "effective"])
});

export const BUCK_LOSS_GROUPS_V2 = Object.freeze([
  Object.freeze({ id: "operating", label: "Operating point", primary: true }),
  Object.freeze({ id: "device", label: "Device & technology" }),
  Object.freeze({ id: "drive", label: "Gate drive & transitions", modeControl: "timing" }),
  Object.freeze({ id: "timing", label: "Timing, dead time & recovery" }),
  Object.freeze({ id: "magnetics", label: "Inductor & magnetics", catalog: true }),
  Object.freeze({ id: "capacitors", label: "Input & output capacitors" }),
  Object.freeze({ id: "controller", label: "Controller & comparison", modeControl: "control" })
]);

export function buckLossFieldKeysForGroupV2(groupId) {
  return Object.entries(BUCK_LOSS_SCHEMA_V2)
    .filter(([, config]) => config.group === groupId)
    .sort(([, left], [, right]) => (left.uiOrder ?? 0) - (right.uiOrder ?? 0))
    .map(([key]) => key);
}

export const BUCK_LOSS_URL_ORDER_V2 = Object.freeze([
  "m", "p", "device", "control", "timing", "part", "dcrm",
  ...Object.values(BUCK_LOSS_SCHEMA_V2).map((config) => config.url),
  "i"
]);

export function rawDefaultsV2() {
  return Object.fromEntries(Object.entries(BUCK_LOSS_SCHEMA_V2).map(([key, config]) => [key, config.default]));
}

export function normalizeBuckLossInputsV2(raw = {}) {
  const normalized = {};
  const provenance = {};
  for (const [key, config] of Object.entries(BUCK_LOSS_SCHEMA_V2)) {
    const supplied = raw[key] !== undefined;
    const candidate = supplied ? raw[key] : config.default;
    if (candidate === "" || candidate === null || candidate === undefined) {
      normalized[key] = null;
      provenance[key] = raw.__provenance?.[key] ?? "missing";
      continue;
    }
    const number = Number(candidate);
    normalized[key] = Number.isFinite(number) ? number * config.scale : null;
    provenance[key] = raw.__provenance?.[key] ?? (supplied ? "entered" : "default");
  }
  normalized.vBias = normalized.vBias ?? normalized.vin;
  if (provenance.vBias === "missing") provenance.vBias = "inferred-from-vin";
  normalized.rac = normalized.rac ?? normalized.dcr;
  if (provenance.rac === "missing") provenance.rac = "inferred-rac-equals-rdc";
  return { inputs: normalized, provenance };
}

export function denormalizeBuckLossInputsV2(inputs = {}) {
  const raw = {};
  for (const [key, config] of Object.entries(BUCK_LOSS_SCHEMA_V2)) {
    const value = inputs[key];
    raw[key] = value === null || value === undefined ? null : value / config.scale;
  }
  return raw;
}

export function validateBuckLossInputsV2(inputs = {}) {
  const errors = [];
  for (const [key, config] of Object.entries(BUCK_LOSS_SCHEMA_V2)) {
    const value = inputs[key];
    if (value === null) {
      if (!config.optional) errors.push(key);
      continue;
    }
    const displayValue = value / config.scale;
    const rangeTolerance = 1e-12 * Math.max(1, Math.abs(config.min), Math.abs(config.max));
    if (!Number.isFinite(value) || displayValue < config.min - rangeTolerance || displayValue > config.max + rangeTolerance) errors.push(key);
  }
  if (!(inputs.vout < inputs.vin)) errors.push("vout-lt-vin");
  if (!(inputs.ioutMax > 0)) errors.push("ioutMax");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function schemaConfigForUrlKeyV2(urlKey) {
  return Object.entries(BUCK_LOSS_SCHEMA_V2).find(([, config]) => config.url === urlKey) ?? null;
}
