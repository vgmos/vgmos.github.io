import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { estimateInductorAcLoss } from "../js/tools/inductor-ac-loss.js";
import { normalizeCatalogPart } from "../scripts/coilcraft/loss-surface.mjs";
import {
  V2_PILOT_PART_NUMBERS,
  buildV2Dataset,
  buildV2PartModel,
  extractV2Discovery,
  fitPowerLaw,
  makeV2AcquisitionPlan,
  makeV2DiscoveryPlan,
  makeV2RefinementSamples,
  validateV2Run,
  validateV2Part,
  v2FrequencyBounds
} from "../scripts/coilcraft/loss-model-v2.mjs";

async function catalog() {
  return JSON.parse(await readFile(new URL("../assets/data/coilcraft-inductors.v1.json", import.meta.url), "utf8"));
}

function discoveriesFor(catalogData, options = {}) {
  return V2_PILOT_PART_NUMBERS.map((partNumber, index) => ({
    part_number: partNumber,
    core_identifier: `CORE-${index}`,
    loss_r_factor: 0.2,
    coefficient_breakpoints: options.empty
      ? []
      : [{ frequency_Hz: options.frequency ?? 300_000, k: 1 + index, x: 1.5, y: 2.2 }],
    coefficient_fingerprint: `coeff-${index}-${options.frequency ?? "none"}`,
    response_fingerprint: "schema-fixture"
  }));
}

function vendorLossW(sample) {
  if (sample.ripple_pp_A === 0) return 0;
  const a = 0.02 * (sample.frequency_Hz / 100_000) ** 0.4;
  return a * sample.ripple_pp_A ** 1.6;
}

function recordsFor(plan) {
  return plan.samples.map((sample) => {
    const vendorW = vendorLossW(sample);
    const rippleDcrW = sample.ripple_pp_A ** 2 / 12 * sample.dcr_typ_mOhm * 1e-3;
    return {
      sample_id: sample.sample_id,
      sample_kind: sample.kind,
      round: sample.round,
      part_number: sample.part_number,
      frequency_Hz: sample.frequency_Hz,
      idc_A: sample.idc_A,
      ipeak_A: sample.ipeak_A,
      ripple_pp_A: sample.ripple_pp_A,
      ambient_C: sample.ambient_C,
      waveform: sample.waveform,
      dcr_typ_mOhm: sample.dcr_typ_mOhm,
      dcr_typ_loss_mW: sample.idc_A ** 2 * sample.dcr_typ_mOhm,
      vendor_ac_core_winding_loss_mW: vendorW * 1000,
      ripple_dcr_loss_mW: rippleDcrW * 1000,
      additional_ac_core_winding_loss_mW: (vendorW - rippleDcrW) * 1000,
      total_loss_mW: vendorW * 1000 + sample.idc_A ** 2 * sample.dcr_typ_mOhm,
      raw_total_loss_mW: null,
      interval_low_Hz: sample.interval_low_Hz,
      interval_high_Hz: sample.interval_high_Hz,
      hidden_index: sample.hidden_index
    };
  });
}

