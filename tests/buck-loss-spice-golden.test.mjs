import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { applyBuckLossDeviceTemplateV2 } from "../js/tools/buck-loss-device-templates-v2.js";
import { computeBuckLossPointV2, computeBuckWaveformV2, findCcmBoundaryV2 } from "../js/tools/buck-loss-model-v2.js";
import { normalizeBuckLossInputsV2, rawDefaultsV2 } from "../js/tools/buck-loss-schema-v2.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/buck-loss-spice-golden.v3.json", import.meta.url), "utf8"));

function configured(raw, templateId = "epc2090") {
  const templated = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...raw }, templateId);
  const { inputs } = normalizeBuckLossInputsV2(templated.rawInputs);
  return { inputs, template: templated.template };
}

function modelPoint(item) {
  const { inputs, template } = configured(item.inputs, item.deviceTemplate);
  return computeBuckLossPointV2(inputs, item.inputs.loadA, {
    technology: template.technology,
    deviceTemplate: item.deviceTemplate,
    timingMode: template.timingMode,
    controlMode: item.controlMode
  });
}

function close(actual, expected, relative, absolute, label) {
  assert.ok(Number.isFinite(actual), `${label}: actual is not finite`);
  assert.ok(Number.isFinite(expected), `${label}: expected is not finite`);
  const delta = Math.abs(actual - expected);
  const limit = Math.max(absolute, relative * Math.abs(expected));
  assert.ok(delta <= limit, `${label}: |${actual} - ${expected}| = ${delta} > ${limit}`);
}

function modelDropoutThreshold(raw, loadA) {
  let low = raw.vout + 1e-6;
  let high = raw.vout + 1.5;
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const vin = (low + high) / 2;
    const { inputs } = configured({ ...raw, vin, vBias: vin });
    const waveform = computeBuckWaveformV2(inputs, loadA, { controlMode: "forced-ccm" });
    if (waveform.valid) high = vin;
    else low = vin;
  }
  return (low + high) / 2;
}

