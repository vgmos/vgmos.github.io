const EPSILON = 1e-12;
const MIN_VIEW_SPAN_PHASE = 1 / 1000;
const RING_SETTLING_RATIO = 0.01;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value) {
  return Number.isFinite(value);
}

function positive(value) {
  return finite(value) && value > 0;
}

function wrapPhase(phase) {
  const wrapped = phase % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

export function waveformTimelineV2(waveform) {
  if (!positive(waveform?.period) || !Array.isArray(waveform.segments)) return [];
  let elapsed = 0;
  const timeline = waveform.segments.map((segment, index) => {
    const duration = Math.max(0, finite(segment.duration) ? segment.duration : 0);
    const startSeconds = elapsed;
    elapsed += duration;
    return {
      ...segment,
      index,
      startSeconds,
      endSeconds: elapsed,
      startPhase: startSeconds / waveform.period,
      endPhase: elapsed / waveform.period
    };
  });
  const last = timeline.at(-1);
  if (last && Math.abs(last.endPhase - 1) < 1e-8) {
    last.endPhase = 1;
    last.endSeconds = waveform.period;
  }
  return timeline;
}

function deadTimeForEdge(waveform, edgeId, timeline) {
  const key = edgeId === "rising" ? "lowToHigh" : "highToLow";
  const direct = waveform?.deadTimes?.[key];
  if (finite(direct)) return Math.max(0, direct);
  const edge = edgeId === "rising" ? "low-to-high" : "high-to-low";
  return timeline.find((segment) => segment.state === "dead-time" && segment.edge === edge)?.duration ?? 0;
}

export function waveformEdgeEvidenceV2(point) {
  const waveform = point?.waveform;
  const timeline = waveformTimelineV2(waveform);
  const highSide = timeline.find((segment) => segment.state === "high-side" && segment.duration > EPSILON);
  if (!highSide || !positive(waveform?.period)) {
    return {
      available: false,
      rising: null,
      falling: null
    };
  }
  const transition = point.transition ?? {};
  const timingFor = (edgeId) => {
    if (transition.method === "derived-gate-charge") {
      const durationSeconds = edgeId === "rising" ? transition.voltageFall : transition.voltageRise;
      return {
        kind: "derived-ramp",
        durationSeconds: finite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
        label: "Derived gate-charge timing"
      };
    }
    if (["effective-fallback", "effective-override"].includes(transition.method)) {
      const durationSeconds = edgeId === "rising" ? transition.effectiveTurnOn : transition.effectiveTurnOff;
      return {
        kind: "effective-bracket",
        durationSeconds: finite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
        label: transition.method === "effective-override" ? "Effective overlap override" : "Effective overlap fallback"
      };
    }
    if (["measured-energy-surface", "vendor-spice-energy-surface"].includes(transition.method)) {
      return {
        kind: "energy-only",
        durationSeconds: 0,
        label: "Energy evidence only · edge time unavailable"
      };
    }
    return { kind: "unavailable", durationSeconds: 0, label: "Edge timing unavailable" };
  };
  const make = (id, phase, commutationKey) => ({
    id,
    label: id === "rising" ? "Rising edge" : "Falling edge",
    phase,
    timeSeconds: phase * waveform.period,
    deadTimeSeconds: deadTimeForEdge(waveform, id, timeline),
    timing: timingFor(id),
    commutation: point.commutation?.edges?.[commutationKey] ?? null
  });
  return {
    available: true,
    rising: make("rising", 0, "lowToHigh"),
    falling: make("falling", highSide.endPhase, "highToLow")
  };
}

export function defaultWaveformViewV2(point, probePhase = 0.32) {
  const edges = waveformEdgeEvidenceV2(point);
  const fallingPhase = edges.available ? edges.falling.phase : 1;
  const precedingPhase = clamp(1 - fallingPhase, 0, 1);
  const startPhase = -precedingPhase / 2;
  return {
    mode: "full",
    startPhase,
    endPhase: startPhase + 1,
    probePhase: finite(probePhase) ? probePhase : 0.32
  };
}

export function clampWaveformViewV2(point, view, mode = view?.mode ?? "custom") {
  const full = defaultWaveformViewV2(point, view?.probePhase);
  if (!view || !finite(view.startPhase) || !finite(view.endPhase)) return { ...full, mode };
  const requestedSpan = view.endPhase - view.startPhase;
  const span = clamp(positive(requestedSpan) ? requestedSpan : 1, MIN_VIEW_SPAN_PHASE, 1);
  let startPhase = view.startPhase;
  let endPhase = startPhase + span;
  if (startPhase < full.startPhase) {
    startPhase = full.startPhase;
    endPhase = startPhase + span;
  }
  if (endPhase > full.endPhase) {
    endPhase = full.endPhase;
    startPhase = endPhase - span;
  }
  return {
    mode,
    startPhase,
    endPhase,
    probePhase: finite(view.probePhase) ? view.probePhase : full.probePhase
  };
}

export function edgePresetWaveformViewV2(point, edgeId, probePhase = 0.32) {
  const full = defaultWaveformViewV2(point, probePhase);
  const edges = waveformEdgeEvidenceV2(point);
  const edge = edges[edgeId];
  const period = point?.waveform?.period;
  if (!edges.available || !edge || !positive(period)) return full;
  const baseSpan = Math.max(
    24 * edge.timing.durationSeconds,
    12 * edge.deadTimeSeconds,
    0.02 * period
  );
  const fitFloor = Math.min(period, 1.8 * edge.deadTimeSeconds);
  const spanSeconds = Math.min(period, Math.max(Math.min(baseSpan, 0.5 * period), fitFloor));
  const spanPhase = clamp(spanSeconds / period, MIN_VIEW_SPAN_PHASE, 1);
  const requested = {
    mode: edgeId,
    startPhase: edge.phase - 0.35 * spanPhase,
    endPhase: edge.phase + 0.65 * spanPhase,
    probePhase
  };
  return clampWaveformViewV2(point, requested, edgeId);
}

export function semanticWaveformViewV2(point, view) {
  if (!view || view.mode === "full") return defaultWaveformViewV2(point, view?.probePhase);
  if (view.mode === "rising" || view.mode === "falling") {
    return edgePresetWaveformViewV2(point, view.mode, view.probePhase);
  }
  return clampWaveformViewV2(point, view, "custom");
}

export function zoomWaveformViewV2(point, view, anchorPhase, spanFactor) {
  const current = clampWaveformViewV2(point, view, "custom");
  const currentSpan = current.endPhase - current.startPhase;
  const nextSpan = clamp(currentSpan * spanFactor, MIN_VIEW_SPAN_PHASE, 1);
  const anchor = clamp(finite(anchorPhase) ? anchorPhase : (current.startPhase + current.endPhase) / 2, current.startPhase, current.endPhase);
  const ratio = currentSpan > 0 ? (anchor - current.startPhase) / currentSpan : 0.5;
  return clampWaveformViewV2(point, {
    ...current,
    startPhase: anchor - ratio * nextSpan,
    endPhase: anchor + (1 - ratio) * nextSpan
  }, "custom");
}

export function panWaveformViewV2(point, view, deltaPhase) {
  const current = clampWaveformViewV2(point, view, "custom");
  return clampWaveformViewV2(point, {
    ...current,
    startPhase: current.startPhase + deltaPhase,
    endPhase: current.endPhase + deltaPhase
  }, "custom");
}

export function phaseFromUnitV2(view, unit) {
  return view.startPhase + clamp(unit, 0, 1) * (view.endPhase - view.startPhase);
}

export function unitFromPhaseV2(view, phase) {
  const span = view.endPhase - view.startPhase;
  return span > 0 ? (phase - view.startPhase) / span : 0;
}

function segmentVoltage(segment, inputs) {
  if (segment?.state === "high-side") return inputs.vin;
  if (segment?.state === "dead-time") return -inputs.diodeVf;
  if (segment?.state === "zero-current") return inputs.vout;
  return 0;
}

function timelineSegmentAtPhase(timeline, phase) {
  const wrapped = wrapPhase(phase);
  return timeline.find((segment) => wrapped >= segment.startPhase && wrapped < segment.endPhase) ?? timeline.at(-1) ?? null;
}

function derivedRampVoltage(point, inputs, timeline, phase, idealVoltage) {
  const edges = waveformEdgeEvidenceV2(point);
  if (!edges.available) return idealVoltage;
  for (const edge of [edges.rising, edges.falling]) {
    if (edge.timing.kind !== "derived-ramp" || !positive(edge.timing.durationSeconds)) continue;
    const durationPhase = edge.timing.durationSeconds / point.waveform.period;
    const cycle = Math.floor(phase - edge.phase + EPSILON);
    const start = edge.phase + cycle;
    const progress = (phase - start) / durationPhase;
    if (progress < 0 || progress > 1) continue;
    const previous = segmentVoltage(timelineSegmentAtPhase(timeline, start - 1e-10), inputs);
    const next = segmentVoltage(timelineSegmentAtPhase(timeline, start + durationPhase + 1e-10), inputs);
    return previous + (next - previous) * clamp(progress, 0, 1);
  }
  return idealVoltage;
}

export function calculateRingingModelV2(parasitics = {}) {
  const values = parasitics ?? {};
  const capacitanceF = Number(values.nodeCapacitanceF);
  const inductanceH = Number(values.loopInductanceH);
  const resistanceOhm = Number(values.loopResistanceOhm);
  if (!positive(capacitanceF) || !positive(inductanceH) || !positive(resistanceOhm)) {
    return { available: false, status: "missing-parasitics" };
  }
  const omega0 = 1 / Math.sqrt(inductanceH * capacitanceF);
  const alpha = resistanceOhm / (2 * inductanceH);
  if (!positive(omega0) || !finite(alpha) || alpha >= omega0) {
    return {
      available: false,
      status: "non-oscillatory",
      capacitanceF,
      inductanceH,
      resistanceOhm,
      omega0,
      alpha,
      dampingRatio: omega0 > 0 ? alpha / omega0 : null
    };
  }
  const omegaD = Math.sqrt(omega0 * omega0 - alpha * alpha);
  return {
    available: true,
    status: "underdamped",
    capacitanceF,
    inductanceH,
    resistanceOhm,
    omega0,
    omegaD,
    alpha,
    dampingRatio: alpha / omega0,
    frequencyHz: omegaD / (2 * Math.PI),
    periodSeconds: 2 * Math.PI / omegaD,
    settlingSeconds: -Math.log(RING_SETTLING_RATIO) / alpha
  };
}

function ringingStepResponse(model, elapsedSeconds) {
  if (elapsedSeconds <= 0) return 0;
  const { alpha, omegaD } = model;
  return 1 - Math.exp(-alpha * elapsedSeconds) * (
    Math.cos(omegaD * elapsedSeconds) + alpha / omegaD * Math.sin(omegaD * elapsedSeconds)
  );
}

function ringingRampIntegral(model, elapsedSeconds) {
  if (elapsedSeconds <= 0) return 0;
  const { alpha, omegaD } = model;
  const denominator = alpha * alpha + omegaD * omegaD;
  const exponential = Math.exp(-alpha * elapsedSeconds);
  const cosine = Math.cos(omegaD * elapsedSeconds);
  const sine = Math.sin(omegaD * elapsedSeconds);
  const cosineIntegral = (exponential * (-alpha * cosine + omegaD * sine) + alpha) / denominator;
  const sineIntegral = (exponential * (-alpha * sine - omegaD * cosine) + omegaD) / denominator;
  return elapsedSeconds - cosineIntegral - alpha / omegaD * sineIntegral;
}

export function ringingRampResponseV2(model, elapsedSeconds, rampSeconds = 0) {
  if (!model?.available || elapsedSeconds < 0) return null;
  if (!positive(rampSeconds)) return ringingStepResponse(model, elapsedSeconds);
  if (elapsedSeconds <= rampSeconds) return ringingRampIntegral(model, elapsedSeconds) / rampSeconds;
  return (ringingRampIntegral(model, elapsedSeconds) - ringingRampIntegral(model, elapsedSeconds - rampSeconds)) / rampSeconds;
}

function ringDurationSeconds(point, edge, model) {
  const period = point.waveform.period;
  const edges = waveformEdgeEvidenceV2(point);
  const nextDistance = edge.id === "rising"
    ? edges.falling.phase * period
    : (1 - edges.falling.phase) * period;
  const rampSeconds = edge.timing.kind === "derived-ramp" ? edge.timing.durationSeconds : 0;
  const raw = Math.max(model.settlingSeconds, 3 * model.periodSeconds, 2 * rampSeconds);
  return Math.max(period * MIN_VIEW_SPAN_PHASE, Math.min(raw, Math.max(period * MIN_VIEW_SPAN_PHASE, 0.95 * nextDistance)));
}

function calculatedRingingVoltage(point, inputs, timeline, phase, parasitics) {
  if (point.waveform.mode !== "ccm") return null;
  const model = calculateRingingModelV2(parasitics);
  if (!model.available) return null;
  const edges = waveformEdgeEvidenceV2(point);
  if (!edges.available) return null;
  for (const edge of [edges.rising, edges.falling]) {
    const cycle = Math.floor(phase - edge.phase + EPSILON);
    const edgePhase = edge.phase + cycle;
    const elapsedSeconds = (phase - edgePhase) * point.waveform.period;
    if (elapsedSeconds < 0 || elapsedSeconds > ringDurationSeconds(point, edge, model)) continue;
    const rampSeconds = edge.timing.kind === "derived-ramp" ? edge.timing.durationSeconds : 0;
    const previousVoltage = segmentVoltage(timelineSegmentAtPhase(timeline, edgePhase - 1e-10), inputs);
    const nextVoltage = segmentVoltage(timelineSegmentAtPhase(timeline, edgePhase + Math.max(rampSeconds / point.waveform.period, 1e-10)), inputs);
    const response = ringingRampResponseV2(model, elapsedSeconds, rampSeconds);
    return previousVoltage + (nextVoltage - previousVoltage) * response;
  }
  return null;
}

export function sampleWaveformAtPhaseV2(point, inputs, timeline, phase, parasitics = null) {
  const segment = timelineSegmentAtPhase(timeline, phase);
  const wrapped = wrapPhase(phase);
  const durationPhase = Math.max(EPSILON, (segment?.endPhase ?? 0) - (segment?.startPhase ?? 0));
  const local = segment ? clamp((wrapped - segment.startPhase) / durationPhase, 0, 1) : 0;
  const current = segment ? segment.iStart + (segment.iEnd - segment.iStart) * local : 0;
  const idealVoltage = segmentVoltage(segment, inputs);
  const supportedVoltage = derivedRampVoltage(point, inputs, timeline, phase, idealVoltage);
  const ringingVoltage = calculatedRingingVoltage(point, inputs, timeline, phase, parasitics);
  return {
    phase,
    timeSeconds: phase * point.waveform.period,
    wrappedPhase: wrapped,
    segment,
    current,
    idealVoltage,
    supportedVoltage,
    ringingVoltage,
    ringingActive: finite(ringingVoltage)
  };
}

export function visibleWaveformSegmentsV2(point, view, timeline = waveformTimelineV2(point?.waveform)) {
  if (!timeline.length) return [];
  const segments = [];
  const firstCycle = Math.floor(view.startPhase) - 1;
  const lastCycle = Math.ceil(view.endPhase) + 1;
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    for (const segment of timeline) {
      const startPhase = segment.startPhase + cycle;
      const endPhase = segment.endPhase + cycle;
      if (endPhase < view.startPhase - EPSILON || startPhase > view.endPhase + EPSILON) continue;
      segments.push({
        ...segment,
        cycle,
        startPhase,
        endPhase,
        visibleStartPhase: Math.max(startPhase, view.startPhase),
        visibleEndPhase: Math.min(endPhase, view.endPhase)
      });
    }
  }
  return segments;
}

