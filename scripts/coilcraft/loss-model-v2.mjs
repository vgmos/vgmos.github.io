import { createHash } from "node:crypto";
import { estimateInductorAcLoss } from "../../js/tools/inductor-ac-loss.js";
import {
  LOSS_ENDPOINT,
  LOSS_TOOL_URL,
  makeToolRequest,
  normalizedCatalogParts,
  normalizeToolResponse,
  referenceCurrent,
  responseSchemaFingerprint,
  selectedIsat,
  validateCollectedRecords
} from "./loss-surface.mjs";

export const V2_PILOT_PART_NUMBERS = [
  "XEL4030-471",
  "XEL4030-102",
  "XEL4030-222",
  "XGL6060-102",
  "XGL6060-222",
  "XGL6060-472"
];

export const PRACTICAL_FREQUENCY_ANCHORS_HZ = [
  100_000, 250_000, 500_000, 1_000_000,
  1_500_000, 2_000_000, 3_000_000, 5_000_000
];

export const COEFFICIENT_BREAKPOINT_FIELDS = [
  [100_000, "0P1MHz"],
  [300_000, "0P3MHz"],
  [500_000, "0P5MHz"],
  [1_000_000, "1MHz"],
  [2_000_000, "2MHz"],
  [3_000_000, "3MHz"],
  [4_000_000, "4MHz"],
  [5_000_000, "5MHz"],
  [6_500_000, "6P5MHz"],
  [8_000_000, "8MHz"]
];

const SOBOL_2D = [
  [0.5, 0.5], [0.75, 0.25], [0.25, 0.75], [0.375, 0.375],
  [0.875, 0.875], [0.625, 0.125], [0.125, 0.625], [0.1875, 0.3125],
  [0.6875, 0.8125], [0.9375, 0.0625], [0.4375, 0.5625], [0.3125, 0.1875],
  [0.8125, 0.6875], [0.5625, 0.4375], [0.0625, 0.9375], [0.09375, 0.46875]
];

const round = (value) => Number(Number(value).toPrecision(12));
const sortedUnique = (values) => [...new Set(values)].sort((a, b) => a - b);
const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function logMix(low, high, fraction) {
  return Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * fraction);
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function partMap(catalog) {
  return new Map(normalizedCatalogParts(catalog).map((part) => [part.part_number, part]));
}

export function v2FrequencyBounds(part) {
  const verifiedMaxHz = Math.min(6_000_000, 0.25 * part.srf_typ_MHz * 1e6);
  const guardedMaxHz = Math.min(6_000_000, 0.35 * part.srf_typ_MHz * 1e6, 1.5 * verifiedMaxHz);
  return { verifiedMaxHz: round(verifiedMaxHz), guardedMaxHz: round(guardedMaxHz) };
}

function baseSample(part, kind, frequencyHz, idcA, ripplePpA, extra = {}) {
  const sample = {
    kind,
    round: extra.round ?? 0,
    part_number: part.part_number,
    series: part.series,
    inductance_uH: part.inductance_uH,
    dcr_typ_mOhm: part.dcr_typ_mOhm,
    reference_current_A: referenceCurrent(part),
    selected_isat_A: selectedIsat(part).value,
    ambient_C: 25,
    waveform: "triangular",
    frequency_Hz: round(frequencyHz),
    idc_A: round(idcA),
    ripple_pp_A: round(ripplePpA),
    ipeak_A: round(idcA + ripplePpA / 2),
    interval_low_Hz: extra.intervalLowHz ? round(extra.intervalLowHz) : null,
    interval_high_Hz: extra.intervalHighHz ? round(extra.intervalHighHz) : null,
    hidden_index: extra.hiddenIndex ?? null
  };
  sample.sample_id = hash(sample).slice(0, 20);
  return sample;
}

