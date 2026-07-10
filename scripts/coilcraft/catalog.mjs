// Assemble the canonical Coilcraft inductor catalog from the datasheet PDFs and
// serialize it to the two tracked artifacts: a flat review CSV and a normalized
// browser JSON. Output is deterministic — no timestamps — so regenerating from
// unchanged inputs reproduces byte-identical files.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CATALOG_ID, DISCLAIMER, SCHEMA_VERSION, SOURCES } from "./sources.mjs";
import { extractPdfText } from "./pdf-text.mjs";
import { parseSeries } from "./parse.mjs";

export const CSV_COLUMNS = [
  "manufacturer",
  "series",
  "base_part_number",
  "part_number",
  "inductance_uh",
  "tolerance_pct",
  "dcr_typ_mohm",
  "dcr_max_mohm",
  "srf_typ_mhz",
  "isat_10pct_a",
  "isat_20pct_a",
  "isat_30pct_a",
  "irms_20c_a",
  "irms_40c_a",
  "spec_temp_c",
  "test_freq_mhz",
  "test_voltage_vrms",
  "test_dc_bias_a",
  "series_url",
  "datasheet_url",
  "datasheet_document",
  "datasheet_revision",
  "datasheet_sha256"
];

const BROWSER_PART_FIELDS = [
  "series",
  "base_part_number",
  "part_number",
  "inductance_uh",
  "tolerance_pct",
  "dcr_typ_mohm",
  "dcr_max_mohm",
  "srf_typ_mhz",
  "isat_10pct_a",
  "isat_20pct_a",
  "isat_30pct_a",
  "irms_20c_a",
  "irms_40c_a",
  "datasheet_url"
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function seriesRank(series) {
  const index = SOURCES.findIndex((source) => source.series === series);
  return index === -1 ? SOURCES.length : index;
}

// Deterministic ordering: datasheet order (XEL4030 before XGL6060), then
// ascending inductance, then part number as a final tie-breaker.
function sortParts(parts) {
  return [...parts].sort((a, b) => {
    if (a.series !== b.series) return seriesRank(a.series) - seriesRank(b.series);
    if (a.inductance_uh !== b.inductance_uh) return a.inductance_uh - b.inductance_uh;
    return a.base_part_number.localeCompare(b.base_part_number);
  });
}

// Build the catalog from datasheet buffers. Pass `{ series, buffer }` entries to
// parse in-memory (used by the acquisition pipeline for freshly downloaded
// candidates); otherwise the tracked datasheets are read from disk.
export function buildCatalog({ datasheetsDir, buffers } = {}) {
  const bufferBySeries = new Map((buffers ?? []).map((entry) => [entry.series, entry.buffer]));
  const parts = [];
  const sources = [];

  for (const source of SOURCES) {
    const buffer =
      bufferBySeries.get(source.series) ??
      readFileSync(path.join(datasheetsDir, source.datasheetFile));
    const checksum = sha256(buffer);
    const text = extractPdfText(buffer);
    const seriesParts = parseSeries(text, source, checksum);
    parts.push(...seriesParts);
    sources.push({
      manufacturer: source.manufacturer,
      series: source.series,
      series_url: source.seriesUrl,
      datasheet_url: source.datasheetUrl,
      document_number: source.documentNumber,
      revision_date: source.revisionDate,
      sha256: checksum,
      tolerance_pct: source.tolerancePct,
      spec_temp_c: source.specTempC,
      test_frequency_mhz: source.testFrequencyMhz,
      test_voltage_vrms: source.testVoltageVrms,
      test_dc_bias_a: source.testDcBiasA,
      isat_drops_pct: source.shape.isatDrops,
      part_count: seriesParts.length
    });
  }

  const sortedParts = sortParts(parts);
  const payload = {
    schema_version: SCHEMA_VERSION,
    catalog_id: CATALOG_ID,
    disclaimer: DISCLAIMER,
    sources,
    parts: sortedParts
  };
  const catalog_version = `sha256:${sha256(Buffer.from(JSON.stringify(payload)))}`;
  return { catalog_version, ...payload };
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCsv(catalog) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const part of catalog.parts) {
    lines.push(CSV_COLUMNS.map((column) => csvValue(part[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function serializeJson(catalog) {
  const browser = {
    schema_version: catalog.schema_version,
    catalog_id: catalog.catalog_id,
    catalog_version: catalog.catalog_version,
    disclaimer: catalog.disclaimer,
    sources: catalog.sources,
    parts: catalog.parts.map((part) => {
      const trimmed = {};
      for (const field of BROWSER_PART_FIELDS) trimmed[field] = part[field];
      return trimmed;
    })
  };
  return `${JSON.stringify(browser, null, 2)}\n`;
}

// Structural and physical-plausibility checks. Returns a list of human-readable
// problems; an empty list means the candidate is valid.
export function validateCatalog(catalog) {
  const errors = [];
  const seen = new Set();

  for (const source of SOURCES) {
    const count = catalog.parts.filter((part) => part.series === source.series).length;
    if (count !== source.expectedCount) {
      errors.push(`${source.series}: expected ${source.expectedCount} parts, found ${count}`);
    }
  }

  for (const part of catalog.parts) {
    const id = part.base_part_number;
    if (seen.has(id)) errors.push(`duplicate part number ${id}`);
    seen.add(id);

    const positives = [
      "inductance_uh",
      "dcr_typ_mohm",
      "dcr_max_mohm",
      "srf_typ_mhz",
      "irms_20c_a",
      "irms_40c_a"
    ];
    for (const key of positives) {
      if (!(Number.isFinite(part[key]) && part[key] > 0)) {
        errors.push(`${id}: ${key} must be a positive finite number (got ${part[key]})`);
      }
    }

    if (part.dcr_max_mohm < part.dcr_typ_mohm) {
      errors.push(`${id}: max DCR ${part.dcr_max_mohm} < typ DCR ${part.dcr_typ_mohm}`);
    }
    if (part.irms_40c_a < part.irms_20c_a) {
      errors.push(`${id}: Irms 40°C ${part.irms_40c_a} < Irms 20°C ${part.irms_20c_a}`);
    }

    const isats = [part.isat_10pct_a, part.isat_20pct_a, part.isat_30pct_a];
    for (const value of isats) {
      if (value !== null && !(Number.isFinite(value) && value > 0)) {
        errors.push(`${id}: published Isat values must be positive (got ${value})`);
      }
    }
    if (isats.every((value) => value !== null)) {
      const [i10, i20, i30] = isats;
      if (!(i10 <= i20 && i20 <= i30)) {
        errors.push(`${id}: Isat not monotonic across drop % (${i10} ≤ ${i20} ≤ ${i30})`);
      }
    }
    if (isats.every((value) => value === null)) {
      errors.push(`${id}: no published saturation rating`);
    }
  }

  return errors;
}
