#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyBuckLossDeviceTemplateV2 } from "../../../js/tools/buck-loss-device-templates-v2.js";
import { computeBuckWaveformV2, findCcmBoundaryV2 } from "../../../js/tools/buck-loss-model-v2.js";
import { normalizeBuckLossInputsV2, rawDefaultsV2 } from "../../../js/tools/buck-loss-schema-v2.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const OUTPUT_PATH = join(REPO_ROOT, "tests/fixtures/buck-loss-spice-golden.v3.json");
const REQUIRED_NGSPICE_VERSION = "46";
const FIXTURE_REVISION = "2026-07-10-v2.1";
const WRITE_MODE = process.argv.includes("--write") || !process.argv.includes("--check");
const CHECK_MODE = process.argv.includes("--check");
const REQUESTED_CASE = process.env.SPICE_CASE ?? null;

const BASE_RAW = Object.freeze({
  vin: 12,
  vout: 3.3,
  ioutMax: 3,
  fsw: 1000,
  inductance: 2.2,
  deadTime: 20,
  dcr: 20,
  rac: 20,
  inductorAcManual: 0,
  inputEsr: 5,
  esr: 5,
  iq: 0,
  vBias: 12
});

const HIGH_VOLTAGE_RAW = Object.freeze({
  ...BASE_RAW,
  vin: 48,
  vout: 12,
  ioutMax: 5,
  fsw: 400,
  inductance: 15,
  deadTime: 20,
  vBias: 48
});

const TOLERANCES = Object.freeze({
  waveformRelative: 0.03,
  staticLossRelative: 0.03,
  aggregateStaticRelative: 0.08,
  efficiencyAbsolute: 0.01,
  boundaryRelative: 0.03,
  dropoutVoutFraction: 0.01,
  absolute: Object.freeze({
    currentA: 0.005,
    deadCurrentA: 0.0002,
    dutyFraction: 0.005,
    voltageV: 0.005,
    staticLossW: 0.0002,
    deadLossW: 0.0002,
    aggregateLossW: 0.001
  })
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function format(value) {
  if (!Number.isFinite(value)) throw new TypeError(`Non-finite SPICE parameter: ${value}`);
  return Number(value).toExponential(12);
}

function parseMeasurements(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z0-9_]*)\s*=\s*([-+0-9.eE]+)/i);
    if (match) values[match[1].toLowerCase()] = Number(match[2]);
  }
  return values;
}

function simulatorVersion() {
  const output = execFileSync("ngspice", ["-v"], { encoding: "utf8" });
  return output.match(/ngspice-(\d+(?:\.\d+)?)/i)?.[1] ?? "unknown";
}

let runSerial = 0;
function runNetlist(id, netlist, workDir) {
  runSerial += 1;
  const stem = `${id}-${runSerial}`.replace(/[^a-z0-9_.-]/gi, "-");
  const netlistPath = join(workDir, `${stem}.cir`);
  const logPath = join(workDir, `${stem}.log`);
  writeFileSync(netlistPath, netlist);
  try {
    execFileSync("ngspice", ["-b", "-o", logPath, netlistPath], {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const log = readFileSync(logPath, "utf8");
    throw new Error(`ngspice failed for ${id}:\n${log}`, { cause: error });
  }
  const measurements = parseMeasurements(readFileSync(logPath, "utf8"));
  if (!Object.keys(measurements).length) throw new Error(`ngspice reported no measurements for ${id}`);
  return measurements;
}

function setup(raw, templateId = "epc2090") {
  const templated = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...raw }, templateId);
  const { inputs } = normalizeBuckLossInputsV2(templated.rawInputs);
  return { inputs, template: templated.template };
}

