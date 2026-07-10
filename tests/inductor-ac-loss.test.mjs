import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBuckLossPoint } from "../js/tools/buck-loss-evaluator.js";
import { normalizeInputs } from "../js/tools/buck-loss-model.js";
import { estimateInductorAcLoss, validateInductorAcSurface } from "../js/tools/inductor-ac-loss.js";

const lossFormula = (frequency, current, ripple) => 1e-6 * (frequency / 100) * Math.exp(0.1 * current) * ripple ** 2;

function fixtureSurface() {
  const axes = { frequency_Hz: [100, 1000], dc_current_A: [0, 10], ripple_pp_A: [1, 10] };
  return {
    part_number: "TEST-101",
    ambient_C: 25,
    axes,
    ac_loss_W: axes.frequency_Hz.map((frequency) => axes.dc_current_A.map((current) => (
      axes.ripple_pp_A.map((ripple) => lossFormula(frequency, current, ripple))
    )))
  };
}

const inputs = normalizeInputs({
  vin: 12, vout: 3, ioutMax: 10, fsw: 0.316227766, inductance: 2.846049894,
  rdsHigh: 10, rdsLow: 10, qgHigh: 0, qgLow: 0, tOverlap: 0, deadTime: 0,
  diodeVf: 0, dcr: 5, esr: 0, vDrive: 5, iq: 0, vBias: 12,
  eossTotal: 0, qrr: 0, inductorIsat: null
});

describe("inductor AC-loss estimator", () => {
  it("reproduces nodes and transformed-space interior points", () => {
    const surface = fixtureSurface();
    const node = estimateInductorAcLoss(surface, { frequencyHz: 1000, dcCurrentA: 10, ripplePpA: 10, ambientC: 25 });
    assert.equal(node.status, "estimated");
    assert.ok(Math.abs(node.lossW - lossFormula(1000, 10, 10)) < 1e-12);

    const frequency = Math.sqrt(100 * 1000);
    const ripple = Math.sqrt(1 * 10);
    const interior = estimateInductorAcLoss(surface, { frequencyHz: frequency, dcCurrentA: 5, ripplePpA: ripple, ambientC: 25 });
    assert.equal(interior.status, "estimated");
    assert.ok(Math.abs(interior.lossW - lossFormula(frequency, 5, ripple)) < 1e-12);
  });

  it("returns exact zero at zero ripple and names every exceeded axis", () => {
    const surface = fixtureSurface();
    assert.deepEqual(estimateInductorAcLoss(surface, { frequencyHz: 1, dcCurrentA: 99, ripplePpA: 0, ambientC: 100 }), {
      status: "estimated", lossW: 0, outsideAxes: [], method: "analytical-zero-ripple"
    });
    const outside = estimateInductorAcLoss(surface, { frequencyHz: 50, dcCurrentA: 11, ripplePpA: 0.5, ambientC: 30 });
    assert.equal(outside.status, "out-of-domain");
    assert.deepEqual(outside.outsideAxes, ["frequency", "dc-current", "ripple-current", "ambient-temperature"]);
  });

  it("rejects malformed tensors and operating points", () => {
    const malformed = { ...fixtureSurface(), ac_loss_W: [[[1]]] };
    assert.equal(validateInductorAcSurface(malformed).valid, false);
    assert.equal(estimateInductorAcLoss(malformed, { frequencyHz: 100, dcCurrentA: 0, ripplePpA: 1 }).status, "invalid");
    assert.equal(estimateInductorAcLoss(fixtureSurface(), { frequencyHz: 0, dcCurrentA: 0, ripplePpA: 1 }).status, "invalid");
    assert.equal(estimateInductorAcLoss(null, {}).status, "not-characterized");
  });

  it("adds approved AC loss once and fails open for unpublished data", () => {
    const dataset = { permission_status: "approved", parts: { "TEST-101": fixtureSurface() } };
    const modeled = evaluateBuckLossPoint(inputs, 5, { inductorPartNumber: "TEST-101", inductorAcDataset: dataset, ripplePpA: Math.sqrt(10) });
    const baseline = evaluateBuckLossPoint(inputs, 5, { inductorPartNumber: "TEST-101", inductorAcDataset: { permission_status: "internal_evaluation", parts: {} }, ripplePpA: Math.sqrt(10) });
    assert.equal(modeled.inductorAcIncluded, true);
    assert.equal(baseline.inductorAcIncluded, false);
    assert.equal(baseline.inductorAcEstimate.status, "not-characterized");
    assert.ok(Math.abs(modeled.pLoss - baseline.pLoss - modeled.losses.inductorAc) < 1e-12);
    assert.ok(modeled.efficiency < baseline.efficiency);

    const manualInputs = { ...inputs, inductorAcManual: 0.025 };
    const manual = evaluateBuckLossPoint(manualInputs, 5, { inductorPartNumber: "TEST-101", inductorAcDataset: { permission_status: "internal_evaluation", parts: {} }, ripplePpA: Math.sqrt(10) });
    assert.equal(manual.inductorAcIncluded, false);
    assert.equal(manual.inductorAcAnyIncluded, true);
    assert.equal(manual.manualInductorAcLossW, 0.025);
    assert.ok(Math.abs(manual.pLoss - baseline.pLoss - 0.025) < 1e-12);

    const modeledWithManual = evaluateBuckLossPoint(manualInputs, 5, { inductorPartNumber: "TEST-101", inductorAcDataset: dataset, ripplePpA: Math.sqrt(10) });
    assert.equal(modeledWithManual.inductorAcIncluded, true);
    assert.ok(Math.abs(modeledWithManual.modeledInductorAcLossW - modeled.modeledInductorAcLossW) < 1e-12);
    assert.ok(Math.abs(modeledWithManual.losses.inductorAc - modeled.losses.inductorAc - 0.025) < 1e-12);
    assert.ok(Math.abs(modeledWithManual.pLoss - modeled.pLoss - 0.025) < 1e-12);
  });
});
