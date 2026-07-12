import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWaveformGeometryV2,
  calculateRingingModelV2,
  defaultWaveformViewV2,
  edgePresetWaveformViewV2,
  panWaveformViewV2,
  ringingRampResponseV2,
  sampleWaveformAtPhaseV2,
  unitFromPhaseV2,
  waveformEdgeEvidenceV2,
  waveformTimeTicksV2,
  waveformTimelineV2,
  zoomWaveformViewV2
} from "../js/tools/buck-loss-waveform-view-v2.js";

const PERIOD = 1e-6;
const INPUTS = Object.freeze({ vin: 12, vout: 3.3, diodeVf: 0.7 });
const RINGING = Object.freeze({ nodeCapacitanceF: 3e-9, loopInductanceH: 2e-9, loopResistanceOhm: 0.35 });

function segment(state, duration, iStart, iEnd, extra = {}) {
  return { state, duration, iStart, iEnd, ...extra };
}

function pointFixture(overrides = {}) {
  const waveform = {
    valid: true,
    mode: "ccm",
    period: PERIOD,
    deadTimes: { highToLow: 7e-9, lowToHigh: 1e-9 },
    segments: [
      segment("high-side", 250e-9, 1.5, 2.5),
      segment("dead-time", 7e-9, 2.5, 2.47, { edge: "high-to-low" }),
      segment("low-side", 742e-9, 2.47, 1.51),
      segment("dead-time", 1e-9, 1.51, 1.5, { edge: "low-to-high" })
    ],
    ...overrides.waveform
  };
  return {
    waveform,
    transition: {
      method: "derived-gate-charge",
      voltageFall: 3e-9,
      voltageRise: 5e-9,
      ...overrides.transition
    },
    commutation: {
      edges: {
        lowToHigh: { classification: "hard-switching" },
        highToLow: { classification: "full-zvs" }
      }
    }
  };
}

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