function topologyConfigs() {
  const configs = [];
  const addBoundaryCase = (raw, ratio, deadTime = raw.deadTime, extra = {}) => {
    const caseRaw = { ...raw, deadTime };
    const { inputs } = setup(caseRaw);
    const boundary = findCcmBoundaryV2(inputs);
    const suffix = String(ratio).replace(".", "p");
    configs.push({
      id: `${raw.vin}v-${raw.vout}v-b${suffix}-td${deadTime}ns`,
      raw: caseRaw,
      templateId: "epc2090",
      loadA: boundary * ratio,
      boundaryRatio: ratio,
      expectedMode: ratio <= 1 ? "dcm" : "ccm",
      controlMode: "auto-dcm",
      ...extra
    });
  };

  for (const ratio of [0.25, 0.9, 0.99, 1.01, 1.1]) addBoundaryCase(BASE_RAW, ratio);
  for (const deadTime of [5, 60]) {
    addBoundaryCase(BASE_RAW, 0.99, deadTime);
    addBoundaryCase(BASE_RAW, 1.01, deadTime);
  }
  for (const loadA of [2, 3]) {
    configs.push({
      id: `12v-3p3v-${loadA}a-td20ns`,
      raw: BASE_RAW,
      templateId: "epc2090",
      loadA,
      boundaryRatio: null,
      expectedMode: "ccm",
      controlMode: "auto-dcm"
    });
  }
  addBoundaryCase(HIGH_VOLTAGE_RAW, 0.99);
  addBoundaryCase(HIGH_VOLTAGE_RAW, 1.01);
  configs.push({
    id: "48v-12v-5a-td20ns",
    raw: HIGH_VOLTAGE_RAW,
    templateId: "epc2090",
    loadA: 5,
    boundaryRatio: null,
    expectedMode: "ccm",
    controlMode: "auto-dcm"
  });
  addBoundaryCase(BASE_RAW, 0.5, 20, {
    id: "12v-3p3v-forced-negative-b0p5-td20ns",
    expectedMode: "ccm",
    controlMode: "forced-ccm"
  });
  return configs;
}

