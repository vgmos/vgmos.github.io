import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { performance } from "node:perf_hooks";
import {
  BUCK_LOSS_MODEL_REVISION,
  BUCK_LOSS_GROUPS_V2,
  BUCK_LOSS_SCHEMA_V2,
  buckLossFieldKeysForGroupV2,
  normalizeBuckLossInputsV2,
  rawDefaultsV2,
  validateBuckLossInputsV2
} from "../js/tools/buck-loss-schema-v2.js";
import { applyBuckLossDeviceTemplateV2, getBuckLossDeviceTemplateV2 } from "../js/tools/buck-loss-device-templates-v2.js";
import { evaluateBuckLossPointV2 } from "../js/tools/buck-loss-evaluator-v2.js";
import {
  computeBuckLossPointV2,
  computeBuckLossSweepV2,
  computeBuckWaveformV2,
  findCcmBoundaryV2
} from "../js/tools/buck-loss-model-v2.js";

function setup(deviceId = "epc2090", overrides = {}) {
  const merged = applyBuckLossDeviceTemplateV2({
    ...rawDefaultsV2(),
    inductorAcManual: 0,
    ...overrides
  }, deviceId);
  const { inputs, provenance } = normalizeBuckLossInputsV2(merged.rawInputs);
  return {
    inputs,
    context: {
      technology: merged.template.technology,
      catalogKind: merged.template.catalogKind,
      deviceTemplate: deviceId,
      parameterCorner: merged.template.cornerId,
      timingMode: merged.template.timingMode,
      controlMode: "auto-dcm",
      provenance
    }
  };
}

function rel(actual, expected, tolerance = 1e-9) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= scale * tolerance, `${actual} != ${expected}`);
}