describe("Coilcraft compressed AC-loss v2", () => {
  it("fits the ripple power law exactly", () => {
    const fit = fitPowerLaw(0.1, 0.002 * 0.1 ** 1.7, 6, 0.002 * 6 ** 1.7);
    assert.ok(Math.abs(fit.a_W_per_A_pow_B - 0.002) < 1e-12);
    assert.ok(Math.abs(fit.b - 1.7) < 1e-12);
  });

  it("builds all frequency rules, Sobol checks, and IDC canaries", async () => {
    const data = await catalog();
    const discoveryPlan = makeV2DiscoveryPlan(data);
    assert.equal(discoveryPlan.samples.length, 6);
    const plan = makeV2AcquisitionPlan(data, discoveriesFor(data));
    assert.deepEqual(plan.parts.map((part) => part.part_number), V2_PILOT_PART_NUMBERS);
    for (const part of plan.parts) {
      assert.equal(plan.samples.filter((sample) => sample.part_number === part.part_number && sample.kind.startsWith("hidden-")).length, 8);
      assert.equal(plan.samples.filter((sample) => sample.part_number === part.part_number && sample.kind.startsWith("idc-canary-")).length, 2);
      assert.ok(part.training_frequency_Hz.includes(50_000));
      assert.ok(part.training_frequency_Hz.includes(part.verified_max_frequency_Hz));
      assert.ok(part.training_frequency_Hz.every((frequency) => frequency <= part.verified_max_frequency_Hz));
      assert.ok(part.guarded_anchor_frequency_Hz.every((frequency) => frequency > part.verified_max_frequency_Hz && frequency <= part.guarded_max_frequency_Hz));
      const excludedAdaptiveFrequencies = part.training_frequency_Hz.slice(0, -1).flatMap((frequency, index) => {
        const high = part.training_frequency_Hz[index + 1];
        return [0.25, 0.5, 0.75].map((fraction) => Number(Math.exp(Math.log(frequency) + (Math.log(high) - Math.log(frequency)) * fraction).toPrecision(12)));
      });
      const hiddenFrequencies = plan.samples.filter((sample) => sample.part_number === part.part_number && sample.kind.startsWith("hidden-")).map((sample) => sample.frequency_Hz);
      assert.ok(hiddenFrequencies.every((frequency) => !excludedAdaptiveFrequencies.includes(frequency)));
    }
    const xgl472 = plan.parts.find((part) => part.part_number === "XGL6060-472");
    assert.equal(xgl472.verified_max_frequency_Hz, 4_750_000);
    assert.equal(xgl472.guarded_max_frequency_Hz, 6_000_000);
    assert.deepEqual(xgl472.guarded_anchor_frequency_Hz, [5_000_000, 6_000_000]);
    assert.deepEqual(v2FrequencyBounds(normalizeCatalogPart(data.parts.find((part) => part.base_part_number === "XGL6060-472"))), {
      verifiedMaxHz: 4_750_000,
      guardedMaxHz: 6_000_000
    });
  });

  it("extracts discovery coefficients and rejects endpoint schema drift", async () => {
    const data = await catalog();
    const sample = makeV2DiscoveryPlan(data).samples[0];
    const part = {
      PartNumber: sample.part_number,
      ACLoss: 1,
      DCLoss: 2,
      DCRTyp: 0.003,
      LossCore: "M800",
      LossRFac: 0.2,
      LossKAt0P5MHz: 0.1,
      LossXAt0P5MHz: 1.5,
      LossYAt0P5MHz: 2.2
    };
    const first = extractV2Discovery(sample, { StatusCode: 1, PartsData: [part] });
    const changed = extractV2Discovery(sample, { StatusCode: 1, PartsData: [{ ...part, LossKAt0P5MHz: 0.2 }] });
    assert.equal(first.coefficient_breakpoints[0].frequency_Hz, 500_000);
    assert.notEqual(first.coefficient_fingerprint, changed.coefficient_fingerprint);
    assert.throws(() => extractV2Discovery(sample, { StatusCode: 1, PartsData: [{ PartNumber: sample.part_number }] }), /required loss fields/);
  });

  it("evaluates measured, interpolated, guarded, zero, and rejected states with RMS subtraction", async () => {
    const data = await catalog();
    const discoveries = discoveriesFor(data);
    const plan = makeV2AcquisitionPlan(data, discoveries);
    const records = recordsFor(plan);
    const partPlan = plan.parts[0];
    const model = buildV2PartModel(partPlan, records, discoveries[0]);
    const knot = model.knots[1];
    const measured = estimateInductorAcLoss(model, { frequencyHz: knot.frequency_Hz, dcCurrentA: 0, ripplePpA: knot.measured_ripple_pp_A[0], ambientC: 25, waveform: "triangular" });
    assert.equal(measured.status, "measured-knot");
    assert.ok(Math.abs(measured.lossW - Math.max(0, measured.vendorLossW - measured.rippleDcrLossW)) < 1e-12);
    const interpolated = estimateInductorAcLoss(model, { frequencyHz: 750_000, dcCurrentA: 0, ripplePpA: 0.1 * partPlan.reference_current_A, ambientC: 25, waveform: "triangular" });
    assert.equal(interpolated.status, "interpolated");
    const guarded = estimateInductorAcLoss(model, { frequencyHz: 750_000, dcCurrentA: 0, ripplePpA: 0.7 * partPlan.reference_current_A, ambientC: 25, waveform: "triangular" });
    assert.equal(guarded.status, "guarded-extrapolation");
    const zero = estimateInductorAcLoss(model, { frequencyHz: 750_000, dcCurrentA: 0, ripplePpA: 0, ambientC: 25, waveform: "triangular" });
    assert.equal(zero.lossW, 0);
    assert.equal(zero.method, "analytical-zero-ripple");
    assert.deepEqual(estimateInductorAcLoss(model, { frequencyHz: 7_000_000, dcCurrentA: 0, ripplePpA: 1, ambientC: 25, waveform: "triangular" }).outsideAxes, ["frequency"]);
    assert.ok(estimateInductorAcLoss(model, { frequencyHz: 1_000_000, dcCurrentA: partPlan.selected_isat_A, ripplePpA: 1, ambientC: 25, waveform: "triangular" }).outsideAxes.includes("peak-current"));
    assert.ok(estimateInductorAcLoss(model, { frequencyHz: 1_000_000, dcCurrentA: 0, ripplePpA: 1, ambientC: 50, waveform: "sine" }).outsideAxes.includes("ambient-temperature"));
  });

  it("requests adaptive knots and passes the full synthetic promotion gate", async () => {
    const data = await catalog();
    const discoveries = discoveriesFor(data);
    const plan = makeV2AcquisitionPlan(data, discoveries);
    const records = recordsFor(plan);
    const exact = makeV2RefinementSamples(data, plan, records, 1);
    assert.equal(exact.length, 0);
    const disturbed = records.map((record) => record.sample_kind === "adaptive-midpoint" && record.part_number === plan.parts[0].part_number
      ? { ...record, vendor_ac_core_winding_loss_mW: record.vendor_ac_core_winding_loss_mW * 1.5, additional_ac_core_winding_loss_mW: record.additional_ac_core_winding_loss_mW * 1.5 }
      : record);
    const requested = makeV2RefinementSamples(data, plan, disturbed, 1);
    assert.ok(requested.some((sample) => sample.kind === "refinement-low"));
    assert.ok(requested.some((sample) => sample.kind === "adaptive-midpoint" && sample.round === 1));

    for (const partPlan of plan.parts) {
      const validation = validateV2Part(partPlan, records, discoveries.find((entry) => entry.part_number === partPlan.part_number));
      assert.equal(validation.summary.passes, true, `${partPlan.part_number}: ${validation.summary.failures}`);
    }
  });

  it("publishes all passing v2 parts while preserving schema-v1 fallback semantics", async () => {
    const data = await catalog();
    const discoveries = discoveriesFor(data);
    const plan = makeV2AcquisitionPlan(data, discoveries);
    const records = recordsFor(plan);
    const legacy = {
      parts: {
        "XEL4030-201": { part_number: "XEL4030-201", axes: {}, ac_loss_W: [] },
        "XGL6060-222": { part_number: "XGL6060-222", axes: {}, ac_loss_W: [] }
      }
    };
    const published = buildV2Dataset(plan, records, legacy, { permission_status: "approved", captured_at_utc: "2026-01-01T00:00:00Z" });
    assert.equal(published.dataset.schema_version, 2);
    assert.equal(published.dataset.parts["XEL4030-201"].model_schema_version, 1);
    assert.equal(published.dataset.parts["XGL6060-222"].model_schema_version, 2);
    assert.equal(Object.values(published.dataset.parts).filter((part) => part.model_schema_version === 2).length, 6);

    const failedRecords = records.map((record) => record.part_number === "XGL6060-222" && record.sample_kind === "hidden-verified"
      ? { ...record, additional_ac_core_winding_loss_mW: record.additional_ac_core_winding_loss_mW * 10 }
      : record);
    const failed = buildV2Dataset(plan, failedRecords, legacy, {}, { requireAll: false });
    assert.equal(failed.dataset.parts["XGL6060-222"].model_schema_version, 1);
    assert.ok(failed.failing_parts.includes("XGL6060-222"));
  });

  it("uses coefficient breakpoints when present and remains valid when they are missing", async () => {
    const data = await catalog();
    const withCoefficient = makeV2AcquisitionPlan(data, discoveriesFor(data, { frequency: 300_000 }));
    const withoutCoefficient = makeV2AcquisitionPlan(data, discoveriesFor(data, { empty: true }));
    assert.ok(withCoefficient.parts.every((part) => part.training_frequency_Hz.includes(300_000)));
    assert.ok(withoutCoefficient.parts.every((part) => !part.coefficient_breakpoint_Hz.length));
    const guardedCoefficient = makeV2AcquisitionPlan(data, discoveriesFor(data, { frequency: 5_500_000 }));
    const xgl472 = guardedCoefficient.parts.find((part) => part.part_number === "XGL6060-472");
    assert.ok(xgl472.guarded_anchor_frequency_Hz.includes(5_500_000));
    assert.ok(!xgl472.training_frequency_Hz.includes(5_500_000));
  });

  it("revalidates normalized-run completeness, accounting, and provenance before promotion", async () => {
    const data = await catalog();
    const discoveries = discoveriesFor(data);
    const plan = makeV2AcquisitionPlan(data, discoveries);
    const provenance = { source_run_id: "fixture-run", source_model_fingerprint: "schema-fixture" };
    const records = recordsFor(plan).map((record) => ({
      ...record,
      source_run_id: provenance.source_run_id,
      source_model_fingerprint: provenance.source_model_fingerprint
    }));
    assert.equal(validateV2Run(plan, records, provenance).valid, true);
    assert.equal(validateV2Run(plan, records.slice(1), provenance).valid, false);
    assert.equal(validateV2Run(plan, [...records, records[0]], provenance).valid, false);
    assert.equal(validateV2Run(plan, records.map((record, index) => index ? record : { ...record, source_model_fingerprint: "changed" }), provenance).valid, false);
  });

  it("re-evaluates every hidden check from the serialized public dataset", async () => {
    const dataset = JSON.parse(await readFile(new URL("../assets/data/coilcraft-inductor-loss-surfaces.v1.json", import.meta.url), "utf8"));
    for (const partNumber of V2_PILOT_PART_NUMBERS) {
      const model = dataset.parts[partNumber];
      assert.equal(model.model_schema_version, 2);
      assert.equal(model.validation.hidden_checks.length, 8);
      const relativeErrors = [];
      const guardedErrors = [];
      for (const check of model.validation.hidden_checks) {
        assert.ok(!model.knots.some((knot) => Math.abs(Math.log(knot.frequency_Hz / check.frequency_Hz)) < 1e-10), `${partNumber}: hidden frequency became a fit knot`);
        const estimate = estimateInductorAcLoss(model, {
          frequencyHz: check.frequency_Hz,
          dcCurrentA: check.idc_A,
          ripplePpA: check.ripple_pp_A,
          ambientC: 25,
          waveform: "triangular"
        });
        assert.equal(estimate.status, check.predicted_state, `${partNumber}: ${check.sample_id}`);
        assert.ok(Math.abs(estimate.lossW - check.predicted_additional_loss_W) <= 1e-10 * Math.max(1, check.predicted_additional_loss_W));
        const absoluteErrorW = Math.abs(estimate.lossW - check.actual_additional_loss_W);
        const relativeError = absoluteErrorW / check.actual_additional_loss_W;
        assert.ok(relativeError <= 0.25 + 1e-12, `${partNumber}: hidden max error`);
        if (check.actual_additional_loss_W < 0.005) assert.ok(absoluteErrorW <= 0.0005 + 1e-12, `${partNumber}: sub-5mW absolute error`);
        relativeErrors.push(relativeError);
        if (check.kind === "hidden-guarded") guardedErrors.push(relativeError);
      }
      const sorted = relativeErrors.toSorted((left, right) => left - right);
      const median = (sorted[3] + sorted[4]) / 2;
      const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
      assert.ok(median <= 0.08 + 1e-12, `${partNumber}: hidden median`);
      assert.ok(p95 <= 0.15 + 1e-12, `${partNumber}: hidden p95`);
      assert.ok(Math.max(...guardedErrors) <= 0.25 + 1e-12, `${partNumber}: guarded hidden max`);
      assert.equal(model.validation.summary.passes, true);
    }
  });
});
