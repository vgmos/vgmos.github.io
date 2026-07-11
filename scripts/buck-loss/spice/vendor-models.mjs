#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const LOCK_PATH = join(SCRIPT_DIR, "vendor-models.lock.json");
const CACHE_ROOT = join(REPO_ROOT, ".cache/buck-loss/vendor-models");
const command = process.argv[2] ?? "verify";
const requestedId = valueAfter("--id") ?? "infineon-bsc010n04ls6-280225";
const archiveOverride = valueAfter("--archive");

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function format(value) {
  if (!Number.isFinite(value)) throw new TypeError(`Non-finite vendor-model parameter: ${value}`);
  return Number(value).toExponential(12);
}

function relativeDelta(measured, published) {
  return Math.abs(measured - published) / Math.max(Math.abs(published), 1e-30);
}

function publishedComparison(measured, typical, maximum, acceptance = {}) {
  const typicalRelativeDelta = relativeDelta(measured, typical);
  const withinTypicalPolicy = typicalRelativeDelta <= acceptance.typicalRelativeLimit;
  const atOrBelowPublishedMaximum = maximum == null ? null : measured <= maximum;
  const passed = withinTypicalPolicy
    && (!acceptance.requireAtOrBelowPublishedMaximum || atOrBelowPublishedMaximum === true);
  return {
    measured,
    publishedTypical: typical,
    publishedMaximum: maximum ?? null,
    typicalRelativeDelta,
    typicalRelativeLimit: acceptance.typicalRelativeLimit,
    atOrBelowPublishedMaximum,
    passed
  };
}

function assertPublishedContracts() {
  if (lock.schemaVersion !== 2) throw new Error(`Unsupported vendor lock schema ${lock.schemaVersion}`);
  const contracts = model.publishedConditionContracts;
  if (!contracts || !Array.isArray(model.strictRequiredCoverage)) {
    throw new Error(`Missing immutable published-condition or strict-coverage contract for ${model.id}`);
  }
  if (!model.datasheet?.url || !model.datasheet?.revision || !model.datasheet?.publicationDate) {
    throw new Error(`Incomplete datasheet identity for ${model.id}`);
  }
  if (!Array.isArray(contracts.rdsOn) || contracts.rdsOn.length === 0) {
    throw new Error(`At least one RDS(on) published-condition contract is required for ${model.id}`);
  }
}

function parseMeasurements(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const at = match[2].match(/\bat\s*(?:=\s*)?([-+0-9.eE]+)\s*$/i);
    const scalar = match[2].match(/=\s*([-+0-9.eE]+)/);
    const value = name.endsWith("_time") ? at?.[1] : scalar?.[1];
    if (value != null) values[name] = Number(value);
  }
  return values;
}

const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
const model = lock.models.find((entry) => entry.id === requestedId);
if (!model) throw new Error(`Unknown vendor model: ${requestedId}`);
const REPORT_PATH = join(REPO_ROOT, `tests/fixtures/buck-loss-vendor-${model.id}.v2.json`);
const modelCache = join(CACHE_ROOT, model.id);
const archivePath = join(modelCache, model.archiveFilename);
const modelPath = join(modelCache, model.modelFilename);
let simulationModelPath = modelPath;