describe("buck loss waveform view helpers", () => {
  it("centers a complete period so both switching edges have context", () => {
    const point = pointFixture();
    const view = defaultWaveformViewV2(point);
    const edges = waveformEdgeEvidenceV2(point);

    close(view.startPhase, -0.375);
    close(view.endPhase, 0.625);
    assert.ok(edges.rising.phase > view.startPhase && edges.rising.phase < view.endPhase);
    assert.ok(edges.falling.phase > view.startPhase && edges.falling.phase < view.endPhase);
  });

  it("wraps negative pre-trigger time into the preceding low-to-high dead time", () => {
    const point = pointFixture();
    const timeline = waveformTimelineV2(point.waveform);
    const before = sampleWaveformAtPhaseV2(point, INPUTS, timeline, -0.0005);
    const after = sampleWaveformAtPhaseV2(point, INPUTS, timeline, 0);

    assert.equal(before.segment.edge, "low-to-high");
    assert.equal(before.idealVoltage, -0.7);
    assert.equal(after.segment.state, "high-side");
    assert.equal(after.idealVoltage, 12);
  });

  it("maps derived device VDS timing to the opposite switch-node edge polarity", () => {
    const edges = waveformEdgeEvidenceV2(pointFixture());
    assert.equal(edges.rising.timing.durationSeconds, 3e-9);
    assert.equal(edges.falling.timing.durationSeconds, 5e-9);
    assert.equal(edges.rising.timing.kind, "derived-ramp");
    assert.equal(edges.falling.commutation.classification, "full-zvs");
  });

  it("uses the committed edge preset framing and asymmetric dead time", () => {
    const point = pointFixture();
    const rising = edgePresetWaveformViewV2(point, "rising");
    const falling = edgePresetWaveformViewV2(point, "falling");

    close(rising.endPhase - rising.startPhase, 0.072);
    close(falling.endPhase - falling.startPhase, 0.12);
    close((0 - rising.startPhase) / (rising.endPhase - rising.startPhase), 0.35);
    close((0.25 - falling.startPhase) / (falling.endPhase - falling.startPhase), 0.35);
  });

  it("lets the dead-time fit floor beat the half-period preset cap", () => {
    const point = pointFixture({
      waveform: {
        deadTimes: { highToLow: 400e-9, lowToHigh: 400e-9 },
        segments: [
          segment("high-side", 100e-9, 1, 2),
          segment("dead-time", 400e-9, 2, 1.6, { edge: "high-to-low" }),
          segment("low-side", 100e-9, 1.6, 1.4),
          segment("dead-time", 400e-9, 1.4, 1, { edge: "low-to-high" })
        ]
      },
      transition: { voltageRise: 0 }
    });
    const falling = edgePresetWaveformViewV2(point, "falling");
    close(falling.endPhase - falling.startPhase, 0.72);
  });

  it("keeps the phase under the cursor fixed while zooming", () => {
    const point = pointFixture();
    const view = defaultWaveformViewV2(point);
    const anchor = 0.2;
    const beforeUnit = unitFromPhaseV2(view, anchor);
    const zoomed = zoomWaveformViewV2(point, view, anchor, 0.5);
    close(unitFromPhaseV2(zoomed, anchor), beforeUnit);
    close(zoomed.endPhase - zoomed.startPhase, 0.5);
  });

  it("pans without escaping the single unwrapped period", () => {
    const point = pointFixture();
    const zoomed = zoomWaveformViewV2(point, defaultWaveformViewV2(point), 0, 0.2);
    const farLeft = panWaveformViewV2(point, zoomed, -10);
    const farRight = panWaveformViewV2(point, zoomed, 10);
    const full = defaultWaveformViewV2(point);

    close(farLeft.startPhase, full.startPhase);
    close(farRight.endPhase, full.endPhase);
    close(farLeft.endPhase - farLeft.startPhase, 0.2);
    close(farRight.endPhase - farRight.startPhase, 0.2);
  });

  it("inserts both sides of every exact boundary into adaptive geometry", () => {
    const point = pointFixture();
    const geometry = buildWaveformGeometryV2({
      point,
      inputs: INPUTS,
      view: defaultWaveformViewV2(point),
      width: 720
    });
    const falling = geometry.samples.filter((sample) => Math.abs(sample.phase - 0.25) < 1e-10);
    assert.ok(falling.length >= 2);
    assert.equal(falling[0].idealVoltage, 12);
    assert.equal(falling.at(-1).idealVoltage, -0.7);
    assert.ok(geometry.samples.length <= 1600 + 40);
  });

  it("draws a derived rising ramp while leaving the ideal step intact", () => {
    const point = pointFixture();
    const timeline = waveformTimelineV2(point.waveform);
    const midway = sampleWaveformAtPhaseV2(point, INPUTS, timeline, 1.5e-9 / PERIOD);
    assert.equal(midway.idealVoltage, 12);
    close(midway.supportedVoltage, (-0.7 + 12) / 2, 1e-6);
  });

  it("computes a sourced-parasitic RLC response and 1-2-5 time ticks", () => {
    const model = calculateRingingModelV2(RINGING);
    assert.equal(model.status, "underdamped");
    assert.ok(model.frequencyHz > 60e6 && model.frequencyHz < 70e6);
    assert.ok(model.dampingRatio > 0.2 && model.dampingRatio < 0.23);
    assert.equal(ringingRampResponseV2(model, 0, 0), 0);
    assert.ok(ringingRampResponseV2(model, model.periodSeconds / 2, 0) > 1);

    const point = pointFixture();
    const timeline = waveformTimelineV2(point.waveform);
    const calculated = sampleWaveformAtPhaseV2(point, INPUTS, timeline, 8e-9 / PERIOD, RINGING);
    const unavailable = sampleWaveformAtPhaseV2(point, INPUTS, timeline, 8e-9 / PERIOD);
    assert.equal(calculated.ringingActive, true);
    assert.ok(Number.isFinite(calculated.ringingVoltage));
    assert.equal(unavailable.ringingActive, false);
    assert.equal(unavailable.ringingVoltage, null);

    const ticks = waveformTimeTicksV2(point, defaultWaveformViewV2(point));
    assert.ok(ticks.some((tick) => tick.timeSeconds === 0));
    assert.ok(ticks.some((tick) => tick.timeSeconds < 0));
    assert.ok(ticks.every((tick, index) => index === 0 || tick.timeSeconds > ticks[index - 1].timeSeconds));
  });
});
