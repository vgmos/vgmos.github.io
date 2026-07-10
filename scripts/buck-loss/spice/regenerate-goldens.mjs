#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyBuckLossDeviceTemplateV2 } from "../../../js/tools/buck-loss-device-templates-v2.js";
import { normalizeBuckLossInputsV2, rawDefaultsV2 } from "../../../js/tools/buck-loss-schema-v2.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const OUTPUT_PATH = join(REPO_ROOT, "tests/fixtures/buck-loss-spice-golden.v2.json");
const REQUIRED_NGSPICE_VERSION = "46";
const FIXTURE_REVISION = "2026-07-10";

const CASES = Object.freeze([
  Object.freeze({
    id: "epc2090-12v-3v3-2a-ccm",
    templateId: "epc2090",
    loadA: 2,
    expectedMode: "ccm",
    raw: Object.freeze({
      vin: 12,
      vout: 3.3,
      ioutMax: 3,
      fsw: 1000,
      inductance: 2.2,
      deadTime: 20,
      dcr: 20,
      rac: 20,
      inductorAcManual: 0,
      inputEsr: 0,
      esr: 0,
      iq: 0,
      vBias: 12
    })
  }),
  Object.freeze({
    id: "silicon30-12v-3v3-2a-ccm",
    templateId: "silicon-30v",
    loadA: 2,
    expectedMode: "ccm",
    raw: Object.freeze({
      vin: 12,
      vout: 3.3,
      ioutMax: 3,
      fsw: 1000,
      inductance: 2.2,
      deadTime: 20,
      dcr: 20,
      rac: 20,
      inductorAcManual: 0,
      inputEsr: 0,
      esr: 0,
      iq: 0,
      vBias: 12
    })
  }),
  Object.freeze({
    id: "epc2090-12v-3v3-50ma-dcm",
    templateId: "epc2090",
    loadA: 0.05,
    expectedMode: "dcm",
    raw: Object.freeze({
      vin: 12,
      vout: 3.3,
      ioutMax: 3,
      fsw: 1000,
      inductance: 2.2,
      deadTime: 0,
      dcr: 0,
      rac: 0,
      inductorAcManual: 0,
      inputEsr: 0,
      esr: 0,
      iq: 0,
      vBias: 12
    })
  })
]);

const requestedCase = process.env.SPICE_CASE ?? null;
const selectedCases = requestedCase ? CASES.filter((item) => item.id === requestedCase) : CASES;
if (!selectedCases.length) throw new Error(`Unknown SPICE_CASE: ${requestedCase}`);

function format(value) {
  if (!Number.isFinite(value)) throw new TypeError(`Non-finite SPICE parameter: ${value}`);
  return Number(value).toExponential(12);
}