async function acquire() {
  mkdirSync(modelCache, { recursive: true });
  let archive;
  if (archiveOverride) archive = readFileSync(resolve(archiveOverride));
  else {
    const response = await fetch(model.downloadUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Unable to download ${model.downloadUrl}: HTTP ${response.status}. Download it in a browser, then rerun with --id ${model.id} --archive /path/to/${model.archiveFilename}.`);
    }
    archive = Buffer.from(await response.arrayBuffer());
  }
  if (sha256(archive) !== model.archiveSha256) throw new Error(`Archive hash mismatch for ${model.id}`);
  writeFileSync(archivePath, archive);
  const listing = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const entry = listing.find((name) => basename(name).toLowerCase() === model.modelFilename.toLowerCase());
  if (!entry) throw new Error(`${model.modelFilename} is missing from the archive`);
  const source = execFileSync("unzip", ["-p", archivePath, entry], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
  if (sha256(source) !== model.modelSha256) throw new Error(`Model hash mismatch for ${model.id}`);
  writeFileSync(modelPath, source);
  process.stdout.write(`Cached hash-verified ${model.id} at ${modelCache}\n`);
}

function validateSource() {
  if (!existsSync(archivePath) || !existsSync(modelPath)) {
    throw new Error(`Missing local ${model.id}; run npm run data:buck-loss:spice:vendor:acquire`);
  }
  const archiveHash = sha256(readFileSync(archivePath));
  const source = readFileSync(modelPath);
  const sourceHash = sha256(source);
  if (archiveHash !== model.archiveSha256) throw new Error(`Archive hash mismatch for ${model.id}`);
  if (sourceHash !== model.modelSha256) throw new Error(`Model hash mismatch for ${model.id}`);
  const validateSubcircuit = (contract) => {
    const declaration = source.toString("utf8").match(new RegExp(`^\\.subckt\\s+${contract.name}\\s+([^\\r\\n]+)`, "im"));
    if (!declaration) throw new Error(`Missing .SUBCKT ${contract.name}`);
    const pins = declaration[1].trim().split(/\s+/).slice(0, contract.pins.length).map((pin) => pin.toLowerCase());
    if (pins.join(" ") !== contract.pins.join(" ").toLowerCase()) {
      throw new Error(`Subcircuit pin contract mismatch: ${declaration[0]}`);
    }
  };
  validateSubcircuit(model.subcircuit);
  if (model.fallbackSubcircuit) validateSubcircuit(model.fallbackSubcircuit);
  return { archiveHash, sourceHash };
}

function prepareSimulationModel() {
  if (model.adapter.kind === "identity") return { path: modelPath, adaptedSha256: model.modelSha256 };
  if (model.adapter.kind !== "comment-known-header-line") throw new Error(`Unsupported adapter: ${model.adapter.kind}`);
  const source = readFileSync(modelPath, "utf8");
  const pattern = /^([ \t]+Updated EPC2307 from preliminary version[ \t\r]*)$/m;
  if (!pattern.test(source)) throw new Error(`Expected EPC header continuation is missing; refusing to adapt a different source`);
  const adapted = source.replace(pattern, "*$1");
  const adaptedPath = join(modelCache, `${model.modelFilename}.adapter-r${model.adapter.revision}.lib`);
  writeFileSync(adaptedPath, adapted);
  return { path: adaptedPath, adaptedSha256: sha256(Buffer.from(adapted)) };
}

function simulatorVersion() {
  const infoPath = "/Applications/LTspice.app/Contents/Info.plist";
  const output = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", infoPath], { encoding: "utf8" });
  return output.trim();
}

let serial = 0;
function runNetlist(id, body, workDir) {
  serial += 1;
  const netlist = `* ${model.manufacturer} ${model.partNumber} LTspice characterization-only check: ${id}\n.include ${JSON.stringify(simulationModelPath)}\n${model.requiredDirectives.join("\n")}\n${body}`;
  const stem = `${id}-${serial}`.replace(/[^a-z0-9_.-]/gi, "-");
  const circuitPath = join(workDir, `${stem}.cir`);
  const logPath = circuitPath.slice(0, -extname(circuitPath).length) + ".log";
  writeFileSync(circuitPath, netlist);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    try {
      execFileSync(model.simulator.darwinExecutable, [...model.simulator.args, circuitPath], {
        cwd: workDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2 && !existsSync(logPath)) continue;
      const log = existsSync(logPath) ? decodeLtspiceLog(readFileSync(logPath)) : "LTspice did not create a log";
      throw new Error(`Vendor-model simulation failed for ${id}:\n${log}`, { cause: error });
    }
  }
  if (lastError) throw lastError;
  if (!existsSync(logPath)) throw new Error(`LTspice did not create ${logPath}`);
  const log = decodeLtspiceLog(readFileSync(logPath));
  const measurements = parseMeasurements(log);
  const expectedMeasurements = [...body.matchAll(/^\.meas\s+\w+\s+([a-z][a-z0-9_]*)/gim)].map((match) => match[1].toLowerCase());
  const missing = expectedMeasurements.filter((name) => !Number.isFinite(measurements[name]));
  if (missing.length) throw new Error(`LTspice omitted measurements for ${id}: ${missing.join(", ")}\n${log}`);
  if (!Object.values(measurements).every(Number.isFinite)) throw new Error(`Non-finite measurement for ${id}`);
  return { netlist, measurements };
}

function decodeLtspiceLog(buffer) {
  let nulCount = 0;
  for (let index = 1; index < Math.min(buffer.length, 512); index += 2) {
    if (buffer[index] === 0) nulCount += 1;
  }
  return nulCount > 8 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

function deviceInstance(name, nodes, contract = model.subcircuit) {
  const ordered = contract.pins.map((pin) => {
    const normalized = pin.toLowerCase();
    const node = nodes[normalized] ?? nodes[normalized.replace(/in$/, "")];
    if (!node) throw new Error(`No node mapping for ${pin} on ${contract.name}`);
    return node;
  });
  return `${name} ${ordered.join(" ")} ${contract.name}`;
}

function staticCharacterization(workDir) {
  const results = {};
  for (const contract of model.publishedConditionContracts.rdsOn) {
    const { junctionTemperatureC, gateSourceVoltageV, drainCurrentA } = contract.conditions;
    const body = (maxStepS) => `.temp ${junctionTemperatureC}
.option method=gear
VGS g 0 PWL(0 0 10n ${format(gateSourceVoltageV)})
ITEST 0 d PWL(0 0 20n 0 30n ${format(drainCurrentA)})
${deviceInstance("XQ", { drain: "d", gate: "g", source: "0" })}
.tran ${format(maxStepS)} 120n 0 ${format(maxStepS)}
.meas tran vds_avg AVG V(d) FROM=70n TO=120n
.meas tran drain_current_avg AVG I(ITEST) FROM=70n TO=120n
.end
`;
    const baseline = runNetlist(`${contract.id}-baseline`, body(1e-9), workDir);
    const repeated = runNetlist(`${contract.id}-repeat`, body(1e-9), workDir);
    const refined = runNetlist(`${contract.id}-half-step`, body(0.5e-9), workDir);
    const summarize = (run) => ({
      netlistSha256: sha256(run.netlist),
      measuredDrainSourceVoltageV: Math.abs(run.measurements.vds_avg),
      measuredDrainCurrentA: Math.abs(run.measurements.drain_current_avg),
      measuredRdsOnOhm: Math.abs(run.measurements.vds_avg) / Math.abs(run.measurements.drain_current_avg)
    });
    const baselineResult = summarize(baseline);
    const repeatedResult = summarize(repeated);
    const refinedResult = summarize(refined);
    results[contract.id] = {
      contract,
      fixture: "forced-current-static-on-state",
      ...baselineResult,
      convergence: {
        baselineMaxStepS: 1e-9,
        refinedMaxStepS: 0.5e-9,
        repeat: repeatedResult,
        refined: refinedResult,
        repeatRelativeDelta: relativeDelta(baselineResult.measuredRdsOnOhm, repeatedResult.measuredRdsOnOhm),
        halfStepRelativeDelta: relativeDelta(baselineResult.measuredRdsOnOhm, refinedResult.measuredRdsOnOhm)
      },
      comparison: publishedComparison(
        baselineResult.measuredRdsOnOhm,
        contract.published.typicalOhm,
        contract.published.maximumOhm,
        contract.acceptance
      )
    };
  }
  return {
    status: "published-condition-compared",
    method: "Force the published drain current and divide the steady-state drain-source voltage by measured current.",
    sampleWindowS: [70e-9, 120e-9],
    cases: results,
    allComparisonsPassed: Object.values(results).every((entry) => entry.comparison.passed)
  };
}

function gateChargeFixture(contract, id, maxStepS, workDir) {
  const { junctionTemperatureC, drainSupplyV, drainCurrentA, gateVoltageRangeV } = contract.conditions;
  const gateTargetV = gateVoltageRangeV[1];
  const gateCurrentA = model.manufacturer === "Infineon" ? 0.05 : 0.01;
  const chargeStartS = 50e-9;
  const stopS = 3e-6;
  const gateClampMarginV = 0.02;
  const run = runNetlist(id, `.temp ${junctionTemperatureC}
VDD vdd 0 ${format(drainSupplyV)}
IDRAIN vdd d ${format(drainCurrentA)}
DCLAMP d vdd DCLAMP
.model DCLAMP D(Is=1e-12 N=1 Rs=1m Cjo=0)
BGATE 0 g I=if(time<${format(chargeStartS)},0,${format(gateCurrentA)}*limit((${format(gateTargetV + gateClampMarginV)}-V(g))/${format(gateClampMarginV)},0,1))
${deviceInstance("XQ", { drain: "d", gate: "g", source: "0" })}
.ic V(d)=${format(drainSupplyV)} V(g)=0
.tran ${format(maxStepS)} ${format(stopS)} 0 ${format(maxStepS)} UIC
.meas tran gate_target_time WHEN V(g)=${format(gateTargetV)} TD=${format(chargeStartS)} RISE=1
.meas tran drain_fall_start_time WHEN V(d)=${format(drainSupplyV * 0.99)} FALL=1
.meas tran drain_fall_end_time WHEN V(d)=${format(drainSupplyV * 0.01)} FALL=1
.meas tran drain_current_avg AVG I(IDRAIN) FROM=${format(chargeStartS)} TO=${format(stopS)}
.meas tran gate_voltage_final FIND V(g) AT=${format(stopS)}
.meas tran drain_voltage_final FIND V(d) AT=${format(stopS)}
.end
`, workDir);
  const measured = run.measurements;
  if (!(measured.gate_target_time > chargeStartS && measured.gate_target_time <= stopS)) {
    throw new Error(`Gate-target event is outside the driven charge window for ${id}`);
  }
  if (!(measured.drain_fall_start_time > chargeStartS
    && measured.drain_fall_end_time > measured.drain_fall_start_time
    && measured.drain_fall_end_time <= stopS)) {
    throw new Error(`Drain-transition events are outside the driven charge window for ${id}`);
  }
  const finalGateVoltageLimitV = Math.min(
    gateTargetV * (1 + model.characterization.gateChargeFinalVoltageRelativeLimit),
    model.characterization.gateAbsoluteMaximumV
  );
  if (!(measured.gate_voltage_final >= gateTargetV
    && measured.gate_voltage_final <= finalGateVoltageLimitV
    && measured.gate_voltage_final <= model.characterization.gateAbsoluteMaximumV)) {
    throw new Error(`Final gate voltage is outside the bounded target/absolute-maximum contract for ${id}`);
  }
  return {
    netlistSha256: sha256(run.netlist),
    measurements: measured,
    gateCurrentA,
    chargeStartS,
    gateClampMarginV,
    gateAbsoluteMaximumV: model.characterization.gateAbsoluteMaximumV,
    finalGateVoltageLimitV,
    totalGateChargeC: gateCurrentA * (measured.gate_target_time - chargeStartS),
    gateSourceChargeProxyC: gateCurrentA * (measured.drain_fall_start_time - chargeStartS),
    gateDrainChargeProxyC: gateCurrentA * (measured.drain_fall_end_time - measured.drain_fall_start_time)
  };
}

function gateChargeCharacterization(workDir) {
  const totalContract = model.publishedConditionContracts.totalGateCharge;
  const partitionContract = model.publishedConditionContracts.partitionedGateCharge;
  const runSet = (contract, stem) => {
    const coarse = gateChargeFixture(contract, `${stem}-coarse`, 1e-9, workDir);
    const baseline = gateChargeFixture(contract, `${stem}-baseline`, 0.5e-9, workDir);
    const repeated = gateChargeFixture(contract, `${stem}-repeat`, 0.5e-9, workDir);
    const quantities = ["totalGateChargeC", "gateSourceChargeProxyC", "gateDrainChargeProxyC"];
    const maxDelta = (left, right) => Math.max(...quantities.map((key) => relativeDelta(left[key], right[key])));
    const coarseRelativeDeltas = Object.fromEntries(
      quantities.map((key) => [key, relativeDelta(coarse[key], baseline[key])])
    );
    let refined = null;
    let halfStep = null;
    try {
      refined = gateChargeFixture(contract, `${stem}-half-step`, 0.25e-9, workDir);
      const relativeDeltas = Object.fromEntries(
        quantities.map((key) => [key, relativeDelta(baseline[key], refined[key])])
      );
      halfStep = {
        status: "completed",
        maxStepS: 0.25e-9,
        refined,
        relativeDeltas,
        maxRelativeDelta: Math.max(...Object.values(relativeDeltas))
      };
    } catch (error) {
      halfStep = {
        status: "attempted-not-completed",
        maxStepS: 0.25e-9,
        reason: "Native LTspice 17.0.38 did not complete the 0.25 ns gate-charge run; no half-step value is claimed.",
        failureClass: /did not create a log/.test(String(error)) ? "native-simulator-no-log" : "simulation-error"
      };
    }
    return {
      convergenceLadder: {
        coarseMaxStepS: 1e-9,
        acceptedBaselineMaxStepS: 0.5e-9,
        refinedMaxStepS: 0.25e-9,
        coarse,
        coarseToBaselineRelativeDeltas: coarseRelativeDeltas,
        coarseToBaselineMaxRelativeDelta: Math.max(...Object.values(coarseRelativeDeltas))
      },
      baseline,
      repeatMaxRelativeDelta: maxDelta(baseline, repeated),
      halfStep
    };
  };
  const total = runSet(totalContract, "constant-current-total-gate-charge");
  const partition = runSet(partitionContract, "constant-current-partitioned-gate-charge");
  const totalComparison = publishedComparison(
    total.baseline.totalGateChargeC,
    totalContract.published.typicalC,
    totalContract.published.maximumC,
    totalContract.acceptance
  );
  const partitionTotalComparison = publishedComparison(
    partition.baseline.totalGateChargeC,
    partitionContract.published.totalGateChargeC,
    partitionContract.published.totalGateChargeMaximumC,
    partitionContract.acceptance
  );
  return {
    fixture: "constant-gate-current-clamped-drain",
    fixtureNote: "Total QG uses the published VDS, ID, VGS and temperature. Gate current is constant through the target crossing, then tapers to zero over a 20 mV clamp margin; final VGS is asserted below both the selected tolerance and absolute maximum. QGS/QGD are 99%-to-1% drain-transition extraction proxies; the datasheet does not publish those extraction thresholds, so they are not condition-equivalent badge evidence.",
    total: {
      status: total.halfStep.status === "completed" && total.halfStep.relativeDeltas.totalGateChargeC <= 0.02
        ? "published-condition-compared"
        : total.halfStep.status === "completed"
          ? "published-condition-compared-half-step-unstable"
          : "published-condition-compared-half-step-incomplete",
      contract: totalContract,
      ...total,
      comparison: totalComparison
    },
    partitioned: {
      status: "attempted-proxy-not-published-equivalent",
      contract: partitionContract,
      ...partition,
      comparisons: {
        totalGateCharge: partitionTotalComparison,
        gateSourceChargeProxy: publishedComparison(
          partition.baseline.gateSourceChargeProxyC,
          partitionContract.published.gateSourceChargeC,
          null,
          partitionContract.acceptance
        ),
        gateDrainChargeProxy: publishedComparison(
          partition.baseline.gateDrainChargeProxyC,
          partitionContract.published.gateDrainChargeC,
          partitionContract.published.gateDrainChargeMaximumC,
          partitionContract.acceptance
        )
      },
      badgeAccepted: false,
      reason: "The bounded fixture is reproducible, but its 99%/1% drain-transition thresholds are project-defined proxies rather than the vendor's unpublished QGS/QGD extraction procedure."
    }
  };
}

function reverseRecoveryCharacterization(workDir, outputChargeC) {
  const contract = model.publishedConditionContracts.reverseRecovery;
  if (contract.applicability === "not-applicable") {
    return {
      status: "not-applicable",
      contract,
      reason: contract.reason,
      simulationAttempted: false
    };
  }
  const { junctionTemperatureC, reverseVoltageV, forwardCurrentA, currentFallRateAPerS } = contract.conditions;
  const rampStartS = 50e-9;
  const zeroCrossingS = rampStartS + forwardCurrentA / currentFallRateAPerS;
  const reverseTargetA = 20;
  const rampStopS = zeroCrossingS + reverseTargetA / currentFallRateAPerS;
  const stopS = 300e-9;
  const body = (maxStepS) => `.temp ${junctionTemperatureC}
VCLAMP vclamp 0 ${format(reverseVoltageV)}
DCLAMP d vclamp DCLAMP
.model DCLAMP D(Is=1e-12 N=1 Rs=1m Cjo=0)
VDUT d dint 0
VGATE g 0 0
IFORCE d 0 PWL(0 ${format(forwardCurrentA)} ${format(rampStartS)} ${format(forwardCurrentA)} ${format(zeroCrossingS)} 0 ${format(rampStopS)} ${format(-reverseTargetA)} ${format(stopS)} ${format(-reverseTargetA)})
${deviceInstance("XQ", { drain: "dint", gate: "g", source: "0" })}
BPOSITIVE q 0 V=max(I(VDUT),0)
RQ q 0 1G
.tran ${format(maxStepS)} ${format(stopS)} 0 ${format(maxStepS)} UIC
.meas tran forward_current_avg AVG I(IFORCE) FROM=20n TO=40n
.meas tran commutation_charge INTEG V(q) FROM=${format(zeroCrossingS)} TO=${format(stopS)}
.meas tran peak_reverse_current MAX I(VDUT) FROM=${format(zeroCrossingS)} TO=${format(stopS)}
.meas tran drain_voltage_peak MAX V(dint) FROM=${format(zeroCrossingS)} TO=${format(stopS)}
.end
`;
  let baseline;
  let repeated;
  let refined;
  try {
    baseline = runNetlist("qrr-bounded-ramp-baseline", body(0.5e-9), workDir);
    repeated = runNetlist("qrr-bounded-ramp-repeat", body(0.5e-9), workDir);
    refined = runNetlist("qrr-bounded-ramp-half-step", body(0.25e-9), workDir);
  } catch (error) {
    return {
      status: "attempted-not-completed",
      contract,
      fixture: "forced-current-slope-with-output-charge-subtraction",
      simulationAttempted: true,
      reason: "The bounded Infineon L1 commutation fixture did not complete all baseline/repeat/half-step runs, so no QRR value or comparison is claimed.",
      failureClass: /did not create a log/.test(String(error)) ? "native-simulator-no-log" : "simulation-error"
    };
  }
  const estimatedRecoveryChargeC = Math.max(0, baseline.measurements.commutation_charge - outputChargeC);
  return {
    status: "attempted-bounded-not-published-equivalent",
    contract,
    fixture: "forced-current-slope-with-output-charge-subtraction",
    fixtureNote: "The external current crosses zero at the published dIF/dt and the drain clamps at published VR. The integrated commutation charge also contains nonlinear output charge; subtracting the separate QOSS ramp is an analytical estimate, not the vendor's unpublished double-pulse extraction.",
    netlistSha256: sha256(baseline.netlist),
    baseline: baseline.measurements,
    subtractedOutputChargeC: outputChargeC,
    estimatedRecoveryChargeC,
    analyticalComparison: publishedComparison(
      estimatedRecoveryChargeC,
      contract.published.typicalC,
      contract.published.maximumC,
      contract.acceptance
    ),
    repeatRelativeDelta: relativeDelta(baseline.measurements.commutation_charge, repeated.measurements.commutation_charge),
    halfStepRelativeDelta: relativeDelta(baseline.measurements.commutation_charge, refined.measurements.commutation_charge),
    badgeAccepted: false,
    reason: "The bounded result is reproducible but is not promoted to published-condition QRR validation without the vendor's double-pulse fixture and extraction procedure."
  };
}

function terminalCharacterization(workDir) {
  const reverseContract = model.publishedConditionContracts.sourceDrainForwardVoltage;
  const reverseCurrentA = reverseContract.conditions.reverseCurrentA;
  const reverseBody = (maxStepS) => `.temp ${reverseContract.conditions.junctionTemperatureC}
.option method=gear
VGS g 0 ${format(reverseContract.conditions.gateSourceVoltageV)}
ITEST d 0 PWL(0 0 20n 0 30n ${format(reverseCurrentA)})
${deviceInstance("XQ", { drain: "d", gate: "g", source: "0" })}
.tran ${format(maxStepS)} 120n 0 ${format(maxStepS)}
.meas tran vsd_avg AVG -V(d) FROM=70n TO=120n
.meas tran reverse_current_avg AVG I(ITEST) FROM=70n TO=120n
.end
`;
  const reverse = runNetlist(`${reverseContract.id}-baseline`, reverseBody(1e-9), workDir);
  const reverseRepeated = runNetlist(`${reverseContract.id}-repeat`, reverseBody(1e-9), workDir);
  const reverseRefined = runNetlist(`${reverseContract.id}-half-step`, reverseBody(0.5e-9), workDir);
  const summarizeReverse = (run) => ({
    netlistSha256: sha256(run.netlist),
    sourceDrainVoltageV: Math.abs(run.measurements.vsd_avg),
    measuredReverseCurrentA: Math.abs(run.measurements.reverse_current_avg)
  });
  const reverseResult = summarizeReverse(reverse);
  const reverseRepeatedResult = summarizeReverse(reverseRepeated);
  const reverseRefinedResult = summarizeReverse(reverseRefined);

  const outputContract = model.publishedConditionContracts.outputCharge;
  const outputVoltageV = outputContract.conditions.drainSourceVoltageRangeV[1];
  const rampStartS = 10e-9;
  const rampDurationS = 1e-6;
  const rampStopS = rampStartS + rampDurationS;
  const simulationStopS = rampStopS + 10e-9;
  const simulationStopVoltageV = outputVoltageV * (1 + (simulationStopS - rampStopS) / rampDurationS);
  const outputBody = (maxStepS) => `.temp 25
VGATE g 0 0
VDSRAMP drive 0 PWL(0 0 ${format(rampStartS)} 0 ${format(rampStopS)} ${format(outputVoltageV)} ${format(simulationStopS)} ${format(simulationStopVoltageV)})
VDSENSE drive d 0
${deviceInstance("XQ", { drain: "d", gate: "g", source: "0" })}
BPOWER p 0 V=V(d)*I(VDSENSE)
RPOWER p 0 1G
.tran ${format(maxStepS)} ${format(simulationStopS)} 0 ${format(maxStepS)} UIC
.meas tran qoss INTEG I(VDSENSE) FROM=${format(rampStartS)} TO=${format(rampStopS)}
.meas tran eoss INTEG V(p) FROM=${format(rampStartS)} TO=${format(rampStopS)}
.meas tran vds_final FIND V(d) AT=${format(rampStopS)}
.end
`;
  const outputCharge = runNetlist("output-charge-ramp-baseline", outputBody(1e-9), workDir);
  const outputChargeRepeated = runNetlist("output-charge-ramp-repeat", outputBody(1e-9), workDir);
  const outputChargeRefined = runNetlist("output-charge-ramp-half-step", outputBody(0.5e-9), workDir);
  const summarizeOutput = (run) => ({
    netlistSha256: sha256(run.netlist),
    outputChargeC: Math.abs(run.measurements.qoss),
    outputEnergyJ: Math.abs(run.measurements.eoss),
    finalDrainSourceVoltageV: run.measurements.vds_final
  });
  const outputResult = summarizeOutput(outputCharge);
  const outputRepeatedResult = summarizeOutput(outputChargeRepeated);
  const outputRefinedResult = summarizeOutput(outputChargeRefined);

  const measuredReverseV = reverseResult.sourceDrainVoltageV;
  const measuredOutputChargeC = outputResult.outputChargeC;
  const measuredOutputEnergyJ = outputResult.outputEnergyJ;
  const gateCharge = gateChargeCharacterization(workDir);
  const recovery = reverseRecoveryCharacterization(workDir, measuredOutputChargeC);
  const outputEnergyContract = model.publishedConditionContracts.outputEnergy ?? null;

  return {
    status: "published-condition-and-reviewed-characterization",
    reverseConduction: {
      status: "published-condition-compared",
      contract: reverseContract,
      ...reverseResult,
      convergence: {
        baselineMaxStepS: 1e-9,
        refinedMaxStepS: 0.5e-9,
        repeat: reverseRepeatedResult,
        refined: reverseRefinedResult,
        repeatRelativeDelta: relativeDelta(measuredReverseV, reverseRepeatedResult.sourceDrainVoltageV),
        halfStepRelativeDelta: relativeDelta(measuredReverseV, reverseRefinedResult.sourceDrainVoltageV)
      },
      comparison: publishedComparison(
        measuredReverseV,
        reverseContract.published.typicalV,
        reverseContract.published.maximumV,
        reverseContract.acceptance
      )
    },
    outputCharge: {
      status: "published-condition-compared",
      contract: outputContract,
      rampDurationS,
      ...outputResult,
      convergence: {
        baselineMaxStepS: 1e-9,
        refinedMaxStepS: 0.5e-9,
        repeat: outputRepeatedResult,
        refined: outputRefinedResult,
        repeatRelativeDeltas: {
          outputChargeC: relativeDelta(measuredOutputChargeC, outputRepeatedResult.outputChargeC),
          outputEnergyJ: relativeDelta(measuredOutputEnergyJ, outputRepeatedResult.outputEnergyJ)
        },
        halfStepRelativeDeltas: {
          outputChargeC: relativeDelta(measuredOutputChargeC, outputRefinedResult.outputChargeC),
          outputEnergyJ: relativeDelta(measuredOutputEnergyJ, outputRefinedResult.outputEnergyJ)
        }
      },
      chargeComparison: publishedComparison(
        measuredOutputChargeC,
        outputContract.published.typicalC,
        outputContract.published.maximumC,
        outputContract.acceptance
      ),
      energyComparison: outputEnergyContract ? {
        contract: outputEnergyContract,
        ...publishedComparison(
          measuredOutputEnergyJ,
          outputEnergyContract.published.derivedStoredEnergyJ,
          null,
          outputEnergyContract.acceptance
        )
      } : {
        status: "no-published-counterpart",
        reason: "The locked datasheet publishes QOSS but no scalar EOSS or COSS(ER) value at this condition."
      }
    },
    gateCharge,
    reverseRecovery: recovery
  };
}

function switchingBody(maxStep) {
  const period = 2e-6;
  const stop = 1.5e-6;
  const gateDrive = model.characterization.gateDriveV;
  return `.temp 25
VINPUT vin 0 12
RLOAD vin load 1.2
VDSENSE load d 0
VSSENSE s 0 0
${deviceInstance("XQ", { drain: "d", gate: "g", source: "s" })}
VGATE gdrv s PULSE(0 ${gateDrive} 100n 2n 2n 800n ${format(period)})
RGATE gdrv g 2
BPOWER p 0 V=V(d,s)*I(VDSENSE)
RPOWER p 0 1G
BKCL kcl 0 V=I(VDSENSE)+I(VINPUT)
RKCL kcl 0 1G
.tran ${format(maxStep)} ${format(stop)} 0 ${format(maxStep)}
.meas tran id_avg AVG I(VDSENSE) FROM=0 TO=${format(stop)}
.meas tran id_on_early AVG I(VDSENSE) FROM=300n TO=500n
.meas tran id_on_late AVG I(VDSENSE) FROM=500n TO=700n
.meas tran id_rms RMS I(VDSENSE) FROM=0 TO=${format(stop)}
.meas tran id_peak MAX I(VDSENSE) FROM=0 TO=${format(stop)}
.meas tran vds_min MIN V(d,s) FROM=0 TO=${format(stop)}
.meas tran vds_max MAX V(d,s) FROM=0 TO=${format(stop)}
.meas tran input_avg AVG -I(VINPUT) FROM=0 TO=${format(stop)}
.meas tran device_energy INTEG V(p) FROM=0 TO=${format(stop)}
.meas tran turn_on_window_energy INTEG V(p) FROM=80n TO=180n
.meas tran turn_off_window_energy INTEG V(p) FROM=880n TO=980n
.meas tran kcl_rms RMS V(kcl) FROM=0 TO=${format(stop)}
.end
`;
}

function switchingCharacterization(workDir) {
  const baseline = runNetlist("resistive-switching-baseline", switchingBody(1e-9), workDir);
  const repeated = runNetlist("resistive-switching-repeat", switchingBody(1e-9), workDir);
  const refined = runNetlist("resistive-switching-half-step", switchingBody(0.5e-9), workDir);
  const keys = ["id_avg", "id_on_late", "id_rms", "id_peak", "vds_min", "vds_max", "input_avg", "device_energy"];
  const relativeDelta = (left, right) => Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1e-12);
  const baselineMeasures = baseline.measurements;
  const sampleDuration = 1.5e-6;
  const inputPower = 12 * baselineMeasures.input_avg;
  const resistorPower = 1.2 * baselineMeasures.id_rms ** 2;
  const devicePower = baselineMeasures.device_energy / sampleDuration;
  return {
    fixture: "single-device-resistive-switching",
    testConditions: {
      temperatureC: 25,
      supplyV: 12,
      loadResistanceOhm: 1.2,
      gateLowV: 0,
      gateHighV: model.characterization.gateDriveV,
      gateDelayS: 100e-9,
      gateRiseTimeS: 2e-9,
      gateFallTimeS: 2e-9,
      gateOnTimeS: 800e-9,
      periodS: 2e-6,
      simulationStopS: 1.5e-6,
      baselineMaxStepS: 1e-9,
      refinedMaxStepS: 0.5e-9
    },
    externalGateResistanceOhm: 2,
    gateEdgeTimeS: 2e-9,
    netlistSha256: sha256(baseline.netlist),
    baseline: baselineMeasures,
    edgeWindows: {
      status: "reviewed-characterization-no-published-counterpart",
      turnOnWindowS: [80e-9, 180e-9],
      turnOffWindowS: [880e-9, 980e-9],
      turnOnDrainTerminalEnergyJ: baselineMeasures.turn_on_window_energy,
      turnOffDrainTerminalEnergyJ: baselineMeasures.turn_off_window_energy,
      turnOnHalfStepRelativeDelta: relativeDelta(
        baselineMeasures.turn_on_window_energy,
        refined.measurements.turn_on_window_energy
      ),
      turnOffHalfStepRelativeDelta: relativeDelta(
        baselineMeasures.turn_off_window_energy,
        refined.measurements.turn_off_window_energy
      ),
      note: "Window energies include drain-terminal conduction and commutation energy; no vendor EON/EOFF scalar exists at this fixture, so no universal edge-accuracy claim is made."
    },
    repeatMaxRelativeDelta: Math.max(...keys.map((key) => relativeDelta(baselineMeasures[key], repeated.measurements[key]))),
    halfStepMaxRelativeDelta: Math.max(...keys.map((key) => relativeDelta(baselineMeasures[key], refined.measurements[key]))),
    steadyWindowRelativeDelta: relativeDelta(baselineMeasures.id_on_early, baselineMeasures.id_on_late),
    kclResidualRelative: Math.abs(baselineMeasures.kcl_rms) / Math.max(Math.abs(baselineMeasures.id_rms), 1e-12),
    energyResidualRelative: Math.abs(inputPower - resistorPower - devicePower)
      / Math.max(Math.abs(inputPower), 1e-12)
  };
}

function fullBuckBody(duty, maxStep, cycles = 20) {
  const contract = model.fallbackSubcircuit ?? model.subcircuit;
  const vin = 12;
  const vout = 3.3;
  const inductance = 2.2e-6;
  const dcr = 20e-3;
  const period = 1e-6;
  const deadTime = 20e-9;
  const edgeTime = 2e-9;
  const tOn = duty * period;
  const lowDelay = tOn + deadTime;
  const lowWidth = period - tOn - 2 * deadTime;
  const stop = cycles * period;
  const sampleStart = (cycles - 4) * period;
  const split = (cycles - 2) * period;
  const deadAfterHighStart = split + tOn;
  const deadAfterHighStop = deadAfterHighStart + deadTime;
  const deadBeforeHighStart = split + period - deadTime;
  const deadBeforeHighStop = split + period;
  return `.temp 25
.option method=gear reltol=2e-5 abstol=1e-10 vntol=1e-7 plotwinsize=0
VINPUT vsrc 0 ${format(vin)}
VHSENSE vsrc vin 0
${deviceInstance("XHIGH", { drain: "vin", gate: "gh", source: "sw" }, contract)}
VLSENSE sw ld 0
${deviceInstance("XLOW", { drain: "ld", gate: "gl", source: "0" }, contract)}
VGH gh sw PULSE(0 ${format(model.characterization.gateDriveV)} 0 ${format(edgeTime)} ${format(edgeTime)} ${format(tOn)} ${format(period)})
VGL gl 0 PULSE(0 ${format(model.characterization.gateDriveV)} ${format(lowDelay)} ${format(edgeTime)} ${format(edgeTime)} ${format(lowWidth)} ${format(period)})
LBUCK sw ilraw ${format(inductance)} IC=2
VILSENSE ilraw ilres 0
RDCR ilres out ${format(dcr)}
VOUT out 0 ${format(vout)}
BHP hp 0 V=V(vin,sw)*I(VHSENSE)
RHP hp 0 1G
BLP lp 0 V=V(ld)*I(VLSENSE)
RLP lp 0 1G
BTP tp 0 V=V(hp)+V(lp)
RTP tp 0 1G
BKCL kcl 0 V=I(VHSENSE)-I(VLSENSE)-I(VILSENSE)
RKCL kcl 0 1G
.tran ${format(maxStep)} ${format(stop)} 0 ${format(maxStep)} UIC
.meas tran il_prev AVG I(VILSENSE) FROM=${format(sampleStart)} TO=${format(split)}
.meas tran il_avg AVG I(VILSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran il_rms RMS I(VILSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran il_peak MAX I(VILSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran il_valley MIN I(VILSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran hs_rms RMS I(VHSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran ls_rms RMS I(VLSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran input_avg AVG I(VHSENSE) FROM=${format(split)} TO=${format(stop)}
.meas tran output_avg AVG I(VOUT) FROM=${format(split)} TO=${format(stop)}
.meas tran switch_min MIN V(sw) FROM=${format(split)} TO=${format(stop)}
.meas tran switch_max MAX V(sw) FROM=${format(split)} TO=${format(stop)}
.meas tran hs_energy INTEG V(hp) FROM=${format(split)} TO=${format(stop)}
.meas tran ls_energy INTEG V(lp) FROM=${format(split)} TO=${format(stop)}
.meas tran dead_after_high_energy INTEG V(tp) FROM=${format(deadAfterHighStart)} TO=${format(deadAfterHighStop)}
.meas tran dead_before_high_energy INTEG V(tp) FROM=${format(deadBeforeHighStart)} TO=${format(deadBeforeHighStop)}
.meas tran kcl_rms RMS V(kcl) FROM=${format(split)} TO=${format(stop)}
.end
`;
}

function fullBuckCharacterization(workDir) {
  const executionContract = model.fallbackSubcircuit ?? model.subcircuit;
  let low = 0.25;
  let high = 0.31;
  let best = null;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const duty = (low + high) / 2;
    const run = runNetlist(`full-buck-duty-${iteration}`, fullBuckBody(duty, 2e-9, 8), workDir);
    const drift = run.measurements.il_avg - run.measurements.il_prev;
    if (!best || Math.abs(drift) < Math.abs(best.drift)) best = { duty, drift };
    if (drift > 0) high = duty;
    else low = duty;
  }
  const baseline = runNetlist("full-buck-baseline", fullBuckBody(best.duty, 1e-9), workDir);
  const repeated = runNetlist("full-buck-repeat", fullBuckBody(best.duty, 1e-9), workDir);
  const refined = runNetlist("full-buck-half-step", fullBuckBody(best.duty, 0.5e-9), workDir);
  const convergenceKeys = [
    "il_avg", "il_rms", "il_peak", "il_valley", "hs_rms", "ls_rms",
    "input_avg", "output_avg", "hs_energy", "ls_energy"
  ];
  const relativeDelta = (left, right) => Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1e-12);
  const measured = baseline.measurements;
  const sampleDuration = 2e-6;
  const inputPower = 12 * measured.input_avg;
  const outputPower = 3.3 * measured.output_avg;
  const dcrPower = 20e-3 * measured.il_rms ** 2;
  const drainTerminalPower = (measured.hs_energy + measured.ls_energy) / sampleDuration;
  const measuredRippleA = measured.il_peak - measured.il_valley;
  const idealDuty = 3.3 / 12;
  const onIntervalRippleA = (12 - 3.3) * best.duty * 1e-6 / 2.2e-6;
  return {
    status: model.fallbackSubcircuit ? "characterized-bounded-fallback" : "characterized-bounded-primary",
    modelContract: {
      primaryCharacterizationSubcircuit: model.subcircuit.name,
      fullBuckExecutionSubcircuit: executionContract.name,
      executionModelLevel: model.fallbackSubcircuit?.modelLevel ?? "primary-vendor-model",
      usesFallback: Boolean(model.fallbackSubcircuit)
    },
    testConditions: {
      temperatureC: 25,
      inputVoltageV: 12,
      outputClampVoltageV: 3.3,
      initialInductorCurrentA: 2,
      switchingFrequencyHz: 1e6,
      inductanceH: 2.2e-6,
      inductorDcrOhm: 20e-3,
      deadTimeS: 20e-9,
      gateDriveV: model.characterization.gateDriveV,
      gateEdgeTimeS: 2e-9,
      baselineMaxStepS: 1e-9,
      refinedMaxStepS: 0.5e-9
    },
    solvedDuty: best.duty,
    netlistSha256: sha256(baseline.netlist),
    baseline: measured,
    analyticalCounterparts: {
      idealVoltSecondDuty: {
        analyticalDuty: idealDuty,
        measuredSolvedDuty: best.duty,
        relativeDelta: relativeDelta(best.duty, idealDuty),
        note: "The ideal counterpart omits device drops, dead-time commutation and inductor DCR."
      },
      onIntervalInductorRipple: {
        analyticalRippleA: onIntervalRippleA,
        measuredPeakToValleyRippleA: measuredRippleA,
        relativeDelta: relativeDelta(measuredRippleA, onIntervalRippleA),
        note: "The analytical counterpart uses (VIN-VOUT)·tON/L at the solved duty and omits DCR and nonlinear switching intervals."
      }
    },
    commandedDeadWindows: {
      status: "reviewed-characterization-no-published-counterpart",
      definition: "Drain-terminal energy integrated over the two nominal 20 ns gate-command dead windows in one steady cycle.",
      signConvention: "Signed drain-terminal energy: positive means net energy absorbed by the two device drain terminals; negative means net energy returned to the fixture and must not be read as dissipated loss.",
      afterHighSideEnergyJ: measured.dead_after_high_energy,
      beforeHighSideEnergyJ: measured.dead_before_high_energy,
      afterHighSideHalfStepRelativeDelta: relativeDelta(
        measured.dead_after_high_energy,
        refined.measurements.dead_after_high_energy
      ),
      beforeHighSideHalfStepRelativeDelta: relativeDelta(
        measured.dead_before_high_energy,
        refined.measurements.dead_before_high_energy
      )
    },
    convergenceMeasures: convergenceKeys,
    repeatMaxRelativeDelta: Math.max(...convergenceKeys.map((key) => relativeDelta(measured[key], repeated.measurements[key]))),
    halfStepMaxRelativeDelta: Math.max(...convergenceKeys.map((key) => relativeDelta(measured[key], refined.measurements[key]))),
    edgeExtrema: {
      comparisonStatus: "diagnostic-only-timestep-sensitive",
      baseline: { minimumV: measured.switch_min, maximumV: measured.switch_max },
      halfStep: { minimumV: refined.measurements.switch_min, maximumV: refined.measurements.switch_max },
      halfStepMaxRelativeDelta: Math.max(
        relativeDelta(measured.switch_min, refined.measurements.switch_min),
        relativeDelta(measured.switch_max, refined.measurements.switch_max)
      )
    },
    currentWindowRelativeDelta: Math.abs(measured.il_avg - measured.il_prev) / Math.max(Math.abs(measured.il_avg), 1e-12),
    kclResidualRelative: Math.abs(measured.kcl_rms) / Math.max(Math.abs(measured.il_rms), 1e-12),
    energyResidualRelative: Math.abs(inputPower - outputPower - dcrPower - drainTerminalPower)
      / Math.max(Math.abs(inputPower), 1e-12)
  };
}

function finiteTree(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (value && typeof value === "object") return Object.values(value).every(finiteTree);
  return true;
}

function buildReport(version, hashes, adaptation, workDir) {
  const staticChecks = staticCharacterization(workDir);
  const terminalChecks = terminalCharacterization(workDir);
  const switching = switchingCharacterization(workDir);
  const fullBuck = fullBuckCharacterization(workDir);
  const coverage = {
    rdsOn: {
      status: "published-condition-compared",
      reportPath: "characterization.staticChecks",
      comparisonPassed: staticChecks.allComparisonsPassed
    },
    reverseConductionVsd: {
      status: "published-condition-compared",
      reportPath: "characterization.terminalChecks.reverseConduction",
      comparisonPassed: terminalChecks.reverseConduction.comparison.passed
    },
    totalGateCharge: {
      status: terminalChecks.gateCharge.total.status,
      reportPath: "characterization.terminalChecks.gateCharge.total",
      comparisonPassed: terminalChecks.gateCharge.total.comparison.passed
    },
    partitionedGateChargeQgsQgd: {
      status: terminalChecks.gateCharge.partitioned.status,
      reportPath: "characterization.terminalChecks.gateCharge.partitioned",
      reason: terminalChecks.gateCharge.partitioned.reason
    },
    outputChargeQoss: {
      status: "published-condition-compared",
      reportPath: "characterization.terminalChecks.outputCharge",
      comparisonPassed: terminalChecks.outputCharge.chargeComparison.passed
    },
    outputEnergyEoss: model.publishedConditionContracts.outputEnergy ? {
      status: "published-condition-compared",
      reportPath: "characterization.terminalChecks.outputCharge.energyComparison",
      comparisonPassed: terminalChecks.outputCharge.energyComparison.passed
    } : {
      status: "reviewed-characterization-no-published-counterpart",
      reportPath: "characterization.terminalChecks.outputCharge",
      reason: terminalChecks.outputCharge.energyComparison.reason
    },
    reverseRecoveryQrr: {
      status: terminalChecks.reverseRecovery.status,
      reportPath: "characterization.terminalChecks.reverseRecovery",
      reason: terminalChecks.reverseRecovery.reason
    },
    separateTurnOnTurnOffEnergy: {
      status: "reviewed-characterization-no-published-counterpart",
      reportPath: "characterization.switching.edgeWindows",
      reason: switching.edgeWindows.note
    },
    deadTimeRecovery: {
      status: "reviewed-characterization-no-published-counterpart",
      reportPath: "characterization.fullBuck.commandedDeadWindows",
      reason: "The vendor datasheets do not publish dead-window energy for this 12 V to 3.3 V fixture."
    },
    fullBuckVendorModel: {
      status: fullBuck.status,
      reportPath: "characterization.fullBuck",
      reason: model.manufacturer === "Infineon"
        ? "The detailed L1 half-bridge did not converge under hard commutation; the bounded full-buck check uses the official simplified L0 fallback and is not L1 validation."
        : "The bounded full-buck check executes the locked EPC primary model; it remains characterization rather than product sign-off."
    }
  };
  const acceptedCoverageStatuses = new Set([
    "published-condition-compared",
    "reviewed-characterization-no-published-counterpart",
    "not-applicable",
    "characterized-bounded-primary",
    "characterized-bounded-fallback"
  ]);
  const unsupportedRequiredCoverage = model.strictRequiredCoverage.filter(
    (key) => !coverage[key] || !acceptedCoverageStatuses.has(coverage[key].status)
  );
  const comparisonEntries = [
    ["rdsOn", staticChecks.allComparisonsPassed],
    ["reverseConductionVsd", terminalChecks.reverseConduction.comparison.passed],
    ["totalGateCharge", terminalChecks.gateCharge.total.comparison.passed],
    ["outputChargeQoss", terminalChecks.outputCharge.chargeComparison.passed],
    ...(model.publishedConditionContracts.outputEnergy
      ? [["outputEnergyEoss", terminalChecks.outputCharge.energyComparison.passed]]
      : [])
  ];
  const failedPublishedComparisons = comparisonEntries.filter(([, passed]) => !passed).map(([key]) => key);
  const qualityGates = {
    repeatRelativeLimit: 0.005,
    halfStepRelativeLimit: 0.02,
    steadyWindowRelativeLimit: 0.005,
    kclResidualRelativeLimit: 0.02,
    energyResidualRelativeLimit: 0.02,
    rdsOnRepeatPassed: Object.values(staticChecks.cases).every((entry) => entry.convergence.repeatRelativeDelta <= 0.005),
    rdsOnHalfStepPassed: Object.values(staticChecks.cases).every((entry) => entry.convergence.halfStepRelativeDelta <= 0.02),
    reverseConductionRepeatPassed: terminalChecks.reverseConduction.convergence.repeatRelativeDelta <= 0.005,
    reverseConductionHalfStepPassed: terminalChecks.reverseConduction.convergence.halfStepRelativeDelta <= 0.02,
    outputChargeEnergyRepeatPassed: Object.values(terminalChecks.outputCharge.convergence.repeatRelativeDeltas).every((value) => value <= 0.005),
    outputChargeEnergyHalfStepPassed: Object.values(terminalChecks.outputCharge.convergence.halfStepRelativeDeltas).every((value) => value <= 0.02),
    repeatPassed: switching.repeatMaxRelativeDelta <= 0.005,
    halfStepPassed: switching.halfStepMaxRelativeDelta <= 0.02,
    steadyWindowPassed: switching.steadyWindowRelativeDelta <= 0.005,
    kclPassed: switching.kclResidualRelative <= 0.02,
    energyPassed: switching.energyResidualRelative <= 0.02,
    totalGateChargeRepeatPassed: terminalChecks.gateCharge.total.repeatMaxRelativeDelta <= 0.005,
    totalGateChargeHalfStepPassed: terminalChecks.gateCharge.total.halfStep.status === "completed"
      && terminalChecks.gateCharge.total.halfStep.relativeDeltas.totalGateChargeC <= 0.02,
    partitionedGateChargeRepeatPassed: terminalChecks.gateCharge.partitioned.repeatMaxRelativeDelta <= 0.005,
    partitionedGateChargeHalfStepPassed: terminalChecks.gateCharge.partitioned.halfStep.status === "completed"
      && terminalChecks.gateCharge.partitioned.halfStep.maxRelativeDelta <= 0.02,
    ...(terminalChecks.reverseRecovery.status === "attempted-bounded-not-published-equivalent" ? {
      reverseRecoveryFixtureRepeatPassed: terminalChecks.reverseRecovery.repeatRelativeDelta <= 0.005,
      reverseRecoveryFixtureHalfStepPassed: terminalChecks.reverseRecovery.halfStepRelativeDelta <= 0.02
    } : {}),
    terminalDiagnosticsPassed:
      terminalChecks.reverseConduction.sourceDrainVoltageV > 0
      && terminalChecks.outputCharge.outputChargeC > 0
      && terminalChecks.outputCharge.outputEnergyJ > 0
      && terminalChecks.gateCharge.total.baseline.totalGateChargeC > 0,
    fullBuckRepeatPassed: fullBuck.repeatMaxRelativeDelta <= 0.005,
    fullBuckHalfStepPassed: fullBuck.halfStepMaxRelativeDelta <= 0.02,
    fullBuckSteadyPassed: fullBuck.currentWindowRelativeDelta <= 0.005,
    fullBuckKclPassed: fullBuck.kclResidualRelative <= 0.02,
    fullBuckEnergyPassed: fullBuck.energyResidualRelative <= 0.02,
    finitePassed: finiteTree({ staticChecks, terminalChecks, switching, fullBuck })
  };
  const coverageComplete = unsupportedRequiredCoverage.length === 0;
  const releaseQualityPassed = Object.values(qualityGates).filter((value) => typeof value === "boolean").every(Boolean);
  const ordinaryQualityGateExclusions = new Set([
    "totalGateChargeHalfStepPassed",
    "partitionedGateChargeHalfStepPassed"
  ]);
  const ordinaryQualityPassed = Object.entries(qualityGates)
    .filter(([key, value]) => typeof value === "boolean" && !ordinaryQualityGateExclusions.has(key))
    .every(([, value]) => value);
  const badgeEligible = coverageComplete && failedPublishedComparisons.length === 0 && releaseQualityPassed;
  return {
    schemaVersion: 2,
    evidenceClass: "vendor-model-characterization",
    label: `Official ${model.manufacturer} LTspice model executed in native LTspice`,
    characterizationOnly: true,
    source: {
      lockId: model.id,
      publisher: model.publisher,
      archiveSha256: hashes.archiveHash,
      modelSha256: hashes.sourceHash,
      modelVersion: model.modelVersion,
      retrievalDate: model.retrievalDate,
      redistribution: model.redistribution,
      datasheet: model.datasheet,
      publishedConditionContracts: model.publishedConditionContracts,
      subcircuits: {
        primary: model.subcircuit,
        fallback: model.fallbackSubcircuit ?? null
      }
    },
    adapter: { ...model.adapter, adaptedSha256: adaptation.adaptedSha256 },
    simulator: { name: model.simulator.name, version, args: model.simulator.args },
    requiredDirectives: model.requiredDirectives,
    characterization: { staticChecks, terminalChecks, switching, fullBuck },
    reviewedCharacterization: {
      fullBuck: { status: fullBuck.status, reportPath: "characterization.fullBuck" },
      edgeEnergy: { status: switching.edgeWindows.status, reportPath: "characterization.switching.edgeWindows" },
      deadTime: { status: fullBuck.commandedDeadWindows.status, reportPath: "characterization.fullBuck.commandedDeadWindows" },
      recovery: { status: terminalChecks.reverseRecovery.status, reportPath: "characterization.terminalChecks.reverseRecovery" },
      outputEnergy: { status: coverage.outputEnergyEoss.status, reportPath: coverage.outputEnergyEoss.reportPath }
    },
    coverage,
    coverageComplete,
    badgeEligible,
    verificationGate: {
      passed: ordinaryQualityPassed,
      excludedReleaseOnlyQualityGates: [...ordinaryQualityGateExclusions],
      note: "Native verify attests the byte-stable characterization and accepted core quality gates. Gate-charge half-step stability remains a stricter release/badge condition so an honest unsupported report can still be reproduced and committed."
    },
    releaseGate: {
      gate: "strict-vendor-cross-check-badge",
      passed: badgeEligible,
      strictRequiredCoverage: model.strictRequiredCoverage,
      unsupportedRequiredCoverage,
      failedPublishedComparisons,
      qualityPassed: releaseQualityPassed,
      note: "This gate is release-only. Ordinary committed/native verification preserves honest unsupported evidence; release badge publication requires complete strict coverage and every published-condition policy to pass."
    },
    limitations: [
      "Vendor-model switching is a bounded single-device resistive characterization; independent switched-topology fixtures carry the buck waveform and static-loss gates.",
      "The constant-current QGS/QGD values use project-defined 99%/1% drain-transition proxies because the datasheet extraction thresholds are unpublished; they are not badge evidence.",
      ...(!terminalChecks.gateCharge.total.comparison.passed
        ? ["The bounded total-QG result does not satisfy its immutable published-typical comparison policy and therefore blocks the strict badge."]
        : []),
      ...(terminalChecks.gateCharge.total.halfStep.status !== "completed"
        ? [terminalChecks.gateCharge.total.halfStep.reason]
        : []),
      ...(failedPublishedComparisons.length
        ? [`Published-condition comparison policy failed for ${failedPublishedComparisons.join(", ")}; the strict badge remains blocked.`]
        : []),
      ...(model.manufacturer === "Infineon"
        ? [terminalChecks.reverseRecovery.reason]
        : []),
      ...(model.manufacturer === "Infineon"
        ? ["The detailed Infineon L1 half-bridge did not converge under hard commutation. A separately labeled bounded full-buck run uses the official simplified L0 standard-SPICE fallback and is not L1 full-buck validation."]
        : [])
    ],
    qualityGates,
    review: {
      status: "reviewed-characterization",
      note: "The LTspice model is a local characterization cross-check, not redistribution, universal edge-energy accuracy, or product sign-off."
    }
  };
}

async function main() {
  if (!["acquire", "verify", "regenerate", "release-check"].includes(command)) throw new Error(`Unknown command: ${command}`);
  assertPublishedContracts();
  if (command === "release-check") {
    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    if (report.source?.lockId !== model.id || report.schemaVersion !== 2) {
      throw new Error(`Committed vendor report does not match the strict ${model.id} contract`);
    }
    if (!report.releaseGate?.passed || !report.badgeEligible || !report.coverageComplete) {
      const missing = report.releaseGate?.unsupportedRequiredCoverage?.join(", ") || "none";
      const failed = report.releaseGate?.failedPublishedComparisons?.join(", ") || "none";
      throw new Error(`Strict vendor release gate failed for ${model.id}; unsupported coverage: ${missing}; failed published comparisons: ${failed}`);
    }
    process.stdout.write(`Strict vendor release gate passed for ${model.id}\n`);
    return;
  }
  if (command === "acquire") {
    await acquire();
    validateSource();
    return;
  }
  const hashes = validateSource();
  const adaptation = prepareSimulationModel();
  simulationModelPath = adaptation.path;
  const version = simulatorVersion();
  if (version !== model.simulator.requiredVersion) {
    throw new Error(`${model.id} requires LTspice ${model.simulator.requiredVersion}; found ${version}`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "buck-loss-vendor-"));
  try {
    const report = buildReport(version, hashes, adaptation, workDir);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (command === "verify") {
      if (readFileSync(REPORT_PATH, "utf8") !== serialized) {
        throw new Error(`Vendor report is stale; run npm run data:buck-loss:spice:vendor:regenerate`);
      }
      if (!report.verificationGate?.passed) throw new Error(`Vendor characterization verification gate failed`);
      process.stdout.write(`Verified ${REPORT_PATH}\n`);
    } else {
      mkdirSync(dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, serialized);
      process.stdout.write(`Wrote ${REPORT_PATH}\n`);
    }
  } finally {
    if (process.env.KEEP_VENDOR_WORK === "1") process.stderr.write(`Kept ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