describe("buck loss v2 contracts", () => {
  it("keeps the legacy v1 kernel as an exact frozen snapshot", () => {
    const legacy = readFileSync(new URL("../js/tools/buck-loss-model.js", import.meta.url), "utf8");
    const snapshot = readFileSync(new URL("../js/tools/buck-loss-model-v1.js", import.meta.url), "utf8");
    assert.equal(snapshot, legacy);
  });

  it("normalizes the canonical display-unit schema and validates a templated setup", () => {
    const { inputs } = setup();
    assert.equal(inputs.fsw, 1e6);
    assert.equal(inputs.inductance, 2.2e-6);
    assert.equal(inputs.rdsHigh, 3.8e-3);
    assert.equal(inputs.qgdHigh, 0.7e-9);
    assert.equal(inputs.cossErHigh, 441e-12);
    const normalized = normalizeBuckLossInputsV2(applyBuckLossDeviceTemplateV2(rawDefaultsV2(), "epc2090").rawInputs);
    assert.equal(normalized.provenance.vBias, "inferred-from-vin");
    assert.equal(normalized.provenance.rac, "inferred-rac-equals-rdc");
    assert.deepEqual(validateBuckLossInputsV2(inputs), { valid: true, errors: [] });
  });

  it("owns form grouping and conditional visibility in the canonical schema", () => {
    const groupedKeys = BUCK_LOSS_GROUPS_V2.flatMap((group) => buckLossFieldKeysForGroupV2(group.id));
    assert.deepEqual([...groupedKeys].sort(), Object.keys(BUCK_LOSS_SCHEMA_V2).sort());
    assert.equal(new Set(groupedKeys).size, groupedKeys.length);
    assert.deepEqual(buckLossFieldKeysForGroupV2("operating"), ["vin", "vout", "ioutMax", "fsw", "inductance"]);
    assert.equal(BUCK_LOSS_SCHEMA_V2.vDrive.group, "drive");
    assert.equal(BUCK_LOSS_SCHEMA_V2.effectiveTurnOn.timingMode, "effective");
    assert.equal(BUCK_LOSS_SCHEMA_V2.qgdHigh.timingMode, "derived");
    assert.equal(BUCK_LOSS_SCHEMA_V2.qrrRef.technology, "silicon");
  });

  it("ships exact manufacturer and technology-aware example templates", () => {
    const epc = getBuckLossDeviceTemplateV2("epc2090");
    assert.equal(epc.technology, "gan");
    assert.equal(epc.catalogKind, "manufacturer");
    assert.equal(epc.cornerId, "mixed-datasheet-25c");
    assert.equal(epc.modelSource.version, "1.104 · 22-Jul-2025");
    assert.match(epc.modelSource.url, /EPCGaNLibrary\.zip$/);
    assert.equal(epc.values.rdsHigh, 3.8);
    assert.equal(epc.values.qgHigh, 7.3);
    assert.equal(epc.values.qgs2High, 0.7);
    assert.equal(epc.values.qgdHigh, 0.7);
    assert.equal(epc.values.cossErHigh, 441);
    assert.equal(epc.values.gateResistanceOnHigh, 0.4);
    assert.equal(epc.values.diodeVf, 1.5);
    assert.equal(epc.values.qrrRef, 0);
    assert.equal(epc.values.effectiveTurnOn, 3);
    assert.equal(epc.values.effectiveTurnOff, 2);
    assert.equal(epc.provenance.qgs2High, "inferred-qgs-minus-qgth");
    assert.match(epc.source.url, /EPC2090_datasheet\.pdf/);

    const infineon = getBuckLossDeviceTemplateV2("infineon-bsc010n04ls6-4v5");
    assert.equal(infineon.label, "Infineon BSC010N04LS6 pair");
    assert.equal(infineon.technology, "silicon");
    assert.equal(infineon.catalogKind, "manufacturer");
    assert.equal(infineon.manufacturer, "Infineon");
    assert.equal(infineon.partNumber, "BSC010N04LS6");
    assert.equal(infineon.cornerId, "mixed-datasheet-25c-vgs4v5");
    assert.equal(infineon.voltageClass, 40);
    assert.equal(infineon.timingMode, "effective");
    assert.equal(infineon.values.rdsHigh, 1.1);
    assert.equal(infineon.values.rdsLow, 1.1);
    assert.equal(infineon.values.qgHigh, 32);
    assert.equal(infineon.values.qgs2High, 4.7);
    assert.equal(infineon.values.qgdHigh, 8.1);
    assert.equal(infineon.values.plateauHigh, 2.7);
    assert.equal(infineon.provenance.qgs2High, "inferred-qgs-minus-qgth");
    assert.equal(infineon.values.qrrRef, 97);
    assert.equal(infineon.values.qrrRefCurrent, 10);
    assert.equal(infineon.values.diodeVf, 0.8);
    assert.equal(infineon.values.vDrive, 4.5);
    for (const key of [
      "gateResistanceOnHigh", "gateResistanceOffHigh",
      "effectiveTurnOn", "effectiveTurnOff", "cossErHigh", "cossErLow", "eossMaxVoltage"
    ]) {
      assert.equal(infineon.values[key], null, `${key} must stay unset rather than inferred from an incompatible datasheet quantity`);
      assert.equal(infineon.provenance[key], "missing");
    }
    assert.match(infineon.conditions.rdsHigh, /1\.10 mΩ typical, 1\.40 mΩ maximum/);
    assert.match(infineon.conditions.qrrRef, /IF = 10 A/);
    assert.match(infineon.source.url, /bsc010n04ls6-datasheet-en\.pdf/i);
    assert.match(infineon.source.model.url, /OptiMOS6_40V_Spice\.zip/i);
    assert.match(infineon.source.model.simulator, /scoped native-LTspice characterization/i);
    assert.match(infineon.source.model.applicationNoteUrl, /powermosfet-simulationmodels/i);
    assert.equal(infineon.source.model.reportUrl, undefined);
    assert.deepEqual(infineon.source.model.requiredDirectives, [".options Thev_Induc=1"]);
    assert.equal(infineon.modelSource.redistribution, "not-redistributed");
    assert.equal(infineon.modelSource.version, "280225 · 28-Feb-2025");
    assert.deepEqual(infineon.modelSource.requiredDirectives, [".options Thev_Induc=1"]);
    assert.equal(infineon.parameterConditions.rdsHigh.maximum, 1.4);
    assert.equal(infineon.parameterConditions.qgdHigh.maximum, 12);
    assert.match(infineon.parameterConditions.qgdHigh.conditions, /TJ = 25 °C/);
    assert.match(infineon.parameterConditions.qgdHigh.qualification, /not subject to production test/i);
    assert.match(infineon.parameterConditions.qrrRef.conditions, /TJ = 25 °C/);
    assert.match(infineon.parameterConditions.qrrRef.qualification, /not subject to production test/i);
    assert.equal(infineon.parameterConditions.qrrRefCurrent.statistic, "reference condition");
    assert.match(infineon.parameterConditions.qrrRefCurrent.conditions, /IF = 10 A/);
    assert.equal(infineon.parameterConditions.vDrive.statistic, "selected test condition");
    assert.match(infineon.parameterConditions.vDrive.conditions, /RDS\(on\).*total-gate-charge corner/);
    assert.ok(infineon.notes.some((note) => /QGD and QRR are defined by design/i.test(note)));

    const stale = applyBuckLossDeviceTemplateV2({
      ...rawDefaultsV2(),
      effectiveTurnOn: 123,
      cossErHigh: 456,
      __provenance: { effectiveTurnOn: "entered", cossErHigh: "entered" }
    }, "infineon-bsc010n04ls6-4v5");
    assert.equal(stale.rawInputs.effectiveTurnOn, null);
    assert.equal(stale.rawInputs.cossErHigh, null);
    assert.equal(stale.rawInputs.__provenance.effectiveTurnOn, "missing");
    assert.equal(stale.rawInputs.__provenance.cossErHigh, "missing");

    const infineonSetup = setup("infineon-bsc010n04ls6-4v5");
    const infineonPoint = computeBuckLossPointV2(infineonSetup.inputs, 2, infineonSetup.context);
    assert.equal(infineonPoint.parameterCorner, "mixed-datasheet-25c-vgs4v5");
    assert.equal(infineonPoint.catalogKind, "manufacturer");
    assert.equal(infineonPoint.availability, "subtotal");
    assert.equal(infineonPoint.losses.turnOnOverlap, null);
    assert.equal(infineonPoint.losses.turnOffOverlap, null);
    assert.equal(infineonPoint.losses.nodeEnergy, null);
    assert.ok(infineonPoint.losses.reverseRecovery > 0);
    assert.ok(infineonPoint.omitted.includes("switchingTransitionsMissingData"));
    assert.ok(infineonPoint.omitted.includes("nodeEnergyMissingData"));

    const expectedSilicon = [
      ["silicon-30v", 5, 20, 4, 5, 2.5, 800, 30, 0.8, 2],
      ["silicon-60v", 10, 30, 6, 8, 3, 500, 60, 0.85, 3],
      ["silicon-100v", 20, 45, 9, 12, 3.5, 350, 100, 0.9, 4]
    ];
    expectedSilicon.forEach(([id, rds, qg, qgs2, qgd, plateau, cossEr, qrr, diodeVf, gateResistance]) => {
      const silicon = getBuckLossDeviceTemplateV2(id);
      assert.equal(silicon.technology, "silicon");
      assert.equal(silicon.catalogKind, "teaching");
      assert.equal(silicon.cornerId, "synthetic-typical-25c");
      assert.equal(silicon.values.rdsHigh, rds);
      assert.equal(silicon.values.rdsLow, rds);
      assert.equal(silicon.values.qgHigh, qg);
      assert.equal(silicon.values.qgs2High, qgs2);
      assert.equal(silicon.values.qgdHigh, qgd);
      assert.equal(silicon.values.plateauHigh, plateau);
      assert.equal(silicon.values.cossErHigh, cossEr);
      assert.equal(silicon.values.qrrRef, qrr);
      assert.equal(silicon.values.diodeVf, diodeVf);
      assert.equal(silicon.values.gateResistanceOnHigh, gateResistance);
      assert.equal(silicon.values.vDrive, 5);
      assert.match(silicon.source.detail, /not a vendor part/i);
    });
  });

  it("exposes the complete versioned point and sweep result contracts", () => {
    const { inputs, context } = setup();
    const point = computeBuckLossPointV2(inputs, 2, context);
    assert.equal(point.modelVersion, 2);
    assert.equal(point.modelRevision, BUCK_LOSS_MODEL_REVISION);
    assert.equal(point.modelRevision, "2.1");
    assert.equal(point.technology, "gan");
    assert.equal(point.catalogKind, "manufacturer");
    assert.equal(point.deviceTemplate, "epc2090");
    assert.equal(point.parameterCorner, "mixed-datasheet-25c");
    assert.equal(point.controlMode, "auto-dcm");
    assert.equal(point.valid, true);
    assert.ok(["total", "subtotal"].includes(point.availability));
    assert.ok(Array.isArray(point.omitted));
    assert.ok(Array.isArray(point.coverageGaps));
    assert.ok(Array.isArray(point.warnings));
    assert.equal(point.failure, null);
    assert.equal(typeof point.provenance, "object");
    assert.equal(point.waveform.segments.length, 4);
    point.waveform.segments.forEach((segment) => {
      for (const key of ["duration", "iStart", "iEnd", "currentIntegral", "currentSquareIntegral"]) {
        assert.ok(Number.isFinite(segment[key]), `${key} must be finite`);
      }
      assert.ok(segment.activePath);
    });
    assert.ok(Number.isFinite(point.waveform.ccmBoundary));
    assert.equal(Object.keys(point.groupedLosses).length, 8);
    assert.equal(Object.keys(point.losses).length, Object.keys(point.equationProvenance).length);
    assert.ok(Number.isFinite(point.pOut));
    assert.ok(Number.isFinite(point.pLoss));
    assert.ok(Number.isFinite(point.pInEstimated));
    assert.ok(Number.isFinite(point.efficiency));

    const sweep = computeBuckLossSweepV2(inputs, context, { points: 180 });
    assert.equal(sweep.modelVersion, 2);
    assert.equal(sweep.modelRevision, "2.1");
    assert.equal(sweep.points.length, 180);
    assert.ok(sweep.annotations.peakEfficiency);
    assert.ok(Number.isFinite(sweep.annotations.ccmBoundary));
    assert.ok(sweep.annotations.lossBalance.fixedToCurrentLike);
    assert.ok(sweep.annotations.lossBalance.currentLikeToCurrentSquared);
    assert.ok(sweep.annotations.lossBalance.fixedToCurrentSquared);
    assert.ok(sweep.annotations.fetSizingAdvisory);
    assert.ok(sweep.annotations.dominanceRegions.length > 0);
  });
});