function netlistFor(config, inputs, duty, workDir) {
  const period = 1 / inputs.fsw;
  const tOn = duty * period;
  const lowDelay = tOn + inputs.deadTime;
  const lowWidth = Math.max(1e-12, period - tOn - 2 * inputs.deadTime);
  const cycles = config.expectedMode === "dcm" ? 420 : 240;
  const sampleCycles = 60;
  const stop = cycles * period;
  const sampleStart = (cycles - sampleCycles) * period;
  const loadResistance = inputs.vout / config.loadA;
  const cap = config.expectedMode === "dcm" ? 220e-6 : 20e-6;
  const lowSidePath = config.expectedMode === "dcm"
    ? `* Ideal-diode emulation: the low path conducts forward only and opens at zero current.
VLSENSE 0 ls 0
RLOW ls lsd ${format(inputs.rdsLow)}
DLOW lsd sw DIDEAL`
    : `SLOW sw ls lcmd 0 SLSW
VLSENSE ls 0 0`;
  const reversePath = config.expectedMode === "dcm"
    ? `* Dead-time reverse-path loss is covered by the CCM fixtures.
VREV 0 rev ${format(inputs.diodeVf)}
RREV rev 0 1e12`
    : `VREV 0 rev ${format(inputs.diodeVf)}
DREV rev sw DREVPATH`;
  return `* Buck-loss v2 independent steady-state fixture: ${config.id}
.option method=gear reltol=1e-6 abstol=1e-10 vntol=1e-8
.param T=${format(period)} TON=${format(tOn)} TLOWD=${format(lowDelay)} TLOWW=${format(lowWidth)}
VINPUT vin 0 ${format(inputs.vin)}
VHSENSE vin hs 0
SHIGH hs sw gh 0 SHSW
${lowSidePath}
${reversePath}
VGH gh 0 PULSE(0 5 0 1p 1p {TON} {T})
VLCMD lcmd 0 PULSE(0 5 {TLOWD} 1p 1p {TLOWW} {T})
LBUCK sw lx ${format(inputs.inductance)} IC=${format(config.expectedMode === "ccm" ? config.loadA : 0)}
RDCR lx out ${format(inputs.dcr)}
COUT out 0 ${format(cap)} IC=${format(inputs.vout)}
RLOAD out 0 ${format(loadResistance)}
.model SHSW SW(Ron=${format(inputs.rdsHigh)} Roff=1e10 Vt=2.5 Vh=0.1)
.model SLSW SW(Ron=${format(inputs.rdsLow)} Roff=1e10 Vt=2.5 Vh=0.1)
.model DREVPATH D(Is=1e-3 N=0.02 Rs=1e-6 Cjo=0)
.model DIDEAL D(Is=1e-6 N=0.05 Rs=1e-3 Cjo=1p)
.tran ${format(period / 250)} ${format(stop)} 0 ${format(period / 80)} UIC
.meas tran vout_avg AVG V(out) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran il_avg AVG I(LBUCK) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran il_rms RMS I(LBUCK) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ihs_rms RMS I(VHSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ils_rms RMS I(VLSENSE) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran high_duty AVG V(gh)/5 FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran low_duty AVG V(lcmd)/5 FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran dead_i_avg AVG I(VREV) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran i_peak MAX I(LBUCK) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran i_valley MIN I(LBUCK) FROM=${format(sampleStart)} TO=${format(stop)}
.save V(out) I(LBUCK) I(VHSENSE) I(VLSENSE) I(VREV) V(gh) V(lcmd)
.end
`;
}

function parseMeasurements(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z0-9_]*)\s*=\s*([-+0-9.eE]+)/i);
    if (match) values[match[1].toLowerCase()] = Number(match[2]);
  }
  return values;
}

