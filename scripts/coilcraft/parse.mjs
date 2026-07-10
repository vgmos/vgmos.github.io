// Parse a Coilcraft datasheet's specification table into structured part rows.
//
// Both supported table shapes share the same physical layout: a part-number
// anchor (`<series>-<code>M...`) followed by a fixed run of numeric columns.
// The per-series shape (see sources.mjs) says how many columns there are and
// which columns are saturation ratings at 10 %, 20 %, or 30 % inductance drop.
// Unpublished ratings are recorded as `null` and never inferred.

const ISAT_KEYS = { 10: "isat_10pct_a", 20: "isat_20pct_a", 30: "isat_30pct_a" };
const NUMBER = /-?\d+(?:\.\d+)?/g;

function normalize(text) {
  return text.replace(/en-US/g, " ").replace(/ /g, " ").replace(/[ \t]+/g, " ");
}

// The data rows begin immediately after the final header cell ("40°C rise").
// Anchoring here excludes the ordering example (e.g. "XEL4030-682MEC") that is
// printed above the table and would otherwise masquerade as a data row.
function tableRegion(text) {
  const header = text.lastIndexOf("40°C rise");
  return header === -1 ? text : text.slice(header + "40°C rise".length);
}

export function parseSeries(rawText, source, sha256) {
  const { series, shape } = source;
  const text = tableRegion(normalize(rawText));
  const anchor = new RegExp(`${series}-(\\d{3})M`, "g");

  const anchors = [];
  let match;
  while ((match = anchor.exec(text)) !== null) {
    anchors.push({ code: match[1], start: match.index, end: anchor.lastIndex });
  }
  if (anchors.length < source.expectedCount) {
    throw new Error(
      `${series}: found ${anchors.length} table rows, expected at least ${source.expectedCount}. ` +
        "The datasheet layout may have changed."
    );
  }

  const rows = anchors.slice(0, source.expectedCount);
  const parts = rows.map((row, index) => {
    const slice = text.slice(row.end, index + 1 < rows.length ? rows[index + 1].start : undefined);
    const numbers = (slice.match(NUMBER) || []).slice(0, shape.columns.length).map(Number);
    if (numbers.length !== shape.columns.length || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error(
        `${series}-${row.code}: read ${numbers.length}/${shape.columns.length} numeric columns. ` +
          "The datasheet layout may have changed."
      );
    }

    const base = `${series}-${row.code}`;
    const part = {
      manufacturer: source.manufacturer,
      series,
      base_part_number: base,
      part_number: `${base}${source.orderableSuffix}`,
      inductance_uh: null,
      tolerance_pct: source.tolerancePct,
      dcr_typ_mohm: null,
      dcr_max_mohm: null,
      srf_typ_mhz: null,
      isat_10pct_a: null,
      isat_20pct_a: null,
      isat_30pct_a: null,
      irms_20c_a: null,
      irms_40c_a: null,
      spec_temp_c: source.specTempC,
      test_freq_mhz: source.testFrequencyMhz,
      test_voltage_vrms: source.testVoltageVrms,
      test_dc_bias_a: source.testDcBiasA,
      series_url: source.seriesUrl,
      datasheet_url: source.datasheetUrl,
      datasheet_document: source.documentNumber,
      datasheet_revision: source.revisionDate,
      datasheet_sha256: sha256
    };
    shape.columns.forEach((key, columnIndex) => {
      part[key] = numbers[columnIndex];
    });
    return part;
  });

  const isatDrops = new Set(shape.isatDrops);
  for (const drop of [10, 20, 30]) {
    if (!isatDrops.has(drop)) {
      parts.forEach((part) => {
        part[ISAT_KEYS[drop]] = null;
      });
    }
  }
  return parts;
}
