import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildSurfaceDataset,
  makePilotPlan,
  makeToolRequest,
  normalizeToolResponse,
  validateAccountingRecord,
  validateCollectedRecords
} from "../scripts/coilcraft/loss-surface.mjs";
import { V2_PILOT_PART_NUMBERS } from "../scripts/coilcraft/loss-model-v2.mjs";

async function catalog() {
  return JSON.parse(await readFile(new URL("../assets/data/coilcraft-inductors.v1.json", import.meta.url), "utf8"));
}

function syntheticRecord(sample) {
  const rippleDcrLoss = sample.ripple_pp_A ** 2 / 12 * sample.dcr_typ_mOhm;
  const additionalAcLoss = sample.ripple_pp_A === 0 ? 0 : 10 * Math.exp(0.01 * sample.idc_A);
  const dcLoss = sample.idc_A ** 2 * sample.dcr_typ_mOhm;
  return {
    sample_id: sample.sample_id,
    sample_kind: sample.kind,
    part_number: sample.part_number,
    frequency_Hz: sample.frequency_Hz,
    idc_A: sample.idc_A,
    ipeak_A: sample.ipeak_A,
    ripple_pp_A: sample.ripple_pp_A,
    ambient_C: sample.ambient_C,
    waveform: sample.waveform,
    dcr_typ_mOhm: sample.dcr_typ_mOhm,
    dcr_typ_loss_mW: dcLoss,
    vendor_ac_core_winding_loss_mW: additionalAcLoss + rippleDcrLoss,
    ripple_dcr_loss_mW: rippleDcrLoss,
    additional_ac_core_winding_loss_mW: additionalAcLoss,
    total_loss_mW: dcLoss + additionalAcLoss + rippleDcrLoss,
    raw_total_loss_mW: dcLoss + additionalAcLoss + rippleDcrLoss,
    temperature_rise_C: 1,
    source_run_id: "fixture",
    source_model_fingerprint: "fixture-model",
    captured_at_utc: "2026-07-09T00:00:00.000Z"
  };
}

describe("Coilcraft AC-loss acquisition", () => {
  it("publishes the reviewed v2 pilot while preserving the legacy surface", async () => {
    const dataset = JSON.parse(await readFile(new URL("../assets/data/coilcraft-inductor-loss-surfaces.v1.json", import.meta.url), "utf8"));
    assert.equal(dataset.schema_version, 2);
    assert.equal(dataset.permission_status, "approved");
    assert.deepEqual(Object.keys(dataset.parts), [
      "XEL4030-201",
      "XEL4030-471",
      "XEL4030-102",
      "XEL4030-222",
      "XGL6060-102",
      "XGL6060-222",
      "XGL6060-472"
    ]);
    assert.equal(dataset.parts["XEL4030-201"].model_schema_version, 1);
    assert.ok(V2_PILOT_PART_NUMBERS.every((partNumber) => dataset.parts[partNumber].model_schema_version === 2));
    assert.match(dataset.accounting_convention, /I_L_RMS/);
    assert.ok(Object.values(dataset.parts).every((part) => part.validation.passes ?? part.validation.summary?.passes));
  });

  it("builds the reviewed two-part grid and current tool request", async () => {
    const plan = makePilotPlan(await catalog());
    assert.deepEqual(plan.parts.map((part) => part.part_number), ["XEL4030-201", "XGL6060-222"]);
    for (const part of plan.parts) {
      const expectedTraining = part.axes.frequency_Hz.length * part.axes.dc_current_A.length * part.axes.ripple_pp_A.length;
      const expectedHoldouts = (part.axes.frequency_Hz.length - 1) * (part.axes.dc_current_A.length - 1) * (part.axes.ripple_pp_A.length - 1);
      assert.equal(plan.samples.filter((sample) => sample.part_number === part.part_number && sample.kind === "training").length, expectedTraining);
      assert.equal(plan.samples.filter((sample) => sample.part_number === part.part_number && sample.kind === "holdout").length, expectedHoldouts);
      assert.equal(plan.samples.filter((sample) => sample.part_number === part.part_number && sample.kind.includes("canary")).length, 1);
    }
    assert.equal(new Set(plan.samples.map((sample) => sample.sample_id)).size, plan.samples.length);
    const request = makeToolRequest(plan.samples[0]);
    assert.equal(request.searchType, 2);
    assert.equal(request.operatingConditions[0].current.unit, 8);
    assert.equal(request.operatingConditions[0].frequency.unit, 11);
    assert.deepEqual(request.operatingConditions[0].partNumbers, [plan.samples[0].part_number]);
  });

  it("normalizes ACLoss as combined core plus winding loss", async () => {
    const plan = makePilotPlan(await catalog());
    const sample = plan.samples.find((candidate) => candidate.part_number === "XGL6060-222" && candidate.ripple_pp_A > 0 && candidate.idc_A > 0);
    const payload = {
      StatusCode: 1,
      PartsData: [{
        PartNumber: sample.part_number,
        ACLoss: 12.5,
        DCLoss: sample.idc_A ** 2 * sample.dcr_typ_mOhm,
        TotalLoss: null,
        PartTemperature: 27
      }]
    };
    const record = normalizeToolResponse(sample, payload, { source_run_id: "fixture" });
    assert.equal(record.vendor_ac_core_winding_loss_mW, 12.5);
    assert.equal(record.additional_ac_core_winding_loss_mW, 12.5 - record.ripple_dcr_loss_mW);
    assert.equal(record.total_loss_mW, record.vendor_ac_core_winding_loss_mW + record.dcr_typ_loss_mW);
    assert.equal(record.temperature_rise_C, 2);
  });

  it("accepts the observed IDC-only DCLoss convention and rejects full RMS DCLoss", () => {
    const base = {
      sample_id: "accounting", idc_A: 2, ripple_pp_A: 2, dcr_typ_mOhm: 4.3,
      dcr_typ_loss_mW: 2 ** 2 * 4.3,
      vendor_ac_core_winding_loss_mW: 10,
      ripple_dcr_loss_mW: 4 / 12 * 4.3,
      additional_ac_core_winding_loss_mW: 10 - 4 / 12 * 4.3,
      raw_total_loss_mW: null
    };
    assert.equal(validateAccountingRecord(base).valid, true);
    const fullRms = { ...base, dcr_typ_loss_mW: (2 ** 2 + 4 / 12) * 4.3 };
    const result = validateAccountingRecord(fullRms);
    assert.equal(result.valid, false);
    assert.equal(result.matches_idc_only, false);
    assert.equal(result.matches_full_rms, true);
  });

  it("builds validated surfaces from complete accounting-compatible records", async () => {
    const plan = makePilotPlan(await catalog());
    const records = plan.samples.map(syntheticRecord);
    assert.equal(validateCollectedRecords(plan, records).valid, true);
    const { dataset, validations } = buildSurfaceDataset(plan, records, {
      permission_status: "approved",
      source_model_fingerprint: "fixture-model",
      captured_at_utc: "2026-07-09T00:00:00.000Z"
    });
    assert.equal(dataset.permission_status, "approved");
    assert.deepEqual(Object.keys(dataset.parts), ["XEL4030-201", "XGL6060-222"]);
    assert.equal(validations["XGL6060-222"].summary.passes, true);
  });
});