function runNetlist(config, netlist, workDir) {
  const netlistPath = join(workDir, `${config.id}.cir`);
  const logPath = join(workDir, `${config.id}.log`);
  writeFileSync(netlistPath, netlist);
  try {
    execFileSync("ngspice", ["-b", "-o", logPath, netlistPath], {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const log = readFileSync(logPath, "utf8");
    throw new Error(`ngspice failed for ${config.id}:\n${log}`, { cause: error });
  }
  return parseMeasurements(readFileSync(logPath, "utf8"));
}

function runNgspice(config, inputs, duty, workDir) {
  const measurements = runNetlist(config, netlistFor(config, inputs, duty, workDir), workDir);
  if (!Number.isFinite(measurements.vout_avg)) {
    throw new Error(`ngspice did not report vout_avg for ${config.id}`);
  }
  return measurements;
}

function pwl(values) {
  return values.map(([time, value]) => `${format(time)} ${format(value)}`).join(" ");
}

function dcmReferenceNetlist(config, inputs) {
  const period = 1 / inputs.fsw;
  const slopeUp = (inputs.vin - inputs.vout) / inputs.inductance;
  const slopeDown = inputs.vout / inputs.inductance;
  const peak = Math.sqrt(config.loadA * period / (0.5 * (1 / slopeUp + 1 / slopeDown)));
  const tHigh = peak / slopeUp;
  const tLow = peak / slopeDown;
  const active = tHigh + tLow;
  if (!(active < period)) throw new Error(`${config.id} is not an ideal DCM reference point`);
  const cycles = 32;
  const edge = period * 1e-6;
  const inductor = [];
  const highSide = [];
  const lowSide = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const start = cycle * period;
    const highEnd = start + tHigh;
    const activeEnd = start + active;
    const end = (cycle + 1) * period;
    if (cycle === 0) {
      inductor.push([start, 0]);
      highSide.push([start, 0]);
      lowSide.push([start, 0]);
    }
    inductor.push([highEnd, peak], [activeEnd, 0], [end, 0]);
    highSide.push([highEnd, peak], [highEnd + edge, 0], [end, 0]);
    lowSide.push([Math.max(start, highEnd - edge), 0], [highEnd, peak], [activeEnd, 0], [end, 0]);
  }
  const sampleStart = 2 * period;
  const stop = cycles * period;
  return {
    netlist: `* Buck-loss v2 independent ideal DCM PWL reference: ${config.id}
IIND il 0 PWL(${pwl(inductor)})
IHS ih 0 PWL(${pwl(highSide)})
ILS ils 0 PWL(${pwl(lowSide)})
RIND il 0 1
RHS ih 0 1
RLS ils 0 1
.tran ${format(period / 500)} ${format(stop)}
.meas tran il_avg AVG V(il) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran il_rms RMS V(il) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ihs_rms RMS V(ih) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran ils_rms RMS V(ils) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran i_peak MAX V(il) FROM=${format(sampleStart)} TO=${format(stop)}
.meas tran i_valley MIN V(il) FROM=${format(sampleStart)} TO=${format(stop)}
.end
`,
    duty: tHigh / period,
    lowDuty: tLow / period
  };
}

function solveDuty(config, inputs, workDir) {
  let low = 0.02;
  let high = Math.min(0.95, 1 - 2 * inputs.deadTime * inputs.fsw - 0.002);
  let best = null;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const duty = (low + high) / 2;
    const measurements = runNgspice(config, inputs, duty, workDir);
    const error = measurements.vout_avg - inputs.vout;
    if (!best || Math.abs(error) < Math.abs(best.error)) best = { duty, error, measurements };
    if (error > 0) high = duty;
    else low = duty;
  }
  if (!best || Math.abs(best.error) > inputs.vout * 2e-4) {
    throw new Error(`Duty solve failed for ${config.id}: ${best?.error}`);
  }
  return best;
}

function simulatorVersion() {
  const output = execFileSync("ngspice", ["-v"], { encoding: "utf8" });
  return output.match(/ngspice-(\d+(?:\.\d+)?)/i)?.[1] ?? "unknown";
}

function buildFixture(config, workDir) {
  const templated = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...config.raw }, config.templateId);
  const { inputs } = normalizeBuckLossInputsV2(templated.rawInputs);
  if (config.expectedMode === "dcm") return buildDcmReferenceFixture(config, inputs, workDir);
  const solved = solveDuty(config, inputs, workDir);
  const measured = solved.measurements;
  const deadCurrentAverage = Math.abs(measured.dead_i_avg);
  const losses = {
    highSideConduction: measured.ihs_rms ** 2 * inputs.rdsHigh,
    lowSideConduction: measured.ils_rms ** 2 * inputs.rdsLow,
    inductorCopperTotal: measured.il_rms ** 2 * inputs.dcr,
    deadTimeConduction: deadCurrentAverage * inputs.diodeVf
  };
  const aggregateStaticLoss = Object.values(losses).reduce((sum, value) => sum + value, 0);
  const pOut = inputs.vout * config.loadA;
  return {
    id: config.id,
    expectedMode: config.expectedMode,
    deviceTemplate: config.templateId,
    inputs: {
      ...config.raw,
      loadA: config.loadA
    },
    simulation: {
      dutyCommand: solved.duty,
      dutyMeasured: measured.high_duty,
      lowSideDutyMeasured: measured.low_duty,
      voutAverage: measured.vout_avg,
      inductorAverage: measured.il_avg,
      inductorRms: measured.il_rms,
      highSideRms: measured.ihs_rms,
      lowSideRms: measured.ils_rms,
      deadTimeCurrentAverage: deadCurrentAverage,
      peakCurrent: measured.i_peak,
      valleyCurrent: measured.i_valley,
      losses,
      aggregateStaticLoss,
      efficiencyStatic: pOut / (pOut + aggregateStaticLoss)
    }
  };
}

