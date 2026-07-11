import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBuckLossDeviceTemplateV2 } from "../js/tools/buck-loss-device-templates-v2.js";
import { BUCK_LOSS_TERM_METADATA_V2 } from "../js/tools/buck-loss-equations-v2.js";
import { computeBuckLossPointV2 } from "../js/tools/buck-loss-model-v2.js";
import { normalizeBuckLossInputsV2, rawDefaultsV2 } from "../js/tools/buck-loss-schema-v2.js";

function point(raw, loadA) {
  const templated = applyBuckLossDeviceTemplateV2({
    ...rawDefaultsV2(),
    rdsHigh: 0.1,
    rdsLow: 0.1,
    dcr: 0,
    rac: 0,
    inputEsr: 0,
    inductorAcManual: 0,
    iq: 0,
    ...raw
  }, "silicon-30v");
  const { inputs } = normalizeBuckLossInputsV2(templated.rawInputs);
  return computeBuckLossPointV2(inputs, loadA, {
    technology: "silicon",
    deviceTemplate: "silicon-30v",
    timingMode: "derived",
    controlMode: "auto-dcm"
  });
}

function withinHalfPercent(actual, expected, label) {
  const error = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(error <= 0.005, `${label}: ${(100 * error).toFixed(3)}% > 0.5%`);
}

describe("buck loss v2 textbook vectors", () => {
  it("specializes Example 4 / Eq. 4.24 to the buck output-capacitor ripple", () => {
    const result = point({
      vin: 4,
      vout: 2,
      ioutMax: 1,
      fsw: 1000,
      inductance: 10,
      deadTime: 0,
      diodeVf: 0,
      esr: 200
    }, 0.25);
    const expectedRipple = 0.1;
    const expectedCapRms = 0.5 * expectedRipple / Math.sqrt(3);
    const expectedLoss = expectedCapRms ** 2 * 0.2;
    assert.equal(result.waveform.mode, "ccm");
    withinHalfPercent(result.waveform.ripplePp, expectedRipple, "peak-to-peak ripple");
    withinHalfPercent(Math.sqrt(result.waveform.moments.outputCapRms2), expectedCapRms, "output-capacitor RMS");
    withinHalfPercent(result.losses.outputCapEsr, expectedLoss, "output-capacitor ESR loss");
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.outputCapEsr.source.equation, "4.24");
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.outputCapEsr.source.printedPage, 186);
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.outputCapEsr.source.pdfPage, 200);
  });

  it("matches Example 8 / Eq. 4.35 dead-time loss in a buck DCM point", () => {
    const result = point({
      vin: 4,
      vout: 2,
      ioutMax: 1,
      fsw: 1000,
      inductance: 10,
      deadTime: 50,
      diodeVf: 0.7,
      esr: 0
    }, 0.01);
    const roundedExamplePeak = 0.045;
    const expectedDeadTimeLoss = roundedExamplePeak * 0.7 * 50e-9 / 1e-6;
    assert.equal(result.waveform.mode, "dcm");
    assert.ok(result.waveform.duties.zeroCurrent > 0.5);
    withinHalfPercent(result.losses.deadTimeConduction, expectedDeadTimeLoss, "DCM dead-time loss");
    assert.match(BUCK_LOSS_TERM_METADATA_V2.deadTimeConduction.source.equation, /4\.35/);
    assert.deepEqual(BUCK_LOSS_TERM_METADATA_V2.deadTimeConduction.source.references, [
      { equation: "4.33", printedPage: 193, pdfPage: 207 },
      { equation: "4.35", printedPage: 194, pdfPage: 208 }
    ]);
  });

  it("reproduces the closing-edge overlap in Example 9 / Eq. 4.39", () => {
    const current = 0.47;
    const switchSwing = 4.8;
    const currentRise = 240e-12;
    const voltageFall = 1.6e-9;
    const switchingFrequency = 1e6;
    const overlap = current * switchSwing * switchingFrequency * (currentRise / 3 + voltageFall / 2);
    assert.ok(Math.abs(overlap - 2e-3) / 2e-3 < 0.01, `${overlap} does not reproduce the example's rounded 2.0 mW`);
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap.formula, "VSW · ION · fSW · (tI/3 + tV/2)");
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap.source.equation, "4.39");
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap.source.printedPage, 197);
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap.source.pdfPage, 211);
    assert.equal(BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap.source.relation, "direct");
  });

  it("exposes equation provenance for every atomic term", () => {
    const result = point({ vin: 12, vout: 3.3, ioutMax: 3, fsw: 1000, inductance: 2.2, deadTime: 20, diodeVf: 0.8, esr: 5 }, 2);
    assert.deepEqual(Object.keys(result.losses).sort(), Object.keys(result.equationProvenance).sort());
    for (const metadata of Object.values(result.equationProvenance)) {
      assert.ok(metadata.label);
      assert.ok(metadata.family);
      assert.ok(metadata.formula);
      assert.ok(metadata.source.title);
      assert.ok(["direct", "adapted"].includes(metadata.source.relation));
    }
    assert.equal(result.equationProvenance.reverseRecovery.source.relation, "adapted");
    assert.equal(result.equationProvenance.nodeEnergy.source.relation, "adapted");
    assert.equal(result.equationProvenance.highSideConduction.source.title, "Switched Inductor Power IC Design");
    assert.equal(result.equationProvenance.highSideConduction.source.chapter, 4);
  });
});
