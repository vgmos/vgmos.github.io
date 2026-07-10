import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  V2_PILOT_PART_NUMBERS,
  buildV2Dataset,
  makeV2AcquisitionPlan,
  makeV2DiscoveryPlan,
  makeV2RefinementSamples,
  mergeV2PlanSamples,
  validateV2Run
} from "./loss-model-v2.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const cacheRoot = path.join(root, ".cache/coilcraft-loss-v2");
const catalogPath = path.join(root, "assets/data/coilcraft-inductors.v1.json");
const publicDatasetPath = path.join(root, "assets/data/coilcraft-inductor-loss-surfaces.v1.json");
const approvalPath = path.join(root, "data/inductors/coilcraft-loss-approval.json");
const command = process.argv[2] || "discovery-plan";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function catalog() {
  return readJson(catalogPath);
}

async function discoveryPlanCommand() {
  const plan = makeV2DiscoveryPlan(await catalog());
  const file = path.join(cacheRoot, "plans", `${plan.plan_id}.json`);
  await writeJson(file, plan);
  console.log(JSON.stringify({ plan: path.relative(root, file), parts: plan.parts, requests: plan.samples.length }, null, 2));
}

async function planCommand() {
  const discoveriesPath = argument("--discoveries");
  if (!discoveriesPath) throw new Error("--discoveries <json> is required");
  const discoveries = await readJson(path.resolve(discoveriesPath));
  const plan = makeV2AcquisitionPlan(await catalog(), discoveries);
  const file = path.join(cacheRoot, "plans", `${plan.plan_id}.json`);
  await writeJson(file, plan);
  console.log(JSON.stringify({
    plan: path.relative(root, file),
    parts: plan.parts.map((part) => part.part_number),
    requests: plan.samples.length,
    by_kind: Object.fromEntries(Object.entries(Object.groupBy(plan.samples, (sample) => sample.kind)).map(([kind, samples]) => [kind, samples.length]))
  }, null, 2));
}

async function runDirectory() {
  const runId = argument("--run");
  if (!runId) throw new Error("--run <run-id> is required");
  return { runId, runDir: path.join(cacheRoot, runId) };
}

async function refineCommand() {
  const round = Number(argument("--round"));
  const { runId, runDir } = await runDirectory();
  const plan = await readJson(path.join(runDir, "plan.json"));
  const records = await readJson(path.join(runDir, "normalized.json"));
  const samples = makeV2RefinementSamples(await catalog(), plan, records, round);
  await writeJson(path.join(runDir, `refinement-round-${round}.json`), samples);
  console.log(JSON.stringify({ run_id: runId, round, requests: samples.length, samples }, null, 2));
}

async function mergeRefinementCommand() {
  const round = Number(argument("--round"));
  const { runId, runDir } = await runDirectory();
  const plan = await readJson(path.join(runDir, "plan.json"));
  const samples = await readJson(path.join(runDir, `refinement-round-${round}.json`));
  const merged = mergeV2PlanSamples(plan, samples);
  await writeJson(path.join(runDir, "plan.json"), merged);
  console.log(JSON.stringify({ run_id: runId, round, total_requests: merged.samples.length }, null, 2));
}

async function buildFromRun({ approved = false } = {}) {
  const { runId, runDir } = await runDirectory();
  const plan = await readJson(path.join(runDir, "plan.json"));
  const records = await readJson(path.join(runDir, "normalized.json"));
  const provenance = await readJson(path.join(runDir, "provenance.json"));
  const legacy = await readJson(path.join(runDir, "legacy-surface.json"));
  const runValidation = validateV2Run(plan, records, provenance);
  if (!runValidation.valid) throw new Error(`v2 run validation failed:\n${runValidation.errors.join("\n")}`);
  const result = buildV2Dataset(plan, records, legacy, {
    ...provenance,
    permission_status: approved ? "approved" : "internal_evaluation"
  }, { requireAll: false });
  await writeJson(path.join(runDir, approved ? "candidate-surface.json" : "candidate-surface.private.json"), result.dataset);
  await writeJson(path.join(runDir, "validation-report.json"), result.validations);
  return { runId, runDir, plan, result };
}

async function validateCommand() {
  const built = await buildFromRun();
  const summaries = Object.fromEntries(Object.entries(built.result.validations).map(([part, validation]) => [part, validation.summary]));
  console.log(JSON.stringify({ run_id: built.runId, failing_parts: built.result.failing_parts, validations: summaries }, null, 2));
  if (built.result.failing_parts.length) process.exitCode = 1;
}

async function promoteCommand() {
  const approval = await readJson(approvalPath).catch(() => null);
  if (!approval || approval.permission_status !== "approved") throw new Error("reviewed loss-model approval is required");
  if (!V2_PILOT_PART_NUMBERS.every((part) => approval.part_numbers?.includes(part))) {
    throw new Error("approval does not cover all six schema-v2 pilot parts");
  }
  const built = await buildFromRun({ approved: true });
  if (built.result.failing_parts.length) throw new Error(`promotion refused: ${built.result.failing_parts.join(", ")}`);
  await writeJson(publicDatasetPath, built.result.dataset);
  console.log(`Promoted schema-v2 dataset ${built.result.dataset.dataset_version} from ${built.runId}.`);
}

const commands = {
  "discovery-plan": discoveryPlanCommand,
  plan: planCommand,
  refine: refineCommand,
  "merge-refinement": mergeRefinementCommand,
  validate: validateCommand,
  promote: promoteCommand
};

if (!commands[command]) throw new Error(`Unknown command: ${command}`);
await fs.mkdir(cacheRoot, { recursive: true });
await commands[command]();