export function makeV2DiscoveryPlan(catalog) {
  const byPart = partMap(catalog);
  const samples = V2_PILOT_PART_NUMBERS.map((partNumber) => {
    const part = byPart.get(partNumber);
    if (!part) throw new Error(`${partNumber}: missing from accepted catalog`);
    return baseSample(part, "discovery", 1_000_000, 0, 0.1 * referenceCurrent(part));
  });
  const plan = {
    schema_version: 2,
    plan_id: "coilcraft-ac-loss-v2-discovery",
    permission_status: "internal_evaluation",
    tool_url: LOSS_TOOL_URL,
    endpoint: LOSS_ENDPOINT,
    parts: [...V2_PILOT_PART_NUMBERS],
    samples
  };
  plan.plan_sha256 = hash(plan);
  return plan;
}

export function extractV2Discovery(sample, payload) {
  if (!payload || payload.StatusCode !== 1 || !Array.isArray(payload.PartsData)) {
    throw new Error(`${sample.sample_id}: discovery response schema drift`);
  }
  const part = payload.PartsData.find((candidate) => candidate.PartNumber === sample.part_number);
  if (!part || finite(part.ACLoss) === null || finite(part.DCLoss) === null || finite(part.DCRTyp) === null) {
    throw new Error(`${sample.sample_id}: discovery response omitted required loss fields`);
  }
  const coefficientBreakpoints = COEFFICIENT_BREAKPOINT_FIELDS.map(([frequencyHz, suffix]) => ({
    frequency_Hz: frequencyHz,
    k: finite(part[`LossKAt${suffix}`]),
    x: finite(part[`LossXAt${suffix}`]),
    y: finite(part[`LossYAt${suffix}`])
  })).filter((entry) => entry.k !== null || entry.x !== null || entry.y !== null);
  const coefficientShape = coefficientBreakpoints.map(({ frequency_Hz, k, x, y }) => ({ frequency_Hz, k, x, y }));
  return {
    part_number: sample.part_number,
    discovered_at_operating_point: {
      frequency_Hz: sample.frequency_Hz,
      idc_A: sample.idc_A,
      ripple_pp_A: sample.ripple_pp_A
    },
    core_identifier: part.LossCore ?? null,
    loss_r_factor: finite(part.LossRFac),
    coefficient_breakpoints: coefficientShape,
    coefficient_fingerprint: hash({ core: part.LossCore ?? null, r: finite(part.LossRFac), coefficientShape }),
    response_fingerprint: responseSchemaFingerprint(payload)
  };
}

function trainingFrequencies(part, discovery) {
  const { verifiedMaxHz, guardedMaxHz } = v2FrequencyBounds(part);
  const coefficient = discovery.coefficient_breakpoints.map((entry) => entry.frequency_Hz);
  const candidates = [50_000, ...PRACTICAL_FREQUENCY_ANCHORS_HZ, verifiedMaxHz, 6_000_000, ...coefficient];
  const training = sortedUnique(candidates.filter((frequency) => frequency >= 50_000 && frequency <= verifiedMaxHz));
  const guarded = sortedUnique([...PRACTICAL_FREQUENCY_ANCHORS_HZ, 6_000_000, ...coefficient]
    .filter((frequency) => frequency > verifiedMaxHz && frequency <= guardedMaxHz));
  return { training, guarded, verifiedMaxHz, guardedMaxHz };
}

function excludedFrequencySet(partPlan) {
  const adaptiveMidpoints = partPlan.training_frequency_Hz.slice(0, -1).flatMap((frequency, index) => {
    const high = partPlan.training_frequency_Hz[index + 1];
    return [0.25, 0.5, 0.75].map((fraction) => round(logMix(frequency, high, fraction)));
  });
  return new Set([
    ...partPlan.training_frequency_Hz,
    ...partPlan.coefficient_breakpoint_Hz,
    ...adaptiveMidpoints
  ]);
}

