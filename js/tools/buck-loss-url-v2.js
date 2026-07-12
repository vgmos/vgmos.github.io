import {
  BUCK_LOSS_MODEL_VERSION,
  BUCK_LOSS_SCHEMA_V2,
  BUCK_LOSS_URL_ORDER_V2,
  rawDefaultsV2
} from "./buck-loss-schema-v2.js";
import { applyBuckLossDeviceTemplateV2, getBuckLossDeviceTemplateV2 } from "./buck-loss-device-templates-v2.js";
import { DEFAULT_BUCK_LOSS_PRESET_V2, getBuckLossPresetV2 } from "./buck-loss-presets-v2.js";

function paramsFrom(input) {
  const text = String(input ?? "").trim();
  if (!text) return new URLSearchParams();
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.includes("?")) {
      return new URL(text, "https://example.invalid").searchParams;
    }
  } catch {
    return new URLSearchParams(text.replace(/^[?#]/, ""));
  }
  return new URLSearchParams(text.replace(/^[?#]/, ""));
}

function finiteNumber(value) {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

function equalValue(left, right) {
  if (left === right) return true;
  if (left === null || right === null || left === undefined || right === undefined) return false;
  return Math.abs(Number(left) - Number(right)) <= Math.max(1e-12, Math.abs(Number(right)) * 1e-10);
}

function baselineFor(presetId, deviceId) {
  const preset = getBuckLossPresetV2(presetId) ?? getBuckLossPresetV2(DEFAULT_BUCK_LOSS_PRESET_V2);
  const base = { ...rawDefaultsV2(), ...(preset?.rawInputs || {}) };
  return applyBuckLossDeviceTemplateV2(base, deviceId).rawInputs;
}

export function detectBuckLossUrlVersion(input) {
  const params = paramsFrom(input);
  if ([...params.keys()].length === 0) return { route: "v2-bare", params };
  return params.get("m") === String(BUCK_LOSS_MODEL_VERSION)
    ? { route: "v2", params }
    : { route: "legacy-v1", params };
}

export function parseBuckLossUrlV2(input, options = {}) {
  const { route, params } = detectBuckLossUrlVersion(input);
  if (route === "legacy-v1") return { route, rawSearch: params.toString() };

  const notes = [];
  const requestedPreset = params.get("p") || DEFAULT_BUCK_LOSS_PRESET_V2;
  const preset = getBuckLossPresetV2(requestedPreset) ?? getBuckLossPresetV2(DEFAULT_BUCK_LOSS_PRESET_V2);
  if (requestedPreset !== preset.id) notes.push({ code: "unknown-preset" });
  const requestedDevice = params.get("device") || options.rememberedDeviceId || null;
  const device = requestedDevice ? getBuckLossDeviceTemplateV2(requestedDevice) : null;
  if (requestedDevice && !device) notes.push({ code: "unknown-device" });

  let rawInputs = { ...rawDefaultsV2(), ...preset.rawInputs };
  if (device) rawInputs = applyBuckLossDeviceTemplateV2(rawInputs, device.id).rawInputs;
  for (const [key, config] of Object.entries(BUCK_LOSS_SCHEMA_V2)) {
    if (!params.has(config.url)) continue;
    const value = finiteNumber(params.get(config.url));
    if (value === null) {
      if (config.optional) {
        rawInputs[key] = null;
        rawInputs.__provenance = { ...(rawInputs.__provenance || {}), [key]: "url-entered" };
      }
      else notes.push({ code: "invalid-parameter", key });
      continue;
    }
    const limited = clamp(value, config.min, config.max);
    rawInputs[key] = limited;
    if (limited !== value) notes.push({ code: "clamped", key });
    rawInputs.__provenance = { ...(rawInputs.__provenance || {}), [key]: "url-entered" };
  }

  const cursorRaw = finiteNumber(params.get("i"));
  const cursor = clamp(cursorRaw ?? preset.cursor, 0, rawInputs.ioutMax);
  const controlMode = params.get("control") === "forced-ccm" ? "forced-ccm" : "auto-dcm";
  const requestedTimingMode = params.get("timing");
  const timingMode = ["auto", "derived", "effective"].includes(requestedTimingMode)
    ? requestedTimingMode
    : device?.timingMode ?? "auto";
  const part = params.get("part") || preset.inductorPart || null;
  const dcrMode = params.get("dcrm") === "max" ? "max" : "typ";
  return {
    route,
    modelVersion: BUCK_LOSS_MODEL_VERSION,
    needsDevice: !device,
    presetId: preset.id,
    deviceId: device?.id ?? null,
    technology: device?.technology ?? null,
    controlMode,
    timingMode,
    rawInputs,
    custom: Object.values(BUCK_LOSS_SCHEMA_V2).some((config) => params.has(config.url)),
    cursor,
    selectedInductorPart: part,
    inductorDcrMode: dcrMode,
    notes
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toPrecision(12)));
}

export function serializeBuckLossUrlV2(state) {
  const presetId = getBuckLossPresetV2(state.presetId)?.id ?? DEFAULT_BUCK_LOSS_PRESET_V2;
  const deviceId = getBuckLossDeviceTemplateV2(state.deviceId)?.id ?? null;
  if (!deviceId) throw new Error("A v2 device template is required before serializing state.");
  const baseline = baselineFor(presetId, deviceId);
  const values = new Map();
  values.set("m", String(BUCK_LOSS_MODEL_VERSION));
  values.set("p", presetId);
  values.set("device", deviceId);
  values.set("control", state.controlMode === "forced-ccm" ? "forced-ccm" : "auto-dcm");
  values.set("timing", ["auto", "derived", "effective"].includes(state.timingMode) ? state.timingMode : "auto");
  if (state.selectedInductorPart) values.set("part", state.selectedInductorPart);
  if (state.inductorDcrMode === "max") values.set("dcrm", "max");
  for (const [key, config] of Object.entries(BUCK_LOSS_SCHEMA_V2)) {
    const value = state.rawInputs?.[key];
    if (equalValue(value, baseline[key])) continue;
    if (value === null || value === undefined || value === "") {
      if (config.optional) values.set(config.url, "");
      continue;
    }
    const number = Number(value);
    if (Number.isFinite(number)) values.set(config.url, formatNumber(number));
  }
  values.set("i", formatNumber(clamp(Number(state.cursor) || 0, 0, Number(state.rawInputs.ioutMax) || 0)));

  const params = new URLSearchParams();
  BUCK_LOSS_URL_ORDER_V2.forEach((key) => {
    if (values.has(key)) params.set(key, values.get(key));
  });
  return params.toString();
}
