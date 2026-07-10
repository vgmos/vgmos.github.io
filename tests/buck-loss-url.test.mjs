import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PRESET_ID, getBuckLossPreset } from "../js/tools/buck-loss-presets.js";
import {
  makeBuckLossState,
  parseBuckLossUrl,
  serializeBuckLossUrl
} from "../js/tools/buck-loss-url.js";

describe("buck loss URL state", () => {
  it("round-trips parse and serialize through canonical state", () => {
    const first = parseBuckLossUrl("?p=48v-to-12v-bus&fsw=800&eoss=20&qrr=4&lac=12.5&isat=4&i=2.5");
    assert.equal(first.activePresetId, null);
    assert.equal(first.requestedPresetId, "48v-to-12v-bus");
    assert.equal(first.rawInputs.fsw, 800);
    assert.equal(first.rawInputs.eossTotal, 20);
    assert.equal(first.rawInputs.qrr, 4);
    assert.equal(first.rawInputs.inductorAcManual, 12.5);
    assert.equal(first.rawInputs.inductorIsat, 4);
    assert.equal(first.cursor, 2.5);
    const canonical = serializeBuckLossUrl(first);
    const second = parseBuckLossUrl(canonical);
    assert.deepEqual(second.rawInputs, first.rawInputs);
    assert.equal(second.cursor, first.cursor);
    assert.equal(serializeBuckLossUrl(second), canonical);
  });

  it("clamps out-of-range values and records one quiet note", () => {
    const parsed = parseBuckLossUrl("?vin=0&vout=500&imax=1000&fsw=-1&l=0&rhs=-4&vf=9&iq=99&i=1000");
    assert.equal(parsed.rawInputs.vin, 1);
    assert.equal(parsed.rawInputs.vout, 0.95);
    assert.equal(parsed.rawInputs.ioutMax, 60);
    assert.equal(parsed.rawInputs.fsw, 50);
    assert.equal(parsed.rawInputs.inductance, 0.1);
    assert.equal(parsed.rawInputs.rdsHigh, 0.1);
    assert.equal(parsed.rawInputs.diodeVf, 2.5);
    assert.equal(parsed.rawInputs.iq, 20);
    assert.equal(parsed.cursor, 60);
    assert.equal(parsed.notes.filter((entry) => entry.code === "clamped").length, 1);
  });

  it("lets explicit vin win over conflicting vout", () => {
    const parsed = parseBuckLossUrl("?vin=10&vout=15&i=1");
    assert.equal(parsed.rawInputs.vin, 10);
    assert.equal(parsed.rawInputs.vout, 9.5);
    assert.equal(parsed.cursor, 1);
    assert.equal(parsed.notes.filter((entry) => entry.code === "clamped").length, 1);
  });

  it("raises vin when only vout needs buck headroom", () => {
    const parsed = parseBuckLossUrl("?vout=15&i=1");
    assert.equal(parsed.rawInputs.vout, 15);
    assert.equal(parsed.rawInputs.vin, 15 / 0.95);
    assert.equal(parsed.notes.filter((entry) => entry.code === "clamped").length, 1);
  });

  it("clamps huge gate-charge parameters without keeping unknown keys", () => {
    const parsed = parseBuckLossUrl("?qhs=9999&banana=1&i=1");
    assert.equal(parsed.rawInputs.qgHigh, 100);
    assert.equal(parsed.notes.filter((entry) => entry.code === "clamped").length, 1);
    assert.ok(!serializeBuckLossUrl(parsed).includes("banana"));
  });

  it("ignores unknown keys", () => {
    const parsed = parseBuckLossUrl("?banana=1&vin=24&nope=2&i=1");
    assert.equal(parsed.rawInputs.vin, 24);
    assert.equal(parsed.cursor, 1);
    assert.equal(parsed.notes.length, 0);
    assert.ok(!serializeBuckLossUrl(parsed).includes("banana"));
  });

  it("allows zero current cursor for the linear plot axis", () => {
    const parsed = parseBuckLossUrl("?p=12v-to-3v3-pol&i=0");
    assert.equal(parsed.cursor, 0);
    assert.equal(serializeBuckLossUrl(parsed), "p=12v-to-3v3-pol&i=0");
  });

  it("applies preset precedence before explicit parameters", () => {
    const parsed = parseBuckLossUrl("?p=5v-to-1v8-core&vin=12&vout=3.3&i=4");
    assert.equal(parsed.rawInputs.ioutMax, 5);
    assert.equal(parsed.rawInputs.fsw, 1500);
    assert.equal(parsed.rawInputs.vin, 12);
    assert.equal(parsed.rawInputs.vout, 3.3);
    assert.equal(parsed.cursor, 4);
    assert.equal(parsed.activePresetId, null);
  });

  it("resolves removed picker presets only for legacy shared-link fidelity", () => {
    const parsed = parseBuckLossUrl("?p=high-freq-compact&i=2");
    assert.equal(parsed.requestedPresetId, "high-freq-compact");
    assert.equal(parsed.activePresetId, "high-freq-compact");
    assert.equal(parsed.rawInputs.fsw, 3000);
    assert.equal(parsed.rawInputs.inductance, 0.68);
    assert.equal(serializeBuckLossUrl(parsed), "p=high-freq-compact&i=2");
  });

  it("uses default preset and note for unknown preset ids", () => {
    const parsed = parseBuckLossUrl("?p=not-real&i=2");
    const defaultPreset = getBuckLossPreset(DEFAULT_PRESET_ID);
    assert.deepEqual(parsed.rawInputs, defaultPreset.rawInputs);
    assert.equal(parsed.cursor, 2);
    assert.equal(parsed.activePresetId, DEFAULT_PRESET_ID);
    assert.equal(parsed.notes[0].code, "unknown-preset");
  });

  it("omits pristine preset defaults while always including current", () => {
    const preset = getBuckLossPreset(DEFAULT_PRESET_ID);
    const state = makeBuckLossState(preset.rawInputs, {
      activePresetId: DEFAULT_PRESET_ID,
      requestedPresetId: DEFAULT_PRESET_ID,
      cursor: preset.cursor
    });
    assert.equal(serializeBuckLossUrl(state), "p=12v-to-3v3-pol&i=2");

    const parsed = parseBuckLossUrl("");
    assert.equal(parsed.activePresetId, DEFAULT_PRESET_ID);
    assert.equal(serializeBuckLossUrl(parsed), "p=12v-to-3v3-pol&i=2");
  });

  it("serializes optional blank values only when explicitly set", () => {
    const preset = getBuckLossPreset(DEFAULT_PRESET_ID);
    const blankState = makeBuckLossState(preset.rawInputs, {
      activePresetId: DEFAULT_PRESET_ID,
      cursor: preset.cursor
    });
    assert.equal(serializeBuckLossUrl(blankState), "p=12v-to-3v3-pol&i=2");

    const explicit = makeBuckLossState({ ...preset.rawInputs, vBias: 5, inductorIsat: 2 }, {
      cursor: preset.cursor,
      explicitOptional: { vBias: true, inductorIsat: true }
    });
    assert.equal(serializeBuckLossUrl(explicit), "vbias=5&isat=2&i=2");
  });

  it("round-trips selected inductor identity and DCR mode", () => {
    const parsed = parseBuckLossUrl("?part=xgl6060-222&dcrm=max&l=2.2&dcr=4.8&isat=12.1&i=4");
    assert.equal(parsed.selectedInductorPart, "XGL6060-222");
    assert.equal(parsed.inductorDcrMode, "max");
    const canonical = serializeBuckLossUrl(parsed);
    assert.ok(canonical.includes("part=XGL6060-222"));
    assert.ok(canonical.includes("dcrm=max"));
    const roundTrip = parseBuckLossUrl(canonical);
    assert.equal(roundTrip.selectedInductorPart, parsed.selectedInductorPart);
    assert.equal(roundTrip.inductorDcrMode, "max");
  });

  it("quietly rejects malformed part and DCR mode URL values", () => {
    const parsed = parseBuckLossUrl("?part=%3Cscript%3E&dcrm=worst&i=1");
    assert.equal(parsed.selectedInductorPart, null);
    assert.equal(parsed.inductorDcrMode, "typ");
    assert.deepEqual(parsed.notes.map((entry) => entry.code), ["unknown-inductor", "unknown-dcr-mode"]);
  });
});