function hiddenSamples(part, partPlan) {
  const excluded = excludedFrequencySet(partPlan);
  const result = [];
  for (let index = 0; result.length < 6 && index < SOBOL_2D.length; index += 1) {
    const [u, v] = SOBOL_2D[index];
    const frequency = round(logMix(50_000, partPlan.verified_max_frequency_Hz, 0.04 + 0.92 * u));
    const ripple = round(logMix(partPlan.verified_ripple_pp_A[0], partPlan.verified_ripple_pp_A[1], 0.04 + 0.92 * v));
    if (excluded.has(frequency)) continue;
    result.push(baseSample(part, "hidden-verified", frequency, 0, ripple, { hiddenIndex: result.length }));
  }
  const lowGuardedRipple = 0.006 * partPlan.reference_current_A;
  const highGuardedRipple = 0.7 * partPlan.reference_current_A;
  const guardedFrequency = partPlan.guarded_max_frequency_Hz > partPlan.verified_max_frequency_Hz
    ? logMix(partPlan.verified_max_frequency_Hz, partPlan.guarded_max_frequency_Hz, 0.65)
    : logMix(50_000, partPlan.verified_max_frequency_Hz, 0.7);
  result.push(baseSample(part, "hidden-guarded", guardedFrequency, 0, lowGuardedRipple, { hiddenIndex: 6 }));
  result.push(baseSample(part, "hidden-guarded", guardedFrequency, 0, highGuardedRipple, { hiddenIndex: 7 }));
  return result;
}

export function makeV2AcquisitionPlan(catalog, discoveries) {
  const byPart = partMap(catalog);
  const discoveryMap = new Map(discoveries.map((entry) => [entry.part_number, entry]));
  const samples = [];
  const parts = [];
  for (const partNumber of V2_PILOT_PART_NUMBERS) {
    const part = byPart.get(partNumber);
    const discovery = discoveryMap.get(partNumber);
    if (!part || !discovery) throw new Error(`${partNumber}: catalog or discovery missing`);
    const referenceCurrentA = referenceCurrent(part);
    const selected = selectedIsat(part);
    const frequencies = trainingFrequencies(part, discovery);
    const rippleLow = 0.01 * referenceCurrentA;
    const rippleHigh = 0.6 * referenceCurrentA;
    const rippleIntermediate = Math.sqrt(rippleLow * rippleHigh);
    const partPlan = {
      part_number: part.part_number,
      series: part.series,
      inductance_uH: part.inductance_uH,
      dcr_typ_mOhm: part.dcr_typ_mOhm,
      reference_current_A: referenceCurrentA,
      selected_isat_A: selected.value,
      selected_isat_drop_pct: selected.drop_pct,
      srf_typ_MHz: part.srf_typ_MHz,
      verified_max_frequency_Hz: frequencies.verifiedMaxHz,
      guarded_max_frequency_Hz: frequencies.guardedMaxHz,
      verified_ripple_pp_A: [round(rippleLow), round(rippleHigh)],
      guarded_ripple_pp_A: [0, round(0.8 * referenceCurrentA)],
      training_frequency_Hz: frequencies.training,
      guarded_anchor_frequency_Hz: frequencies.guarded,
      coefficient_breakpoint_Hz: discovery.coefficient_breakpoints.map((entry) => entry.frequency_Hz),
      discovery_fingerprint: discovery.coefficient_fingerprint
    };
    parts.push(partPlan);
    for (const frequency of frequencies.training) {
      samples.push(baseSample(part, "training-low", frequency, 0, rippleLow));
      samples.push(baseSample(part, "training-high", frequency, 0, rippleHigh));
    }
    for (let index = 0; index < frequencies.training.length - 1; index += 1) {
      const low = frequencies.training[index];
      const high = frequencies.training[index + 1];
      samples.push(baseSample(part, "adaptive-midpoint", Math.sqrt(low * high), 0, rippleIntermediate, {
        round: 0, intervalLowHz: low, intervalHighHz: high
      }));
    }
    for (const frequency of frequencies.guarded) {
      samples.push(baseSample(part, "guarded-anchor", frequency, 0, rippleIntermediate));
    }
    const canaryFrequency = Math.min(1_000_000, frequencies.verifiedMaxHz);
    samples.push(baseSample(part, "idc-canary-zero", canaryFrequency, 0, 0.1 * referenceCurrentA));
    samples.push(baseSample(part, "idc-canary-high", canaryFrequency, 0.7 * referenceCurrentA, 0.1 * referenceCurrentA));
    samples.push(baseSample(part, "zero-ripple-canary", canaryFrequency, 0, 0));
    samples.push(...hiddenSamples(part, partPlan));
  }
  const plan = {
    schema_version: 2,
    plan_id: "coilcraft-ac-loss-v2-six-part-pilot",
    permission_status: "internal_evaluation",
    tool_url: LOSS_TOOL_URL,
    endpoint: LOSS_ENDPOINT,
    ambient_C: 25,
    waveform: "triangular",
    max_refinement_rounds: 2,
    parts,
    discoveries,
    samples
  };
  plan.plan_sha256 = hash(plan);
  return plan;
}

