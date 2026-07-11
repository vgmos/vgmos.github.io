import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..");
const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const lock = JSON.parse(readFileSync(new URL("../scripts/buck-loss/spice/vendor-models.lock.json", import.meta.url), "utf8"));

const expectedReports = Object.freeze([
  Object.freeze({
    id: "infineon-bsc010n04ls6-280225",
    manufacturer: "Infineon",
    publisher: "Infineon Technologies AG",
    adapterKind: "identity",
    fullBuckStatus: "characterized-bounded-fallback",
    usesFallback: true,
    qrrStatus: "attempted-bounded-not-published-equivalent",
    failedPublishedComparisons: [],
    unsupportedRequiredCoverage: ["partitionedGateChargeQgsQgd", "reverseRecoveryQrr"],
    totalGateChargeHalfStepPassed: true,
    partitionedGateChargeHalfStepPassed: true
  }),
  Object.freeze({
    id: "epc2090-ltspice-v1.104",
    manufacturer: "EPC",
    publisher: "Efficient Power Conversion Corporation",
    adapterKind: "comment-known-header-line",
    fullBuckStatus: "characterized-bounded-primary",
    usesFallback: false,
    qrrStatus: "not-applicable",
    failedPublishedComparisons: ["reverseConductionVsd"],
    unsupportedRequiredCoverage: ["totalGateCharge", "partitionedGateChargeQgsQgd"],
    totalGateChargeHalfStepPassed: false,
    partitionedGateChargeHalfStepPassed: false
  })
]);

function reportFor(id) {
  return JSON.parse(readFileSync(fixtureUrl(`buck-loss-vendor-${id}.v2.json`), "utf8"));
}

function assertSha256(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/, `${label} must be a lowercase SHA-256 digest`);
}

function assertFiniteTree(value, path = "report") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteTree(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertFiniteTree(item, `${path}.${key}`);
  }
}

function assertComparisonMath(comparison, label) {
  const expected = Math.abs(comparison.measured - comparison.publishedTypical)
    / Math.max(Math.abs(comparison.publishedTypical), 1e-30);
  assert.ok(Math.abs(comparison.typicalRelativeDelta - expected) <= 1e-12, `${label} delta must be derived from committed values`);
  assert.equal(comparison.passed, comparison.typicalRelativeDelta <= comparison.typicalRelativeLimit
    && (comparison.publishedMaximum == null || comparison.atOrBelowPublishedMaximum !== false));
}

function flattenContracts(contracts) {
  return Object.values(contracts).flatMap((contract) => Array.isArray(contract) ? contract : [contract]);
}