describe("buck loss v2 waveform kernel", () => {
  it("uses nonideal CCM windows and exact linear-current moments", () => {
    const { inputs } = setup();
    const waveform = computeBuckWaveformV2(inputs, 2, { controlMode: "auto-dcm" });
    assert.equal(waveform.valid, true);
    assert.equal(waveform.mode, "ccm");
    rel(waveform.duties.highSide + waveform.duties.lowSide + waveform.duties.deadTime, 1);
    assert.ok(waveform.duties.highSide > inputs.vout / inputs.vin);
    assert.ok(waveform.duties.lowSide < 1 - waveform.duties.highSide);
    assert.deepEqual(waveform.segments.map((segment) => segment.activePath), [
      "high-side-channel",
      "reverse-path",
      "low-side-channel",
      "reverse-path"
    ]);
    rel(waveform.moments.currentAverage, 2);
    rel(waveform.moments.iLrms2, 2 ** 2 + waveform.ripplePp ** 2 / 12, 2e-3);
    rel(waveform.moments.outputCapRms2, waveform.moments.iLrms2 - 2 ** 2, 2e-3);
  });

  it("automatically enters fixed-frequency diode-emulation DCM", () => {
    const { inputs } = setup();
    const waveform = computeBuckWaveformV2(inputs, 0.05, { controlMode: "auto-dcm" });
    assert.equal(waveform.mode, "dcm");
    assert.equal(waveform.iValley, 0);
    assert.ok(waveform.duties.zeroCurrent > 0);
    rel(waveform.moments.currentAverage, 0.05, 1e-6);
    assert.ok(waveform.segments.every((segment) => segment.iStart >= 0 && segment.iEnd >= 0));
  });

  it("reserves the trailing dead interval when long-dead-time DCM current survives the low command", () => {
    const { inputs } = setup("epc2090", { deadTime: 60 });
    const boundary = findCcmBoundaryV2(inputs);
    const waveform = computeBuckWaveformV2(inputs, boundary * 0.99, {
      controlMode: "auto-dcm",
      ccmBoundary: boundary
    });
    assert.equal(waveform.mode, "dcm");
    assert.deepEqual(waveform.segments.map((segment) => segment.activePath), [
      "high-side-channel",
      "reverse-path",
      "low-side-channel",
      "reverse-path",
      "open"
    ]);
    const deadSegments = waveform.segments.filter((segment) => segment.state === "dead-time");
    assert.equal(deadSegments.length, 2);
    assert.ok(deadSegments[1].duration > 0, "the trailing dead interval must carry current");
    assert.ok(deadSegments[1].duration <= inputs.deadTime);
    rel(Object.values(waveform.duties).reduce((sum, value) => sum + value, 0), 1);
    rel(
      waveform.duties.lowSide,
      1 - waveform.duties.highSide - 2 * inputs.deadTime * inputs.fsw,
      1e-9
    );
    assert.ok(waveform.duties.zeroCurrent > 0);
  });

  it("keeps long-dead-time waveform moments continuous at the CCM/DCM handoff", () => {
    const { inputs } = setup("epc2090", { deadTime: 60 });
    const boundary = findCcmBoundaryV2(inputs);
    const below = computeBuckWaveformV2(inputs, boundary * (1 - 1e-6), {
      controlMode: "auto-dcm",
      ccmBoundary: boundary
    });
    const above = computeBuckWaveformV2(inputs, boundary * (1 + 1e-6), {
      controlMode: "auto-dcm",
      ccmBoundary: boundary
    });
    assert.equal(below.mode, "dcm");
    assert.equal(above.mode, "ccm");
    assert.equal(below.segments.filter((segment) => segment.state === "dead-time").length, 2);
    for (const key of ["currentAverage", "iLrms2", "highSideRms2", "lowSideRms2", "outputCapRms2"]) {
      const scale = Math.max(Math.abs(below.moments[key]), Math.abs(above.moments[key]), 1e-12);
      assert.ok(Math.abs(below.moments[key] - above.moments[key]) / scale < 0.01, `${key} is discontinuous`);
    }
    assert.ok(Math.abs(below.duties.highSide - above.duties.highSide) < 0.001);
    assert.ok(Math.abs(below.duties.deadTime - above.duties.deadTime) < 0.001);
  });

  it("retains forced CCM only as an explicit comparison", () => {
    const { inputs } = setup();
    const automatic = computeBuckWaveformV2(inputs, 0.05, { controlMode: "auto-dcm" });
    const forced = computeBuckWaveformV2(inputs, 0.05, { controlMode: "forced-ccm" });
    assert.equal(automatic.mode, "dcm");
    assert.equal(forced.mode, "ccm");
    assert.ok(forced.iValley < 0);
  });

  it("marks the exact zero-load endpoint as controller-dependent", () => {
    const { inputs, context } = setup();
    const point = computeBuckLossPointV2(inputs, 0, context);
    assert.equal(point.waveform.mode, "zero-load-unmodeled");
    assert.equal(point.efficiency, null);
    assert.equal(point.availability, "subtotal");
    assert.ok(point.omitted.includes("zeroLoadControlBehavior"));
    assert.deepEqual(
      point.coverageGaps.find((gap) => gap.code === "zeroLoadControlBehavior"),
      { term: "switchingTransitions", code: "zeroLoadControlBehavior", scope: "whole-term" }
    );
  });

  it("keeps waveform moments and mutually modeled losses continuous at the CCM/DCM handoff", () => {
    const { inputs, context } = setup();
    const boundary = findCcmBoundaryV2(inputs);
    const below = computeBuckLossPointV2(inputs, boundary * (1 - 1e-6), { ...context, ccmBoundary: boundary });
    const above = computeBuckLossPointV2(inputs, boundary * (1 + 1e-6), { ...context, ccmBoundary: boundary });
    assert.equal(below.waveform.mode, "dcm");
    assert.equal(above.waveform.mode, "ccm");
    assert.equal(below.availability, "subtotal");
    assert.equal(above.availability, "total");
    assert.equal(below.losses.nodeEnergy, null);
    assert.ok(below.omitted.includes("nodeEnergyDcmCommutationUnmodeled"));
    assert.ok(above.losses.nodeEnergy > 0);
    const aboveSharedLoss = above.pLoss - above.losses.nodeEnergy;
    const belowSharedLoss = below.pLoss;
    assert.ok(
      Math.abs(aboveSharedLoss - belowSharedLoss) / Math.max(aboveSharedLoss, belowSharedLoss) < 0.01,
      "DCM omission must not hide a discontinuity in the terms modeled on both sides"
    );
    for (const key of ["currentAverage", "iLrms2", "inputAverage", "inputCapRms2", "outputCapRms2"]) {
      const scale = Math.max(Math.abs(above.waveform.moments[key]), Math.abs(below.waveform.moments[key]), 1e-12);
      assert.ok(
        Math.abs(above.waveform.moments[key] - below.waveform.moments[key]) / scale < 0.01,
        `${key} is discontinuous at the CCM/DCM handoff`
      );
    }
  });
});