export function fitPowerLaw(rippleLowA, lossLowW, rippleHighA, lossHighW) {
  if (!(rippleLowA > 0 && rippleHighA > rippleLowA && lossLowW > 0 && lossHighW > 0)) {
    throw new Error("power-law fit requires positive ordered anchors");
  }
  const b = Math.log(lossHighW / lossLowW) / Math.log(rippleHighA / rippleLowA);
  const a = lossLowW / rippleLowA ** b;
  if (!(Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0)) throw new Error("invalid power-law coefficients");
  return { a_W_per_A_pow_B: a, b };
}

function coefficientRecords(records, partNumber) {
  const allowed = new Set(["training-low", "training-high", "refinement-low", "refinement-high"]);
  const grouped = new Map();
  for (const record of records.filter((entry) => entry.part_number === partNumber && allowed.has(entry.sample_kind))) {
    const group = grouped.get(record.frequency_Hz) ?? {};
    if (record.sample_kind.endsWith("low")) group.low = record;
    else group.high = record;
    grouped.set(record.frequency_Hz, group);
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([frequency_Hz, pair]) => {
    if (!pair.low || !pair.high) throw new Error(`${partNumber}: incomplete coefficient anchors at ${frequency_Hz}`);
    const fit = fitPowerLaw(
      pair.low.ripple_pp_A,
      pair.low.vendor_ac_core_winding_loss_mW / 1000,
      pair.high.ripple_pp_A,
      pair.high.vendor_ac_core_winding_loss_mW / 1000
    );
    return {
      frequency_Hz,
      ...fit,
      measured_ripple_pp_A: [pair.low.ripple_pp_A, pair.high.ripple_pp_A],
      source_sample_ids: [pair.low.sample_id, pair.high.sample_id]
    };
  });
}

export function buildV2PartModel(partPlan, records, discovery, validation = null) {
  return {
    model_schema_version: 2,
    model_type: "frequency-interpolated-ripple-power-law",
    part_number: partPlan.part_number,
    ambient_C: 25,
    waveform: "triangular",
    reference_current_A: partPlan.reference_current_A,
    selected_isat_A: partPlan.selected_isat_A,
    selected_isat_drop_pct: partPlan.selected_isat_drop_pct,
    dcr_typ_mOhm: partPlan.dcr_typ_mOhm,
    core_identifier: discovery.core_identifier,
    coefficient_fingerprint: discovery.coefficient_fingerprint,
    response_fingerprint: discovery.response_fingerprint,
    verified_domain: {
      frequency_Hz: [50_000, partPlan.verified_max_frequency_Hz],
      ripple_pp_A: partPlan.verified_ripple_pp_A
    },
    guarded_domain: {
      frequency_Hz: [50_000, partPlan.guarded_max_frequency_Hz],
      ripple_pp_A: partPlan.guarded_ripple_pp_A
    },
    knots: coefficientRecords(records, partPlan.part_number),
    validation
  };
}

