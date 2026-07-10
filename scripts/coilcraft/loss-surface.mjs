import { createHash } from "node:crypto";
import { estimateInductorAcLoss, validateInductorAcSurface } from "../../js/tools/inductor-ac-loss.js";

export const LOSS_TOOL_URL = "https://www.coilcraft.com/en-us/tools/power-inductor-finder/";
export const LOSS_ENDPOINT = "/api/power-inductor/parts";
export const PILOT_PART_NUMBERS = ["XEL4030-201", "XGL6060-222"];
export const FREQUENCY_HZ = [50_000, 100_000, 300_000, 1_000_000, 3_000_000, 6_000_000];
export const IDC_RATIOS = [0, 0.25, 0.5, 0.7];
export const RIPPLE_RATIOS = [0.01, 0.03, 0.1, 0.3];
export const RIPPLE_RATIOS_BY_PART = {
  "XEL4030-201": [...RIPPLE_RATIOS, 0.6]
};

export const INTERPOLATION_PROFILES = {
  "XEL4030-201": {
    frequency_by_interval: ["log", "log", "log", "linear", "log"],
    ripple_by_interval: ["log", "log", "log", "log", "linear"]
  },
  "XGL6060-222": {
    frequency_by_interval: ["log", "log", "log", "linear", "log"],
    ripple_by_interval: ["log", "log", "log", "log", "log"]
  }
};

const round = (value) => Number(Number(value).toPrecision(12));
const sortedUnique = (values) => [...new Set(values)].sort((a, b) => a - b);

export function normalizeCatalogPart(part) {
  if (!part?.base_part_number) return part;
  return {
    ...part,
    manufacturer: "Coilcraft",
    part_number: part.base_part_number,
    orderable_part_number: part.part_number,
    inductance_uH: part.inductance_uh,
    dcr_typ_mOhm: part.dcr_typ_mohm,
    dcr_max_mOhm: part.dcr_max_mohm,
    srf_typ_MHz: part.srf_typ_mhz,
    isat_10pct_A: part.isat_10pct_a,
    isat_20pct_A: part.isat_20pct_a,
    isat_30pct_A: part.isat_30pct_a,
    irms_20C_rise_A: part.irms_20c_a,
    irms_40C_rise_A: part.irms_40c_a,
    source_datasheet_url: part.datasheet_url
  };
}

