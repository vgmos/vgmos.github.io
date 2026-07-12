export const DEFAULT_BUCK_LOSS_PRESET_V2 = "12v-to-3v3-pol";

export const BUCK_LOSS_PRESETS_V2 = Object.freeze([
  Object.freeze({
    id: "12v-to-3v3-pol",
    name: "12 → 3.3 V POL",
    cursor: 2,
    inductorPart: "XGL6060-222",
    dcrMode: "typ",
    prompt: "A 12 Vᵢₙ point-of-load example with a Coilcraft 2.2 µH inductor.",
    rawInputs: Object.freeze({ vin: 12, vout: 3.3, ioutMax: 3, fsw: 1000, inductance: 2.2, deadTime: 2, dcr: 20, rac: null, inputEsr: 5, esr: 5, iq: 2, vBias: null, inductorAcManual: null, inductorIsat: null })
  }),
  Object.freeze({
    id: "5v-to-1v8-core",
    name: "5 → 1.8 V core",
    cursor: 3,
    inductorPart: "XEL4030-471",
    dcrMode: "typ",
    prompt: "A high-current core rail with a characterized 0.47 µH inductor.",
    rawInputs: Object.freeze({ vin: 5, vout: 1.8, ioutMax: 5, fsw: 1500, inductance: 0.47, deadTime: 2, dcr: 8, rac: null, inputEsr: 3, esr: 3, iq: 3, vBias: null, inductorAcManual: null, inductorIsat: null })
  }),
  Object.freeze({
    id: "48v-to-12v-bus",
    name: "48 → 12 V bus",
    cursor: 3,
    inductorPart: "XGL6060-153",
    dcrMode: "typ",
    prompt: "A 48 V bus converter where hard-switch energy and recovery become more visible.",
    rawInputs: Object.freeze({ vin: 48, vout: 12, ioutMax: 5, fsw: 400, inductance: 15, deadTime: 3, dcr: 15, rac: null, inputEsr: 10, esr: 10, iq: 3, vBias: null, inductorAcManual: null, inductorIsat: null })
  })
]);

export const BUCK_LOSS_PRESET_MAP_V2 = new Map(BUCK_LOSS_PRESETS_V2.map((preset) => [preset.id, preset]));

export function getBuckLossPresetV2(id) {
  return BUCK_LOSS_PRESET_MAP_V2.get(id) ?? null;
}
