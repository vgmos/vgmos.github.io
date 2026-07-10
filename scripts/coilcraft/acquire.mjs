#!/usr/bin/env node
// Coilcraft catalog acquisition pipeline.
//
//   node scripts/coilcraft/acquire.mjs build    Rebuild tracked files from the
//                                               committed datasheets (offline).
//   node scripts/coilcraft/acquire.mjs check    Download current datasheets,
//                                               parse + validate a candidate in
//                                               .cache/coilcraft/, and report
//                                               whether the tracked CSV/JSON
//                                               would change. Never writes
//                                               tracked files.
//   node scripts/coilcraft/acquire.mjs accept   Download, validate, and promote
//                                               the reviewed candidate to the
//                                               tracked datasheets, CSV, and JSON.
//
// Set RUN_COILCRAFT_LIVE=1 to additionally cross-check the parsed roster against
// Coilcraft's parts-search API. It is opt-in because Coilcraft/Cloudflare may
// block automated sessions, and it is only ever called from this offline tool —
// never from the public web page.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES } from "./sources.mjs";
import { buildCatalog, validateCatalog, serializeCsv, serializeJson } from "./catalog.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const CACHE_DIR = path.join(ROOT, ".cache", "coilcraft");
const DATASHEET_DIR = path.join(ROOT, "data", "inductors", "datasheets");
const TRACKED_CSV = path.join(ROOT, "data", "inductors", "coilcraft-parts.csv");
const TRACKED_JSON = path.join(ROOT, "assets", "data", "coilcraft-inductors.v1.json");
const USER_AGENT = "vgmos-coilcraft-acquire/1.0 (+https://vgmos.github.io)";

function rel(target) {
  return path.relative(ROOT, target) || ".";
}

async function download(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/pdf" } });
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function loadBuffers(mode) {
  const buffers = [];
  for (const source of SOURCES) {
    if (mode === "download") {
      process.stdout.write(`  downloading ${source.series} … `);
      const buffer = await download(source.datasheetUrl);
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(path.join(CACHE_DIR, source.datasheetFile), buffer);
      console.log(`${buffer.length.toLocaleString()} bytes`);
      buffers.push({ series: source.series, buffer, file: source.datasheetFile });
    } else {
      const file = path.join(DATASHEET_DIR, source.datasheetFile);
      buffers.push({ series: source.series, buffer: readFileSync(file), file: source.datasheetFile });
    }
  }
  return buffers;
}

function reportValidation(catalog) {
  const errors = validateCatalog(catalog);
  if (errors.length) {
    console.error("\nValidation failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`  validated ${catalog.parts.length} parts (${catalog.catalog_version})`);
}

async function crossCheckRoster(catalog) {
  if (process.env.RUN_COILCRAFT_LIVE !== "1") return;
  console.log("\nLive roster cross-check (RUN_COILCRAFT_LIVE=1):");
  for (const source of SOURCES) {
    try {
      const response = await fetch("https://www.coilcraft.com/api/partssearch/partsFromSeries", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": USER_AGENT },
        body: JSON.stringify({ IsPow: true, SeriesName: source.series })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const roster = new Set(
        JSON.stringify(data)
          .match(new RegExp(`${source.series}-\\d{3}`, "g") ?? [])
          ?.map((value) => value) ?? []
      );
      const parsed = catalog.parts.filter((part) => part.series === source.series).map((part) => part.base_part_number);
      const missing = parsed.filter((base) => !roster.has(base));
      console.log(`  ${source.series}: roster returned ${roster.size} codes; ${missing.length} parsed parts absent from roster`);
      if (missing.length) console.log(`    absent: ${missing.join(", ")}`);
    } catch (error) {
      console.log(`  ${source.series}: roster check unavailable (${error.message})`);
    }
  }
}

function writeCandidate(catalog) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const csv = serializeCsv(catalog);
  const json = serializeJson(catalog);
  writeFileSync(path.join(CACHE_DIR, "coilcraft-parts.csv"), csv);
  writeFileSync(path.join(CACHE_DIR, "coilcraft-inductors.v1.json"), json);
  return { csv, json };
}

function readTracked(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function reportDiff(candidate) {
  const targets = [
    { label: rel(TRACKED_CSV), next: candidate.csv, current: readTracked(TRACKED_CSV) },
    { label: rel(TRACKED_JSON), next: candidate.json, current: readTracked(TRACKED_JSON) }
  ];
  let changed = false;
  console.log("\nComparison with tracked files:");
  for (const target of targets) {
    if (target.current === null) {
      console.log(`  ${target.label}: NEW (not yet tracked)`);
      changed = true;
    } else if (target.current !== target.next) {
      console.log(`  ${target.label}: WOULD CHANGE`);
      changed = true;
    } else {
      console.log(`  ${target.label}: up to date`);
    }
  }
  return changed;
}

function promote(catalog, buffers) {
  mkdirSync(path.dirname(TRACKED_CSV), { recursive: true });
  mkdirSync(path.dirname(TRACKED_JSON), { recursive: true });
  writeFileSync(TRACKED_CSV, serializeCsv(catalog));
  writeFileSync(TRACKED_JSON, serializeJson(catalog));
  for (const entry of buffers) {
    if (entry.file) copyFileSync(path.join(CACHE_DIR, entry.file), path.join(DATASHEET_DIR, entry.file));
  }
  console.log(`\nPromoted:\n  ${rel(TRACKED_CSV)}\n  ${rel(TRACKED_JSON)}\n  datasheets under ${rel(DATASHEET_DIR)}`);
}

async function main() {
  const command = process.argv[2] || "check";

  if (command === "build") {
    console.log("Building catalog from committed datasheets:");
    const buffers = await loadBuffers("tracked");
    const catalog = buildCatalog({ buffers });
    reportValidation(catalog);
    await crossCheckRoster(catalog);
    writeFileSync(TRACKED_CSV, serializeCsv(catalog));
    writeFileSync(TRACKED_JSON, serializeJson(catalog));
    console.log(`\nWrote:\n  ${rel(TRACKED_CSV)}\n  ${rel(TRACKED_JSON)}`);
    return;
  }

  if (command === "check") {
    console.log("Checking current Coilcraft datasheets:");
    const buffers = await loadBuffers("download");
    const catalog = buildCatalog({ buffers });
    reportValidation(catalog);
    await crossCheckRoster(catalog);
    const candidate = writeCandidate(catalog);
    const changed = reportDiff(candidate);
    console.log(
      changed
        ? `\nCandidate written to ${rel(CACHE_DIR)}. Review, then run: npm run data:coilcraft:accept`
        : "\nTracked files are already current."
    );
    return;
  }

  if (command === "accept") {
    console.log("Accepting current Coilcraft datasheets:");
    const buffers = await loadBuffers("download");
    const catalog = buildCatalog({ buffers });
    reportValidation(catalog);
    await crossCheckRoster(catalog);
    writeCandidate(catalog);
    promote(catalog, buffers);
    return;
  }

  console.error(`Unknown command: ${command}. Use one of: build, check, accept.`);
  process.exit(2);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