function topologyNetlist(config, inputs, duty, options = {}) {
  const period = 1 / inputs.fsw;
  const tOn = duty * period;
  const lowDelay = tOn + inputs.deadTime;
  const lowWidth = Math.max(1e-12, period - tOn - 2 * inputs.deadTime);
  const cycles = options.cycles ?? (config.controlMode === "forced-ccm" ? 240 : config.expectedMode === "dcm" ? 20 : 60);
  const sampleCycles = Math.min(20, Math.floor(cycles / 2));
  const stop = cycles * period;
  const sampleStart = (cycles - sampleCycles) * period;
  const previousStart = (cycles - 2 * sampleCycles) * period;
  const maxStep = inputs.deadTime > 0
    ? Math.min(period / 250, inputs.deadTime / 6)
    : period / 250;
  const lowSidePath = `VLSENSE 0 lsa 0\nSLOW lsa sw lcmd 0 SLSW`;
  const initialWaveform = computeBuckWaveformV2(inputs, config.loadA, { controlMode: config.controlMode });
  const inductorPath = config.expectedMode === "dcm"
    ? `DZERO sw lind DZERO\nLBUCK lind ilraw ${format(inputs.inductance)} IC=0`
    : `LBUCK sw ilraw ${format(inputs.inductance)} IC=${format(initialWaveform.valid ? initialWaveform.iValley : config.loadA)}`;
  const reverseNetwork = inputs.deadTime > 0
    ? `VLOWREV 0 lowrev ${format(inputs.diodeVf)}\nDLOWREV lowrev sw DREVPATH\nVHIGHREV highrev vin ${format(inputs.diodeVf)}\nDHIGHREV sw highrev DREVPATH`
    : `VLOWREV 0 lowdummy 0\nRLOWDUMMY lowdummy 0 1G\nVHIGHREV highdummy vin 0\nRHIGHDUMMY highdummy vin 1G`;
  const edgeTime = inputs.vin > 24 && config.expectedMode === "ccm" ? 500e-12 : 100e-12;
  const switchCap = inputs.vin > 24 ? 20e-15 : 10e-15;

  return `* Buck-loss v2.1 independent switched topology: ${config.id}
.option method=gear reltol=2e-6 abstol=1e-10 vntol=1e-8
.param T=${format(period)} TON=${format(tOn)} TLOWD=${format(lowDelay)} TLOWW=${format(lowWidth)}
VINPUT vsrc 0 ${format(inputs.vin)}
VINSENSE vsrc vin 0
VHSENSE vin hs 0
SHIGH hs sw gh 0 SHSW
${lowSidePath}
${reverseNetwork}
CSWN sw 0 ${format(switchCap)}
RSWN sw 0 1G
VGH gh 0 PULSE(0 5 0 ${format(edgeTime)} ${format(edgeTime)} {TON} {T})
VLCMD lcmd 0 PULSE(0 5 {TLOWD} ${format(edgeTime)} ${format(edgeTime)} {TLOWW} {T})
${inductorPath}
VILSENSE ilraw ilres 0
RDCR ilres out ${format(inputs.dcr)}
VOUT out 0 ${format(inputs.vout)}
BHICURRENT hicurrent 0 V=I(VILSENSE)*V(gh)/5
BLOCURRENT locurrent 0 V=I(VILSENSE)*V(lcmd)/5
.model SHSW SW(Ron=${format(inputs.rdsHigh)} Roff=1e12 Vt=2.5 Vh=0.05)
.model SLSW SW(Ron=${format(inputs.rdsLow)} Roff=1e12 Vt=2.5 Vh=0.05)
.model DZERO D(Is=1e-9 N=0.02 Rs=100u Cjo=0)
.model DREVPATH D(Is=1e-9 N=0.02 Rs=1m Cjo=0)
.tran ${format(maxStep)} ${format(stop)} 0 ${format(maxStep)} UIC
.meas tran il_avg AVG I(VILSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran il_prev AVG I(VILSENSE) FROM=${format(previousStart)} TO=${format(sampleStart)}
.meas tran il_rms RMS I(VILSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ihs_avg AVG I(VHSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ihs_rms RMS I(VHSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ils_rms RMS I(VLSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ihs_model_rms RMS V(hicurrent) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ils_model_rms RMS V(locurrent) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran input_avg AVG I(VINSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran input_rms RMS I(VINSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran low_dead_avg AVG I(VLOWREV) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran high_dead_avg AVG I(VHIGHREV) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran low_dead_rms RMS I(VLOWREV) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran high_dead_rms RMS I(VHIGHREV) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran i_peak MAX I(VILSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran i_valley MIN I(VILSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran zero_cross WHEN I(VILSENSE)=1u FALL=LAST
.save V(out) I(VINSENSE) I(VHSENSE) I(VLSENSE) I(VILSENSE) I(VLOWREV) I(VHIGHREV)
.end
`;
}

function solveDuty(config, inputs, workDir) {
  const initial = computeBuckWaveformV2(inputs, config.loadA, { controlMode: config.controlMode });
  const center = initial.valid ? initial.duties.highSide : inputs.vout / inputs.vin;
  let low = Math.max(0.005, center - 0.05);
  let high = Math.min(0.98, 1 - 2 * inputs.deadTime * inputs.fsw - 0.0001, center + 0.05);
  let best = null;
  for (let iteration = 0; iteration < 15; iteration += 1) {
    const duty = (low + high) / 2;
    const netlist = topologyNetlist(config, inputs, duty);
    let measured;
    try {
      measured = runNetlist(`${config.id}-duty-${iteration}`, netlist, workDir);
    } catch (error) {
      if (best) break;
      throw error;
    }
    const error = measured.il_avg - config.loadA;
    if (!Number.isFinite(error)) throw new Error(`Missing inductor current for ${config.id}`);
    if (!best || Math.abs(error) < Math.abs(best.error)) best = { duty, error, measured, netlist };
    if (error > 0) high = duty;
    else low = duty;
  }
  if (!best) throw new Error(`Duty solve failed for ${config.id}`);
  return best;
}