function buildDcmReferenceFixture(config, inputs, workDir) {
  const reference = dcmReferenceNetlist(config, inputs);
  const measured = runNetlist(config, reference.netlist, workDir);
  const losses = {
    highSideConduction: measured.ihs_rms ** 2 * inputs.rdsHigh,
    lowSideConduction: measured.ils_rms ** 2 * inputs.rdsLow,
    inductorCopperTotal: measured.il_rms ** 2 * inputs.dcr,
    deadTimeConduction: 0
  };
  const aggregateStaticLoss = Object.values(losses).reduce((sum, value) => sum + value, 0);
  const pOut = inputs.vout * config.loadA;
  return {
    id: config.id,
    expectedMode: config.expectedMode,
    deviceTemplate: config.templateId,
    method: "ideal-dcm-pwl-transient",
    inputs: { ...config.raw, loadA: config.loadA },
    simulation: {
      dutyCommand: reference.duty,
      dutyMeasured: reference.duty,
      lowSideDutyMeasured: reference.lowDuty,
      voutAverage: inputs.vout,
      inductorAverage: Math.abs(measured.il_avg),
      inductorRms: Math.abs(measured.il_rms),
      highSideRms: Math.abs(measured.ihs_rms),
      lowSideRms: Math.abs(measured.ils_rms),
      deadTimeCurrentAverage: 0,
      peakCurrent: Math.abs(measured.i_valley),
      valleyCurrent: Math.abs(measured.i_peak),
      losses,
      aggregateStaticLoss,
      efficiencyStatic: pOut / (pOut + aggregateStaticLoss)
    }
  };
}

function phaseProfile(durationA, durationB, peakPower, direction, steps = 64) {
  const values = [];
  if (direction === "on") {
    for (let index = 0; index <= steps; index += 1) {
      const x = index / steps;
      values.push([durationA * x, peakPower * x * x]);
    }
    for (let index = 1; index <= steps; index += 1) {
      const x = index / steps;
      values.push([durationA + durationB * x, peakPower * (1 - x)]);
    }
  } else {
    for (let index = 0; index <= steps; index += 1) {
      const x = index / steps;
      values.push([durationA * x, peakPower * x]);
    }
    for (let index = 1; index <= steps; index += 1) {
      const x = index / steps;
      values.push([durationA + durationB * x, peakPower * (1 - x) ** 2]);
    }
  }
  return values;
}

