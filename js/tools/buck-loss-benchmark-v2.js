import { applyBuckLossDeviceTemplateV2 } from "./buck-loss-device-templates-v2.js";
import { evaluateBuckLossPointV2 } from "./buck-loss-evaluator-v2.js";
import { BUCK_LOSS_FAMILIES_V2 } from "./buck-loss-equations-v2.js";
import {
  BUCK_LOSS_MODEL_REVISION,
  normalizeBuckLossInputsV2,
  rawDefaultsV2
} from "./buck-loss-schema-v2.js";

const finite = (value) => Number.isFinite(value);
const MECHANISM_FAMILIES = new Set([
  "mosfetConduction", "magnetics", "capacitors", "switchingTransitions",
  "deadTimeRecovery", "gateDrive", "nodeEnergy", "controllerBias"
]);
const DIRECT_MECHANISM_EVIDENCE = new Set(["measured", "instrument-derived"]);
const MECHANISM_FAMILY_MAP = new Map(BUCK_LOSS_FAMILIES_V2.map((family) => [family.id, family]));

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 6) {
  if (!finite(value)) return value;
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function measuredBuckLossFromEfficiency({ efficiencyPercent, iout, vout }) {
  const efficiency = efficiencyPercent / 100;
  if (!(efficiency > 0 && efficiency <= 1) || !(iout > 0) || !(vout > 0)) return null;
  return vout * iout * (1 / efficiency - 1);
}

function validateFixture(fixture) {
  const issues = [];
  if (fixture?.schemaVersion !== 1) issues.push("schemaVersion");
  if (fixture?.model?.revision !== BUCK_LOSS_MODEL_REVISION) issues.push("model.revision");
  if (!fixture?.deviceTemplateId) issues.push("deviceTemplateId");
  if (!Array.isArray(fixture?.traces) || !fixture.traces.length) issues.push("traces");
  if (!Array.isArray(fixture?.lanes) || !fixture.lanes.length) issues.push("lanes");
  if (!fixture?.acceptance?.primaryLaneId) issues.push("acceptance.primaryLaneId");
  if (issues.length) throw new Error(`Invalid buck benchmark fixture: ${issues.join(", ")}`);
}

function qualityProfile(fixture) {
  const rows = fixture.traces.flatMap((trace) => trace.points.map((point) => ({
    traceId: trace.id,
    vin: trace.vin,
    ...point
  })));
  const keys = rows.map((row) => `${row.traceId}:${row.iout}`);
  const uniqueKeys = new Set(keys);
  const invalidRows = rows.filter((row) => (
    !finite(row.vin) || !finite(row.iout) || row.iout <= 0 ||
    !finite(row.efficiencyPercent) || row.efficiencyPercent <= 0 || row.efficiencyPercent > 100
  ));
  const outOfAxesRows = rows.filter((row) => (
    row.iout < fixture.measurement.axes.ioutA[0] || row.iout > fixture.measurement.axes.ioutA[1] ||
    row.efficiencyPercent < fixture.measurement.axes.efficiencyPercent[0] ||
    row.efficiencyPercent > fixture.measurement.axes.efficiencyPercent[1]
  ));
  const statedTrace = fixture.traces.find((trace) => trace.vin === 8);
  const statedPeak = statedTrace ? Math.max(...statedTrace.points.map((point) => point.efficiencyPercent)) : null;
  const statedPeakDelta = finite(statedPeak)
    ? Math.abs(statedPeak - fixture.measurement.statedEfficiencyCheck.efficiencyPercent)
    : null;
  const expectedLoads = fixture.measurement.sampleLoadsA;
  const incompleteTraces = fixture.traces.filter((trace) => (
    trace.points.length !== expectedLoads.length ||
    expectedLoads.some((load, index) => trace.points[index]?.iout !== load)
  )).map((trace) => trace.id);
  const mechanismMeasurements = fixture.measurement.mechanismMeasurements ?? [];
  const mechanismKeys = mechanismMeasurements.map((row) => `${row.traceId}:${row.iout}:${row.family}`);
  const mechanismKeySet = new Set(mechanismKeys);
  const invalidMechanismRows = mechanismMeasurements.filter((row) => {
    const trace = fixture.traces.find((candidate) => candidate.id === row.traceId);
    const operatingPointExists = trace?.points.some((point) => point.iout === row.iout);
    const allowedTerms = MECHANISM_FAMILY_MAP.get(row.family)?.terms ?? [];
    const scopedTermsValid = row.terms === undefined || (
      Array.isArray(row.terms) && row.terms.length > 0 && row.terms.every((term) => allowedTerms.includes(term))
    );
    return !trace || !operatingPointExists || !MECHANISM_FAMILIES.has(row.family) ||
      !finite(row.measuredLossW) || row.measuredLossW < 0 || !row.evidenceClass || !scopedTermsValid;
  });
  const eligibleMechanismRows = mechanismMeasurements.filter((row) => (
    !invalidMechanismRows.includes(row) && DIRECT_MECHANISM_EVIDENCE.has(row.evidenceClass)
  ));
  const ineligibleMechanismRows = mechanismMeasurements.filter((row) => (
    !invalidMechanismRows.includes(row) && !DIRECT_MECHANISM_EVIDENCE.has(row.evidenceClass)
  ));
  return {
    rowCount: rows.length,
    uniqueKeyCount: uniqueKeys.size,
    duplicateKeyCount: keys.length - uniqueKeys.size,
    invalidRowCount: invalidRows.length,
    outOfAxesRowCount: outOfAxesRows.length,
    incompleteTraces,
    statedEfficiencyCheckDeltaPp: statedPeakDelta,
    mechanismMeasurementCount: mechanismMeasurements.length,
    directMechanismMeasurementCount: eligibleMechanismRows.length,
    ineligibleMechanismEvidenceCount: ineligibleMechanismRows.length,
    invalidMechanismRowCount: invalidMechanismRows.length,
    duplicateMechanismKeyCount: mechanismKeys.length - mechanismKeySet.size,
    mechanismReady: eligibleMechanismRows.length > 0 && !invalidMechanismRows.length && mechanismKeys.length === mechanismKeySet.size,
    ready: keys.length === uniqueKeys.size && !invalidRows.length && !outOfAxesRows.length &&
      !incompleteTraces.length && !invalidMechanismRows.length && mechanismKeys.length === mechanismKeySet.size && finite(statedPeakDelta) &&
      statedPeakDelta <= fixture.measurement.publishedCurveUncertaintyPp
  };
}

function configuredInputs(fixture, trace, lane) {
  const templated = applyBuckLossDeviceTemplateV2({
    ...rawDefaultsV2(),
    ...fixture.board.rawInputs
  }, fixture.deviceTemplateId);
  if (!templated.template) throw new Error(`Unknown benchmark device template: ${fixture.deviceTemplateId}`);
  const traceOverrides = trace.rawInputOverrides || {};
  const rawInputs = {
    ...templated.rawInputs,
    ...traceOverrides,
    __provenance: {
      ...(templated.rawInputs.__provenance || {}),
      ...(trace.provenanceOverrides || {})
    }
  };
  const normalized = normalizeBuckLossInputsV2(rawInputs);
  const resistanceMultiplier = lane.rdsMultiplier ?? 1;
  return {
    inputs: {
      ...normalized.inputs,
      rdsHigh: normalized.inputs.rdsHigh * resistanceMultiplier,
      rdsLow: normalized.inputs.rdsLow * resistanceMultiplier
    },
    provenance: {
      ...normalized.provenance,
      rdsHigh: resistanceMultiplier === 1 ? normalized.provenance.rdsHigh : lane.provenance,
      rdsLow: resistanceMultiplier === 1 ? normalized.provenance.rdsLow : lane.provenance
    },
    template: templated.template
  };
}

function summarizeRows(rows, acceptance) {
  const gated = rows.filter((row) => row.iout >= acceptance.minLoadA && row.iout <= acceptance.maxLoadA);
  const efficiencyErrors = gated.map((row) => row.efficiencyErrorPp);
  const signedBiasPp = mean(efficiencyErrors);
  const metrics = {
    pointCount: gated.length,
    efficiencyMaePp: mean(efficiencyErrors.map(Math.abs)),
    efficiencyWorstAbsPp: Math.max(...efficiencyErrors.map(Math.abs)),
    efficiencySignedBiasPp: signedBiasPp,
    curveShapeMaePp: mean(efficiencyErrors.map((value) => Math.abs(value - signedBiasPp))),
    medianAbsLossErrorPercent: median(gated.map((row) => Math.abs(row.lossErrorPercent)))
  };
  const checks = {
    efficiencyMae: metrics.efficiencyMaePp <= acceptance.maxEfficiencyMaePp,
    efficiencyWorst: metrics.efficiencyWorstAbsPp <= acceptance.maxEfficiencyWorstAbsPp,
    medianLossError: metrics.medianAbsLossErrorPercent <= acceptance.maxMedianAbsLossErrorPercent
  };
  return { ...metrics, checks, pass: Object.values(checks).every(Boolean) };
}

function evaluateLane(fixture, lane) {
  const traceResults = fixture.traces.map((trace) => {
    const configured = configuredInputs(fixture, trace, lane);
    const rows = trace.points.map((measurement) => {
      const point = evaluateBuckLossPointV2(configured.inputs, measurement.iout, {
        technology: configured.template.technology,
        catalogKind: configured.template.catalogKind,
        deviceTemplate: configured.template.id,
        parameterCorner: `${configured.template.cornerId}-${lane.id}`,
        timingMode: configured.template.timingMode,
        controlMode: fixture.board.controlMode,
        provenance: configured.provenance
      });
      if (!point.valid) throw new Error(`${trace.id}/${lane.id}/${measurement.iout} A is invalid: ${point.errors.join(", ")}`);
      const measuredLossW = measuredBuckLossFromEfficiency({
        efficiencyPercent: measurement.efficiencyPercent,
        iout: measurement.iout,
        vout: fixture.board.rawInputs.vout
      });
      const predictedEfficiencyPercent = point.efficiency * 100;
      const efficiencyErrorPp = predictedEfficiencyPercent - measurement.efficiencyPercent;
      const lossErrorW = point.pLoss - measuredLossW;
      return {
        id: `${trace.id}-${lane.id}-${measurement.iout}a`,
        traceId: trace.id,
        laneId: lane.id,
        vin: trace.vin,
        vout: fixture.board.rawInputs.vout,
        iout: measurement.iout,
        measuredEfficiencyPercent: measurement.efficiencyPercent,
        measuredLossW,
        predictedEfficiencyPercent,
        predictedKnownLossW: point.pLoss,
        efficiencyErrorPp,
        lossErrorW,
        lossErrorPercent: measuredLossW > 0 ? 100 * lossErrorW / measuredLossW : null,
        availability: point.availability,
        omitted: point.omitted,
        coverageGaps: point.coverageGaps,
        groupedKnownLossesW: point.groupedLosses,
        atomicKnownLossesW: point.losses,
        waveformMode: point.waveform.mode,
        ripplePpA: point.waveform.ripplePp,
        rdsHighOhm: configured.inputs.rdsHigh,
        rdsLowOhm: configured.inputs.rdsLow,
        gateDriveV: configured.inputs.vDrive
      };
    });
    return {
      traceId: trace.id,
      vin: trace.vin,
      rows,
      summary: summarizeRows(rows, fixture.acceptance)
    };
  });
  const rows = traceResults.flatMap((trace) => trace.rows);
  const overall = summarizeRows(rows, fixture.acceptance);
  return {
    id: lane.id,
    label: lane.label,
    acceptanceEvaluated: lane.id === fixture.acceptance.primaryLaneId,
    rows,
    traceResults,
    overall,
    pass: overall.pass && traceResults.every((trace) => trace.summary.pass)
  };
}

function summarizeMechanismComparisons(comparisons) {
  const grouped = new Map();
  comparisons.forEach((comparison) => {
    const rows = grouped.get(comparison.family) ?? [];
    rows.push(comparison);
    grouped.set(comparison.family, rows);
  });
  return [...grouped.entries()].map(([family, rows]) => {
    const relativeErrors = rows.map((row) => Math.abs(row.errorPercent)).filter(finite);
    return {
      family,
      pointCount: rows.length,
      meanAbsoluteErrorW: mean(rows.map((row) => Math.abs(row.errorW))),
      worstAbsoluteErrorW: Math.max(...rows.map((row) => Math.abs(row.errorW))),
      medianAbsoluteErrorPercent: relativeErrors.length ? median(relativeErrors) : null
    };
  });
}

function evaluateMechanismValidation(fixture, primaryLane) {
  const measurements = fixture.measurement.mechanismMeasurements ?? [];
  const eligible = measurements.filter((measurement) => DIRECT_MECHANISM_EVIDENCE.has(measurement.evidenceClass));
  if (!eligible.length) {
    return {
      status: "not-evaluable",
      pass: null,
      reason: "no-direct-mechanism-measurements",
      directMeasurementCount: 0,
      comparisonCount: 0,
      excludedMeasurementCount: 0,
      comparisons: [],
      excludedMeasurements: [],
      families: []
    };
  }
  const evaluated = eligible.map((measurement) => {
    const row = primaryLane.rows.find((candidate) => candidate.traceId === measurement.traceId && candidate.iout === measurement.iout);
    const familyTerms = MECHANISM_FAMILY_MAP.get(measurement.family)?.terms ?? [];
    const terms = measurement.terms ?? familyTerms;
    const missingTerms = terms.filter((term) => !finite(row?.atomicKnownLossesW?.[term]));
    if (!row || missingTerms.length) return {
      comparable: false,
      traceId: measurement.traceId,
      iout: measurement.iout,
      family: measurement.family,
      evidenceClass: measurement.evidenceClass,
      terms,
      reason: !row ? "operating-point-not-found" : "modeled-scope-incomplete",
      missingTerms
    };
    const predictedLossW = terms.reduce((sum, term) => sum + row.atomicKnownLossesW[term], 0);
    const errorW = predictedLossW - measurement.measuredLossW;
    return {
      comparable: true,
      traceId: measurement.traceId,
      iout: measurement.iout,
      family: measurement.family,
      evidenceClass: measurement.evidenceClass,
      sourceLocation: measurement.sourceLocation ?? null,
      terms,
      measuredLossW: measurement.measuredLossW,
      predictedLossW,
      errorW,
      errorPercent: measurement.measuredLossW > 0 ? 100 * errorW / measurement.measuredLossW : null
    };
  });
  const comparisons = evaluated.filter((comparison) => comparison.comparable).map(({ comparable, ...comparison }) => comparison);
  const excludedMeasurements = evaluated.filter((comparison) => !comparison.comparable).map(({ comparable, ...comparison }) => comparison);
  if (!comparisons.length) {
    return {
      status: "not-evaluable",
      pass: null,
      reason: "no-comparable-modeled-families",
      directMeasurementCount: eligible.length,
      comparisonCount: 0,
      excludedMeasurementCount: excludedMeasurements.length,
      comparisons: [],
      excludedMeasurements,
      families: []
    };
  }
  const thresholds = fixture.acceptance.mechanisms ?? null;
  const checks = comparisons.map((comparison) => ({
    ...comparison,
    checks: thresholds ? {
      absoluteError: !finite(thresholds.maxAbsoluteErrorW) || Math.abs(comparison.errorW) <= thresholds.maxAbsoluteErrorW,
      relativeError: !finite(thresholds.maxAbsoluteErrorPercent) || Math.abs(comparison.errorPercent) <= thresholds.maxAbsoluteErrorPercent
    } : null
  }));
  const pass = thresholds ? checks.every((comparison) => Object.values(comparison.checks).every(Boolean)) : null;
  return {
    status: thresholds ? (pass ? "pass" : "fail") : "evaluated-no-threshold",
    pass,
    reason: thresholds ? null : "no-mechanism-acceptance-thresholds",
    directMeasurementCount: eligible.length,
    comparisonCount: checks.length,
    excludedMeasurementCount: excludedMeasurements.length,
    comparisons: checks,
    excludedMeasurements,
    families: summarizeMechanismComparisons(checks),
    thresholds
  };
}

export function evaluateBuckLossBenchmarkFixtureV2(fixture) {
  validateFixture(fixture);
  const dataQuality = qualityProfile(fixture);
  if (!dataQuality.ready) throw new Error(`Benchmark measurement data failed quality checks: ${JSON.stringify(dataQuality)}`);
  const lanes = fixture.lanes.map((lane) => evaluateLane(fixture, lane));
  const primary = lanes.find((lane) => lane.id === fixture.acceptance.primaryLaneId);
  if (!primary) throw new Error(`Primary lane not found: ${fixture.acceptance.primaryLaneId}`);
  const mechanismValidation = evaluateMechanismValidation(fixture, primary);
  const mechanismRequired = fixture.acceptance.mechanisms?.required === true;
  const acceptancePass = primary.pass && (!mechanismRequired || mechanismValidation.pass === true);
  return {
    fixtureId: fixture.id,
    modelRevision: BUCK_LOSS_MODEL_REVISION,
    dataQuality,
    lanes,
    primaryLaneId: primary.id,
    mechanismValidation,
    acceptance: {
      pass: acceptancePass,
      status: acceptancePass ? "pass" : "fail",
      thresholds: fixture.acceptance,
      overall: primary.overall,
      traces: primary.traceResults.map((trace) => ({
        traceId: trace.traceId,
        vin: trace.vin,
        ...trace.summary
      }))
    }
  };
}

function compactSummary(summary) {
  return {
    pointCount: summary.pointCount,
    efficiencyMaePp: round(summary.efficiencyMaePp),
    efficiencyWorstAbsPp: round(summary.efficiencyWorstAbsPp),
    efficiencySignedBiasPp: round(summary.efficiencySignedBiasPp),
    curveShapeMaePp: round(summary.curveShapeMaePp),
    medianAbsLossErrorPercent: round(summary.medianAbsLossErrorPercent),
    checks: summary.checks,
    pass: summary.pass
  };
}

export function expectedBuckLossBenchmarkV1(analysis) {
  return {
    modelRevision: analysis.modelRevision,
    dataQuality: {
      ...analysis.dataQuality,
      statedEfficiencyCheckDeltaPp: round(analysis.dataQuality.statedEfficiencyCheckDeltaPp)
    },
    acceptanceStatus: analysis.acceptance.status,
    mechanismValidation: {
      status: analysis.mechanismValidation.status,
      pass: analysis.mechanismValidation.pass,
      reason: analysis.mechanismValidation.reason,
      directMeasurementCount: analysis.mechanismValidation.directMeasurementCount,
      comparisonCount: analysis.mechanismValidation.comparisonCount,
      excludedMeasurementCount: analysis.mechanismValidation.excludedMeasurementCount,
      families: analysis.mechanismValidation.families.map((family) => ({
        family: family.family,
        pointCount: family.pointCount,
        meanAbsoluteErrorW: round(family.meanAbsoluteErrorW),
        worstAbsoluteErrorW: round(family.worstAbsoluteErrorW),
        medianAbsoluteErrorPercent: round(family.medianAbsoluteErrorPercent)
      }))
    },
    lanes: analysis.lanes.map((lane) => ({
      id: lane.id,
      acceptanceEvaluated: lane.acceptanceEvaluated,
      pass: lane.pass,
      overall: compactSummary(lane.overall),
      traces: lane.traceResults.map((trace) => ({
        traceId: trace.traceId,
        vin: trace.vin,
        ...compactSummary(trace.summary)
      }))
    })),
    checkpoints: analysis.lanes.flatMap((lane) => lane.traceResults.flatMap((trace) => (
      trace.rows.filter((row) => [2, 6, 10].includes(row.iout)).map((row) => ({
        laneId: lane.id,
        vin: trace.vin,
        iout: row.iout,
        measuredEfficiencyPercent: row.measuredEfficiencyPercent,
        predictedEfficiencyPercent: round(row.predictedEfficiencyPercent),
        measuredLossW: round(row.measuredLossW),
        predictedKnownLossW: round(row.predictedKnownLossW),
        efficiencyErrorPp: round(row.efficiencyErrorPp),
        lossErrorPercent: round(row.lossErrorPercent),
        availability: row.availability,
        omitted: row.omitted
      }))
    )))
  };
}