function buildTopologyFixture(config, workDir) {
  const { inputs } = setup(config.raw, config.templateId);
  const boundary = findCcmBoundaryV2(inputs);
  const solved = solveDuty(config, inputs, workDir);
  const measured = solved.measured;
  const lowDeadCurrentSigned = measured.low_dead_avg ?? 0;
  const highDeadCurrentSigned = measured.high_dead_avg ?? 0;
  const lowDeadCurrent = Math.abs(lowDeadCurrentSigned);
  const highDeadCurrent = Math.abs(highDeadCurrentSigned);
  const deadCurrentAverage = lowDeadCurrent + highDeadCurrent;
  const modelInputAverage = config.loadA * solved.duty;
  const channelInputCapRms = Math.sqrt(Math.max(0, measured.ihs_model_rms ** 2 - modelInputAverage ** 2));
  const actualInputCapRms = Math.sqrt(Math.max(0, measured.input_rms ** 2 - measured.input_avg ** 2));
  const outputCapRms = Math.sqrt(Math.max(0, measured.il_rms ** 2 - config.loadA ** 2));
  const period = 1 / inputs.fsw;
  const zeroCrossPhase = Number.isFinite(measured.zero_cross)
    ? ((measured.zero_cross % period) + period) % period
    : period;
  let deadFraction;
  let lowFraction;
  let zeroFraction;
  if (config.expectedMode === "dcm") {
    const highEnd = solved.duty * period;
    const lowStart = highEnd + inputs.deadTime;
    const lowEnd = period - inputs.deadTime;
    const leadingDeadDuration = Math.max(0, Math.min(zeroCrossPhase, lowStart) - highEnd);
    const lowDuration = Math.max(0, Math.min(zeroCrossPhase, lowEnd) - lowStart);
    const trailingDeadDuration = Math.max(0, zeroCrossPhase - lowEnd);
    deadFraction = (leadingDeadDuration + trailingDeadDuration) / period;
    lowFraction = lowDuration / period;
    zeroFraction = Math.max(0, (period - zeroCrossPhase) / period);
  } else {
    deadFraction = 2 * inputs.deadTime / period;
    lowFraction = Math.max(0, 1 - solved.duty - deadFraction);
    zeroFraction = 0;
  }
  const duties = {
    highSide: solved.duty,
    lowSide: lowFraction,
    deadTime: deadFraction,
    zeroCurrent: zeroFraction
  };
  const losses = {
    highSideConduction: measured.ihs_model_rms ** 2 * inputs.rdsHigh,
    lowSideConduction: measured.ils_model_rms ** 2 * inputs.rdsLow,
    inductorCopperTotal: measured.il_rms ** 2 * inputs.dcr,
    inputCapEsr: actualInputCapRms ** 2 * inputs.inputEsr,
    outputCapEsr: outputCapRms ** 2 * inputs.esr,
    deadTimeConduction: deadCurrentAverage * inputs.diodeVf
  };
  const aggregateStaticLoss = Object.values(losses).reduce((sum, value) => sum + value, 0);
  const pOut = inputs.vout * config.loadA;
  return {
    id: config.id,
    evidenceClass: "independent-switched-topology",
    method: config.expectedMode === "dcm" ? "switched-buck-zero-current-clamped" : "switched-buck-synchronous",
    expectedMode: config.expectedMode,
    controlMode: config.controlMode,
    comparisonPolicy: config.controlMode === "forced-ccm"
      ? {
          hardGated: "waveform moments, dead/zero intervals, non-commutation static terms, aggregate static loss, and efficiency",
          characterizationOnly: [
            "highSideDuty",
            "lowSideDuty",
            "deadTimeCurrentAverage",
            "lowDeadTimeCurrentAverageSigned",
            "highDeadTimeCurrentAverageSigned",
            "lowDeadTimeCurrentRms",
            "highDeadTimeCurrentRms",
            "deadTimeConduction"
          ],
          reason: "The analytical forced-CCM model is a first-order negative-current warning and does not resolve diode commutation waveforms."
        }
      : { hardGated: "all comparable waveform and static terms", characterizationOnly: [] },
    deviceTemplate: config.templateId,
    boundaryRatio: config.boundaryRatio,
    modelBoundaryA: boundary,
    inputs: { ...config.raw, loadA: config.loadA },
    netlistSha256: sha256(solved.netlist),
    simulation: {
      dutyCommand: solved.duty,
      voutAverage: inputs.vout,
      inductorAverage: measured.il_avg,
      inductorRms: measured.il_rms,
      highSideRms: measured.ihs_model_rms,
      lowSideRms: measured.ils_model_rms,
      inputCapRms: actualInputCapRms,
      inputCapRmsGatedEstimate: channelInputCapRms,
      outputCapRms,
      deadTimeCurrentAverage: deadCurrentAverage,
      lowDeadTimeCurrentAverage: lowDeadCurrent,
      highDeadTimeCurrentAverage: highDeadCurrent,
      lowDeadTimeCurrentAverageSigned: lowDeadCurrentSigned,
      highDeadTimeCurrentAverageSigned: highDeadCurrentSigned,
      lowDeadTimeCurrentRms: Math.abs(measured.low_dead_rms ?? 0),
      highDeadTimeCurrentRms: Math.abs(measured.high_dead_rms ?? 0),
      peakCurrent: measured.i_peak,
      valleyCurrent: config.expectedMode === "ccm" ? 2 * measured.il_avg - measured.i_peak : measured.i_valley,
      valleyCurrentRaw: measured.i_valley,
      duties,
      segmentDurations: {
        highSide: duties.highSide * period,
        lowSide: duties.lowSide * period,
        deadTime: duties.deadTime * period,
        zeroCurrent: duties.zeroCurrent * period
      },
      losses,
      aggregateStaticLoss,
      efficiencyStatic: pOut / (pOut + aggregateStaticLoss),
      convergence: {
        currentWindowDelta: Math.abs(measured.il_avg - measured.il_prev)
      }
    }
  };
}

