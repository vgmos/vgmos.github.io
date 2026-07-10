import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  LOSS_ENDPOINT,
  LOSS_TOOL_URL,
  buildSurfaceDataset,
  makePilotPlan,
  makeToolRequest,
  normalizeToolResponse,
  recordsToCsv,
  responseSchemaFingerprint,
  validateAccountingRecord,
  validateCollectedRecords
} from "./loss-surface.mjs";
import { sha256 } from "./catalog.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const cacheRoot = path.join(root, ".cache/coilcraft-loss");
const catalogPath = path.join(root, "assets/data/coilcraft-inductors.v1.json");
const publicSurfacePath = path.join(root, "assets/data/coilcraft-inductor-loss-surfaces.v1.json");
const approvalPath = path.join(root, "data/inductors/coilcraft-loss-approval.json");
const command = process.argv[2] || "plan";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendNdjson(file, value) {
  await fs.appendFile(file, `${JSON.stringify(value)}\n`);
}

async function readNdjson(file) {
  try {
    return (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function newRunId(plan) {
  const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14);
  return `${stamp}-${plan.plan_sha256.slice(0, 8)}`;
}

async function latestRunId() {
  const entries = await fs.readdir(cacheRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && /^\d{14}-/.test(entry.name)).map((entry) => entry.name).sort().at(-1) ?? null;
}

async function loadPlan() {
  const catalog = await readJson(catalogPath);
  return makePilotPlan(catalog);
}

function requestCounts(plan) {
  return plan.samples.reduce((counts, sample) => {
    counts[sample.kind] = (counts[sample.kind] || 0) + 1;
    return counts;
  }, {});
}

async function planCommand() {
  const plan = await loadPlan();
  const file = path.join(cacheRoot, "plans", `${plan.plan_id}.json`);
  await writeJson(file, plan);
  console.log(JSON.stringify({
    plan: path.relative(root, file),
    parts: plan.parts.map((part) => part.part_number),
    requests: plan.samples.length,
    by_kind: requestCounts(plan),
    permission_status: plan.permission_status
  }, null, 2));
}

function preflightSamples(plan) {
  const result = [];
  for (const part of plan.parts) {
    const accounting = plan.samples.find((sample) => (
      sample.part_number === part.part_number && sample.kind === "training" && sample.frequency_Hz === 1e6 &&
      sample.idc_A === Number((0.25 * part.reference_current_A).toPrecision(12)) &&
      sample.ripple_pp_A === Number((0.3 * part.reference_current_A).toPrecision(12))
    ));
    const zero = plan.samples.find((sample) => sample.part_number === part.part_number && sample.kind === "zero-ripple-canary");
    if (!accounting || !zero) throw new Error(`${part.part_number}: missing preflight samples`);
    result.push(accounting, zero);
  }
  return result;
}

async function fetchToolPoint(page, sample, attempt) {
  const requestBody = makeToolRequest(sample);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const response = await page.evaluate(async ({ endpoint, body }) => {
    const result = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return {
      status: result.status,
      contentType: result.headers.get("content-type"),
      retryAfter: result.headers.get("retry-after"),
      text: await result.text()
    };
  }, { endpoint: LOSS_ENDPOINT, body: requestBody });
  let payload = null;
  if (response.contentType?.includes("application/json")) {
    try { payload = JSON.parse(response.text); } catch { payload = null; }
  }
  return {
    sample_id: sample.sample_id,
    attempt,
    started_at_utc: startedAt,
    elapsed_ms: Date.now() - started,
    request: requestBody,
    response: { status: response.status, content_type: response.contentType, retry_after: response.retryAfter, json: payload },
    response_sha256: sha256(Buffer.from(response.text)),
    payload
  };
}

async function requestWithBackoff(page, sample, rawPath, errorPath) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const raw = await fetchToolPoint(page, sample, attempt);
    await appendNdjson(rawPath, { ...raw, payload: undefined });
    if (raw.response.status === 200 && raw.payload) return raw;
    const transient = raw.response.status === 429 || raw.response.status >= 500;
    if (!transient) {
      const challenge = raw.response.status === 403 && raw.response.content_type?.includes("text/html");
      const message = challenge
        ? "Coilcraft returned a browser challenge; collection stopped without bypassing it"
        : "Non-JSON or permanent response";
      const error = { sample_id: sample.sample_id, attempt, status: raw.response.status, message };
      await appendNdjson(errorPath, error);
      throw new Error(`${sample.sample_id}: ${message}`);
    }
    const retryAfterSeconds = Number(raw.response.retry_after);
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000 * (2 ** (attempt - 1));
    await sleep(Math.min(delay, 15_000));
  }
  throw new Error(`${sample.sample_id}: retry limit exceeded`);
}

