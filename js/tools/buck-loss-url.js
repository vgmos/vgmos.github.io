import { BUCK_LOSS_PRESET_MAP, DEFAULT_PRESET_ID, getBuckLossPreset } from "./buck-loss-presets.js";

export const PARAM_RANGES = {
  vin: { min: 1, max: 100 },
  vout: { min: 0.3, max: 95 },
  ioutMax: { min: 0.05, max: 60 },
  fsw: { min: 50, max: 6000 },
  inductance: { min: 0.1, max: 470 },
  rdsHigh: { min: 0.1, max: 500 },
  rdsLow: { min: 0.1, max: 500 },
  qgHigh: { min: 0, max: 100 },
  qgLow: { min: 0, max: 100 },
  tOverlap: { min: 0, max: 200 },
  deadTime: { min: 0, max: 200 },
  diodeVf: { min: 0.2, max: 1.2 },
  dcr: { min: 0, max: 500 },
  esr: { min: 0, max: 500 },
  vDrive: { min: 2.5, max: 12 },
  iq: { min: 0, max: 20 },
  vBias: { min: 1, max: 100, optional: true },
  eossTotal: { min: 0, max: 1000 },
  qrr: { min: 0, max: 500 },
  inductorIsat: { min: 0.1, max: 200, optional: true }
};

export const URL_KEY_TO_INPUT = {
  vin: "vin",
  vout: "vout",
  imax: "ioutMax",
  fsw: "fsw",
  l: "inductance",
  rhs: "rdsHigh",
  rls: "rdsLow",
  qhs: "qgHigh",
  qls: "qgLow",
  tov: "tOverlap",
  td: "deadTime",
  vf: "diodeVf",
  dcr: "dcr",
  esr: "esr",
  vdrv: "vDrive",
  iq: "iq",
  vbias: "vBias",
  eoss: "eossTotal",
  qrr: "qrr",
  isat: "inductorIsat"
};

export const INPUT_TO_URL_KEY = Object.fromEntries(
  Object.entries(URL_KEY_TO_INPUT).map(([urlKey, inputKey]) => [inputKey, urlKey])
);

const ORDERED_URL_KEYS = [
  "p",
  "vin",
  "vout",
  "imax",
  "fsw",
  "l",
  "rhs",
  "rls",
  "qhs",
  "qls",
  "tov",
  "td",
  "vf",
  "dcr",
  "esr",
  "vdrv",
  "iq",
  "vbias",
  "eoss",
  "qrr",
  "isat",
  "i"
];

function cloneRaw(rawInputs) {
  return { ...rawInputs };
}

function note(code, message) {
  return { code, message };
}