function pwl(values) {
  return values.map(([time, value]) => `${format(time)} ${format(value)}`).join(" ");
}

function buildAnalyticalIdentityChecks(workDir) {
  const { inputs } = setup({ ...BASE_RAW, deadTime: 0, dcr: 0, rac: 0, inputEsr: 0, esr: 0 });
  const loadA = 0.05;
  const period = 1 / inputs.fsw;
  const slopeUp = (inputs.vin - inputs.vout) / inputs.inductance;
  const slopeDown = inputs.vout / inputs.inductance;
  const peak = Math.sqrt(loadA * period / (0.5 * (1 / slopeUp + 1 / slopeDown)));
  const tHigh = peak / slopeUp;
  const tLow = peak / slopeDown;
  const active = tHigh + tLow;
  const values = [[0, 0], [tHigh, peak], [active, 0], [period, 0]];
  const triangularNetlist = `* Formula-integration identity: ideal DCM triangle
IIND il 0 PWL(${pwl(values)})
RIND il 0 1
.tran ${format(period / 1000)} ${format(period)}
.meas tran il_avg AVG V(il) FROM=0 TO=${format(period)}
.meas tran il_rms RMS V(il) FROM=0 TO=${format(period)}
.meas tran i_peak MIN V(il) FROM=0 TO=${format(period)}
.end
`;
  const triangular = runNetlist("identity-dcm-triangle", triangularNetlist, workDir);

  const durationA = 3.2e-9;
  const durationB = 4e-9;
  const peakPower = 12.8 * 2;
  const profile = [];
  for (let index = 0; index <= 64; index += 1) {
    const x = index / 64;
    profile.push([durationA * x, peakPower * x * x]);
  }
  for (let index = 1; index <= 64; index += 1) {
    const x = index / 64;
    profile.push([durationA + durationB * x, peakPower * (1 - x)]);
  }
  const phaseStop = (durationA + durationB) * 1.01;
  const phaseNetlist = `* Formula-integration identity: textbook transition profile
VP p 0 PWL(${pwl(profile)})
RP p 0 1G
.tran ${format(phaseStop / 2000)} ${format(phaseStop)}
.meas tran energy INTEG V(p) FROM=0 TO=${format(phaseStop)}
.end
`;
  const phase = runNetlist("identity-transition-phase", phaseNetlist, workDir);
  return [
    {
      id: "ideal-dcm-triangle-moments",
      evidenceClass: "formula-integration-identity",
      method: "ideal-dcm-pwl-integration",
      netlistSha256: sha256(triangularNetlist),
      expected: {
        currentAverage: loadA,
        currentRms: peak * Math.sqrt(active / (3 * period)),
        peakCurrent: peak
      },
      simulation: {
        currentAverage: Math.abs(triangular.il_avg),
        currentRms: Math.abs(triangular.il_rms),
        peakCurrent: Math.abs(triangular.i_peak)
      }
    },
    {
      id: "textbook-transition-phase-energy",
      evidenceClass: "formula-integration-identity",
      method: "textbook-phase-pwl-integration",
      netlistSha256: sha256(phaseNetlist),
      expected: { energyJ: peakPower * (durationA / 3 + durationB / 2) },
    simulation: { energyJ: phase.energy }
    }
  ];
}