export function normalizedCatalogParts(catalog) {
  return (catalog?.parts || []).map(normalizeCatalogPart);
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function geometricMidpoints(axis) {
  return axis.slice(0, -1).map((value, index) => Math.sqrt(value * axis[index + 1]));
}

function linearMidpoints(axis) {
  return axis.slice(0, -1).map((value, index) => (value + axis[index + 1]) / 2);
}

export function selectedIsat(part) {
  if (Number.isFinite(part?.isat_20pct_A)) return { value: part.isat_20pct_A, drop_pct: 20 };
  if (Number.isFinite(part?.isat_30pct_A)) return { value: part.isat_30pct_A, drop_pct: 30 };
  if (Number.isFinite(part?.isat_10pct_A)) return { value: part.isat_10pct_A, drop_pct: 10 };
  return { value: null, drop_pct: null };
}

export function referenceCurrent(part) {
  const isat = selectedIsat(part).value;
  if (!(isat > 0) || !(part?.irms_40C_rise_A > 0)) throw new Error(`${part?.part_number || "part"}: missing pilot current rating`);
  return Math.min(isat, part.irms_40C_rise_A);
}

function sampleFor(part, referenceCurrentA, kind, frequencyHz, dcCurrentA, ripplePpA, extra = {}) {
  const sample = {
    kind,
    round: extra.round ?? 0,
    repeat_index: extra.repeat_index ?? 0,
    part_number: part.part_number,
    series: part.series,
    inductance_uH: part.inductance_uH,
    dcr_typ_mOhm: part.dcr_typ_mOhm,
    reference_current_A: referenceCurrentA,
    ambient_C: 25,
    waveform: "triangular",
    frequency_Hz: round(frequencyHz),
    idc_A: round(dcCurrentA),
    ripple_pp_A: round(ripplePpA),
    ipeak_A: round(dcCurrentA + ripplePpA / 2)
  };
  sample.sample_id = hash(sample).slice(0, 20);
  return sample;
}

export function makePilotPlan(catalog) {
  const catalogParts = normalizedCatalogParts(catalog);
  const parts = PILOT_PART_NUMBERS.map((partNumber) => catalogParts.find((part) => part.part_number === partNumber));
  if (parts.some((part) => !part)) throw new Error("Pilot parts are missing from the accepted catalog");
  const samples = [];
  const planParts = [];

  for (const part of parts) {
    const referenceCurrentA = referenceCurrent(part);
    const frequencies = FREQUENCY_HZ.filter((frequency) => frequency <= 0.2 * part.srf_typ_MHz * 1e6);
    const dcCurrents = IDC_RATIOS.map((ratio) => round(ratio * referenceCurrentA));
    const rippleRatios = RIPPLE_RATIOS_BY_PART[part.part_number] ?? RIPPLE_RATIOS;
    const rippleCurrents = rippleRatios.map((ratio) => round(ratio * referenceCurrentA));
    planParts.push({
      part_number: part.part_number,
      series: part.series,
      inductance_uH: part.inductance_uH,
      dcr_typ_mOhm: part.dcr_typ_mOhm,
      reference_current_A: referenceCurrentA,
      selected_isat: selectedIsat(part),
      srf_typ_MHz: part.srf_typ_MHz,
      axes: { frequency_Hz: frequencies, dc_current_A: dcCurrents, ripple_pp_A: rippleCurrents }
    });

    for (const frequency of frequencies) {
      for (const dcCurrent of dcCurrents) {
        for (const rippleCurrent of rippleCurrents) {
          samples.push(sampleFor(part, referenceCurrentA, "training", frequency, dcCurrent, rippleCurrent));
        }
      }
    }
    for (const frequency of geometricMidpoints(frequencies)) {
      for (const dcCurrent of linearMidpoints(dcCurrents)) {
        for (const rippleCurrent of geometricMidpoints(rippleCurrents)) {
          samples.push(sampleFor(part, referenceCurrentA, "holdout", frequency, dcCurrent, rippleCurrent));
        }
      }
    }
    samples.push(sampleFor(part, referenceCurrentA, "zero-ripple-canary", 1e6, 0.25 * referenceCurrentA, 0));
    samples.push(sampleFor(part, referenceCurrentA, "anchor-repeat", 1e6, 0.25 * referenceCurrentA, 0.1 * referenceCurrentA, { repeat_index: 1 }));
  }

  const plan = {
    schema_version: 1,
    plan_id: "coilcraft-ac-loss-pilot-v1",
    permission_status: "internal_evaluation",
    tool_url: LOSS_TOOL_URL,
    endpoint: LOSS_ENDPOINT,
    metric: "ACLoss (core + AC winding loss)",
    expected_accounting: "DCLoss=IDC^2*DCRtyp; additional_ACLoss=ACLoss-(ripple_pp^2/12)*DCRtyp",
    ambient_C: 25,
    waveform: "triangular",
    max_refinement_rounds: 2,
    parts: planParts,
    samples
  };
  plan.plan_sha256 = hash(plan);
  return plan;
}

export function makeToolRequest(sample) {
  const frequencyMHz = sample.frequency_Hz / 1e6;
  const ripplePercent = sample.idc_A > 0 ? 100 * sample.ripple_pp_A / sample.idc_A : 0;
  return {
    searchType: 2,
    operatingConditions: [{
      current: {
        currentIdc: sample.idc_A,
        currentIpeak: sample.ipeak_A,
        currentRipple: sample.ripple_pp_A,
        currentRipplePercent: ripplePercent,
        currentType: "idc",
        unit: 8
      },
      frequency: { lower: frequencyMHz, value: frequencyMHz, unit: 11 },
      partNumbers: [sample.part_number]
    }],
    selectedSeries: [{
      series: sample.series,
      inductance: sample.inductance_uH,
      PartNumber: sample.part_number
    }],
    temperature: sample.ambient_C,
    voltTime: null,
    adjustRippleCurrent: false,
    isSameForAllParts: false,
    fromParametricSearch: false
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function normalizeToolResponse(sample, payload, provenance = {}) {
  if (!payload || payload.StatusCode !== 1 || !Array.isArray(payload.PartsData)) {
    throw new Error(`${sample.sample_id}: unexpected loss-tool response`);
  }
  const part = payload.PartsData.find((candidate) => candidate.PartNumber === sample.part_number);
  if (!part) throw new Error(`${sample.sample_id}: response omitted ${sample.part_number}`);
  const acLoss = numberOrNull(part.ACLoss);
  const dcLoss = numberOrNull(part.DCLoss);
  if (!(acLoss >= 0) || !(dcLoss >= 0)) throw new Error(`${sample.sample_id}: invalid loss values`);
  const rippleDcrLoss = (sample.ripple_pp_A ** 2 / 12) * sample.dcr_typ_mOhm;
  const additionalAcLoss = acLoss - rippleDcrLoss;
  const rawTotal = numberOrNull(part.TotalLoss);
  const partTemperature = numberOrNull(part.PartTemperature);
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
    vendor_ac_core_winding_loss_mW: acLoss,
    ripple_dcr_loss_mW: rippleDcrLoss,
    additional_ac_core_winding_loss_mW: additionalAcLoss,
    total_loss_mW: rawTotal ?? acLoss + dcLoss,
    raw_total_loss_mW: rawTotal,
    temperature_rise_C: numberOrNull(part.TempRise) ?? (partTemperature === null ? null : partTemperature - sample.ambient_C),
    source_run_id: provenance.source_run_id ?? null,
    source_model_fingerprint: provenance.source_model_fingerprint ?? null,
    captured_at_utc: provenance.captured_at_utc ?? null
  };
}

function tolerance(expected) {
  return Math.max(1, Math.abs(expected) * 0.01);
}

function closeEnough(actual, expected) {
  return Math.abs(actual - expected) <= tolerance(expected);
}

export function validateAccountingRecord(record) {
  const expectedFullRms = (record.idc_A ** 2 + record.ripple_pp_A ** 2 / 12) * record.dcr_typ_mOhm;
  const expectedIdcOnly = record.idc_A ** 2 * record.dcr_typ_mOhm;
  const expectedRippleDcr = (record.ripple_pp_A ** 2 / 12) * record.dcr_typ_mOhm;
  const expectedAdditionalAc = record.vendor_ac_core_winding_loss_mW - expectedRippleDcr;
  const errors = [];
  if (!closeEnough(record.dcr_typ_loss_mW, expectedIdcOnly)) {
    errors.push("DCLoss does not use IDC-only current");
  }
  if (record.raw_total_loss_mW !== null && !closeEnough(
    record.raw_total_loss_mW,
    record.dcr_typ_loss_mW + record.vendor_ac_core_winding_loss_mW
  )) errors.push("TotalLoss does not equal DCLoss + ACLoss");
  if (record.ripple_pp_A === 0 && !closeEnough(record.vendor_ac_core_winding_loss_mW, 0)) {
    errors.push("ACLoss is nonzero at zero ripple");
  }
  if (!closeEnough(record.ripple_dcr_loss_mW, expectedRippleDcr)) errors.push("ripple DCR subtraction is inconsistent");
  if (!closeEnough(record.additional_ac_core_winding_loss_mW, expectedAdditionalAc)) errors.push("additional ACLoss residual is inconsistent");
  if (record.additional_ac_core_winding_loss_mW < -tolerance(expectedRippleDcr)) errors.push("additional ACLoss residual is negative");
  return {
    valid: errors.length === 0,
    errors,
    expected_full_rms_dcr_loss_mW: expectedFullRms,
    expected_idc_only_dcr_loss_mW: expectedIdcOnly,
    expected_ripple_dcr_loss_mW: expectedRippleDcr,
    expected_additional_ac_core_winding_loss_mW: expectedAdditionalAc,
    matches_full_rms: closeEnough(record.dcr_typ_loss_mW, expectedFullRms),
    matches_idc_only: closeEnough(record.dcr_typ_loss_mW, expectedIdcOnly)
  };
}

export function validateCollectedRecords(plan, records, options = {}) {
  const requireComplete = options.requireComplete !== false;
  const plannedIds = new Set(plan.samples.map((sample) => sample.sample_id));
  const seen = new Set();
  const errors = [];
  for (const record of records) {
    if (!plannedIds.has(record.sample_id)) errors.push(`${record.sample_id}: not in plan`);
    if (seen.has(record.sample_id)) errors.push(`${record.sample_id}: duplicate`);
    seen.add(record.sample_id);
    for (const key of ["frequency_Hz", "idc_A", "ipeak_A", "ripple_pp_A", "ambient_C", "dcr_typ_loss_mW", "vendor_ac_core_winding_loss_mW", "ripple_dcr_loss_mW", "additional_ac_core_winding_loss_mW", "total_loss_mW"]) {
      if (!Number.isFinite(record[key]) || record[key] < 0) errors.push(`${record.sample_id}: invalid ${key}`);
    }
    const accounting = validateAccountingRecord(record);
    if (!accounting.valid) errors.push(...accounting.errors.map((error) => `${record.sample_id}: ${error}`));
  }
  if (requireComplete && seen.size !== plannedIds.size) errors.push(`incomplete run: ${seen.size}/${plannedIds.size} samples`);
  return { valid: errors.length === 0, errors, completed: seen.size, planned: plannedIds.size };
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function buildPartSurface(partPlan, records) {
  const training = records.filter((record) => record.part_number === partPlan.part_number && record.sample_kind === "training");
  const axes = {
    frequency_Hz: sortedUnique(training.map((record) => record.frequency_Hz)),
    dc_current_A: sortedUnique(training.map((record) => record.idc_A)),
    ripple_pp_A: sortedUnique(training.map((record) => record.ripple_pp_A))
  };
  const byNode = new Map(training.map((record) => [
    `${record.frequency_Hz}|${record.idc_A}|${record.ripple_pp_A}`,
    record.additional_ac_core_winding_loss_mW / 1000
  ]));
  const acLossW = axes.frequency_Hz.map((frequency) => axes.dc_current_A.map((current) => axes.ripple_pp_A.map((ripple) => {
    const value = byNode.get(`${frequency}|${current}|${ripple}`);
    if (!(value > 0)) throw new Error(`${partPlan.part_number}: missing or nonpositive surface node`);
    return value;
  })));
  const surface = {
    part_number: partPlan.part_number,
    ambient_C: 25,
    waveform: "triangular",
    reference_current_A: partPlan.reference_current_A,
    interpolation: INTERPOLATION_PROFILES[partPlan.part_number] ?? null,
    axes,
    ac_loss_W: acLossW
  };
  const validation = validateInductorAcSurface(surface);
  if (!validation.valid) throw new Error(`${partPlan.part_number}: invalid surface (${validation.errors.join(", ")})`);
  return surface;
}

function validatePartHoldouts(surface, records) {
  const holdouts = records.filter((record) => record.part_number === surface.part_number && record.sample_kind === "holdout");
  const points = holdouts.map((record) => {
    const estimate = estimateInductorAcLoss(surface, {
      frequencyHz: record.frequency_Hz,
      dcCurrentA: record.idc_A,
      ripplePpA: record.ripple_pp_A,
      ambientC: record.ambient_C
    });
    if (estimate.status !== "estimated") throw new Error(`${record.sample_id}: holdout was not estimable`);
    const actualMw = record.additional_ac_core_winding_loss_mW;
    const errorMw = Math.abs(estimate.lossW * 1000 - actualMw);
    const relativeError = actualMw > 0 ? errorMw / actualMw : 0;
    const passes = actualMw >= 5 ? relativeError <= 0.3 : errorMw <= 1;
    return { sample_id: record.sample_id, actual_mW: actualMw, predicted_mW: estimate.lossW * 1000, error_mW: errorMw, relative_error: relativeError, passes };
  });
  const normal = points.filter((point) => point.actual_mW >= 5);
  const relative = normal.map((point) => point.relative_error);
  const summary = {
    count: points.length,
    median_relative_error: percentile(relative, 0.5),
    p95_relative_error: percentile(relative, 0.95),
    max_relative_error: relative.length ? Math.max(...relative) : 0,
    max_sub_5mW_absolute_error_mW: Math.max(0, ...points.filter((point) => point.actual_mW < 5).map((point) => point.error_mW)),
    failed_sample_ids: points.filter((point) => !point.passes).map((point) => point.sample_id)
  };
  summary.passes = summary.median_relative_error <= 0.1 && summary.p95_relative_error <= 0.2 && summary.max_relative_error <= 0.3 && summary.max_sub_5mW_absolute_error_mW <= 1 && summary.failed_sample_ids.length === 0;
  return { summary, points };
}

export function buildSurfaceDataset(plan, records, provenance = {}) {
  const collection = validateCollectedRecords(plan, records);
  if (!collection.valid) throw new Error(collection.errors.join("\n"));
  const parts = {};
  const validations = {};
  for (const partPlan of plan.parts) {
    const surface = buildPartSurface(partPlan, records);
    const validation = validatePartHoldouts(surface, records);
    if (!validation.summary.passes) throw new Error(`${partPlan.part_number}: holdout thresholds failed`);
    surface.validation = validation.summary;
    parts[partPlan.part_number] = surface;
    validations[partPlan.part_number] = validation;
  }
  const dataset = {
    schema_version: 1,
    dataset_id: "coilcraft-inductor-ac-loss-surfaces",
    permission_status: provenance.permission_status ?? "internal_evaluation",
    metric: "Additional inductor AC/core loss beyond RMS DCR",
    accounting_convention: "P_DCR=I_L_RMS^2*R_DCR; P_AC_additional=Coilcraft_ACLoss-I_ripple_RMS^2*R_DCR_typ",
    source_tool_url: LOSS_TOOL_URL,
    source_model_fingerprint: provenance.source_model_fingerprint ?? null,
    captured_at_utc: provenance.captured_at_utc ?? null,
    ambient_C: 25,
    waveform: "triangular",
    domain_policy: "no-extrapolation",
    parts
  };
  dataset.dataset_version = `${dataset.captured_at_utc || "undated"}+${hash(dataset).slice(0, 12)}`;
  return { dataset, validations };
}

export const NORMALIZED_FIELDS = [
  "sample_id", "sample_kind", "part_number", "frequency_Hz", "idc_A", "ipeak_A", "ripple_pp_A",
  "ambient_C", "waveform", "dcr_typ_mOhm", "dcr_typ_loss_mW", "vendor_ac_core_winding_loss_mW",
  "ripple_dcr_loss_mW", "additional_ac_core_winding_loss_mW",
  "total_loss_mW", "raw_total_loss_mW", "temperature_rise_C", "source_run_id",
  "source_model_fingerprint", "captured_at_utc"
];

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function recordsToCsv(records) {
  return `${NORMALIZED_FIELDS.join(",")}\n${records.map((record) => NORMALIZED_FIELDS.map((field) => csvCell(record[field])).join(",")).join("\n")}\n`;
}

export function responseSchemaFingerprint(payload) {
  const part = payload?.PartsData?.[0] ?? {};
  return hash({ root: Object.keys(payload || {}).sort(), part: Object.keys(part).sort() });
}