function parseSearch(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return new URLSearchParams();
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes("?")) {
      return new URL(raw, "https://example.invalid").searchParams;
    }
  } catch {
    return new URLSearchParams(raw.replace(/^[?#]/, ""));
  }
  return new URLSearchParams(raw.replace(/^[?#]/, ""));
}

function readNumber(value) {
  if (value === null || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function clampNumber(value, range) {
  const number = readNumber(value);
  if (number === null) return { value: null, clamped: false, valid: false };
  const clamped = Math.min(range.max, Math.max(range.min, number));
  return { value: clamped, clamped: clamped !== number, valid: true };
}

function cursorMin(rawInputs) {
  return 0;
}

function clampCursor(value, rawInputs) {
  const min = cursorMin(rawInputs);
  const max = rawInputs.ioutMax;
  const number = readNumber(value);
  if (number === null) return { value: min, clamped: true, valid: false };
  const clamped = Math.min(max, Math.max(min, number));
  return { value: clamped, clamped: clamped !== number, valid: true };
}

function resolveBuck(rawInputs, explicitInputs) {
  const cap = 0.95 * rawInputs.vin;
  if (rawInputs.vout <= cap) return false;
  if (explicitInputs.has("vin")) {
    rawInputs.vout = cap;
  } else if (explicitInputs.has("vout")) {
    const requiredVin = rawInputs.vout / 0.95;
    const clampedVin = Math.min(PARAM_RANGES.vin.max, Math.max(PARAM_RANGES.vin.min, requiredVin));
    rawInputs.vin = clampedVin;
    if (rawInputs.vout > 0.95 * rawInputs.vin) {
      rawInputs.vout = 0.95 * rawInputs.vin;
    }
  } else {
    rawInputs.vout = cap;
  }
  return true;
}

function valuesEqual(a, b) {
  if (a === null || b === null) return a === b;
  return Number(a) === Number(b);
}

function rawInputsEqual(a, b, explicitOptional) {
  return Object.keys(PARAM_RANGES).every((key) => {
    if ((key === "vBias" || key === "inductorIsat") && explicitOptional?.[key]) return false;
    return valuesEqual(a[key], b[key]);
  });
}

function canonicalNumber(value) {
  if (value === null || value === undefined) return "";
  return String(Number(value));
}

function knownUrlKeys(params) {
  return [...params.keys()].filter((key) => key === "p" || key === "i" || URL_KEY_TO_INPUT[key]);
}

export function makeBuckLossState(rawInputs, options = {}) {
  const defaultPreset = getBuckLossPreset(DEFAULT_PRESET_ID);
  const activePresetId = options.activePresetId ?? null;
  return {
    rawInputs: cloneRaw(rawInputs),
    cursor: options.cursor ?? defaultPreset.cursor,
    activePresetId,
    requestedPresetId: options.requestedPresetId ?? activePresetId,
    explicitOptional: {
      vBias: Boolean(options.explicitOptional?.vBias),
      inductorIsat: Boolean(options.explicitOptional?.inductorIsat)
    },
    notes: options.notes ? [...options.notes] : []
  };
}

export function parseBuckLossUrl(searchString) {
  const params = parseSearch(searchString);
  const notes = [];
  const defaultPreset = getBuckLossPreset(DEFAULT_PRESET_ID);
  const hasKnownParams = knownUrlKeys(params).length > 0;
  const requestedPresetId = params.get("p") || DEFAULT_PRESET_ID;
  let preset = defaultPreset;

  if (params.has("p")) {
    const found = getBuckLossPreset(params.get("p"));
    if (found) {
      preset = found;
    } else {
      notes.push(note("unknown-preset", "Unknown preset in the URL; loaded the default example instead."));
    }
  }

  const rawInputs = cloneRaw(preset.rawInputs);
  const explicitOptional = { vBias: false, inductorIsat: false };
  const explicitInputs = new Set();
  let clamped = false;

  for (const [urlKey, inputKey] of Object.entries(URL_KEY_TO_INPUT)) {
    if (!params.has(urlKey)) continue;
    const range = PARAM_RANGES[inputKey];
    if (range.optional && params.get(urlKey) === "") {
      rawInputs[inputKey] = null;
      explicitOptional[inputKey] = false;
      continue;
    }
    const next = clampNumber(params.get(urlKey), range);
    if (!next.valid) {
      clamped = true;
      continue;
    }
    rawInputs[inputKey] = next.value;
    explicitInputs.add(inputKey);
    if (range.optional) explicitOptional[inputKey] = true;
    if (next.clamped) clamped = true;
  }

  if (resolveBuck(rawInputs, explicitInputs)) clamped = true;
  rawInputs.vout = Math.max(PARAM_RANGES.vout.min, Math.min(rawInputs.vout, 0.95 * rawInputs.vin));
  let cursor = preset.cursor;
  if (params.has("i")) {
    const nextCursor = clampCursor(params.get("i"), rawInputs);
    cursor = nextCursor.value;
    if (nextCursor.clamped) clamped = true;
  } else if (!hasKnownParams) {
    cursor = defaultPreset.cursor;
  }

  if (clamped) {
    notes.push(note("clamped", "Some URL values were outside the allowed range and were clamped."));
  }

  const activePresetId = rawInputsEqual(rawInputs, preset.rawInputs, explicitOptional) ? preset.id : null;

  return {
    rawInputs,
    cursor,
    activePresetId,
    requestedPresetId,
    explicitOptional,
    notes
  };
}

export function serializeBuckLossUrl(state) {
  const activePreset = state.activePresetId ? getBuckLossPreset(state.activePresetId) : null;
  const baseline = activePreset?.rawInputs ?? getBuckLossPreset(DEFAULT_PRESET_ID).rawInputs;
  const entries = [];

  if (activePreset) entries.push(["p", activePreset.id]);

  for (const urlKey of ORDERED_URL_KEYS) {
    if (urlKey === "p" || urlKey === "i") continue;
    const inputKey = URL_KEY_TO_INPUT[urlKey];
    if (!inputKey) continue;
    const value = state.rawInputs[inputKey];
    const baselineValue = baseline[inputKey];
    if (inputKey === "vBias" || inputKey === "inductorIsat") {
      if (!state.explicitOptional?.[inputKey]) continue;
    }
    if (!valuesEqual(value, baselineValue)) entries.push([urlKey, canonicalNumber(value)]);
  }

  const cursor = clampCursor(state.cursor, state.rawInputs).value;
  entries.push(["i", canonicalNumber(cursor)]);

  return entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

export function knownPresetIds() {
  return [...BUCK_LOSS_PRESET_MAP.keys()];
}