function clampedNetlist(id, inputs, duty, initialCurrent) {
  const period = 1 / inputs.fsw;
  const tOn = duty * period;
  const lowDelay = tOn + inputs.deadTime;
  const lowWidth = Math.max(1e-12, period - tOn - 2 * inputs.deadTime);
  const cycles = 600;
  const sampleCycles = 30;
  const stop = cycles * period;
  const sampleStart = (cycles - sampleCycles) * period;
  const previousStart = (cycles - 2 * sampleCycles) * period;
  const maxStep = inputs.deadTime > 0
    ? Math.min(period / 250, inputs.deadTime / 6)
    : period / 250;
  return `* Buck-loss v2.1 fixed-output threshold topology: ${id}
.option method=gear reltol=2e-6 abstol=1e-10 vntol=1e-8
.param T=${format(period)} TON=${format(tOn)} TLOWD=${format(lowDelay)} TLOWW=${format(lowWidth)}
VINPUT vsrc 0 ${format(inputs.vin)}
VINSENSE vsrc vin 0
VHSENSE vin hs 0
SHIGH hs sw gh 0 SHSW
VLSENSE 0 lsa 0
SLOW lsa sw lcmd 0 SLSW
VLOWREV 0 lowrev ${format(inputs.diodeVf)}
DLOWREV lowrev sw DREVPATH
VHIGHREV highrev vin ${format(inputs.diodeVf)}
DHIGHREV sw highrev DREVPATH
CSWN sw 0 10f
RSWN sw 0 1G
VGH gh 0 PULSE(0 5 0 100p 100p {TON} {T})
VLCMD lcmd 0 PULSE(0 5 {TLOWD} 100p 100p {TLOWW} {T})
LBUCK sw ilraw ${format(inputs.inductance)} IC=${format(initialCurrent)}
VILSENSE ilraw ilres 0
RDCR ilres out ${format(inputs.dcr)}
VOUT out 0 ${format(inputs.vout)}
.model SHSW SW(Ron=${format(inputs.rdsHigh)} Roff=1e12 Vt=2.5 Vh=0.05)
.model SLSW SW(Ron=${format(inputs.rdsLow)} Roff=1e12 Vt=2.5 Vh=0.05)
.model DREVPATH D(Is=1e-9 N=0.02 Rs=1m Cjo=0)
.tran ${format(maxStep)} ${format(stop)} 0 ${format(maxStep)} UIC
.meas tran il_avg AVG I(VILSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran il_prev AVG I(VILSENSE) FROM=${format(previousStart)} TO=${format(sampleStart)}
.meas tran i_valley MIN I(VILSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.end
`;
}

