import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyRegime,
  computeBuckCore,
  computeLossPoint,
  normalizeInputs,
  validateInputs
} from "../js/tools/buck-loss-model.js";

const relTol = (actual, expected, tolerance = 1e-9) => {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, `${actual} != ${expected}`);
};

const finiteDeep = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteDeep);
  if (typeof value === "object") return Object.values(value).every(finiteDeep);
  return true;
};

const baseRaw = {
  vin: 12,
  vout: 3,
  ioutMax: 3,
  fsw: 1000,
  inductance: 3,
  rdsHigh: 0,
  rdsLow: 0,
  qgHigh: 0,
  qgLow: 0,
  tOverlap: 0,
  deadTime: 0,
  diodeVf: 0,
  dcr: 0,
  esr: 0,
  vDrive: 5,
  iq: 0,
  vBias: null,
  eossTotal: 0,
  qrr: 0,
  inductorIsat: null
};

function v2Inputs(overrides = {}) {
  return normalizeInputs({
    ...baseRaw,
    rdsHigh: 100,
    rdsLow: 50,
    qgHigh: 4,
    qgLow: 4,
    tOverlap: 20,
    deadTime: 20,
    diodeVf: 0.8,
    dcr: 20,
    esr: 10,
    iq: 2,
    vBias: 12,
    ...overrides
  });
}

