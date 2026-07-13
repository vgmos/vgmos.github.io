// Browser-side helpers for the Coilcraft inductor catalog consumed by the buck
// loss explorer. The catalog itself is a static JSON artifact generated offline
// by scripts/coilcraft/ — this module only loads it and applies the saturation
// and grouping policy the UI needs. No datasheet values are ever computed here.

const ISAT_FIELD = { 10: "isat_10pct_a", 20: "isat_20pct_a", 30: "isat_30pct_a" };

// Saturation-current selection policy: prefer the published 20 %-drop rating,
// then fall back to 30 %, then 10 %. A missing rating is never interpolated —
// if nothing is published we return null and the UI leaves Isat blank.
const ISAT_PREFERENCE = [20, 30, 10];

export function selectIsat(part) {
  if (!part) return null;
  for (const dropPct of ISAT_PREFERENCE) {
    const value = part[ISAT_FIELD[dropPct]];
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      return { value: Number(value), dropPct };
    }
  }
  return null;
}

export function dcrForMode(part, mode) {
  if (!part) return null;
  const value = mode === "max" ? part.dcr_max_mohm : part.dcr_typ_mohm;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

// Group parts by series, preserving the catalog's (already sorted) order and the
// order in which each series first appears.
export function groupPartsBySeries(parts = []) {
  const groups = new Map();
  for (const part of parts) {
    if (!groups.has(part.series)) groups.set(part.series, []);
    groups.get(part.series).push(part);
  }
  return [...groups.entries()].map(([series, seriesParts]) => ({ series, parts: seriesParts }));
}

function isValidCatalog(catalog) {
  return Boolean(catalog) && Array.isArray(catalog.parts) && catalog.parts.length > 0;
}

// Fetch the catalog JSON. Resolves to the parsed catalog, or rejects so the
// caller can keep the manual workflow and show a quiet message.
export async function loadCoilcraftCatalog(url, options = {}) {
  if (!url) throw new Error("Coilcraft catalog URL is missing.");
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: options.signal
  });
  if (!response.ok) throw new Error(`Coilcraft catalog request failed (HTTP ${response.status}).`);
  const catalog = await response.json();
  if (!isValidCatalog(catalog)) throw new Error("Coilcraft catalog is empty or malformed.");
  return catalog;
}
