import { buildBuckLossSweepAnnotationsV2, computeBuckLossPointV2, computeBuckWaveformV2, findCcmBoundaryV2 } from "./buck-loss-model-v2.js";
import { BUCK_LOSS_MODEL_REVISION } from "./buck-loss-schema-v2.js";
import { estimateInductorAcLoss } from "./inductor-ac-loss.js";

function unavailable(status, extra = {}) {
  return { status, lossW: null, outsideAxes: [], method: null, ...extra };
}

function inductorEstimate(inputs, iout, waveform, context) {
  const partNumber = context.inductorPartNumber || null;
  const dataset = context.inductorAcDataset || null;
  if (!partNumber) return unavailable("not-selected");
  if (waveform.mode === "dcm") return unavailable("dcm-waveform", { method: "catalog-triangle-out-of-domain" });
  if (!dataset || dataset.permission_status !== "approved") return unavailable("not-characterized");
  const surface = dataset.parts?.[partNumber];
  return estimateInductorAcLoss(surface, {
    frequencyHz: inputs.fsw,
    dcCurrentA: iout,
    ripplePpA: waveform.ripplePp,
    ambientC: 25,
    waveform: "triangular"
  });
}

export function evaluateBuckLossPointV2(inputs, iout, context = {}) {
  const ccmBoundary = Number.isFinite(context.ccmBoundary) ? context.ccmBoundary : findCcmBoundaryV2(inputs);
  const waveform = computeBuckWaveformV2(inputs, iout, {
    controlMode: context.controlMode,
    ccmBoundary
  });
  const estimate = waveform.valid ? inductorEstimate(inputs, iout, waveform, context) : unavailable("invalid-waveform");
  const included = ["estimated", "measured-knot", "interpolated", "guarded-extrapolation"].includes(estimate.status);
  const modeledLossW = included ? estimate.lossW : null;
  const manualLossW = Number.isFinite(inputs.inductorAcManual) ? inputs.inductorAcManual : null;
  const inductorAcLossW = included
    ? modeledLossW + (manualLossW ?? 0)
    : manualLossW;
  const result = computeBuckLossPointV2(inputs, iout, {
    ...context,
    ccmBoundary,
    inductorAcLossW,
    inductorCatalogOutOfDomain: Boolean(context.inductorPartNumber) && waveform.mode === "dcm",
    inductorCoreResidualScaling: included ? "characterized" : manualLossW !== null ? "fixed" : "unclassified",
    inductorCoreResidualFixedW: manualLossW ?? 0
  });
  return {
    ...result,
    inductorAcEstimate: estimate,
    inductorAcIncluded: included,
    modeledInductorAcLossW: modeledLossW,
    manualInductorAcLossW: manualLossW,
    lossEstimateKind: !context.inductorPartNumber
      ? (manualLossW !== null ? "manual-estimate" : "manual-subtotal")
      : estimate.status === "dcm-waveform"
        ? manualLossW !== null ? "dcm-manual-estimate" : "dcm-catalog-subtotal"
        : included ? "catalog-estimate" : manualLossW !== null ? "catalog-manual-estimate" : "catalog-subtotal"
  };
}

export function evaluateBuckLossSweepV2(inputs, context = {}, options = {}) {
  const points = Math.max(2, Math.floor(options.points ?? 180));
  const iMin = options.iMin ?? 0;
  const iMax = options.iMax ?? inputs.ioutMax;
  const ccmBoundary = findCcmBoundaryV2(inputs);
  const pointContext = { ...context, ccmBoundary };
  const values = Array.from({ length: points }, (_, index) => {
    const fraction = index / (points - 1);
    return evaluateBuckLossPointV2(inputs, iMin + (iMax - iMin) * fraction, pointContext);
  });
  const peak = values.reduce((best, point) => {
    if (!Number.isFinite(point.efficiency)) return best;
    return !best || point.efficiency > best.efficiency ? point : best;
  }, null);
  return {
    modelVersion: 2,
    modelRevision: BUCK_LOSS_MODEL_REVISION,
    points: values,
    annotations: buildBuckLossSweepAnnotationsV2(values, ccmBoundary, peak)
  };
}
