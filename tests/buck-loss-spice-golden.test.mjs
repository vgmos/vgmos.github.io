import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { applyBuckLossDeviceTemplateV2 } from "../js/tools/buck-loss-device-templates-v2.js";
import { computeBuckLossPointV2 } from "../js/tools/buck-loss-model-v2.js";
import { normalizeBuckLossInputsV2, rawDefaultsV2 } from "../js/tools/buck-loss-schema-v2.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/buck-loss-spice-golden.v2.json", import.meta.url), "utf8"));

function modelPoint(item) {
  const templated = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...item.inputs }, item.deviceTemplate);
  const { inputs } = normalizeBuckLossInputsV2(templated.rawInputs);
  return computeBuckLossPointV2(inputs, item.inputs.loadA, {
    technology: templated.template.technology,
    deviceTemplate: item.deviceTemplate,
    timingMode: templated.template.timingMode,
    controlMode: "auto-dcm"
  });
}

function closeRelative(actual, expected, tolerance, label) {
  if (Math.abs(expected) < 1e-12) {
    assert.ok(Math.abs(actual) < 1e-9, `${label}: ${actual} is not effectively zero`);
    return;
  }
  const error = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(error <= tolerance, `${label}: ${(100 * error).toFixed(3)}% > ${(100 * tolerance).toFixed(1)}%`);
}

describe("buck loss v2 reviewed SPICE goldens", () => {
  it("pins the committed fixture format and simulator version", () => {
    assert.equal(fixture.schemaVersion, 2);
    assert.equal(fixture.generatedBy, "ngspice-46");
    assert.equal(fixture.fixtureRevision, "2026-07-10");
    assert.equal(fixture.reviewStatus, "reviewed");
    assert.equal(fixture.tolerances.waveformRelative, 0.03);
    assert.equal(fixture.tolerances.staticLossRelative, 0.03);
    assert.equal(fixture.tolerances.aggregateStaticRelative, 0.08);
    assert.equal(fixture.tolerances.efficiencyAbsolute, 0.01);
  });

  for (const item of fixture.cases) {
    it(`matches static waveform fixture ${item.id}`, () => {
      const point = modelPoint(item);
      const simulation = item.simulation;
      const tolerance = fixture.tolerances.waveformRelative;
      assert.equal(point.valid, true);
      assert.equal(point.waveform.mode, item.expectedMode);
      closeRelative(point.waveform.duties.highSide, simulation.dutyCommand, tolerance, "high-side duty");
      closeRelative(point.waveform.moments.currentAverage, simulation.inductorAverage, tolerance, "average inductor current");
      closeRelative(Math.sqrt(point.waveform.moments.iLrms2), simulation.inductorRms, tolerance, "inductor RMS");
      closeRelative(Math.sqrt(point.waveform.moments.highSideRms2), simulation.highSideRms, tolerance, "high-side RMS");
      closeRelative(Math.sqrt(point.waveform.moments.lowSideRms2), simulation.lowSideRms, tolerance, "low-side RMS");
      closeRelative(point.waveform.moments.deadTimeCurrentAverage, simulation.deadTimeCurrentAverage, tolerance, "dead-time current");
      closeRelative(point.waveform.iPeak, simulation.peakCurrent, tolerance, "peak current");
      closeRelative(point.waveform.iValley, simulation.valleyCurrent, tolerance, "valley current");

      const modelStaticLosses = {
        highSideConduction: point.losses.highSideConduction,
        lowSideConduction: point.losses.lowSideConduction,
        inductorCopperTotal: point.losses.inductorDcCopper + point.losses.inductorAcCopper,
        deadTimeConduction: point.losses.deadTimeConduction
      };
      for (const [key, expected] of Object.entries(simulation.losses)) {
        closeRelative(modelStaticLosses[key], expected, fixture.tolerances.staticLossRelative, key);
      }
      const aggregate = Object.values(modelStaticLosses).reduce((sum, value) => sum + value, 0);
      closeRelative(aggregate, simulation.aggregateStaticLoss, fixture.tolerances.aggregateStaticRelative, "aggregate static loss");
      const staticEfficiency = point.pOut / (point.pOut + aggregate);
      assert.ok(Math.abs(staticEfficiency - simulation.efficiencyStatic) <= fixture.tolerances.efficiencyAbsolute);
    });
  }

  for (const item of fixture.switchingReferences) {
    it(`matches switching and recovery fixture ${item.id}`, () => {
      const point = modelPoint(item);
      const expected = item.simulation.powers;
      for (const key of ["turnOnOverlap", "turnOffOverlap", "reverseRecovery"]) {
        closeRelative(point.losses[key], expected[key], 0.15, key);
      }
      const aggregate = point.losses.turnOnOverlap + point.losses.turnOffOverlap + point.losses.reverseRecovery;
      closeRelative(aggregate, item.simulation.aggregateSwitchingRecovery, 0.08, "aggregate switching and recovery");

      const staticFixture = fixture.cases.find((candidate) => candidate.id === item.id.replace(/-switching-phases$/, ""));
      assert.ok(staticFixture, "matching static fixture is required");
      const modelSubsetLoss = aggregate
        + point.losses.highSideConduction
        + point.losses.lowSideConduction
        + point.losses.inductorDcCopper
        + point.losses.inductorAcCopper
        + point.losses.deadTimeConduction;
      const spiceSubsetLoss = item.simulation.aggregateSwitchingRecovery + staticFixture.simulation.aggregateStaticLoss;
      closeRelative(modelSubsetLoss, spiceSubsetLoss, 0.08, "aggregate modeled SPICE subset");
      const modelEfficiency = point.pOut / (point.pOut + modelSubsetLoss);
      const spiceEfficiency = point.pOut / (point.pOut + spiceSubsetLoss);
      assert.ok(Math.abs(modelEfficiency - spiceEfficiency) <= fixture.tolerances.efficiencyAbsolute);
    });
  }
});