function expandedEdgePhases(edge, view) {
  const phases = [];
  for (let cycle = Math.floor(view.startPhase) - 1; cycle <= Math.ceil(view.endPhase) + 1; cycle += 1) {
    const phase = edge.phase + cycle;
    if (phase >= view.startPhase - EPSILON && phase <= view.endPhase + EPSILON) phases.push(phase);
  }
  return phases;
}

export function buildWaveformGeometryV2({ point, inputs, view, width, parasitics = null }) {
  const timeline = waveformTimelineV2(point?.waveform);
  if (!timeline.length || !positive(point?.waveform?.period)) {
    return { samples: [], segments: [], edges: [], timeline, view };
  }
  const safeView = clampWaveformViewV2(point, view, view.mode);
  const sampleCount = clamp(Math.ceil(Math.max(1, width) * 1.5), 64, 1600);
  const requests = [];
  const add = (plotPhase, samplePhase = plotPhase, order = 1) => {
    if (plotPhase < safeView.startPhase - EPSILON || plotPhase > safeView.endPhase + EPSILON) return;
    requests.push({ plotPhase, samplePhase, order });
  };
  for (let index = 0; index <= sampleCount; index += 1) {
    add(safeView.startPhase + (safeView.endPhase - safeView.startPhase) * index / sampleCount);
  }
  const segments = visibleWaveformSegmentsV2(point, safeView, timeline);
  segments.forEach((segment) => {
    for (const boundary of [segment.startPhase, segment.endPhase]) {
      add(boundary, boundary - 1e-10, 0);
      add(boundary, boundary, 2);
    }
  });
  const evidence = waveformEdgeEvidenceV2(point);
  const ringingModel = calculateRingingModelV2(parasitics);
  const edges = evidence.available ? [evidence.rising, evidence.falling].flatMap((edge) => (
    expandedEdgePhases(edge, safeView).map((phase) => ({ ...edge, visiblePhase: phase }))
  )) : [];
  edges.forEach((edge) => {
    add(edge.visiblePhase, edge.visiblePhase - 1e-10, 0);
    add(edge.visiblePhase, edge.visiblePhase, 2);
    if (positive(edge.timing.durationSeconds)) {
      add(edge.visiblePhase + edge.timing.durationSeconds / point.waveform.period);
    }
    if (point.waveform.mode === "ccm" && ringingModel.available) {
      const durationSeconds = ringDurationSeconds(point, edge, ringingModel);
      const intervalSeconds = ringingModel.periodSeconds / 8;
      for (let elapsed = 0; elapsed <= durationSeconds + EPSILON; elapsed += intervalSeconds) {
        add(edge.visiblePhase + elapsed / point.waveform.period);
      }
      add(edge.visiblePhase + durationSeconds / point.waveform.period);
    }
  });
  const deduped = new Map();
  requests.forEach((request) => {
    const key = `${request.plotPhase.toFixed(12)}:${request.samplePhase.toFixed(12)}:${request.order}`;
    deduped.set(key, request);
  });
  const samples = [...deduped.values()]
    .sort((left, right) => left.plotPhase - right.plotPhase || left.order - right.order)
    .map((request) => ({
      ...sampleWaveformAtPhaseV2(point, inputs, timeline, request.samplePhase, parasitics),
      phase: request.plotPhase,
      samplePhase: request.samplePhase
    }));
  return { samples, segments, edges, timeline, view: safeView, ringingModel };
}

function niceStep(rawStep) {
  if (!positive(rawStep)) return 1;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

export function waveformTimeTicksV2(point, view, maximumTicks = 7) {
  const period = point?.waveform?.period;
  if (!positive(period)) return [];
  const start = view.startPhase * period;
  const end = view.endPhase * period;
  const step = niceStep((end - start) / Math.max(2, maximumTicks - 1));
  const first = Math.ceil((start - EPSILON) / step) * step;
  const ticks = [];
  for (let value = first; value <= end + step * 1e-8 && ticks.length < maximumTicks + 2; value += step) {
    ticks.push({ timeSeconds: Math.abs(value) < step * 1e-9 ? 0 : value, phase: value / period });
  }
  return ticks;
}

export const WAVEFORM_VIEW_LIMITS_V2 = Object.freeze({
  minimumSpanPhase: MIN_VIEW_SPAN_PHASE,
  maximumSpanPhase: 1
});