function buildSwitchingReferenceFixture(config, staticFixture, workDir) {
  const templated = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...config.raw }, config.templateId);
  const { inputs } = normalizeBuckLossInputsV2(templated.rawInputs);
  const turnOnCurrent = staticFixture.simulation.valleyCurrent;
  const turnOffCurrent = staticFixture.simulation.peakCurrent;
  const vSwing = inputs.vin + inputs.diodeVf;
  const gateCurrentOn = (inputs.vDrive - inputs.plateauHigh) / inputs.gateResistanceOnHigh;
  const gateCurrentOff = inputs.plateauHigh / inputs.gateResistanceOffHigh;
  const currentRise = inputs.qgs2High / gateCurrentOn;
  const voltageFall = inputs.qgdHigh / gateCurrentOn;
  const voltageRise = inputs.qgdHigh / gateCurrentOff;
  const currentFall = inputs.qgs2High / gateCurrentOff;
  const onProfile = phaseProfile(currentRise, voltageFall, vSwing * turnOnCurrent, "on");
  const offProfile = phaseProfile(voltageRise, currentFall, vSwing * turnOffCurrent, "off");
  const scaledQrr = inputs.qrrRef * turnOnCurrent / inputs.qrrRefCurrent;
  const recoveryDuration = 20e-9;
  const recoveryPeakPower = scaledQrr > 0 ? 2 * vSwing * scaledQrr / recoveryDuration : 0;
  const recoveryProfile = [[0, 0], [recoveryDuration / 2, recoveryPeakPower], [recoveryDuration, 0]];
  const stop = Math.max(
    onProfile.at(-1)[0],
    offProfile.at(-1)[0],
    recoveryDuration
  ) * 1.05;
  const measurements = runNetlist(config, `* Buck-loss v2 switching-phase integration reference: ${config.id}
VPON pon 0 PWL(${pwl(onProfile)})
VPOFF poff 0 PWL(${pwl(offProfile)})
VPQRR pqrr 0 PWL(${pwl(recoveryProfile)})
RPON pon 0 1G
RPOFF poff 0 1G
RPQRR pqrr 0 1G
.tran ${format(stop / 2000)} ${format(stop)}
.meas tran e_on INTEG V(pon) FROM=0 TO=${format(stop)}
.meas tran e_off INTEG V(poff) FROM=0 TO=${format(stop)}
.meas tran e_qrr INTEG V(pqrr) FROM=0 TO=${format(stop)}
.end
`, workDir);
  const powers = {
    turnOnOverlap: measurements.e_on * inputs.fsw,
    turnOffOverlap: measurements.e_off * inputs.fsw,
    reverseRecovery: measurements.e_qrr * inputs.fsw
  };
  return {
    id: `${config.id}-switching-phases`,
    method: "textbook-phase-pwl-integration",
    expectedMode: "ccm",
    deviceTemplate: config.templateId,
    inputs: { ...config.raw, loadA: config.loadA },
    referenceCurrents: { turnOnCurrent, turnOffCurrent },
    phaseDurations: { currentRise, voltageFall, voltageRise, currentFall, recoveryDuration },
    simulation: {
      energies: {
        turnOnOverlap: measurements.e_on,
        turnOffOverlap: measurements.e_off,
        reverseRecovery: measurements.e_qrr
      },
      powers,
      aggregateSwitchingRecovery: Object.values(powers).reduce((sum, value) => sum + value, 0)
    }
  };
}

const workDir = mkdtempSync(join(tmpdir(), "buck-loss-spice-"));
try {
  const ngspiceVersion = simulatorVersion();
  if (ngspiceVersion !== REQUIRED_NGSPICE_VERSION) {
    throw new Error(`SPICE goldens require ngspice-${REQUIRED_NGSPICE_VERSION}; found ngspice-${ngspiceVersion}`);
  }
  const staticCases = selectedCases.map((config) => buildFixture(config, workDir));
  const siliconConfig = selectedCases.find((config) => config.id === "silicon30-12v-3v3-2a-ccm");
  const siliconStatic = staticCases.find((item) => item.id === siliconConfig?.id);
  const switchingReferences = siliconConfig && siliconStatic
    ? [buildSwitchingReferenceFixture(siliconConfig, siliconStatic, workDir)]
    : [];
  const payload = {
    schemaVersion: 2,
    generatedBy: `ngspice-${ngspiceVersion}`,
    fixtureRevision: FIXTURE_REVISION,
    reviewStatus: "reviewed",
    reviewNotes: "Checked for steady-state convergence, nonnegative DCM current, expected CCM/DCM classification, and agreement with the declared acceptance tolerances.",
    methodology: "CCM cases are closed-loop-by-search fixed-frequency transient buck simulations with independently solved PWM duty. The DCM case is a SPICE-integrated ideal triangular PWL reference with a zero-current interval. Switching overlap, Qrr, gate-drive, EOSS, capacitor ESR, core residual, and controller bias are intentionally outside these static waveform fixtures.",
    tolerances: {
      waveformRelative: 0.03,
      staticLossRelative: 0.03,
      aggregateStaticRelative: 0.08,
      efficiencyAbsolute: 0.01
    },
    cases: staticCases,
    switchingReferences
  };
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`Wrote ${OUTPUT_PATH}\n`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
