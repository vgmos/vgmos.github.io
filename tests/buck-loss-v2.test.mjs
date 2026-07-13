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
import { resolveBuckLossConditionsV2 } from "../js/tools/buck-loss-condition-resolver-v2.js";
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

function conditionedSetup(deviceId = "epc2090", {
  currentA = 3,
  vDrive = null,
  rawOverrides = {},
  provenanceOverrides = {}
} = {}) {
  const applied = applyBuckLossDeviceTemplateV2({
    ...rawDefaultsV2(),
    inductorAcManual: 0,
    ioutMax: currentA,
    ...rawOverrides
  }, deviceId);
  Object.assign(applied.rawInputs, rawOverrides);
  if (vDrive !== null) applied.rawInputs.vDrive = vDrive;
  applied.rawInputs.__provenance = {
    ...applied.rawInputs.__provenance,
    ...(vDrive !== null ? { vDrive: "entered" } : {}),
    ...provenanceOverrides
  };
  const conditioning = resolveBuckLossConditionsV2(applied.rawInputs, applied.template, { currentA });
  const { inputs, provenance } = normalizeBuckLossInputsV2(conditioning.rawInputs);
  return {
    conditioning,
    inputs,
    context: {
      technology: applied.template.technology,
      catalogKind: applied.template.catalogKind,
      deviceTemplate: deviceId,
      parameterCorner: applied.template.cornerId,
      timingMode: "auto",
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
    assert.equal(inputs.deadTimeHighToLow, inputs.deadTime);
    assert.equal(inputs.deadTimeLowToHigh, inputs.deadTime);
    assert.equal(normalized.provenance.deadTimeHighToLow, "inferred-from-dead-time");
    assert.equal(normalized.provenance.deadTimeLowToHigh, "inferred-from-dead-time");
    assert.deepEqual(validateBuckLossInputsV2(inputs), { valid: true, errors: [] });
  });

  it("keeps a blank controller bias linked to VIN while an entered bias stays pinned", () => {
    const blankAt12V = normalizeBuckLossInputsV2({ vin: 12, vBias: "" });
    const blankAt48V = normalizeBuckLossInputsV2({ vin: 48, vBias: "" });
    assert.equal(blankAt12V.inputs.vBias, 12);
    assert.equal(blankAt48V.inputs.vBias, 48);
    assert.equal(blankAt12V.provenance.vBias, "inferred-from-vin");
    assert.equal(blankAt48V.provenance.vBias, "inferred-from-vin");

    const enteredAt12V = normalizeBuckLossInputsV2({ vin: 12, vBias: 5 });
    const enteredAt48V = normalizeBuckLossInputsV2({ vin: 48, vBias: 5 });
    assert.equal(enteredAt12V.inputs.vBias, 5);
    assert.equal(enteredAt48V.inputs.vBias, 5);
    assert.equal(enteredAt12V.provenance.vBias, "entered");
    assert.equal(enteredAt48V.provenance.vBias, "entered");
  });

  it("keeps a blank ripple RAC linked to DCR while an entered RAC stays pinned", () => {
    const blankAt20mOhm = normalizeBuckLossInputsV2({ dcr: 20, rac: "" });
    const blankAt55mOhm = normalizeBuckLossInputsV2({ dcr: 55, rac: "" });
    assert.equal(blankAt20mOhm.inputs.rac, 20e-3);
    assert.equal(blankAt55mOhm.inputs.rac, 55e-3);
    assert.equal(blankAt20mOhm.provenance.rac, "inferred-rac-equals-rdc");
    assert.equal(blankAt55mOhm.provenance.rac, "inferred-rac-equals-rdc");

    const enteredAt20mOhm = normalizeBuckLossInputsV2({ dcr: 20, rac: 80 });
    const enteredAt55mOhm = normalizeBuckLossInputsV2({ dcr: 55, rac: 80 });
    assert.equal(enteredAt20mOhm.inputs.rac, 80e-3);
    assert.equal(enteredAt55mOhm.inputs.rac, 80e-3);
    assert.equal(enteredAt20mOhm.provenance.rac, "entered");
    assert.equal(enteredAt55mOhm.provenance.rac, "entered");
  });

  it("keeps blank edge dead times linked to the fallback while entered edges stay pinned", () => {
    const blankAt2ns = normalizeBuckLossInputsV2({
      deadTime: 2,
      deadTimeHighToLow: "",
      deadTimeLowToHigh: ""
    });
    const blankAt20ns = normalizeBuckLossInputsV2({
      deadTime: 20,
      deadTimeHighToLow: "",
      deadTimeLowToHigh: ""
    });
    rel(blankAt2ns.inputs.deadTimeHighToLow, 2e-9, 1e-18);
    rel(blankAt2ns.inputs.deadTimeLowToHigh, 2e-9, 1e-18);
    rel(blankAt20ns.inputs.deadTimeHighToLow, 20e-9, 1e-18);
    rel(blankAt20ns.inputs.deadTimeLowToHigh, 20e-9, 1e-18);
    assert.equal(blankAt20ns.provenance.deadTimeHighToLow, "inferred-from-dead-time");
    assert.equal(blankAt20ns.provenance.deadTimeLowToHigh, "inferred-from-dead-time");

    const enteredAt2ns = normalizeBuckLossInputsV2({
      deadTime: 2,
      deadTimeHighToLow: 7,
      deadTimeLowToHigh: 11
    });
    const enteredAt20ns = normalizeBuckLossInputsV2({
      deadTime: 20,
      deadTimeHighToLow: 7,
      deadTimeLowToHigh: 11
    });
    rel(enteredAt2ns.inputs.deadTimeHighToLow, 7e-9, 1e-18);
    rel(enteredAt2ns.inputs.deadTimeLowToHigh, 11e-9, 1e-18);
    rel(enteredAt20ns.inputs.deadTimeHighToLow, 7e-9, 1e-18);
    rel(enteredAt20ns.inputs.deadTimeLowToHigh, 11e-9, 1e-18);
    assert.equal(enteredAt20ns.provenance.deadTimeHighToLow, "entered");
    assert.equal(enteredAt20ns.provenance.deadTimeLowToHigh, "entered");
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
    assert.equal(epc.values.gateResistanceOnHigh, null);
    assert.equal(epc.provenance.gateResistanceOnHigh, "missing");
    assert.ok(epc.notes.some((note) => /internal device resistance, not the complete driver/i.test(note)));
    assert.equal(epc.values.diodeVf, 1.5);
    assert.equal(epc.values.qrrRef, 0);
    assert.equal(epc.values.effectiveTurnOn, 3);
    assert.equal(epc.values.effectiveTurnOff, 2);
    assert.equal(epc.provenance.qgs2High, "inferred-qgs-minus-qgth");
    assert.match(epc.source.url, /EPC2090_datasheet\.pdf/);
    assert.equal(epc.parameterConditions.rdsHigh.maximum, 5.2);
    assert.equal(epc.parameterConditions.qgHigh.maximum, 9.3);
    assert.match(epc.parameterConditions.qgHigh.conditions, /VDS = 50 V, ID = 16 A/);
    assert.equal(epc.parameterConditions.cossErHigh.statistic, "energy-equivalent");
    assert.match(epc.parameterConditions.cossErHigh.conditions, /0 to 50 V/);
    assert.equal(epc.parameterConditions.effectiveTurnOn.statistic, "illustrative assumption");
    assert.ok(epc.notes.some((note) => /no shipped EON\/EOFF surface/i.test(note)));

    const infineon = getBuckLossDeviceTemplateV2("infineon-bsc010n04ls6-4v5");
    assert.equal(infineon.label, "Infineon BSC010N04LS6 pair");
    assert.equal(infineon.technology, "silicon");
    assert.equal(infineon.catalogKind, "manufacturer");
    assert.equal(infineon.manufacturer, "Infineon");
    assert.equal(infineon.partNumber, "BSC010N04LS6");
    assert.equal(infineon.cornerId, "mixed-datasheet-25c-vgs4v5");
    assert.equal(infineon.voltageClass, 40);
    assert.equal(infineon.timingMode, "auto");
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
    assert.equal(point.modelRevision, "2.4");
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
    assert.equal(point.transition.method, "effective-fallback");
    assert.equal(point.transition.selectedBy, "automatic-hierarchy");
    assert.equal(point.uncertainty.status, "bounded-total");
    assert.ok(point.uncertainty.lossW.low <= point.pLoss);
    assert.ok(point.uncertainty.lossW.high >= point.pLoss);
    assert.equal(point.commutation.accounting, "diagnostic-only-no-zvs-credit");

    const sweep = computeBuckLossSweepV2(inputs, context, { points: 180 });
    assert.equal(sweep.modelVersion, 2);
    assert.equal(sweep.modelRevision, "2.4");
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

describe("buck loss v2 condition-coupled device inputs", () => {
  it("anchors Vishay total gate charge at its measured 4.5 V condition, separate from the EVM's 8 V drive", () => {
    const template = getBuckLossDeviceTemplateV2("vishay-si7860dp-tps40071evm");
    assert.equal(template.conditionModel.reference.driveVoltageV, 8);
    assert.equal(template.conditionModel.gateCharge.referenceDriveVoltageV, 4.5);

    const at4v5 = conditionedSetup("vishay-si7860dp-tps40071evm", { currentA: 16, vDrive: 4.5 }).conditioning;
    const at8V = conditionedSetup("vishay-si7860dp-tps40071evm", { currentA: 16, vDrive: 8 }).conditioning;

    rel(at4v5.diagnostics.totalGateChargeNc, 13);
    rel(at4v5.rawInputs.qgHigh, 13);
    assert.ok(at8V.diagnostics.totalGateChargeNc > at4v5.diagnostics.totalGateChargeNc);
    rel(at8V.diagnostics.totalGateChargeNc, 22.333333333333332);

    const at3v3 = conditionedSetup("vishay-si7860dp-tps40071evm", { currentA: 16, vDrive: 3.3 }).conditioning;
    assert.ok(at3v3.warnings.some(({ code, message }) => (
      code === "drive-outside-recommended-range" && message.includes("source-backed 4.5-10 V range")
    )));
  });

  it("holds the transfer-model plateau at fixed current while drive changes headroom, RDS(on), charge, and turn-on time", () => {
    const at5V = conditionedSetup("epc2090", { currentA: 3, vDrive: 5 }).conditioning;
    const at3v3 = conditionedSetup("epc2090", { currentA: 3, vDrive: 3.3 }).conditioning;

    assert.equal(at5V.diagnostics.supported, true);
    assert.equal(at3v3.diagnostics.supported, true);
    assert.ok(at3v3.warnings.some(({ code }) => code === "drive-outside-recommended-range"));
    rel(at3v3.diagnostics.plateauV, at5V.diagnostics.plateauV);
    rel(at3v3.diagnostics.qgs2Nc, at5V.diagnostics.qgs2Nc);
    assert.ok(at3v3.diagnostics.driveHeadroomV < at5V.diagnostics.driveHeadroomV);
    assert.ok(at3v3.diagnostics.rdsOnMohm > at5V.diagnostics.rdsOnMohm);
    assert.ok(at3v3.diagnostics.totalGateChargeNc < at5V.diagnostics.totalGateChargeNc);
    assert.ok(at3v3.diagnostics.effectiveTurnOnNs > at5V.diagnostics.effectiveTurnOnNs);
    rel(at3v3.diagnostics.effectiveTurnOffNs, at5V.diagnostics.effectiveTurnOffNs);
    assert.equal(at3v3.rawInputs.__provenance.plateauHigh, "calculated-condition-plateau");
    assert.equal(at3v3.rawInputs.__provenance.rdsHigh, "calculated-condition-rds");
    assert.equal(at3v3.rawInputs.__provenance.qgHigh, "calculated-condition-total-qg");
    assert.equal(at3v3.rawInputs.__provenance.effectiveTurnOn, "calculated-condition-effective-time");

    const at16A = conditionedSetup("epc2090", { currentA: 16, vDrive: 3.3 }).conditioning;
    assert.ok(at16A.diagnostics.plateauV > at3v3.diagnostics.plateauV);
    assert.ok(at16A.diagnostics.qgs2Nc > at3v3.diagnostics.qgs2Nc);
    assert.ok(at16A.diagnostics.driveHeadroomV < at3v3.diagnostics.driveHeadroomV);
  });

  it("keeps explicit per-field overrides pinned while calculated sibling fields continue tracking", () => {
    const explicit = {
      rdsHigh: 11,
      qgHigh: 8.8,
      qgs2High: 0.55,
      plateauHigh: 2.05,
      effectiveTurnOn: 9,
      effectiveTurnOff: 10
    };
    const provenanceOverrides = Object.fromEntries(Object.keys(explicit).map((key) => [key, "entered"]));
    const at5V = conditionedSetup("epc2090", {
      currentA: 3,
      vDrive: 5,
      rawOverrides: explicit,
      provenanceOverrides
    }).conditioning;
    const at3v3 = resolveBuckLossConditionsV2({
      ...at5V.rawInputs,
      vDrive: 3.3,
      __provenance: { ...at5V.rawInputs.__provenance, vDrive: "entered" }
    }, getBuckLossDeviceTemplateV2("epc2090"), { currentA: 3 });

    for (const [key, value] of Object.entries(explicit)) {
      assert.equal(at3v3.rawInputs[key], value, `${key} must remain an explicit override`);
      assert.equal(at3v3.rawInputs.__provenance[key], "entered");
      assert.ok(at3v3.diagnostics.preservedKeys.includes(key));
    }
    assert.ok(at3v3.rawInputs.rdsLow > at5V.rawInputs.rdsLow);
    assert.ok(at3v3.rawInputs.qgLow < at5V.rawInputs.qgLow);
    assert.equal(at3v3.diagnostics.effectiveTurnOnNs, 9);
    assert.equal(at3v3.diagnostics.effectiveTurnOffNs, 10);
    assert.notEqual(at3v3.diagnostics.estimatedEffectiveTurnOnNs, 9);
    assert.notEqual(at3v3.diagnostics.estimatedEffectiveTurnOffNs, 10);
  });

  it("resumes automatic calculation after reset and clears stale overrides on a device switch", () => {
    const overridden = conditionedSetup("epc2090", {
      currentA: 3,
      vDrive: 3.3,
      rawOverrides: { rdsHigh: 11, qgHigh: 8.8 },
      provenanceOverrides: { rdsHigh: "entered", qgHigh: "entered" }
    }).conditioning;
    const resetRaw = {
      ...overridden.rawInputs,
      __provenance: { ...overridden.rawInputs.__provenance }
    };
    delete resetRaw.__provenance.rdsHigh;
    delete resetRaw.__provenance.qgHigh;
    const reset = resolveBuckLossConditionsV2(resetRaw, getBuckLossDeviceTemplateV2("epc2090"), { currentA: 3 });
    assert.notEqual(reset.rawInputs.rdsHigh, 11);
    assert.notEqual(reset.rawInputs.qgHigh, 8.8);
    assert.equal(reset.rawInputs.__provenance.rdsHigh, "calculated-condition-rds");
    assert.equal(reset.rawInputs.__provenance.qgHigh, "calculated-condition-total-qg");

    const switched = applyBuckLossDeviceTemplateV2(overridden.rawInputs, "silicon-30v");
    const switchedConditions = resolveBuckLossConditionsV2(switched.rawInputs, switched.template, { currentA: 3 });
    assert.notEqual(switchedConditions.rawInputs.rdsHigh, 11);
    assert.notEqual(switchedConditions.rawInputs.qgHigh, 8.8);
    assert.equal(switchedConditions.rawInputs.__provenance.rdsHigh, "calculated-condition-rds");
    assert.equal(switchedConditions.rawInputs.__provenance.qgHigh, "calculated-condition-total-qg");
    assert.equal(switchedConditions.diagnostics.supported, true);
  });

  it("changes the EPC loss result coherently when drive falls from 5 V to 3.3 V", () => {
    const at5V = conditionedSetup("epc2090", { currentA: 3, vDrive: 5 });
    const at3v3 = conditionedSetup("epc2090", { currentA: 3, vDrive: 3.3 });
    const point5V = computeBuckLossPointV2(at5V.inputs, 3, at5V.context);
    const point3v3 = computeBuckLossPointV2(at3v3.inputs, 3, at3v3.context);

    assert.equal(point5V.transition.method, "effective-fallback");
    assert.equal(point3v3.transition.method, "effective-fallback");
    assert.ok(point3v3.groupedLosses.gateDrive < point5V.groupedLosses.gateDrive);
    assert.ok(point3v3.groupedLosses.switchingTransitions > point5V.groupedLosses.switchingTransitions);
    assert.ok(point3v3.groupedLosses.mosfetConduction > point5V.groupedLosses.mosfetConduction);
    assert.ok(point3v3.pLoss > point5V.pLoss);
    assert.ok(point3v3.efficiency < point5V.efficiency);
  });

  it("diagnoses drives outside the characterized domain and insufficient plateau headroom", () => {
    const outside = conditionedSetup("epc2090", { currentA: 3, vDrive: 2.9 }).conditioning;
    assert.equal(outside.diagnostics.supported, false);
    assert.ok(outside.errors.some(({ code }) => code === "drive-outside-condition-domain"));

    const noHeadroom = conditionedSetup("infineon-bsc010n04ls6-4v5", { currentA: 100, vDrive: 3 }).conditioning;
    assert.equal(noHeadroom.diagnostics.supported, false);
    assert.ok(noHeadroom.diagnostics.driveHeadroomV <= 0);
    assert.ok(noHeadroom.errors.some(({ code, field }) => code === "insufficient-gate-headroom" && field === "vDrive"));

    const manualNoHeadroom = conditionedSetup("epc2090", {
      currentA: 3,
      vDrive: 5,
      rawOverrides: { plateauHigh: 6 },
      provenanceOverrides: { plateauHigh: "entered" }
    }).conditioning;
    assert.ok(manualNoHeadroom.errors.some(({ code, field }) => code === "insufficient-gate-headroom" && field === "plateauHigh"));

    const belowThreshold = conditionedSetup("epc2090", {
      currentA: 3,
      vDrive: 5,
      rawOverrides: { plateauHigh: 0.1 },
      provenanceOverrides: { plateauHigh: "entered" }
    }).conditioning;
    assert.equal(belowThreshold.diagnostics.supported, false);
    assert.ok(belowThreshold.errors.some(({ code, field }) => (
      code === "plateau-below-transfer-threshold" && field === "plateauHigh"
    )));
    assert.ok(belowThreshold.rawInputs.qgs2High >= 0);
  });

  it("canonicalizes hidden low-side detail overrides before they can alter or block the symmetric pair", () => {
    const template = getBuckLossDeviceTemplateV2("epc2090");
    const applied = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ioutMax: 3 }, template.id);
    Object.assign(applied.rawInputs, { plateauLow: 6, qgs2Low: 100, qgdLow: 100 });
    Object.assign(applied.rawInputs.__provenance, {
      plateauLow: "url-entered",
      qgs2Low: "url-entered",
      qgdLow: "url-entered"
    });
    const conditioned = resolveBuckLossConditionsV2(applied.rawInputs, template, { currentA: 3 });
    assert.equal(conditioned.diagnostics.supported, true);
    rel(conditioned.rawInputs.plateauLow, conditioned.rawInputs.plateauHigh);
    rel(conditioned.rawInputs.qgs2Low, conditioned.rawInputs.qgs2High);
    assert.equal(conditioned.rawInputs.qgdLow, template.values.qgdLow);
    assert.equal(conditioned.rawInputs.__provenance.plateauLow, "calculated-condition-plateau");
    assert.equal(conditioned.rawInputs.__provenance.qgs2Low, "calculated-condition-qgs2");
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

  it("models unequal effective dead-time edges and current-dependent reverse-path drop", () => {
    const asymmetric = setup("epc2090", {
      deadTime: 2,
      deadTimeHighToLow: 7,
      deadTimeLowToHigh: 1,
      reversePathResistance: 100
    });
    const waveform = computeBuckWaveformV2(asymmetric.inputs, 2, { controlMode: "forced-ccm" });
    const deadSegments = waveform.segments.filter((segment) => segment.state === "dead-time");
    assert.deepEqual(deadSegments.map((segment) => segment.edge), ["high-to-low", "low-to-high"]);
    rel(deadSegments[0].duration, 7e-9);
    rel(deadSegments[1].duration, 1e-9);
    rel(waveform.deadTimes.highToLow, 7e-9);
    rel(waveform.deadTimes.lowToHigh, 1e-9);
    assert.ok(waveform.moments.deadTimeByEdge.highToLow.currentAbsAverage > waveform.moments.deadTimeByEdge.lowToHigh.currentAbsAverage);

    const point = computeBuckLossPointV2(asymmetric.inputs, 2, { ...asymmetric.context, controlMode: "forced-ccm" });
    rel(
      point.losses.deadTimeConduction,
      point.deadTimeBreakdown.highToLow.powerW + point.deadTimeBreakdown.lowToHigh.powerW
    );
    assert.ok(point.deadTimeBreakdown.highToLow.slopeResistancePowerW > 0);
    assert.equal(point.commutation.edges.highToLow.edge, "high-to-low");
    assert.equal(point.commutation.edges.lowToHigh.edge, "low-to-high");
    assert.equal(point.commutation.accounting, "diagnostic-only-no-zvs-credit");
    assert.ok(point.losses.nodeEnergy > 0, "diagnostic ZVS support must not silently credit EOSS");

    const constantDrop = setup("epc2090", {
      deadTimeHighToLow: 7,
      deadTimeLowToHigh: 1,
      reversePathResistance: 0
    });
    const constantPoint = computeBuckLossPointV2(constantDrop.inputs, 2, { ...constantDrop.context, controlMode: "forced-ccm" });
    assert.ok(point.losses.deadTimeConduction > constantPoint.losses.deadTimeConduction);
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

  it("limits silicon QRR by LS-to-HS dead-time diffusion buildup", () => {
    const gan = setup("epc2090");
    const si = setup("silicon-60v");
    const ganPoint = computeBuckLossPointV2(gan.inputs, 2, gan.context);
    const siPoint1 = computeBuckLossPointV2(si.inputs, 1, si.context);
    const siPoint2 = computeBuckLossPointV2(si.inputs, 2, si.context);
    assert.equal(ganPoint.losses.reverseRecovery, 0);
    assert.ok(siPoint1.losses.reverseRecovery > 0);
    assert.ok(siPoint2.losses.reverseRecovery > siPoint1.losses.reverseRecovery);
    const tauF = si.inputs.qrrRef / si.inputs.qrrRefCurrent;
    const buildUp = -Math.expm1(-si.inputs.deadTimeLowToHigh / tauF);
    rel(
      siPoint2.losses.reverseRecovery,
      (si.inputs.vin + si.inputs.diodeVf)
        * si.inputs.qrrRef
        * siPoint2.waveform.iValley
        / si.inputs.qrrRefCurrent
        * buildUp
        * si.inputs.fsw
    );

    const highToLowOnlyInputs = { ...si.inputs, deadTimeHighToLow: 2e-9, deadTimeLowToHigh: 0 };
    const lowToHighOnlyInputs = { ...si.inputs, deadTimeHighToLow: 0, deadTimeLowToHigh: 2e-9 };
    const highToLowOnly = computeBuckLossPointV2(highToLowOnlyInputs, 2, si.context);
    const lowToHighOnly = computeBuckLossPointV2(lowToHighOnlyInputs, 2, si.context);
    assert.equal(highToLowOnly.losses.reverseRecovery, 0);
    assert.ok(lowToHighOnly.losses.reverseRecovery > 0);

    const zeroQrr = computeBuckLossPointV2({ ...si.inputs, qrrRef: 0, deadTimeLowToHigh: 0 }, 2, si.context);
    assert.equal(zeroQrr.losses.reverseRecovery, 0);
    assert.ok(Number.isFinite(zeroQrr.pLoss));

    const dcm = computeBuckLossPointV2(si.inputs, 0.05, si.context);
    assert.equal(dcm.waveform.mode, "dcm");
    assert.equal(dcm.losses.reverseRecovery, 0);

    const atTau = computeBuckLossPointV2({ ...si.inputs, deadTimeLowToHigh: tauF }, 2, si.context);
    const atTenTau = computeBuckLossPointV2({ ...si.inputs, deadTimeLowToHigh: 10 * tauF }, 2, si.context);
    assert.ok(atTau.losses.reverseRecovery > 0);
    assert.ok(atTenTau.losses.reverseRecovery > atTau.losses.reverseRecovery);
    const asymptotic = (si.inputs.vin + si.inputs.diodeVf)
      * si.inputs.qrrRef
      * atTenTau.waveform.iValley
      / si.inputs.qrrRefCurrent
      * si.inputs.fsw;
    rel(atTenTau.losses.reverseRecovery, asymptotic, 1e-4);
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
    assert.equal(effective.transition.method, "effective-fallback");
    assert.equal(effective.transition.evidenceClass, "assumed");
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
    assert.equal(derived.transition.method, "derived-gate-charge");
    assert.equal(derived.transition.selectedBy, "automatic-hierarchy");
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

  it("prioritizes condition-matched switching-energy evidence and prevents double counting", () => {
    const gan = setup("epc2090");
    const surface = {
      kind: "measured",
      source: { id: "synthetic-energy-surface" },
      conditions: {
        temperatureC: 25,
        gateResistanceOnOhm: gan.inputs.gateResistanceOnHigh,
        gateResistanceOffOhm: gan.inputs.gateResistanceOffHigh
      },
      axes: { voltageV: [10, 14], currentA: [0, 4] },
      turnOnEnergyJ: [[10e-9, 50e-9], [30e-9, 70e-9]],
      turnOffEnergyJ: [[20e-9, 60e-9], [40e-9, 80e-9]],
      includesNodeEnergy: true,
      includesReverseRecovery: true
    };
    const point = computeBuckLossPointV2(gan.inputs, 2, {
      ...gan.context,
      junctionTemperatureC: 25,
      switchingEnergySurface: surface
    });
    assert.equal(point.transition.method, "measured-energy-surface");
    assert.equal(point.transition.evidenceClass, "measured");
    assert.equal(point.transition.confidence, "high");
    const expectedOnEnergy = 20e-9 + 40e-9 * point.waveform.iValley / 4;
    const expectedOffEnergy = 30e-9 + 40e-9 * point.waveform.iPeak / 4;
    rel(point.losses.turnOnOverlap, expectedOnEnergy * gan.inputs.fsw);
    rel(point.losses.turnOffOverlap, expectedOffEnergy * gan.inputs.fsw);
    assert.equal(point.losses.nodeEnergy, 0);
    assert.equal(point.losses.reverseRecovery, 0);
    assert.deepEqual(point.accounting.accountedElsewhere, {
      reverseRecovery: "switchingTransitions",
      nodeEnergy: "switchingTransitions"
    });
    assert.equal(point.equationProvenance.turnOnOverlap.formula, "EON(VIN, ION, conditions) · fSW");

    const mismatch = computeBuckLossPointV2(gan.inputs, 2, {
      ...gan.context,
      junctionTemperatureC: 100,
      switchingEnergySurface: surface
    });
    assert.equal(mismatch.transition.method, "effective-fallback");
    assert.ok(mismatch.warnings.includes("switching-energy-surface-fallback"));
    assert.equal(mismatch.transition.attempts[0].reason, "temperatureC-mismatch");
    assert.ok(mismatch.losses.nodeEnergy > 0);
  });

  it("returns transparent engineering bounds and ranked sensitivity drivers", () => {
    const gan = setup("epc2090");
    const point = computeBuckLossPointV2(gan.inputs, 2, gan.context);
    assert.equal(point.uncertainty.status, "bounded-total");
    assert.equal(point.uncertainty.method, "evidence-weighted-family-envelope");
    assert.ok(point.uncertainty.lossW.low < point.pLoss);
    assert.ok(point.uncertainty.lossW.high > point.pLoss);
    assert.ok(point.uncertainty.efficiency.low < point.efficiency);
    assert.ok(point.uncertainty.efficiency.high > point.efficiency);
    assert.equal(point.uncertainty.dominantSensitivity.family, "switchingTransitions");
    assert.equal(point.uncertainty.dominantSensitivity.evidenceClass, "assumed");
    const spans = point.uncertainty.contributors.map((contributor) => contributor.spanW);
    assert.deepEqual(spans, [...spans].sort((left, right) => right - left));

    const narrowed = computeBuckLossPointV2(gan.inputs, 2, {
      ...gan.context,
      uncertaintyProfile: { families: { switchingTransitions: 0.1 } }
    });
    const nominalTransition = point.uncertainty.contributors.find((entry) => entry.family === "switchingTransitions");
    const narrowedTransition = narrowed.uncertainty.contributors.find((entry) => entry.family === "switchingTransitions");
    assert.ok(narrowedTransition.spanW < nominalTransition.spanW);

    const subtotalSetup = setup("infineon-bsc010n04ls6-4v5");
    const subtotal = computeBuckLossPointV2(subtotalSetup.inputs, 2, subtotalSetup.context);
    assert.equal(subtotal.uncertainty.status, "bounded-known-loss-only");
    assert.ok(subtotal.uncertainty.caveats.some((caveat) => /omitted mechanisms/i.test(caveat)));
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
    assert.equal(invalidPoint.modelRevision, "2.4");
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