async function collectCommand() {
  const plan = await loadPlan();
  if (process.argv.includes("--dry-run")) return planCommand();
  const resumeId = argument("--resume");
  const runId = resumeId || newRunId(plan);
  const runDir = path.join(cacheRoot, runId);
  const rawPath = path.join(runDir, "raw.ndjson");
  const errorPath = path.join(runDir, "errors.ndjson");
  await fs.mkdir(runDir, { recursive: true });
  await writeJson(path.join(runDir, "plan.json"), plan);

  const priorRecords = await readJson(path.join(runDir, "normalized.json")).catch(() => []);
  const completedIds = new Set(priorRecords.map((record) => record.sample_id));
  const records = [...priorRecords];
  const bundleTasks = [];
  const browser = await chromium.launch({ headless: process.env.COILCRAFT_HEADLESS === "1" || process.argv.includes("--headless") });
  let aborted = null;
  let sourceModelFingerprint = null;
  const capturedAt = new Date().toISOString();
  try {
    const page = await browser.newPage();
    page.on("response", (response) => {
      const url = response.url();
      if (!/\/Scripts\/bundle\/.*\.js(?:\?|$)/.test(url)) return;
      bundleTasks.push(response.body().then((body) => ({ url, sha256: sha256(body) })).catch(() => null));
    });
    await page.goto(LOSS_TOOL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("#power-inductor[data-v-app]", { state: "attached", timeout: 60_000 });
    await page.waitForTimeout(1_000);
    const bundles = (await Promise.all(bundleTasks)).filter(Boolean).sort((a, b) => a.url.localeCompare(b.url));
    sourceModelFingerprint = sha256(Buffer.from(JSON.stringify(bundles)));
    const provenance = {
      permission_status: "internal_evaluation",
      source_run_id: runId,
      captured_at_utc: capturedAt,
      tool_url: LOSS_TOOL_URL,
      endpoint: LOSS_ENDPOINT,
      source_model_fingerprint: sourceModelFingerprint,
      bundle_hashes: bundles,
      request_schema: "power-inductor-compare-losses-v1",
      collector_git_sha: process.env.GITHUB_SHA || null,
      node_version: process.version,
      playwright_version: (await import("playwright/package.json", { with: { type: "json" } })).default.version
    };
    await writeJson(path.join(runDir, "provenance.json"), provenance);

    const ordered = [...preflightSamples(plan), ...plan.samples.filter((sample) => !preflightSamples(plan).some((preflight) => preflight.sample_id === sample.sample_id))];
    for (const sample of ordered) {
      if (completedIds.has(sample.sample_id)) continue;
      const raw = await requestWithBackoff(page, sample, rawPath, errorPath);
      if (!sourceModelFingerprint) sourceModelFingerprint = responseSchemaFingerprint(raw.payload);
      const record = normalizeToolResponse(sample, raw.payload, {
        source_run_id: runId,
        source_model_fingerprint: sourceModelFingerprint,
        captured_at_utc: capturedAt
      });
      records.push(record);
      completedIds.add(record.sample_id);
      await writeJson(path.join(runDir, "normalized.json"), records);
      await fs.writeFile(path.join(runDir, "normalized.csv"), recordsToCsv(records));

      if (sample.kind === "training" || sample.kind === "zero-ripple-canary") {
        const accounting = validateAccountingRecord(record);
        if (!accounting.valid) {
          aborted = { reason: "accounting-preflight", sample_id: sample.sample_id, accounting };
          throw new Error(`${sample.part_number}: accounting preflight failed (${accounting.errors.join("; ")})`);
        }
      }
      await sleep(1_100);
    }
  } catch (error) {
    aborted ||= { reason: "collector-error", message: error.message };
    await appendNdjson(errorPath, { captured_at_utc: new Date().toISOString(), ...aborted });
  } finally {
    await browser.close();
  }

  const validation = validateCollectedRecords(plan, records);
  let interpolation = null;
  if (!aborted && validation.valid) {
    try {
      const built = buildSurfaceDataset(plan, records, {
        permission_status: "internal_evaluation",
        source_model_fingerprint: sourceModelFingerprint,
        captured_at_utc: capturedAt
      });
      interpolation = { valid: true, validations: built.validations };
      await writeJson(path.join(runDir, "candidate-surface.private.json"), built.dataset);
      await writeJson(path.join(runDir, "validation-report.json"), built.validations);
    } catch (error) {
      interpolation = { valid: false, error: error.message };
      validation.valid = false;
      validation.errors.push(`interpolation: ${error.message}`);
    }
  }
  const summary = {
    run_id: runId,
    status: aborted ? "aborted" : validation.valid ? "complete" : "invalid",
    completed: records.length,
    planned: plan.samples.length,
    validation,
    interpolation,
    aborted
  };
  await writeJson(path.join(runDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (aborted || !validation.valid) process.exitCode = 1;
}

async function runDirectoryFromArgs() {
  const runId = argument("--run") || await latestRunId();
  if (!runId) throw new Error("No Coilcraft loss run is available");
  return { runId, runDir: path.join(cacheRoot, runId) };
}

async function validateCommand() {
  const { runId, runDir } = await runDirectoryFromArgs();
  const plan = await readJson(path.join(runDir, "plan.json"));
  const records = await readJson(path.join(runDir, "normalized.json"));
  const validation = validateCollectedRecords(plan, records);
  let interpolation = null;
  if (validation.valid) {
    try {
      const provenance = await readJson(path.join(runDir, "provenance.json"));
      const built = buildSurfaceDataset(plan, records, { ...provenance, permission_status: "internal_evaluation" });
      interpolation = { valid: true, validations: built.validations };
      await writeJson(path.join(runDir, "candidate-surface.private.json"), built.dataset);
      await writeJson(path.join(runDir, "validation-report.json"), built.validations);
    } catch (error) {
      interpolation = { valid: false, error: error.message };
      validation.valid = false;
      validation.errors.push(`interpolation: ${error.message}`);
    }
  }
  console.log(JSON.stringify({ run_id: runId, ...validation, interpolation }, null, 2));
  if (!validation.valid) process.exitCode = 1;
}

async function promoteCommand() {
  const { runId, runDir } = await runDirectoryFromArgs();
  const approval = await readJson(approvalPath).catch(() => null);
  if (!approval || approval.permission_status !== "approved") {
    throw new Error(`Public promotion refused: reviewed approval is required at ${path.relative(root, approvalPath)}`);
  }
  const plan = await readJson(path.join(runDir, "plan.json"));
  const requestedParts = new Set(plan.parts.map((part) => part.part_number));
  if (!plan.parts.every((part) => approval.part_numbers?.includes(part.part_number))) {
    throw new Error("Public promotion refused: approval does not cover every pilot part");
  }
  if (![...requestedParts].every((part) => approval.part_numbers.includes(part))) {
    throw new Error("Public promotion refused: approval scope mismatch");
  }
  const records = await readJson(path.join(runDir, "normalized.json"));
  const provenance = await readJson(path.join(runDir, "provenance.json"));
  const { dataset, validations } = buildSurfaceDataset(plan, records, { ...provenance, permission_status: "approved" });
  await writeJson(path.join(runDir, "candidate-surface.json"), dataset);
  await writeJson(path.join(runDir, "validation-report.json"), validations);
  await writeJson(publicSurfacePath, dataset);
  console.log(`Promoted approved surface ${dataset.dataset_version} from run ${runId}.`);
}

const commands = { plan: planCommand, collect: collectCommand, validate: validateCommand, promote: promoteCommand };
if (!commands[command]) throw new Error(`Unknown command: ${command}`);
await fs.mkdir(cacheRoot, { recursive: true });
await commands[command]();