describe("buck loss v2 accounting", () => {
  it("conserves power with nonnegative atomic losses", () => {
    const { inputs, context } = setup();
    const point = computeBuckLossPointV2(inputs, 2, context);
    assert.equal(point.valid, true);
    assert.equal(point.availability, "total");
    Object.values(point.losses).forEach((loss) => assert.ok(loss >= 0));
    rel(point.pInEstimated, point.pOut + point.pLoss);
    rel(point.efficiency, point.pOut / point.pInEstimated);
    assert.ok(point.losses.inputCapEsr > 0);
    assert.ok(point.losses.outputCapEsr > 0);
  });

  it("suppresses QRR for GaN and scales it for silicon", () => {
    const gan = setup("epc2090");
    const si = setup("silicon-60v");
    const ganPoint = computeBuckLossPointV2(gan.inputs, 2, gan.context);
    const siPoint1 = computeBuckLossPointV2(si.inputs, 1, si.context);
    const siPoint2 = computeBuckLossPointV2(si.inputs, 2, si.context);
    assert.equal(ganPoint.losses.reverseRecovery, 0);
    assert.ok(siPoint1.losses.reverseRecovery > 0);
    assert.ok(siPoint2.losses.reverseRecovery > siPoint1.losses.reverseRecovery);
    rel(
      siPoint2.losses.reverseRecovery,
      (si.inputs.vin + si.inputs.diodeVf)
        * si.inputs.qrrRef
        * siPoint2.waveform.iValley
        / si.inputs.qrrRefCurrent
        * si.inputs.fsw
    );
  });

  it("warns specifically when forced CCM enters the negative-current commutation domain", () => {
    const { inputs, context } = setup();
    const negative = computeBuckLossPointV2(inputs, 0.05, { ...context, controlMode: "forced-ccm" });
    const positive = computeBuckLossPointV2(inputs, 2, { ...context, controlMode: "forced-ccm" });
    const automatic = computeBuckLossPointV2(inputs, 0.05, { ...context, controlMode: "auto-dcm" });
    assert.equal(negative.waveform.mode, "ccm");
    assert.ok(negative.waveform.iValley < 0);
    assert.ok(negative.warnings.includes("negative-current-commutation-approximate"));
    assert.ok(!positive.warnings.includes("negative-current-commutation-approximate"));
    assert.equal(automatic.waveform.mode, "dcm");
    assert.ok(!automatic.warnings.includes("negative-current-commutation-approximate"));
  });

  it("uses the disclosed hard-switch swing and transition coefficients", () => {
    const gan = setup("epc2090");
    const effective = computeBuckLossPointV2(gan.inputs, 2, gan.context);
    const ganSwing = gan.inputs.vin + gan.inputs.diodeVf;
    rel(
      effective.losses.turnOnOverlap,
      0.5 * ganSwing * effective.waveform.iValley * gan.inputs.effectiveTurnOn * gan.inputs.fsw
    );
    rel(
      effective.losses.turnOffOverlap,
      0.5 * ganSwing * effective.waveform.iPeak * gan.inputs.effectiveTurnOff * gan.inputs.fsw
    );
    assert.equal(effective.equationProvenance.turnOnOverlap.formula, "½ · VSW · ION · tEFF,ON · fSW");
    assert.equal(effective.equationProvenance.turnOffOverlap.formula, "½ · VSW · IOFF · tEFF,OFF · fSW");
    assert.equal(effective.equationProvenance.turnOnOverlap.source.relation, "adapted");
    assert.equal(effective.equationProvenance.turnOnOverlap.source.equation, null);

    const silicon = setup("silicon-30v");
    const derived = computeBuckLossPointV2(silicon.inputs, 2, silicon.context);
    const siSwing = silicon.inputs.vin + silicon.inputs.diodeVf;
    const gateCurrentOn = (silicon.inputs.vDrive - silicon.inputs.plateauHigh) / silicon.inputs.gateResistanceOnHigh;
    const gateCurrentOff = silicon.inputs.plateauHigh / silicon.inputs.gateResistanceOffHigh;
    const currentRise = silicon.inputs.qgs2High / gateCurrentOn;
    const voltageFall = silicon.inputs.qgdHigh / gateCurrentOn;
    const voltageRise = silicon.inputs.qgdHigh / gateCurrentOff;
    const currentFall = silicon.inputs.qgs2High / gateCurrentOff;
    rel(derived.losses.turnOnOverlap, siSwing * derived.waveform.iValley * silicon.inputs.fsw * (currentRise / 3 + voltageFall / 2));
    rel(derived.losses.turnOffOverlap, siSwing * derived.waveform.iPeak * silicon.inputs.fsw * (voltageRise / 2 + currentFall / 3));
    assert.equal(derived.equationProvenance.turnOnOverlap.formula, "VSW · ION · fSW · (tI/3 + tV/2)");
    assert.equal(derived.equationProvenance.turnOnOverlap.source.equation, "4.39");
    assert.equal(derived.equationProvenance.turnOnOverlap.source.relation, "direct");

    const dcm = computeBuckLossPointV2(silicon.inputs, 0.05, silicon.context);
    assert.equal(dcm.waveform.mode, "dcm");
    assert.equal(dcm.losses.turnOnOverlap, 0);
  });

  it("labels EOSS outside its characterized voltage domain as a subtotal", () => {
    const { inputs, context } = setup("epc2090", { vin: 60, vout: 12, ioutMax: 5, inductance: 15, fsw: 400 });
    const point = computeBuckLossPointV2(inputs, 3, context);
    assert.equal(point.losses.nodeEnergy, null);
    assert.equal(point.availability, "subtotal");
    assert.ok(point.omitted.includes("nodeEnergyOutsideVoltageDomain"));
    assert.deepEqual(point.coverageGaps.find((gap) => gap.term === "nodeEnergy"), {
      term: "nodeEnergy",
      code: "nodeEnergyOutsideVoltageDomain",
      scope: "whole-term"
    });
  });

  it("omits DCM commutation energy and catalog residual while retaining an explicit manual residual", () => {
    const dataset = JSON.parse(readFileSync(new URL("../assets/data/coilcraft-inductor-loss-surfaces.v1.json", import.meta.url), "utf8"));
    const noManual = setup("epc2090", { dcr: 4.3, rac: 4.3, inductorAcManual: null });
    const omitted = evaluateBuckLossPointV2(noManual.inputs, 0.05, {
      ...noManual.context,
      inductorPartNumber: "XGL6060-222",
      inductorAcDataset: dataset
    });
    assert.equal(omitted.waveform.mode, "dcm");
    assert.equal(omitted.inductorAcEstimate.status, "dcm-waveform");
    assert.equal(omitted.inductorAcIncluded, false);
    assert.equal(omitted.modeledInductorAcLossW, null);
    assert.equal(omitted.losses.inductorCoreResidual, null);
    assert.equal(omitted.losses.nodeEnergy, null);
    assert.equal(omitted.availability, "subtotal");
    assert.ok(omitted.omitted.includes("inductorCoreResidualDcmWaveform"));
    assert.ok(omitted.omitted.includes("nodeEnergyDcmCommutationUnmodeled"));
    assert.deepEqual(
      omitted.coverageGaps.find((gap) => gap.code === "inductorCoreResidualDcmWaveform"),
      {
        term: "inductorCoreResidual",
        code: "inductorCoreResidualDcmWaveform",
        scope: "catalog-component"
      }
    );

    const manual = setup("epc2090", { dcr: 4.3, rac: 4.3, inductorAcManual: 150 });
    const retained = evaluateBuckLossPointV2(manual.inputs, 0.05, {
      ...manual.context,
      inductorPartNumber: "XGL6060-222",
      inductorAcDataset: dataset
    });
    assert.equal(retained.inductorAcEstimate.status, "dcm-waveform");
    assert.equal(retained.lossEstimateKind, "dcm-manual-estimate");
    assert.equal(retained.modeledInductorAcLossW, null);
    rel(retained.manualInductorAcLossW, 0.15);
    rel(retained.losses.inductorCoreResidual, 0.15);
    assert.ok(retained.omitted.includes("inductorCoreResidualDcmWaveform"));
    assert.ok(retained.omitted.includes("nodeEnergyDcmCommutationUnmodeled"));
    assert.equal(retained.availability, "subtotal");
  });

  it("makes missing generic core data a subtotal and counts catalog residual once", () => {
    const generic = setup("epc2090", { inductorAcManual: null });
    const genericPoint = computeBuckLossPointV2(generic.inputs, 2, generic.context);
    assert.equal(genericPoint.availability, "subtotal");
    assert.equal(genericPoint.losses.inductorCoreResidual, null);
    assert.ok(genericPoint.omitted.includes("inductorCoreResidualMissingData"));
    assert.deepEqual(genericPoint.coverageGaps.find((gap) => gap.term === "inductorCoreResidual"), {
      term: "inductorCoreResidual",
      code: "inductorCoreResidualMissingData",
      scope: "whole-term"
    });

    const dataset = JSON.parse(readFileSync(new URL("../assets/data/coilcraft-inductor-loss-surfaces.v1.json", import.meta.url), "utf8"));
    const catalog = setup("epc2090", { dcr: 4.3, rac: 4.3, inductorAcManual: 0 });
    const evaluated = evaluateBuckLossPointV2(catalog.inputs, 2, {
      ...catalog.context,
      inductorPartNumber: "XGL6060-222",
      inductorAcDataset: dataset
    });
    assert.equal(evaluated.inductorAcIncluded, true);
    rel(evaluated.losses.inductorCoreResidual, evaluated.modeledInductorAcLossW);
    rel(
      evaluated.losses.inductorDcCopper + evaluated.losses.inductorAcCopper,
      4 * catalog.inputs.dcr + (evaluated.waveform.moments.iLrms2 - 4) * catalog.inputs.rac
    );
    const direct = computeBuckLossPointV2(catalog.inputs, 2, {
      ...catalog.context,
      inductorAcLossW: evaluated.modeledInductorAcLossW
    });
    rel(evaluated.pLoss, direct.pLoss);
  });

  it("applies maximum DCR to RMS copper exactly without rescaling the characterized residual", () => {
    const dataset = JSON.parse(readFileSync(new URL("../assets/data/coilcraft-inductor-loss-surfaces.v1.json", import.meta.url), "utf8"));
    const evaluateAtDcr = (dcrMohm) => {
      const configured = setup("epc2090", { dcr: dcrMohm, rac: dcrMohm, inductorAcManual: null });
      const result = evaluateBuckLossPointV2(configured.inputs, 2, {
        ...configured.context,
        inductorPartNumber: "XGL6060-222",
        inductorAcDataset: dataset
      });
      return { ...configured, result };
    };
    const typical = evaluateAtDcr(4.3);
    const maximum = evaluateAtDcr(4.8);
    for (const item of [typical, maximum]) {
      const copper = item.result.losses.inductorDcCopper + item.result.losses.inductorAcCopper;
      rel(copper, item.result.waveform.moments.iLrms2 * item.inputs.dcr);
      rel(item.result.losses.inductorCoreResidual, item.result.modeledInductorAcLossW);
      assert.equal(item.result.inductorAcIncluded, true);
    }
    assert.ok(
      maximum.result.losses.inductorDcCopper + maximum.result.losses.inductorAcCopper
        > typical.result.losses.inductorDcCopper + typical.result.losses.inductorAcCopper
    );
    const exactCopperDelta = maximum.result.waveform.moments.iLrms2 * maximum.inputs.dcr
      - typical.result.waveform.moments.iLrms2 * typical.inputs.dcr;
    rel(
      maximum.result.losses.inductorDcCopper + maximum.result.losses.inductorAcCopper
        - typical.result.losses.inductorDcCopper - typical.result.losses.inductorAcCopper,
      exactCopperDelta
    );
    assert.ok(
      Math.abs(maximum.result.modeledInductorAcLossW / typical.result.modeledInductorAcLossW - 1)
        < Math.abs(maximum.inputs.dcr / typical.inputs.dcr - 1) / 10,
      "the characterized residual may follow its ripple input but must not be multiplied by the DCR-corner ratio"
    );
  });

  it("returns the transparent RDS(on)-versus-QG sizing advisory", () => {
    const { inputs, context } = setup();
    const point = computeBuckLossPointV2(inputs, 2, context);
    const conduction = point.losses.highSideConduction + point.losses.lowSideConduction;
    const gate = point.losses.gateDriveHigh + point.losses.gateDriveLow;
    rel(point.insights.fetAreaOptimumScale, Math.sqrt(conduction / gate));
    assert.equal(point.insights.fetAreaBalanceScope, "channel-conduction-vs-gate-drive-only");
  });

  it("keeps manual residual out of the quadratic scaling bucket", () => {
    const baseline = setup("epc2090", { inductorAcManual: 0 });
    const withManual = setup("epc2090", { inductorAcManual: 200 });
    const basePoint = computeBuckLossPointV2(baseline.inputs, 2, baseline.context);
    const manualPoint = computeBuckLossPointV2(withManual.inputs, 2, withManual.context);
    rel(manualPoint.insights.lossScaling.fixedLike - basePoint.insights.lossScaling.fixedLike, 0.2);
    rel(manualPoint.insights.lossScaling.currentSquaredLike, basePoint.insights.lossScaling.currentSquaredLike);
  });

  it("maintains finite invariants over deterministic randomized inputs", () => {
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let index = 0; index < 500; index += 1) {
      const vin = 5 + 43 * random();
      const vout = vin * (0.1 + 0.7 * random());
      const ioutMax = 0.5 + 9.5 * random();
      const setupPoint = setup(index % 2 ? "epc2090" : "silicon-100v", {
        vin,
        vout,
        ioutMax,
        fsw: 100 + 1900 * random(),
        inductance: 0.2 + 19.8 * random(),
        deadTime: 2 + 38 * random()
      });
      const point = computeBuckLossPointV2(setupPoint.inputs, ioutMax * random(), setupPoint.context);
      assert.equal(point.valid, true, `random vector ${index}: ${point.errors.join(",")}`);
      assert.ok(Number.isFinite(point.pLoss));
      assert.ok(Object.values(point.losses).filter(Number.isFinite).every((loss) => loss >= 0));
      rel(point.pInEstimated, point.pOut + point.pLoss);
    }
  });

  it("computes 180-point annotated sweeps at p95 inside the interaction budget", () => {
    const { inputs, context } = setup();
    const durations = [];
    let sweep;
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const start = performance.now();
      sweep = computeBuckLossSweepV2(inputs, context, { points: 180 });
      durations.push(performance.now() - start);
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.floor(0.95 * (durations.length - 1))];
    assert.equal(sweep.points.length, 180);
    assert.ok(sweep.annotations.ccmBoundary > 0);
    assert.ok(sweep.annotations.peakEfficiency.efficiency > 0);
    assert.ok(sweep.annotations.lossBalance.fixedToCurrentSquared.iout > 0);
    assert.ok(sweep.annotations.lossBalance.fixedToCurrentLike.iout > 0);
    assert.ok(sweep.annotations.lossBalance.currentLikeToCurrentSquared.iout > 0);
    assert.ok(sweep.annotations.fetSizingAdvisory.scale > 0);
    assert.ok(p95 < 50, `180-point sweep p95 took ${p95.toFixed(2)} ms`);
  });

  it("partitions the valid sweep into contiguous dominant-loss regions", () => {
    const { inputs, context } = setup();
    const sweep = computeBuckLossSweepV2(inputs, context, { points: 180 });
    const regions = sweep.annotations.dominanceRegions;
    const allowed = new Set(["fixedLike", "currentLike", "currentSquaredLike", "unclassified"]);
    assert.ok(regions.length >= 2);
    rel(regions[0].startIout, 0);
    rel(regions.at(-1).endIout, inputs.ioutMax);
    regions.forEach((region, index) => {
      assert.ok(allowed.has(region.kind), region.kind);
      assert.ok(region.endIout > region.startIout);
      assert.ok(region.averageShare > 0 && region.averageShare <= 1);
      if (index > 0) rel(regions[index - 1].endIout, region.startIout);
      if (index > 0) assert.notEqual(regions[index - 1].kind, region.kind);
    });
    const kinds = new Set(regions.map((region) => region.kind));
    assert.ok(kinds.has("fixedLike"));
    assert.ok(kinds.has("currentLike") || kinds.has("currentSquaredLike"));
  });

  it("reports timing-window and dropout failures explicitly", () => {
    const timing = setup("epc2090", { deadTime: 500 });
    const dropout = setup("silicon-30v", { vin: 3.31, vout: 3.3, ioutMax: 5, dcr: 1000 });
    dropout.inputs.rdsHigh = 0.5;
    const timingWaveform = computeBuckWaveformV2(timing.inputs, 2, { controlMode: "forced-ccm" });
    const dropoutWaveform = computeBuckWaveformV2(dropout.inputs, 5, { controlMode: "forced-ccm" });
    const invalidPoint = computeBuckLossPointV2(dropout.inputs, 5, dropout.context);
    assert.equal(timingWaveform.valid, false);
    assert.ok(timingWaveform.errors.includes("dead-time-infeasible"));
    assert.equal(timingWaveform.failure.code, "dead-time-infeasible");
    assert.ok(Number.isFinite(timingWaveform.failure.values.period));
    assert.ok(timingWaveform.failure.values.deadFraction >= 0.5);
    assert.ok(timingWaveform.failure.values.availableSwitchFraction <= 0);
    assert.equal(dropoutWaveform.valid, false);
    assert.ok(dropoutWaveform.errors.includes("dropout"));
    assert.equal(dropoutWaveform.failure.code, "dropout");
    assert.ok(dropoutWaveform.failure.values.highVoltage <= 0);
    assert.ok(Number.isFinite(dropoutWaveform.failure.values.availableSwitchFraction));
    assert.equal(invalidPoint.modelVersion, 2);
    assert.equal(invalidPoint.modelRevision, "2.1");
    assert.equal(invalidPoint.deviceTemplate, "silicon-30v");
    assert.equal(invalidPoint.parameterCorner, "synthetic-typical-25c");
    assert.equal(invalidPoint.failure.code, "dropout");
    assert.deepEqual(invalidPoint.provenance, dropout.context.provenance);
  });

  it("reports a structured duty-window failure for a near-dropout requested output", () => {
    const { inputs, context } = setup("epc2090", { vin: 12, vout: 11.9, ioutMax: 3 });
    const waveform = computeBuckWaveformV2(inputs, 2, { controlMode: "forced-ccm" });
    const point = computeBuckLossPointV2(inputs, 2, { ...context, controlMode: "forced-ccm" });
    assert.equal(waveform.valid, false);
    assert.equal(waveform.failure.code, "low-side-window-negative");
    assert.ok(waveform.failure.values.requiredHighFraction > waveform.failure.values.availableSwitchFraction);
    assert.ok(waveform.failure.values.lowFraction < 0);
    assert.ok(waveform.failure.values.highVoltage > 0);
    assert.equal(point.valid, false);
    assert.deepEqual(point.failure, waveform.failure);
    assert.equal(point.pLoss, null);
    assert.equal(point.efficiency, null);
  });
});