describe("buck loss hash-locked vendor-model reports", () => {
  it("pins two non-redistributed model and published-condition contracts", () => {
    assert.equal(lock.schemaVersion, 2);
    assert.deepEqual(lock.models.map((model) => model.id), expectedReports.map((item) => item.id));

    for (const expected of expectedReports) {
      const model = lock.models.find((item) => item.id === expected.id);
      assert.ok(model, `missing lock entry ${expected.id}`);
      assert.equal(model.manufacturer, expected.manufacturer);
      assert.equal(model.publisher, expected.publisher);
      assert.equal(model.redistribution, false);
      assert.equal(model.adapter.kind, expected.adapterKind);
      assert.equal(model.adapter.revision, 1);
      assert.ok(model.productUrl.startsWith("https://"));
      assert.ok(model.downloadUrl.startsWith("https://"));
      assert.ok(model.datasheet.url.startsWith("https://"));
      assert.ok(model.datasheet.documentId.length > 0);
      assert.ok(model.datasheet.revision.length > 0);
      assert.match(model.datasheet.publicationDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(model.retrievalDate, /^\d{4}-\d{2}-\d{2}$/);
      assertSha256(model.archiveSha256, `${expected.id} archive`);
      assertSha256(model.modelSha256, `${expected.id} model`);
      assert.ok(model.subcircuit.name.length > 0);
      assert.ok(model.subcircuit.pins.length >= 3);
      assert.ok(model.subcircuit.pins.every((pin) => typeof pin === "string" && pin.length > 0));
      assert.equal(model.simulator.name, "LTspice");
      assert.equal(model.simulator.requiredVersion, "17.0.38");
      assert.deepEqual(model.simulator.args, ["-b"]);
      assert.ok(model.characterization.gateAbsoluteMaximumV > model.characterization.gateDriveV);
      assert.ok(model.characterization.gateChargeFinalVoltageRelativeLimit > 0);

      const contracts = flattenContracts(model.publishedConditionContracts);
      assert.ok(contracts.length >= 6);
      for (const contract of contracts) {
        assert.ok(contract.id.length > 0);
        assert.ok(Number.isInteger(contract.sourceLocation.pdfPage) && contract.sourceLocation.pdfPage > 0);
        assert.ok(contract.sourceLocation.section.length > 0);
      }
      assert.deepEqual(model.strictRequiredCoverage, [
        "rdsOn",
        "reverseConductionVsd",
        "totalGateCharge",
        "partitionedGateChargeQgsQgd",
        "outputChargeQoss",
        "outputEnergyEoss",
        "reverseRecoveryQrr",
        "separateTurnOnTurnOffEnergy",
        "deadTimeRecovery",
        "fullBuckVendorModel"
      ]);

      if (expected.usesFallback) {
        assert.equal(model.fallbackSubcircuit.name, "BSC010N04LS6_L0");
        assert.deepEqual(model.fallbackSubcircuit.pins, ["drain", "gate", "source"]);
        assert.equal(model.fallbackSubcircuit.modelLevel, "simplified-standard-spice-compatible");
      } else {
        assert.equal(model.fallbackSubcircuit, undefined);
        assert.equal(model.publishedConditionContracts.reverseRecovery.applicability, "not-applicable");
        assert.equal(model.publishedConditionContracts.reverseRecovery.published.chargeC, 0);
        assert.match(model.publishedConditionContracts.reverseRecovery.reason, /majority-carrier/i);
      }
    }
  });

  for (const expected of expectedReports) {
    it(`validates committed ${expected.manufacturer} published-condition and reviewed characterization`, () => {
      const model = lock.models.find((item) => item.id === expected.id);
      const report = reportFor(expected.id);

      assert.equal(report.schemaVersion, 2);
      assert.equal(report.evidenceClass, "vendor-model-characterization");
      assert.equal(report.label, `Official ${expected.manufacturer} LTspice model executed in native LTspice`);
      assert.equal(report.characterizationOnly, true);
      assert.equal(report.source.lockId, model.id);
      assert.equal(report.source.publisher, model.publisher);
      assert.equal(report.source.archiveSha256, model.archiveSha256);
      assert.equal(report.source.modelSha256, model.modelSha256);
      assert.equal(report.source.modelVersion, model.modelVersion);
      assert.equal(report.source.retrievalDate, model.retrievalDate);
      assert.equal(report.source.redistribution, false);
      assert.deepEqual(report.source.datasheet, model.datasheet);
      assert.deepEqual(report.source.publishedConditionContracts, model.publishedConditionContracts);
      assert.deepEqual(report.source.subcircuits.primary, model.subcircuit);
      assert.deepEqual(report.source.subcircuits.fallback, model.fallbackSubcircuit ?? null);
      assertSha256(report.source.archiveSha256, `${expected.id} report archive`);
      assertSha256(report.source.modelSha256, `${expected.id} report model`);

      assert.equal(report.adapter.kind, expected.adapterKind);
      assert.equal(report.adapter.revision, model.adapter.revision);
      assertSha256(report.adapter.adaptedSha256, `${expected.id} adapted model`);
      assert.equal(report.simulator.name, "LTspice");
      assert.equal(report.simulator.version, model.simulator.requiredVersion);
      assert.deepEqual(report.simulator.args, model.simulator.args);
      assert.deepEqual(report.requiredDirectives, model.requiredDirectives);

      const staticChecks = report.characterization.staticChecks;
      assert.equal(staticChecks.status, "published-condition-compared");
      assert.equal(staticChecks.allComparisonsPassed, true);
      assert.deepEqual(Object.keys(staticChecks.cases), model.publishedConditionContracts.rdsOn.map((contract) => contract.id));
      for (const contract of model.publishedConditionContracts.rdsOn) {
        const entry = staticChecks.cases[contract.id];
        assert.deepEqual(entry.contract, contract);
        assert.equal(entry.fixture, "forced-current-static-on-state");
        assertSha256(entry.netlistSha256, `${expected.id} ${contract.id}`);
        assert.ok(Math.abs(entry.measuredDrainCurrentA - contract.conditions.drainCurrentA) <= 1e-9);
        assert.ok(Math.abs(entry.measuredRdsOnOhm - entry.measuredDrainSourceVoltageV / entry.measuredDrainCurrentA) <= 1e-15);
        assertSha256(entry.convergence.repeat.netlistSha256, `${expected.id} ${contract.id} repeat`);
        assertSha256(entry.convergence.refined.netlistSha256, `${expected.id} ${contract.id} half-step`);
        assert.ok(entry.convergence.repeatRelativeDelta <= 0.005);
        assert.ok(entry.convergence.halfStepRelativeDelta <= 0.02);
        assertComparisonMath(entry.comparison, `${expected.id} ${contract.id}`);
        assert.equal(entry.comparison.passed, true);
      }

      const terminal = report.characterization.terminalChecks;
      assert.equal(terminal.status, "published-condition-and-reviewed-characterization");
      assert.equal(terminal.reverseConduction.status, "published-condition-compared");
      assert.deepEqual(terminal.reverseConduction.contract, model.publishedConditionContracts.sourceDrainForwardVoltage);
      assertSha256(terminal.reverseConduction.netlistSha256, `${expected.id} reverse conduction`);
      assert.ok(Math.abs(terminal.reverseConduction.measuredReverseCurrentA
        - model.publishedConditionContracts.sourceDrainForwardVoltage.conditions.reverseCurrentA) <= 1e-9);
      assertSha256(terminal.reverseConduction.convergence.repeat.netlistSha256, `${expected.id} VSD repeat`);
      assertSha256(terminal.reverseConduction.convergence.refined.netlistSha256, `${expected.id} VSD half-step`);
      assert.ok(terminal.reverseConduction.convergence.repeatRelativeDelta <= 0.005);
      assert.ok(terminal.reverseConduction.convergence.halfStepRelativeDelta <= 0.02);
      assertComparisonMath(terminal.reverseConduction.comparison, `${expected.id} VSD`);

      const gate = terminal.gateCharge;
      assert.equal(gate.fixture, "constant-gate-current-clamped-drain");
      assert.match(gate.fixtureNote, /not condition-equivalent badge evidence/i);
      assert.deepEqual(gate.total.contract, model.publishedConditionContracts.totalGateCharge);
      assert.equal(gate.total.baseline.chargeStartS, 50e-9);
      assert.ok(gate.total.baseline.measurements.gate_target_time > gate.total.baseline.chargeStartS);
      assert.ok(gate.total.baseline.measurements.gate_target_time <= 3e-6);
      const totalGateTargetV = gate.total.contract.conditions.gateVoltageRangeV[1];
      assert.ok(gate.total.baseline.measurements.gate_voltage_final >= totalGateTargetV);
      assert.ok(gate.total.baseline.measurements.gate_voltage_final <= gate.total.baseline.finalGateVoltageLimitV);
      assert.ok(gate.total.baseline.measurements.gate_voltage_final <= gate.total.baseline.gateAbsoluteMaximumV);
      assert.ok(gate.total.baseline.measurements.drain_fall_start_time > gate.total.baseline.chargeStartS);
      assert.ok(gate.total.baseline.measurements.drain_fall_end_time > gate.total.baseline.measurements.drain_fall_start_time);
      assert.ok(Math.abs(gate.total.baseline.totalGateChargeC
        - gate.total.baseline.gateCurrentA * (gate.total.baseline.measurements.gate_target_time - gate.total.baseline.chargeStartS)) <= 1e-18);
      assertSha256(gate.total.baseline.netlistSha256, `${expected.id} total QG`);
      assert.equal(gate.total.repeatMaxRelativeDelta, 0);
      assert.equal(gate.total.convergenceLadder.coarseMaxStepS, 1e-9);
      assert.equal(gate.total.convergenceLadder.acceptedBaselineMaxStepS, 0.5e-9);
      assert.equal(gate.total.convergenceLadder.refinedMaxStepS, 0.25e-9);
      assertSha256(gate.total.convergenceLadder.coarse.netlistSha256, `${expected.id} coarse total QG`);
      assert.ok(Number.isFinite(gate.total.convergenceLadder.coarse.totalGateChargeC));
      assert.equal(gate.total.halfStep.status, "completed");
      assert.equal(gate.total.halfStep.maxStepS, 0.25e-9);
      assertSha256(gate.total.halfStep.refined.netlistSha256, `${expected.id} refined total QG`);
      assert.ok(Number.isFinite(gate.total.halfStep.refined.totalGateChargeC));
      assert.ok(Number.isFinite(gate.total.halfStep.refined.measurements.gate_target_time));
      assert.ok(gate.total.halfStep.refined.measurements.gate_voltage_final <= gate.total.halfStep.refined.finalGateVoltageLimitV);
      assert.ok(gate.total.halfStep.refined.measurements.gate_voltage_final <= gate.total.halfStep.refined.gateAbsoluteMaximumV);
      assert.equal(gate.total.halfStep.relativeDeltas.totalGateChargeC <= 0.02,
        expected.totalGateChargeHalfStepPassed);
      assertComparisonMath(gate.total.comparison, `${expected.id} total QG`);
      assert.equal(gate.total.comparison.passed, true);
      assert.equal(gate.partitioned.status, "attempted-proxy-not-published-equivalent");
      assert.equal(gate.partitioned.badgeAccepted, false);
      assert.match(gate.partitioned.reason, /project-defined proxies/i);
      assert.equal(gate.partitioned.halfStep.status, "completed");
      assertSha256(gate.partitioned.halfStep.refined.netlistSha256, `${expected.id} refined partitioned QG`);
      assert.equal(gate.partitioned.halfStep.maxRelativeDelta <= 0.02,
        expected.partitionedGateChargeHalfStepPassed);
      assertComparisonMath(gate.partitioned.comparisons.totalGateCharge, `${expected.id} partition total QG`);
      assertComparisonMath(gate.partitioned.comparisons.gateSourceChargeProxy, `${expected.id} QGS proxy`);
      assertComparisonMath(gate.partitioned.comparisons.gateDrainChargeProxy, `${expected.id} QGD proxy`);

      const output = terminal.outputCharge;
      assert.equal(output.status, "published-condition-compared");
      assert.deepEqual(output.contract, model.publishedConditionContracts.outputCharge);
      assertSha256(output.netlistSha256, `${expected.id} output charge`);
      assert.equal(output.finalDrainSourceVoltageV, output.contract.conditions.drainSourceVoltageRangeV[1]);
      assertSha256(output.convergence.repeat.netlistSha256, `${expected.id} QOSS/EOSS repeat`);
      assertSha256(output.convergence.refined.netlistSha256, `${expected.id} QOSS/EOSS half-step`);
      assert.ok(Object.values(output.convergence.repeatRelativeDeltas).every((value) => value <= 0.005));
      assert.ok(Object.values(output.convergence.halfStepRelativeDeltas).every((value) => value <= 0.02));
      assertComparisonMath(output.chargeComparison, `${expected.id} QOSS`);
      assert.equal(output.chargeComparison.passed, true);
      if (expected.manufacturer === "EPC") {
        assertComparisonMath(output.energyComparison, `${expected.id} EOSS`);
        assert.equal(output.energyComparison.passed, true);
      } else {
        assert.equal(output.energyComparison.status, "no-published-counterpart");
      }

      const recovery = terminal.reverseRecovery;
      assert.equal(recovery.status, expected.qrrStatus);
      assert.deepEqual(recovery.contract, model.publishedConditionContracts.reverseRecovery);
      if (expected.manufacturer === "EPC") {
        assert.equal(recovery.simulationAttempted, false);
        assert.match(recovery.reason, /not applicable/i);
      } else {
        assertSha256(recovery.netlistSha256, `${expected.id} recovery attempt`);
        assert.equal(recovery.repeatRelativeDelta, 0);
        assert.ok(recovery.halfStepRelativeDelta <= 0.02);
        assert.equal(recovery.badgeAccepted, false);
        assertComparisonMath(recovery.analyticalComparison, `${expected.id} QRR analytical estimate`);
      }

      const switching = report.characterization.switching;
      assert.equal(switching.fixture, "single-device-resistive-switching");
      assertSha256(switching.netlistSha256, `${expected.id} switching`);
      assert.equal(switching.edgeWindows.status, "reviewed-characterization-no-published-counterpart");
      assert.ok(Number.isFinite(switching.edgeWindows.turnOnDrainTerminalEnergyJ));
      assert.ok(Number.isFinite(switching.edgeWindows.turnOffDrainTerminalEnergyJ));
      assert.ok(switching.edgeWindows.turnOnHalfStepRelativeDelta <= 0.02);
      assert.ok(switching.edgeWindows.turnOffHalfStepRelativeDelta <= 0.02);

      const fullBuck = report.characterization.fullBuck;
      assert.equal(fullBuck.status, expected.fullBuckStatus);
      assert.equal(fullBuck.modelContract.usesFallback, expected.usesFallback);
      assert.equal(fullBuck.modelContract.fullBuckExecutionSubcircuit,
        expected.usesFallback ? model.fallbackSubcircuit.name : model.subcircuit.name);
      assertSha256(fullBuck.netlistSha256, `${expected.id} full buck`);
      assert.ok(fullBuck.solvedDuty > 0.2 && fullBuck.solvedDuty < 0.4);
      assert.ok(fullBuck.analyticalCounterparts.idealVoltSecondDuty.relativeDelta >= 0);
      assert.ok(fullBuck.analyticalCounterparts.onIntervalInductorRipple.relativeDelta >= 0);
      assert.equal(fullBuck.commandedDeadWindows.status, "reviewed-characterization-no-published-counterpart");
      assert.match(fullBuck.commandedDeadWindows.signConvention, /negative means net energy returned/i);
      assert.ok(Number.isFinite(fullBuck.commandedDeadWindows.afterHighSideEnergyJ));
      assert.ok(Number.isFinite(fullBuck.commandedDeadWindows.beforeHighSideEnergyJ));
      assert.equal(fullBuck.edgeExtrema.comparisonStatus, "diagnostic-only-timestep-sensitive");

      assert.deepEqual(Object.keys(report.coverage), model.strictRequiredCoverage);
      assert.equal(report.coverage.partitionedGateChargeQgsQgd.status, "attempted-proxy-not-published-equivalent");
      assert.equal(report.coverage.reverseRecoveryQrr.status, expected.qrrStatus);
      assert.equal(report.coverage.fullBuckVendorModel.status, expected.fullBuckStatus);
      assert.equal(report.coverageComplete, false);
      assert.equal(report.badgeEligible, false);
      assert.equal(report.verificationGate.passed, true);
      assert.deepEqual(report.verificationGate.excludedReleaseOnlyQualityGates,
        ["totalGateChargeHalfStepPassed", "partitionedGateChargeHalfStepPassed"]);
      assert.equal(report.releaseGate.passed, false);
      assert.deepEqual(report.releaseGate.strictRequiredCoverage, model.strictRequiredCoverage);
      assert.deepEqual(report.releaseGate.unsupportedRequiredCoverage, expected.unsupportedRequiredCoverage);
      assert.deepEqual(report.releaseGate.failedPublishedComparisons, expected.failedPublishedComparisons);
      assert.equal(report.releaseGate.qualityPassed,
        expected.totalGateChargeHalfStepPassed && expected.partitionedGateChargeHalfStepPassed);
      assert.equal(report.qualityGates.totalGateChargeHalfStepPassed, expected.totalGateChargeHalfStepPassed);
      assert.equal(report.qualityGates.partitionedGateChargeHalfStepPassed, expected.partitionedGateChargeHalfStepPassed);
      assert.equal(report.qualityGates.rdsOnRepeatPassed, true);
      assert.equal(report.qualityGates.rdsOnHalfStepPassed, true);
      assert.equal(report.qualityGates.reverseConductionRepeatPassed, true);
      assert.equal(report.qualityGates.reverseConductionHalfStepPassed, true);
      assert.equal(report.qualityGates.outputChargeEnergyRepeatPassed, true);
      assert.equal(report.qualityGates.outputChargeEnergyHalfStepPassed, true);
      assert.equal(report.qualityGates.fullBuckSteadyPassed,
        fullBuck.currentWindowRelativeDelta <= 0.005);
      assert.equal(report.qualityGates.finitePassed, true);
      assert.ok(report.limitations.some((item) => /QGS\/QGD/i.test(item)));
      if (expected.failedPublishedComparisons.length) assert.ok(report.limitations.some((item) => /comparison policy failed/i.test(item)));

      assert.deepEqual(report.reviewedCharacterization, {
        fullBuck: { status: fullBuck.status, reportPath: "characterization.fullBuck" },
        edgeEnergy: { status: switching.edgeWindows.status, reportPath: "characterization.switching.edgeWindows" },
        deadTime: { status: fullBuck.commandedDeadWindows.status, reportPath: "characterization.fullBuck.commandedDeadWindows" },
        recovery: { status: recovery.status, reportPath: "characterization.terminalChecks.reverseRecovery" },
        outputEnergy: { status: report.coverage.outputEnergyEoss.status, reportPath: report.coverage.outputEnergyEoss.reportPath }
      });
      assertFiniteTree(report.characterization, `${expected.id}.characterization`);
      assert.equal(report.review.status, "reviewed-characterization");
      assert.match(report.review.note, /not .*product sign-off/i);
    });
  }

  it("keeps the strict badge gate release-only and fail-closed", () => {
    const script = resolve(REPO_ROOT, "scripts/buck-loss/spice/vendor-models.mjs");
    for (const expected of expectedReports) {
      const result = spawnSync(process.execPath, [script, "release-check", "--id", expected.id], {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
      assert.notEqual(result.status, 0, `${expected.id} release gate must fail while strict coverage is incomplete`);
      assert.match(result.stderr, /Strict vendor release gate failed/);
      assert.match(result.stderr, /unsupported coverage:/);
    }
  });
});