function errorFor(model, record) {
  const estimate = estimateInductorAcLoss(model, {
    frequencyHz: record.frequency_Hz,
    dcCurrentA: record.idc_A,
    ripplePpA: record.ripple_pp_A,
    ambientC: record.ambient_C,
    waveform: record.waveform
  });
  const actualW = Math.max(0, record.additional_ac_core_winding_loss_mW / 1000);
  const absoluteErrorW = Math.abs(estimate.lossW - actualW);
  const relativeError = actualW > 0 ? absoluteErrorW / actualW : 0;
  return { estimate, actualW, absoluteErrorW, relativeError };
}

export function makeV2RefinementSamples(catalog, plan, records, round) {
  if (!(round === 1 || round === 2)) throw new Error("refinement round must be 1 or 2");
  const byPart = partMap(catalog);
  const discoveryMap = new Map(plan.discoveries.map((entry) => [entry.part_number, entry]));
  const samples = [];
  const midpointRound = round - 1;
  for (const partPlan of plan.parts) {
    const part = byPart.get(partPlan.part_number);
    const model = buildV2PartModel(partPlan, records, discoveryMap.get(partPlan.part_number));
    const checks = records.filter((record) => record.part_number === partPlan.part_number && record.sample_kind === "adaptive-midpoint" && record.round === midpointRound);
    for (const record of checks) {
      const error = errorFor(model, record);
      if (!(error.relativeError > 0.1 || error.absoluteErrorW * 1000 > 0.25)) continue;
      const frequency = record.frequency_Hz;
      const rippleLow = partPlan.verified_ripple_pp_A[0];
      const rippleHigh = partPlan.verified_ripple_pp_A[1];
      const rippleIntermediate = Math.sqrt(rippleLow * rippleHigh);
      samples.push(baseSample(part, "refinement-low", frequency, 0, rippleLow, { round }));
      samples.push(baseSample(part, "refinement-high", frequency, 0, rippleHigh, { round }));
      if (round < 2) {
        for (const [low, high] of [[record.interval_low_Hz, frequency], [frequency, record.interval_high_Hz]]) {
          samples.push(baseSample(part, "adaptive-midpoint", Math.sqrt(low * high), 0, rippleIntermediate, {
            round, intervalLowHz: low, intervalHighHz: high
          }));
        }
      }
    }
  }
  return samples.filter((sample, index) => samples.findIndex((candidate) => candidate.sample_id === sample.sample_id) === index);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

function checkPoint(model, record) {
  const error = errorFor(model, record);
  return {
    sample_id: record.sample_id,
    kind: record.sample_kind,
    frequency_Hz: record.frequency_Hz,
    idc_A: record.idc_A,
    ripple_pp_A: record.ripple_pp_A,
    actual_additional_loss_W: error.actualW,
    predicted_additional_loss_W: error.estimate.lossW,
    predicted_state: error.estimate.status,
    absolute_error_mW: error.absoluteErrorW * 1000,
    relative_error: error.relativeError
  };
}

export function validateV2Part(partPlan, records, discovery) {
  const model = buildV2PartModel(partPlan, records, discovery);
  const hidden = records.filter((record) => record.part_number === partPlan.part_number && record.sample_kind.startsWith("hidden-")).map((record) => checkPoint(model, record));
  const normal = hidden.filter((point) => point.actual_additional_loss_W >= 0.005);
  const relative = normal.map((point) => point.relative_error);
  const guarded = hidden.filter((point) => point.kind === "hidden-guarded");
  const zero = records.find((record) => record.part_number === partPlan.part_number && record.sample_kind === "idc-canary-zero");
  const high = records.find((record) => record.part_number === partPlan.part_number && record.sample_kind === "idc-canary-high");
  const zeroRipple = records.find((record) => record.part_number === partPlan.part_number && record.sample_kind === "zero-ripple-canary");
  const idcAbsoluteMw = Math.abs((zero?.vendor_ac_core_winding_loss_mW ?? Infinity) - (high?.vendor_ac_core_winding_loss_mW ?? -Infinity));
  const idcScale = Math.max(zero?.vendor_ac_core_winding_loss_mW ?? 0, high?.vendor_ac_core_winding_loss_mW ?? 0, 1e-12);
  const idcRelative = idcAbsoluteMw / idcScale;
  const residuals = records.filter((record) => record.part_number === partPlan.part_number).map((record) => record.additional_ac_core_winding_loss_mW);
  const materiallyNegative = residuals.filter((value) => value < -0.25);
  const practical = records.filter((record) => record.part_number === partPlan.part_number && ["training-low", "training-high", "guarded-anchor"].includes(record.sample_kind)).map((record) => checkPoint(model, record));
  const adaptive = records.filter((record) => record.part_number === partPlan.part_number && record.sample_kind === "adaptive-midpoint").map((record) => checkPoint(model, record));
  const summary = {
    hidden_count: hidden.length,
    median_relative_error: percentile(relative, 0.5),
    p95_relative_error: percentile(relative, 0.95),
    max_relative_error: relative.length ? Math.max(...relative) : 0,
    max_sub_5mW_absolute_error_mW: Math.max(0, ...hidden.filter((point) => point.actual_additional_loss_W < 0.005).map((point) => point.absolute_error_mW)),
    max_guarded_relative_error: Math.max(0, ...guarded.map((point) => point.relative_error)),
    idc_variation_relative: idcRelative,
    idc_variation_mW: idcAbsoluteMw,
    zero_ripple_vendor_loss_mW: zeroRipple?.vendor_ac_core_winding_loss_mW ?? null,
    materially_negative_residual_count: materiallyNegative.length,
    max_practical_anchor_relative_error: Math.max(0, ...practical.map((point) => point.relative_error)),
    max_adaptive_relative_error: Math.max(0, ...adaptive.map((point) => point.relative_error))
  };
  const failures = [];
  if (hidden.length !== 8 || guarded.length !== 2) failures.push("hidden-check-count");
  if (hidden.some((point) => point.kind === "hidden-verified" && point.predicted_state !== "interpolated")) failures.push("hidden-verified-state");
  if (guarded.some((point) => point.predicted_state !== "guarded-extrapolation")) failures.push("hidden-guarded-state");
  if (summary.median_relative_error > 0.08) failures.push("median-error");
  if (summary.p95_relative_error > 0.15) failures.push("p95-error");
  if (summary.max_relative_error > 0.25) failures.push("max-error");
  if (summary.max_sub_5mW_absolute_error_mW > 0.5) failures.push("small-loss-absolute-error");
  if (summary.max_guarded_relative_error > 0.25) failures.push("guarded-error");
  if (!(idcRelative <= 0.01 || idcAbsoluteMw <= 0.25)) failures.push("idc-invariance");
  if (summary.zero_ripple_vendor_loss_mW !== 0) failures.push("zero-ripple");
  if (materiallyNegative.length) failures.push("negative-residual");
  if (summary.max_practical_anchor_relative_error > 0.25) failures.push("practical-anchor-error");
  summary.passes = failures.length === 0;
  summary.failures = failures;
  return { model, summary, hidden_checks: hidden, practical_checks: practical, adaptive_checks: adaptive };
}

export function normalizeV2Records(plan, payloadsBySampleId, provenance = {}) {
  return plan.samples.map((sample) => {
    const payload = payloadsBySampleId instanceof Map ? payloadsBySampleId.get(sample.sample_id) : payloadsBySampleId[sample.sample_id];
    const normalized = normalizeToolResponse(sample, payload, provenance);
    return { ...normalized, round: sample.round, interval_low_Hz: sample.interval_low_Hz, interval_high_Hz: sample.interval_high_Hz, hidden_index: sample.hidden_index };
  });
}

export function validateV2Run(plan, records, provenance = {}) {
  const collection = validateCollectedRecords(plan, records);
  const errors = [...collection.errors];
  const runId = provenance.source_run_id ?? null;
  const modelFingerprint = provenance.source_model_fingerprint ?? null;
  if (!runId || !modelFingerprint) errors.push("provenance is missing source run or model fingerprint");
  const discoveryFingerprints = new Set(plan.discoveries?.map((entry) => entry.response_fingerprint).filter(Boolean));
  if (discoveryFingerprints.size !== 1 || (modelFingerprint && !discoveryFingerprints.has(modelFingerprint))) {
    errors.push("discovery response fingerprint does not match run provenance");
  }
  for (const record of records) {
    if (runId && record.source_run_id !== runId) errors.push(`${record.sample_id}: source run mismatch`);
    if (modelFingerprint && record.source_model_fingerprint !== modelFingerprint) errors.push(`${record.sample_id}: source model fingerprint mismatch`);
  }
  return { valid: errors.length === 0, errors, completed: collection.completed, planned: collection.planned };
}

export function buildV2Dataset(plan, records, legacyDataset, provenance = {}, options = {}) {
  const discoveryMap = new Map(plan.discoveries.map((entry) => [entry.part_number, entry]));
  const validations = {};
  const v2Parts = {};
  for (const partPlan of plan.parts) {
    const validation = validateV2Part(partPlan, records, discoveryMap.get(partPlan.part_number));
    validations[partPlan.part_number] = validation;
    if (validation.summary.passes) {
      validation.model.validation = { summary: validation.summary, hidden_checks: validation.hidden_checks };
      v2Parts[partPlan.part_number] = validation.model;
    }
  }
  const failing = plan.parts.map((part) => part.part_number).filter((partNumber) => !validations[partNumber].summary.passes);
  if (options.requireAll !== false && failing.length) throw new Error(`v2 promotion gate failed: ${failing.join(", ")}`);
  const legacyParts = {};
  const xelLegacy = legacyDataset?.parts?.["XEL4030-201"];
  if (xelLegacy) legacyParts["XEL4030-201"] = { model_schema_version: 1, ...xelLegacy };
  const xglLegacy = legacyDataset?.parts?.["XGL6060-222"];
  if (!v2Parts["XGL6060-222"] && xglLegacy) legacyParts["XGL6060-222"] = { model_schema_version: 1, ...xglLegacy };
  const dataset = {
    schema_version: 2,
    compatible_model_schema_versions: [1, 2],
    dataset_id: "coilcraft-inductor-ac-loss-models",
    permission_status: provenance.permission_status ?? "internal_evaluation",
    metric: "Additional inductor AC/core loss beyond RMS DCR",
    accounting_convention: "P_DCR=I_L_RMS^2*R_DCR; P_AC_additional=max(0,Coilcraft_ACLoss-I_ripple_RMS^2*R_DCR_typ)",
    source_tool_url: LOSS_TOOL_URL,
    source_model_fingerprint: provenance.source_model_fingerprint ?? null,
    captured_at_utc: provenance.captured_at_utc ?? null,
    ambient_C: 25,
    waveform: "triangular",
    domain_policy: "verified-plus-guarded-no-srf-inference",
    parts: { ...legacyParts, ...v2Parts }
  };
  dataset.dataset_version = `${dataset.captured_at_utc || "undated"}+${hash(dataset).slice(0, 12)}`;
  return { dataset, validations, failing_parts: failing };
}

export function mergeV2PlanSamples(plan, extraSamples) {
  const samples = [...plan.samples];
  for (const sample of extraSamples) if (!samples.some((candidate) => candidate.sample_id === sample.sample_id)) samples.push(sample);
  const merged = { ...plan, samples };
  merged.plan_sha256 = hash({ ...merged, plan_sha256: undefined });
  return merged;
}

export function v2ToolRequest(sample) {
  return makeToolRequest(sample);
}
