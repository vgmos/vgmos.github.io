import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  evaluateBuckLossBenchmarkFixtureV2,
  expectedBuckLossBenchmarkV1,
  measuredBuckLossFromEfficiency
} from "../js/tools/buck-loss-benchmark-v2.js";
import { getBuckLossDeviceTemplateV2 } from "../js/tools/buck-loss-device-templates-v2.js";
import { parseBuckLossUrlV2, serializeBuckLossUrlV2 } from "../js/tools/buck-loss-url-v2.js";
import {
  ARTIFACT_PATH,
  FIXTURE_PATH,
  buildBenchmarkArtifact
} from "../scripts/buck-loss/benchmark-ti-tps40071.mjs";

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

describe("TI TPS40071EVM hardware benchmark", () => {
  it("locks the published measurement source, vector-extracted grain, and data quality", () => {
    assert.equal(fixture.sources.measurement.documentId, "SLUU180B");
    assert.equal(fixture.sources.measurement.sha256, "6794afce28a68ff27637ae7e48bf92fe263d75b35cf832e338137f524a6a5780");
    assert.match(fixture.measurement.method, /vector-path centerline/i);
    assert.equal(fixture.measurement.publishedCurveUncertaintyPp, 0.1);
    assert.deepEqual(fixture.traces.map((trace) => trace.vin), [5, 8, 12]);
    assert.ok(fixture.traces.every((trace) => trace.points.length === 9));
    assert.equal(new Set(fixture.traces.flatMap((trace) => trace.points.map((point) => `${trace.vin}:${point.iout}`))).size, 27);

    const analysis = evaluateBuckLossBenchmarkFixtureV2(fixture);
    assert.equal(analysis.dataQuality.rowCount, 27);
    assert.equal(analysis.dataQuality.uniqueKeyCount, 27);
    assert.equal(analysis.dataQuality.duplicateKeyCount, 0);
    assert.equal(analysis.dataQuality.invalidRowCount, 0);
    assert.equal(analysis.dataQuality.outOfAxesRowCount, 0);
    assert.deepEqual(analysis.dataQuality.incompleteTraces, []);
    assert.equal(analysis.dataQuality.mechanismMeasurementCount, 0);
    assert.equal(analysis.dataQuality.directMechanismMeasurementCount, 0);
    assert.equal(analysis.dataQuality.mechanismReady, false);
    assert.ok(Math.abs(analysis.dataQuality.statedEfficiencyCheckDeltaPp - 0.0344) < 1e-10);
    assert.equal(analysis.dataQuality.ready, true);
  });

  it("ships the disclosed Si7860DP benchmark template without inventing COSS(ER)", () => {
    const template = getBuckLossDeviceTemplateV2("vishay-si7860dp-tps40071evm");
    assert.equal(template.manufacturer, "Vishay Siliconix");
    assert.equal(template.partNumber, "Si7860DP");
    assert.equal(template.catalogKind, "manufacturer");
    assert.equal(template.timingMode, "auto");
    assert.equal(template.values.rdsHigh, 8);
    assert.equal(template.values.qgHigh, 13);
    assert.equal(template.values.qgs2High, 2.5);
    assert.equal(template.values.qgdHigh, 4);
    assert.equal(template.values.plateauHigh, 3);
    assert.equal(template.values.gateResistanceOnHigh, 9.92);
    assert.equal(template.values.gateResistanceOffHigh, 7.44);
    assert.equal(template.values.diodeVf, 0.7);
    assert.equal(template.values.qrrRef, 60);
    assert.equal(template.values.qrrRefCurrent, 3);
    assert.equal(template.values.cossErHigh, null);
    assert.equal(template.values.cossErLow, null);
    assert.equal(template.values.eossMaxVoltage, null);
    assert.equal(template.provenance.qrrRef, "inferred-triangular-trr");
    assert.equal(template.provenance.cossErHigh, "missing");
    assert.match(template.source.url, /vishay\.com\/docs\/70903\/70903\.pdf/);
    assert.match(template.source.benchmarkUrl, /ti\.com\/lit\/ug\/sluu180b/);

    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=vishay-si7860dp-tps40071evm&control=forced-ccm&i=5");
    assert.equal(parsed.needsDevice, false);
    assert.equal(parsed.deviceId, template.id);
    assert.equal(parsed.timingMode, "auto");
    assert.equal(parsed.rawInputs.cossErHigh, null);
    const serialized = serializeBuckLossUrlV2(parsed);
    assert.match(serialized, /device=vishay-si7860dp-tps40071evm/);
    assert.doesNotMatch(serialized, /(?:cossh|cossl|eossv)=/);
  });

  it("derives measured total loss and evaluates both temperature lanes without curve fitting", () => {
    const derived = measuredBuckLossFromEfficiency({ efficiencyPercent: 93.7683, iout: 10, vout: 3.3 });
    assert.ok(Math.abs(derived - 2.193130300965256) < 1e-12);

    const analysis = evaluateBuckLossBenchmarkFixtureV2(fixture);
    assert.equal(analysis.lanes.length, 2);
    assert.ok(analysis.lanes.every((lane) => lane.rows.length === 27));
    for (const lane of analysis.lanes) {
      for (const row of lane.rows) {
        assert.equal(row.waveformMode, "ccm");
        assert.equal(row.availability, "subtotal");
        assert.deepEqual(row.omitted, fixture.coverage.requiredOmissions);
      }
    }

    const nominal = analysis.lanes.find((lane) => lane.id === "nominal-25c");
    const hot = analysis.lanes.find((lane) => lane.id === "hot-rds-bound");
    nominal.rows.forEach((row, index) => {
      const hotRow = hot.rows[index];
      assert.equal(hotRow.vin, row.vin);
      assert.equal(hotRow.iout, row.iout);
      assert.equal(hotRow.gateDriveV, row.gateDriveV);
      assert.ok(Math.abs(hotRow.rdsHighOhm / row.rdsHighOhm - 1.3) < 1e-12);
      assert.ok(hotRow.predictedKnownLossW > row.predictedKnownLossW);
    });
  });

  it("records the strict FAIL result instead of weakening thresholds or failing the unit suite", () => {
    const analysis = evaluateBuckLossBenchmarkFixtureV2(fixture);
    assert.equal(analysis.acceptance.status, "fail");
    assert.equal(analysis.acceptance.pass, false);
    assert.ok(analysis.acceptance.overall.efficiencyMaePp > fixture.acceptance.maxEfficiencyMaePp);
    assert.ok(analysis.acceptance.overall.efficiencyWorstAbsPp > fixture.acceptance.maxEfficiencyWorstAbsPp);
    assert.ok(analysis.acceptance.overall.medianAbsLossErrorPercent < fixture.acceptance.maxMedianAbsLossErrorPercent);
    assert.ok(analysis.acceptance.traces.every((trace) => trace.pass === false));
    assert.deepEqual(analysis.mechanismValidation, {
      status: "not-evaluable",
      pass: null,
      reason: "no-direct-mechanism-measurements",
      directMeasurementCount: 0,
      comparisonCount: 0,
      excludedMeasurementCount: 0,
      comparisons: [],
      excludedMeasurements: [],
      families: []
    });

    const nominal = analysis.lanes.find((lane) => lane.id === "nominal-25c");
    const highLoad12 = nominal.rows.find((row) => row.vin === 12 && row.iout === 10);
    const lowLoad12 = nominal.rows.find((row) => row.vin === 12 && row.iout === 2);
    assert.ok(Math.abs(highLoad12.efficiencyErrorPp) < 0.2);
    assert.ok(lowLoad12.efficiencyErrorPp > 4.9);
    assert.deepEqual(fixture.expected, expectedBuckLossBenchmarkV1(analysis));
  });

  it("accepts only direct mechanism evidence and never validates against another modeled decomposition", () => {
    const modeled = structuredClone(fixture);
    modeled.measurement.mechanismMeasurements = [{
      traceId: "vin-12v",
      iout: 6,
      family: "switchingTransitions",
      measuredLossW: 0.25,
      evidenceClass: "modeled",
      sourceLocation: "Synthetic negative control"
    }];
    const modeledAnalysis = evaluateBuckLossBenchmarkFixtureV2(modeled);
    assert.equal(modeledAnalysis.dataQuality.ineligibleMechanismEvidenceCount, 1);
    assert.equal(modeledAnalysis.dataQuality.directMechanismMeasurementCount, 0);
    assert.equal(modeledAnalysis.mechanismValidation.status, "not-evaluable");

    const incomplete = structuredClone(fixture);
    incomplete.measurement.mechanismMeasurements = [{
      traceId: "vin-12v",
      iout: 6,
      family: "nodeEnergy",
      measuredLossW: 0.05,
      evidenceClass: "measured",
      sourceLocation: "Synthetic unit-test calorimetry"
    }];
    const incompleteAnalysis = evaluateBuckLossBenchmarkFixtureV2(incomplete);
    assert.equal(incompleteAnalysis.mechanismValidation.status, "not-evaluable");
    assert.equal(incompleteAnalysis.mechanismValidation.reason, "no-comparable-modeled-families");
    assert.equal(incompleteAnalysis.mechanismValidation.excludedMeasurementCount, 1);
    assert.deepEqual(incompleteAnalysis.mechanismValidation.excludedMeasurements[0].missingTerms, ["nodeEnergy"]);

    const direct = structuredClone(fixture);
    direct.measurement.mechanismMeasurements = [{
      traceId: "vin-12v",
      iout: 6,
      family: "mosfetConduction",
      measuredLossW: 0.1,
      evidenceClass: "measured",
      sourceLocation: "Synthetic unit-test calorimetry"
    }];
    direct.acceptance.mechanisms = {
      required: true,
      maxAbsoluteErrorW: 10,
      maxAbsoluteErrorPercent: 10000
    };
    const directAnalysis = evaluateBuckLossBenchmarkFixtureV2(direct);
    assert.equal(directAnalysis.dataQuality.directMechanismMeasurementCount, 1);
    assert.equal(directAnalysis.mechanismValidation.status, "pass");
    assert.equal(directAnalysis.mechanismValidation.pass, true);
    assert.equal(directAnalysis.mechanismValidation.comparisons[0].evidenceClass, "measured");
    assert.equal(directAnalysis.mechanismValidation.families[0].family, "mosfetConduction");
  });

  it("keeps the committed report artifact reproducible and source-backed", () => {
    const analysis = evaluateBuckLossBenchmarkFixtureV2(fixture);
    const committed = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
    assert.deepEqual(committed, buildBenchmarkArtifact(fixture, analysis));
    assert.equal(committed.surface, "report");
    assert.equal(committed.manifest.blocks[0].body, `# ${committed.manifest.title}`);
    assert.equal(committed.manifest.charts.length, 3);
    assert.equal(committed.snapshot.datasets.nominal_point_detail.length, 27);
    assert.equal(committed.snapshot.datasets.trace_summary.length, 6);
    assert.equal(committed.snapshot.status, "ready");
    assert.ok(committed.sources.some((source) => source.href === fixture.sources.measurement.url));
    assert.match(committed.manifest.blocks[1].body, /Result: FAIL/);
    assert.match(committed.manifest.blocks.at(-2).body, /Add an explicit controller gate-regulator loss term/);
  });
});
