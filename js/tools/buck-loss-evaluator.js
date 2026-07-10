import { computeBuckCore, computeLossPoint } from "./buck-loss-model.js";
import { estimateInductorAcLoss } from "./inductor-ac-loss.js";

function unavailable(status, extra = {}) {
  return { status, lossW: null, outsideAxes: [], method: null, ...extra };
}

export function evaluateBuckLossPoint(inputs, iout, context = {}) {
  const partNumber = context.inductorPartNumber || null;
  const dataset = context.inductorAcDataset || null;
  const coreResult = computeBuckCore(inputs, iout);
  const ripplePpA = context.ripplePpA ?? coreResult.core.deltaIL;
  let estimate;
  if (!partNumber) {
    estimate = unavailable("not-selected");
  } else if (!dataset || dataset.permission_status !== "approved") {
    estimate = unavailable("not-characterized");
  } else {
    const surface = dataset.parts?.[partNumber];
    estimate = estimateInductorAcLoss(surface, {
      frequencyHz: inputs.fsw,
      dcCurrentA: iout,
      ripplePpA,
      ambientC: context.ambientC ?? 25,
      waveform: context.waveform ?? "triangular"
    });
  }
  const included = ["estimated", "measured-knot", "interpolated", "guarded-extrapolation"].includes(estimate.status);
  const modeledLossW = included ? estimate.lossW : 0;
  const manualLossW = inputs.inductorAcManual ?? 0;
  const totalInductorAcLossW = modeledLossW + manualLossW;
  const anyIncluded = included || manualLossW > 0;
  const result = computeLossPoint(inputs, iout, { inductorAcLossW: totalInductorAcLossW });
  return {
    ...result,
    inductorAcEstimate: estimate,
    inductorAcIncluded: included,
    inductorAcAnyIncluded: anyIncluded,
    modeledInductorAcLossW: modeledLossW,
    manualInductorAcLossW: manualLossW,
    lossEstimateKind: !partNumber ? (manualLossW > 0 ? "manual-total" : "manual-dcr-only") : included ? "modeled-total" : "modeled-subtotal"
  };
}

export function evaluateBuckLossSweep(inputs, context = {}, options = {}) {
  const points = Math.max(2, Math.floor(options.points ?? 180));
  const iMin = options.iMin ?? 0;
  const iMax = options.iMax ?? inputs.ioutMax;
  return Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    return evaluateBuckLossPoint(inputs, iMin + (iMax - iMin) * t, context);
  });
}