function buildThresholdChecks(workDir) {
  const base = setup(BASE_RAW).inputs;
  const modelBoundary = findCcmBoundaryV2(base);
  let lowDuty = Math.max(0.05, base.vout / base.vin - 0.08);
  let highDuty = Math.min(0.9, base.vout / base.vin + 0.08);
  let boundaryBest = null;
  for (let iteration = 0; iteration < 15; iteration += 1) {
    const duty = (lowDuty + highDuty) / 2;
    const netlist = clampedNetlist("zero-current-onset", base, duty, modelBoundary);
    const measured = runNetlist(`threshold-boundary-${iteration}`, netlist, workDir);
    boundaryBest = { duty, measured, netlist };
    if (measured.i_valley > 0) highDuty = duty;
    else lowDuty = duty;
  }

  const targetCurrent = 2;
  let lowVin = base.vout + 1e-4;
  let highVin = base.vout + 1.5;
  let dropoutBest = null;
  const dropoutDuty = 1 - 2 * base.deadTime * base.fsw - 1e-6;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const vin = (lowVin + highVin) / 2;
    const inputs = { ...base, vin, vBias: vin };
    const netlist = clampedNetlist("dropout-threshold", inputs, dropoutDuty, targetCurrent);
    const measured = runNetlist(`threshold-dropout-${iteration}`, netlist, workDir);
    dropoutBest = { vin, measured, netlist };
    if (measured.il_avg >= targetCurrent) highVin = vin;
    else lowVin = vin;
  }
  return [
    {
      id: "12v-3p3v-zero-current-onset",
      evidenceClass: "independent-switched-topology-threshold",
      method: "fixed-output-duty-search",
      inputs: BASE_RAW,
      netlistSha256: sha256(boundaryBest.netlist),
      simulation: {
        boundaryA: boundaryBest.measured.il_avg,
        valleyA: boundaryBest.measured.i_valley,
        duty: boundaryBest.duty,
        currentWindowDelta: Math.abs(boundaryBest.measured.il_avg - boundaryBest.measured.il_prev)
      }
    },
    {
      id: "3p3v-2a-dropout-onset",
      evidenceClass: "independent-switched-topology-threshold",
      method: "fixed-output-vin-search-at-maximum-duty",
      inputs: { ...BASE_RAW, loadA: targetCurrent },
      netlistSha256: sha256(dropoutBest.netlist),
      searchResolutionV: highVin - lowVin,
      simulation: {
        vinThreshold: (highVin + lowVin) / 2,
        inductorAverage: dropoutBest.measured.il_avg,
        currentWindowDelta: Math.abs(dropoutBest.measured.il_avg - dropoutBest.measured.il_prev)
      }
    }
  ];
}

function payloadFor(version, workDir) {
  let configs = topologyConfigs();
  if (REQUESTED_CASE) {
    configs = configs.filter((item) => item.id === REQUESTED_CASE);
    if (!configs.length) throw new Error(`Unknown SPICE_CASE: ${REQUESTED_CASE}`);
  }
  const topologyCases = configs.map((config) => buildTopologyFixture(config, workDir));
  return {
    schemaVersion: 3,
    generatedBy: `ngspice-${version}`,
    fixtureRevision: FIXTURE_REVISION,
    methodology: "Independent topology cases use switched buck circuits and simulator-side duty/threshold searches. Formula-generated PWL integrations are isolated as analytical identities and never contribute to topology loss or efficiency gates.",
    tolerances: TOLERANCES,
    topologyCases,
    thresholdChecks: REQUESTED_CASE ? [] : buildThresholdChecks(workDir),
    analyticalIdentityChecks: REQUESTED_CASE ? [] : buildAnalyticalIdentityChecks(workDir)
  };
}

const workDir = mkdtempSync(join(tmpdir(), "buck-loss-spice-v21-"));
try {
  const version = simulatorVersion();
  if (version !== REQUIRED_NGSPICE_VERSION) {
    throw new Error(`SPICE goldens require ngspice-${REQUIRED_NGSPICE_VERSION}; found ngspice-${version}`);
  }
  const payload = payloadFor(version, workDir);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (REQUESTED_CASE) {
    process.stdout.write(serialized);
  } else if (CHECK_MODE) {
    const committed = readFileSync(OUTPUT_PATH, "utf8");
    if (committed !== serialized) throw new Error(`SPICE fixture is stale; run npm run data:buck-loss:spice:regenerate`);
    process.stdout.write(`Verified ${OUTPUT_PATH}\n`);
  } else if (WRITE_MODE) {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, serialized);
    process.stdout.write(`Wrote ${OUTPUT_PATH}\n`);
  }
} finally {
  if (process.env.KEEP_SPICE_WORK === "1") process.stderr.write(`Kept ${workDir}\n`);
  else rmSync(workDir, { recursive: true, force: true });
}