describe("buck loss v2.1 independent switched-topology goldens", () => {
  it("pins evidence classes, simulator, and acceptance policy", () => {
    assert.equal(fixture.schemaVersion, 3);
    assert.equal(fixture.generatedBy, "ngspice-46");
    assert.equal(fixture.fixtureRevision, "2026-07-10-v2.1");
    assert.equal(fixture.tolerances.waveformRelative, 0.03);
    assert.equal(fixture.tolerances.staticLossRelative, 0.03);
    assert.equal(fixture.tolerances.aggregateStaticRelative, 0.08);
    assert.equal(fixture.tolerances.efficiencyAbsolute, 0.01);
    assert.equal(fixture.topologyCases.length, 15);
    assert.ok(fixture.topologyCases.every((item) => item.evidenceClass === "independent-switched-topology"));
    assert.ok(fixture.thresholdChecks.every((item) => item.evidenceClass === "independent-switched-topology-threshold"));
    assert.ok(fixture.analyticalIdentityChecks.every((item) => item.evidenceClass === "formula-integration-identity"));
    const topologyIds = new Set(fixture.topologyCases.map((item) => item.id));
    assert.ok(fixture.analyticalIdentityChecks.every((item) => !topologyIds.has(item.id)));
    assert.doesNotMatch(fixture.methodology, /transistor-model sign-?off/i);
  });

  for (const item of fixture.topologyCases) {
    it(`matches independent topology ${item.id}`, () => {
      const point = modelPoint(item);
      const simulation = item.simulation;
      const abs = fixture.tolerances.absolute;
      const characterizedCommutation = item.controlMode === "forced-ccm";
      const waveformRelative = fixture.tolerances.waveformRelative;
      const currentAbsolute = abs.currentA;
      const dutyAbsolute = abs.dutyFraction;
      assert.equal(point.valid, true);
      assert.equal(point.waveform.mode, item.expectedMode);
      assert.match(item.netlistSha256, /^[a-f0-9]{64}$/);

      if (!characterizedCommutation) {
        close(point.waveform.duties.highSide, simulation.duties.highSide, waveformRelative, dutyAbsolute, "high-side duty");
        close(point.waveform.duties.lowSide, simulation.duties.lowSide, waveformRelative, dutyAbsolute, "low-side duty");
      }
      close(point.waveform.duties.deadTime, simulation.duties.deadTime, waveformRelative, dutyAbsolute, "dead-time duty");
      close(point.waveform.duties.zeroCurrent, simulation.duties.zeroCurrent, waveformRelative, dutyAbsolute, "zero-current duty");
      close(point.waveform.moments.currentAverage, simulation.inductorAverage, waveformRelative, currentAbsolute, "average inductor current");
      close(Math.sqrt(point.waveform.moments.iLrms2), simulation.inductorRms, waveformRelative, currentAbsolute, "inductor RMS");
      close(Math.sqrt(point.waveform.moments.highSideRms2), simulation.highSideRms, waveformRelative, currentAbsolute, "high-side RMS");
      close(Math.sqrt(point.waveform.moments.lowSideRms2), simulation.lowSideRms, waveformRelative, currentAbsolute, "low-side RMS");
      close(Math.sqrt(point.waveform.moments.inputCapRms2), simulation.inputCapRms, waveformRelative, currentAbsolute, "input-capacitor RMS");
      close(Math.sqrt(point.waveform.moments.outputCapRms2), simulation.outputCapRms, waveformRelative, currentAbsolute, "output-capacitor RMS");
      if (!characterizedCommutation) {
        close(point.waveform.moments.deadTimeCurrentAverage, simulation.deadTimeCurrentAverage, waveformRelative, abs.deadCurrentA, "dead-time current");
      }
      close(point.waveform.iPeak, simulation.peakCurrent, waveformRelative, currentAbsolute, "peak current");
      close(point.waveform.iValley, simulation.valleyCurrent, waveformRelative, currentAbsolute, "valley current");

      for (const key of [
        "lowDeadTimeCurrentAverageSigned",
        "highDeadTimeCurrentAverageSigned",
        "lowDeadTimeCurrentRms",
        "highDeadTimeCurrentRms"
      ]) assert.ok(Number.isFinite(simulation[key]), `${key} must be finite`);
      assert.ok(simulation.lowDeadTimeCurrentRms >= 0);
      assert.ok(simulation.highDeadTimeCurrentRms >= 0);
      close(
        simulation.deadTimeCurrentAverage,
        Math.abs(simulation.lowDeadTimeCurrentAverageSigned) + Math.abs(simulation.highDeadTimeCurrentAverageSigned),
        0,
        1e-12,
        "separate signed dead-path averages"
      );

      const dutySum = Object.values(simulation.duties).reduce((sum, value) => sum + value, 0);
      close(dutySum, 1, 0, 0.005, "simulated interval sum");
      const period = 1 / (item.inputs.fsw * 1000);
      const durationSum = Object.values(simulation.segmentDurations).reduce((sum, value) => sum + value, 0);
      close(durationSum, period, 0, 0.005 * period, "simulated duration sum");
      assert.ok(simulation.convergence.currentWindowDelta <= Math.max(abs.currentA, 0.005 * Math.abs(simulation.inductorAverage)));

      const modelStaticLosses = {
        highSideConduction: point.losses.highSideConduction,
        lowSideConduction: point.losses.lowSideConduction,
        inductorCopperTotal: point.losses.inductorDcCopper + point.losses.inductorAcCopper,
        inputCapEsr: point.losses.inputCapEsr,
        outputCapEsr: point.losses.outputCapEsr,
        deadTimeConduction: point.losses.deadTimeConduction
      };
      for (const [key, expected] of Object.entries(simulation.losses)) {
        if (characterizedCommutation && key === "deadTimeConduction") continue;
        const absolute = key === "deadTimeConduction" ? abs.deadLossW : abs.staticLossW;
        close(modelStaticLosses[key], expected, fixture.tolerances.staticLossRelative, absolute, key);
      }
      const aggregate = Object.values(modelStaticLosses).reduce((sum, value) => sum + value, 0);
      close(aggregate, simulation.aggregateStaticLoss, fixture.tolerances.aggregateStaticRelative, abs.aggregateLossW, "aggregate static loss");
      const staticEfficiency = point.pOut / (point.pOut + aggregate);
      close(staticEfficiency, simulation.efficiencyStatic, 0, fixture.tolerances.efficiencyAbsolute, "known-static-subset efficiency");

      if (item.controlMode === "forced-ccm") {
        assert.deepEqual(item.comparisonPolicy.characterizationOnly, [
          "highSideDuty",
          "lowSideDuty",
          "deadTimeCurrentAverage",
          "lowDeadTimeCurrentAverageSigned",
          "highDeadTimeCurrentAverageSigned",
          "lowDeadTimeCurrentRms",
          "highDeadTimeCurrentRms",
          "deadTimeConduction"
        ]);
        assert.ok(simulation.valleyCurrent < 0);
        assert.ok(simulation.highDeadTimeCurrentRms > 0.001, "negative-current case must exercise the high reverse path");
        assert.ok(simulation.inputCapRmsGatedEstimate > 0);
      } else {
        assert.deepEqual(item.comparisonPolicy.characterizationOnly, []);
      }
    });
  }

  it("matches independently searched zero-current onset", () => {
    const item = fixture.thresholdChecks.find((entry) => entry.id === "12v-3p3v-zero-current-onset");
    assert.ok(item);
    const { inputs } = configured(item.inputs);
    const expected = findCcmBoundaryV2(inputs);
    close(item.simulation.boundaryA, expected, fixture.tolerances.boundaryRelative, fixture.tolerances.absolute.currentA, "CCM boundary");
    close(item.simulation.valleyA, 0, 0, fixture.tolerances.absolute.currentA, "boundary valley");
  });

  it("matches independently searched dropout onset", () => {
    const item = fixture.thresholdChecks.find((entry) => entry.id === "3p3v-2a-dropout-onset");
    assert.ok(item);
    const expected = modelDropoutThreshold(item.inputs, item.inputs.loadA);
    const limit = Math.max(item.inputs.vout * fixture.tolerances.dropoutVoutFraction, 2 * item.searchResolutionV);
    close(item.simulation.vinThreshold, expected, 0, limit, "dropout threshold");
    close(item.simulation.inductorAverage, item.inputs.loadA, 0.03, fixture.tolerances.absolute.currentA, "dropout current");
  });
});

describe("buck loss analytical integration identities", () => {
  for (const item of fixture.analyticalIdentityChecks) {
    it(`matches identity ${item.id} without promoting it to topology evidence`, () => {
      assert.equal(item.evidenceClass, "formula-integration-identity");
      assert.match(item.netlistSha256, /^[a-f0-9]{64}$/);
      for (const [key, expected] of Object.entries(item.expected)) {
        close(item.simulation[key], expected, 0.002, 1e-12, key);
      }
    });
  }
});
