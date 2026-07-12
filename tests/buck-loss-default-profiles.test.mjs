import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BUCK_LOSS_DEVICE_TEMPLATES_V2,
  applyBuckLossDeviceTemplateV2,
  getBuckLossDeviceTemplateV2
} from "../js/tools/buck-loss-device-templates-v2.js";
import { evaluateBuckLossPointV2 } from "../js/tools/buck-loss-evaluator-v2.js";
import { BUCK_LOSS_PRESETS_V2, getBuckLossPresetV2 } from "../js/tools/buck-loss-presets-v2.js";
import { BUCK_LOSS_MODEL_REVISION, normalizeBuckLossInputsV2, rawDefaultsV2 } from "../js/tools/buck-loss-schema-v2.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/buck-loss-default-profiles.v1.json", import.meta.url), "utf8"));
const inductorAcDataset = JSON.parse(readFileSync(new URL("../assets/data/coilcraft-inductor-loss-surfaces.v1.json", import.meta.url), "utf8"));

function relative(actual, expected, tolerance = 1e-11) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= scale * tolerance, `${actual} != ${expected}`);
}

function profileSetup(presetId, deviceId) {
  const preset = getBuckLossPresetV2(presetId);
  const template = getBuckLossDeviceTemplateV2(deviceId);
  const applied = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...preset.rawInputs }, deviceId);
  const { inputs, provenance } = normalizeBuckLossInputsV2(applied.rawInputs);
  return {
    preset,
    template,
    inputs,
    context: {
      technology: template.technology,
      deviceTemplate: template.id,
      catalogKind: template.catalogKind,
      parameterCorner: template.cornerId,
      timingMode: template.timingMode,
      controlMode: "auto-dcm",
      provenance,
      inductorPartNumber: preset.inductorPart,
      inductorAcDataset
    }
  };
}

describe("buck loss shipped preload profiles", () => {
  it("pins every preset/device cursor vector and its compatibility contract", () => {
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.modelRevision, BUCK_LOSS_MODEL_REVISION);
    assert.equal(fixture.profiles.length, BUCK_LOSS_PRESETS_V2.length * BUCK_LOSS_DEVICE_TEMPLATES_V2.length);
    assert.equal(new Set(fixture.profiles.map((profile) => `${profile.presetId}:${profile.deviceId}`)).size, fixture.profiles.length);

    for (const profile of fixture.profiles) {
      const { preset, template, inputs, context } = profileSetup(profile.presetId, profile.deviceId);
      assert.deepEqual(profile.resolved, {
        vinV: preset.rawInputs.vin,
        voutV: preset.rawInputs.vout,
        ioutMaxA: preset.rawInputs.ioutMax,
        inductanceUh: preset.rawInputs.inductance,
        dcrMohm: preset.rawInputs.dcr,
        racMohm: preset.rawInputs.rac,
        isatA: preset.rawInputs.inductorIsat
      });
      assert.equal(profile.compatible, template.voltageClass >= preset.rawInputs.vin);
      assert.equal(profile.cursorA, preset.cursor);

      const point = evaluateBuckLossPointV2(inputs, profile.cursorA, context);
      assert.equal(point.valid, true);
      assert.equal(point.availability, profile.expected.availability);
      assert.equal(point.waveform.mode, profile.expected.waveformMode);
      assert.deepEqual(point.omitted, profile.expected.omitted);
      relative(point.pLoss, profile.expected.pLossW);
      relative(point.efficiency, profile.expected.efficiency);
      relative(point.pInEstimated, point.pOut + point.pLoss);
      assert.ok(point.pLoss < point.pOut);
      assert.ok(point.efficiency > 0 && point.efficiency < 1);
      Object.values(point.losses).filter(Number.isFinite).forEach((loss) => assert.ok(loss >= 0));

      const dominant = Object.entries(point.groupedLosses)
        .filter(([, value]) => Number.isFinite(value))
        .sort((left, right) => right[1] - left[1])[0][0];
      assert.equal(dominant, profile.expected.dominantFamily);
      if (profile.compatible) assert.ok(point.waveform.iPeak <= inputs.inductorIsat);
    }
  });

  it("uses the named Coilcraft part values before catalog resolution", () => {
    const expected = {
      "12v-to-3v3-pol": { inductance: 2.2, dcr: 4.3, rac: 4.3, inductorIsat: 12.1 },
      "5v-to-1v8-core": { inductance: 0.47, dcr: 4.1, rac: 4.1, inductorIsat: 15.5 },
      "48v-to-12v-bus": { inductance: 15, dcr: 28.2, rac: 28.2, inductorIsat: 4.4 }
    };
    for (const preset of BUCK_LOSS_PRESETS_V2) {
      Object.entries(expected[preset.id]).forEach(([key, value]) => {
        assert.equal(preset.rawInputs[key], value);
        assert.equal(preset.rawInputs.__provenance[key], "coilcraft-datasheet");
      });
    }
    const bus = getBuckLossPresetV2("48v-to-12v-bus");
    assert.equal(bus.rawInputs.ioutMax, 3.5);
    assert.equal(bus.cursor, 3);
  });

  it("keeps every compatible default sweep below the selected inductor ISAT", () => {
    let busPeak = 0;
    for (const preset of BUCK_LOSS_PRESETS_V2) {
      for (const template of BUCK_LOSS_DEVICE_TEMPLATES_V2.filter((candidate) => candidate.voltageClass >= preset.rawInputs.vin)) {
        const { inputs, context } = profileSetup(preset.id, template.id);
        for (let index = 0; index <= 100; index += 1) {
          const current = inputs.ioutMax * index / 100;
          const point = evaluateBuckLossPointV2(inputs, current, context);
          assert.equal(point.valid, true, `${preset.id}:${template.id}:${current}`);
          assert.ok(point.waveform.iPeak <= inputs.inductorIsat + 1e-12, `${preset.id}:${template.id}:${current}`);
          if (preset.id === "48v-to-12v-bus") busPeak = Math.max(busPeak, point.waveform.iPeak);
        }
      }
    }
    assert.ok(busPeak > 4.25 && busPeak < 4.26);
  });

  it("changes only core-residual coverage when the characterization asset is absent", () => {
    for (const preset of BUCK_LOSS_PRESETS_V2) {
      const { inputs, context } = profileSetup(preset.id, "epc2090");
      const resolved = evaluateBuckLossPointV2(inputs, preset.cursor, context);
      const fallback = evaluateBuckLossPointV2(inputs, preset.cursor, { ...context, inductorAcDataset: null });
      assert.equal(fallback.losses.inductorDcCopper, resolved.losses.inductorDcCopper);
      assert.equal(fallback.losses.inductorAcCopper, resolved.losses.inductorAcCopper);
      assert.equal(fallback.losses.inductorCoreResidual, null);
      assert.equal(fallback.availability, "subtotal");
      if (["12v-to-3v3-pol", "5v-to-1v8-core"].includes(preset.id)) assert.ok(resolved.losses.inductorCoreResidual > 0);
      else assert.equal(resolved.losses.inductorCoreResidual, null);
    }
  });
});