describe("buck loss model", () => {
  it("normalizes display units to SI and resolves blanks", () => {
    const n = normalizeInputs({
      vin: 12,
      vout: 3.3,
      ioutMax: 3,
      fsw: 1000,
      inductance: 2.2,
      rdsHigh: 30,
      rdsLow: 15,
      qgHigh: 4,
      qgLow: 8,
      tOverlap: 15,
      deadTime: 20,
      diodeVf: 0.8,
      dcr: 20,
      esr: 5,
      vDrive: 5,
      iq: 2,
      vBias: "",
      eossTotal: 12,
      qrr: 3,
      inductorAcManual: 125,
      inductorIsat: ""
    });
    assert.equal(n.fsw, 1_000_000);
    assert.equal(n.inductance, 2.2e-6);
    assert.equal(n.rdsHigh, 0.03);
    assert.equal(n.qgHigh, 4e-9);
    relTol(n.tOverlap, 15e-9);
    relTol(n.eossTotal, 12e-9);
    assert.equal(n.iq, 0.002);
    assert.equal(n.vBias, 12);
    assert.equal(n.inductorAcManual, 0.125);
    assert.equal(n.inductorIsat, null);
  });

  it("matches core vector V1", () => {
    const inputs = normalizeInputs(baseRaw);
    const { core } = computeBuckCore(inputs, 2);
    relTol(core.D, 0.25);
    relTol(core.deltaIL, 0.75);
    relTol(core.iPeak, 2.375);
    relTol(core.iValley, 1.625);
    relTol(core.iLrms2, 4.046875);
    relTol(core.iCapRms2, 0.046875);
    relTol(core.iHighRms2, 1.01171875);
    relTol(core.iLowRms2, 3.03515625);
  });

  it("matches loss vector V2", () => {
    const result = computeLossPoint(v2Inputs(), 2);
    relTol(result.losses.condHigh, 0.101171875);
    relTol(result.losses.condLow, 0.1517578125);
    relTol(result.losses.dcr, 0.0809375);
    relTol(result.losses.esr, 0.00046875);
    relTol(result.losses.gate, 0.04);
    relTol(result.losses.switching, 0.24);
    relTol(result.losses.deadTime, 0.064);
    relTol(result.losses.bias, 0.024);
    relTol(result.pLoss, 0.7023359375);
    relTol(result.efficiency, 0.8952102753, 1e-9);
  });

  it("matches forced-CCM vector V3", () => {
    const result = computeLossPoint(v2Inputs(), 0.05);
    relTol(result.core.iValley, -0.325);
    assert.ok(result.warnings.includes("forced-ccm"));
    relTol(result.losses.switching, 0.0255);
    relTol(result.losses.deadTime, 0.0068);
    relTol(result.pLoss, 0.1008421875);
    relTol(result.efficiency, 0.5979855362, 1e-9);
  });

  it("has exact expected scaling behavior", () => {
    const base = computeLossPoint(v2Inputs(), 2);
    const doubleRhs = computeLossPoint(v2Inputs({ rdsHigh: 200 }), 2);
    const doubleDcr = computeLossPoint(v2Inputs({ dcr: 40 }), 2);
    const doubleQg = computeLossPoint(v2Inputs({ qgHigh: 8, qgLow: 8 }), 2);
    const doubleFsw = computeLossPoint(v2Inputs({ fsw: 2000 }), 2);
    const noOverlap = computeLossPoint(v2Inputs({ tOverlap: 0 }), 2);
    const noDeadTime = computeLossPoint(v2Inputs({ deadTime: 0 }), 2);
    const light = computeLossPoint(v2Inputs(), 0.5);

    relTol(doubleRhs.losses.condHigh, 2 * base.losses.condHigh);
    relTol(doubleDcr.losses.dcr, 2 * base.losses.dcr);
    relTol(doubleQg.losses.gate, 2 * base.losses.gate);
    relTol(doubleFsw.losses.gate, 2 * base.losses.gate);
    relTol(doubleFsw.losses.switching, 2 * base.losses.switching);
    relTol(doubleFsw.losses.deadTime, 2 * base.losses.deadTime);
    relTol(doubleFsw.losses.esr, 0.25 * base.losses.esr);
    assert.equal(noOverlap.losses.switching, 0);
    assert.equal(noDeadTime.losses.deadTime, 0);
    relTol(light.losses.gate, base.losses.gate);
    relTol(light.losses.bias, base.losses.bias);
  });

  it("keeps the tr=tf identity in CCM", () => {
    const inputs = v2Inputs();
    const result = computeLossPoint(inputs, 2);
    assert.ok(result.core.iValley >= 0);
    relTol(result.losses.switching, 0.5 * inputs.vin * inputs.fsw * inputs.tOverlap * 2);
    relTol(result.losses.deadTime, 2 * inputs.diodeVf * inputs.fsw * inputs.deadTime * 2);
  });

  it("keeps totals and groups consistent", () => {
    const result = computeLossPoint(v2Inputs(), 2);
    const lossSum = Object.values(result.losses).reduce((sum, value) => sum + value, 0);
    const groupSum = Object.values(result.groupedLosses).reduce((sum, value) => sum + value, 0);
    relTol(result.pLoss, lossSum);
    relTol(result.pLoss, groupSum);
    relTol(result.pInEstimated, result.pOut + result.pLoss);
    assert.ok(result.efficiency > 0 && result.efficiency < 1);
  });

  it("injects optional inductor AC loss exactly once", () => {
    const baseline = computeLossPoint(v2Inputs(), 2);
    const modeled = computeLossPoint(v2Inputs(), 2, { inductorAcLossW: 0.125 });
    relTol(modeled.losses.inductorAc, 0.125);
    relTol(modeled.groupedLosses.inductorAc, 0.125);
    relTol(modeled.pLoss, baseline.pLoss + 0.125);
    assert.ok(modeled.efficiency < baseline.efficiency);
    assert.equal(computeLossPoint(v2Inputs(), 2, { inductorAcLossW: -1 }).valid, false);
  });

  it("handles invalid edges and finite low current", () => {
    assert.equal(validateInputs(normalizeInputs({ ...baseRaw, vout: 12 })).valid, false);
    assert.equal(validateInputs(normalizeInputs({ ...baseRaw, inductance: 0 })).valid, false);
    assert.equal(validateInputs(normalizeInputs({ ...baseRaw, fsw: 0 })).valid, false);

    const invalid = computeLossPoint(normalizeInputs({ ...baseRaw, vout: 12 }), 1);
    assert.equal(invalid.valid, false);
    assert.equal(finiteDeep(invalid), true);

    const low = computeLossPoint(v2Inputs(), 0.001);
    assert.equal(finiteDeep(low), true);
  });

  it("fires warnings exactly per their conditions", () => {
    assert.deepEqual(computeLossPoint(v2Inputs(), 2).warnings, []);
    assert.deepEqual(computeLossPoint(v2Inputs(), 0.05).warnings, ["forced-ccm"]);
    assert.ok(computeLossPoint(v2Inputs({ ioutMax: 1 }), 2).warnings.includes("high-ripple"));
    assert.ok(computeLossPoint(v2Inputs({ inductorIsat: 2 }), 2).warnings.includes("isat"));
    assert.ok(computeLossPoint(v2Inputs({ rdsHigh: 5000, rdsLow: 5000, dcr: 5000 }), 0.05).warnings.includes("high-loss"));
    assert.ok(computeLossPoint(v2Inputs({ vout: 0.2 }), 2).warnings.includes("extreme-duty"));
  });

  it("classifies each ordered regime branch", () => {
    const floorInputs = v2Inputs({ qgHigh: 80, qgLow: 80, iq: 10 });
    const floor = computeLossPoint(floorInputs, 0.01);
    assert.equal(classifyRegime(floor, floorInputs).regime, "floor");
    assert.equal(classifyRegime(floor, floorInputs).lightLoad, true);

    const fetInputs = v2Inputs({ rdsHigh: 500, rdsLow: 500, dcr: 1, tOverlap: 0, deadTime: 0, qgHigh: 0, qgLow: 0, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(fetInputs, 2), fetInputs).regime, "fetConduction");

    const dcrInputs = v2Inputs({ rdsHigh: 1, rdsLow: 1, dcr: 500, tOverlap: 0, deadTime: 0, qgHigh: 0, qgLow: 0, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(dcrInputs, 2), dcrInputs).regime, "inductorDcr");

    const acInputs = v2Inputs({ rdsHigh: 1, rdsLow: 1, dcr: 1, tOverlap: 0, deadTime: 0, qgHigh: 0, qgLow: 0, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(acInputs, 2, { inductorAcLossW: 2 }), acInputs).regime, "inductorAc");

    const swInputs = v2Inputs({ tOverlap: 100, deadTime: 0, rdsHigh: 1, rdsLow: 1, dcr: 1, qgHigh: 0, qgLow: 0, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(swInputs, 2), swInputs).regime, "switchingOverlap");

    const deadInputs = v2Inputs({ tOverlap: 0, deadTime: 120, rdsHigh: 1, rdsLow: 1, dcr: 1, qgHigh: 0, qgLow: 0, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(deadInputs, 2), deadInputs).regime, "deadTime");

    const condInputs = v2Inputs({ rdsHigh: 100, rdsLow: 100, dcr: 100, tOverlap: 12, deadTime: 5, qgHigh: 0, qgLow: 0, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(condInputs, 2), condInputs).regime, "conduction");

    const freqInputs = v2Inputs({ tOverlap: 12, deadTime: 12, qgHigh: 12, qgLow: 12, rdsHigh: 20, rdsLow: 20, dcr: 20, iq: 0 });
    assert.equal(classifyRegime(computeLossPoint(freqInputs, 2), freqInputs).regime, "frequency");

    const balancedInputs = v2Inputs({ rdsHigh: 30, rdsLow: 30, dcr: 30, tOverlap: 10, deadTime: 10, qgHigh: 3, qgLow: 3, iq: 1, esr: 500 });
    assert.equal(classifyRegime(computeLossPoint(balancedInputs, 2), balancedInputs).regime, "balanced");
  });

  it("keeps forced-CCM and light-load classification independent", () => {
    const inputs = v2Inputs({ ioutMax: 0.5 });
    const atBoundary = computeLossPoint(inputs, 0.05);
    const belowBoundary = computeLossPoint(inputs, 0.049);
    assert.equal(classifyRegime(atBoundary, inputs).lightLoad, false);
    assert.equal(classifyRegime(belowBoundary, inputs).lightLoad, true);
    assert.equal(classifyRegime(atBoundary, inputs).forcedCCM, true);
  });
});
