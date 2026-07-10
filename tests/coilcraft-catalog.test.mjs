import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildCatalog,
  serializeCsv,
  serializeJson,
  validateCatalog
} from "../scripts/coilcraft/catalog.mjs";
import { parseSeries } from "../scripts/coilcraft/parse.mjs";
import { selectIsat, dcrForMode, groupPartsBySeries } from "../js/tools/coilcraft-catalog.js";

const DATASHEET_DIR = fileURLToPath(new URL("../data/inductors/datasheets", import.meta.url));
const TRACKED_CSV = fileURLToPath(new URL("../data/inductors/coilcraft-parts.csv", import.meta.url));
const TRACKED_JSON = fileURLToPath(new URL("../assets/data/coilcraft-inductors.v1.json", import.meta.url));

const catalog = buildCatalog({ datasheetsDir: DATASHEET_DIR });
const partByBase = (base) => catalog.parts.find((part) => part.base_part_number === base);

describe("coilcraft catalog data", () => {
  it("contains exactly 13 XEL4030 and 20 XGL6060 parts", () => {
    const xel = catalog.parts.filter((part) => part.series === "XEL4030");
    const xgl = catalog.parts.filter((part) => part.series === "XGL6060");
    assert.equal(xel.length, 13);
    assert.equal(xgl.length, 20);
    assert.equal(catalog.parts.length, 33);
  });

  it("uses unique part numbers", () => {
    const bases = catalog.parts.map((part) => part.base_part_number);
    const orderables = catalog.parts.map((part) => part.part_number);
    assert.equal(new Set(bases).size, bases.length);
    assert.equal(new Set(orderables).size, orderables.length);
  });

  it("keeps every modeled electrical value positive and finite", () => {
    for (const part of catalog.parts) {
      for (const key of ["inductance_uh", "dcr_typ_mohm", "dcr_max_mohm", "srf_typ_mhz", "irms_20c_a", "irms_40c_a"]) {
        assert.ok(Number.isFinite(part[key]) && part[key] > 0, `${part.base_part_number}.${key}`);
      }
    }
  });

  it("keeps maximum DCR at or above typical DCR", () => {
    for (const part of catalog.parts) {
      assert.ok(part.dcr_max_mohm >= part.dcr_typ_mohm, part.base_part_number);
    }
  });

  it("keeps 40°C Irms at or above 20°C Irms", () => {
    for (const part of catalog.parts) {
      assert.ok(part.irms_40c_a >= part.irms_20c_a, part.base_part_number);
    }
  });

  it("keeps XGL6060 saturation ratings monotonic across drop percentage", () => {
    for (const part of catalog.parts.filter((entry) => entry.series === "XGL6060")) {
      assert.ok(
        part.isat_10pct_a <= part.isat_20pct_a && part.isat_20pct_a <= part.isat_30pct_a,
        part.base_part_number
      );
    }
  });

  it("passes the built-in structural validator", () => {
    assert.deepEqual(validateCatalog(catalog), []);
  });

  it("does not invent unpublished XEL4030 saturation ratings", () => {
    for (const part of catalog.parts.filter((entry) => entry.series === "XEL4030")) {
      assert.equal(part.isat_10pct_a, null);
      assert.equal(part.isat_20pct_a, null);
      assert.ok(Number.isFinite(part.isat_30pct_a) && part.isat_30pct_a > 0);
    }
  });

  it("matches the known XGL6060-222 datasheet row", () => {
    const part = partByBase("XGL6060-222");
    assert.equal(part.inductance_uh, 2.2);
    assert.equal(part.dcr_typ_mohm, 4.3);
    assert.equal(part.dcr_max_mohm, 4.8);
    assert.equal(part.isat_20pct_a, 12.1);
    assert.equal(part.part_number, "XGL6060-222MEC");
    assert.deepEqual(selectIsat(part), { value: 12.1, dropPct: 20 });
  });

  it("matches the known XEL4030-201 datasheet row", () => {
    const part = partByBase("XEL4030-201");
    assert.equal(part.inductance_uh, 0.2);
    assert.equal(part.dcr_typ_mohm, 2.15);
    assert.equal(part.dcr_max_mohm, 2.4);
    assert.equal(part.isat_30pct_a, 22);
    assert.equal(part.part_number, "XEL4030-201MEC");
    assert.deepEqual(selectIsat(part), { value: 22, dropPct: 30 });
  });
});

describe("coilcraft deterministic output", () => {
  it("regenerates the tracked CSV byte-for-byte", () => {
    assert.equal(serializeCsv(catalog), readFileSync(TRACKED_CSV, "utf8"));
  });

  it("regenerates the tracked JSON byte-for-byte", () => {
    assert.equal(serializeJson(catalog), readFileSync(TRACKED_JSON, "utf8"));
  });

  it("produces a stable catalog version on rebuild", () => {
    const rebuilt = buildCatalog({ datasheetsDir: DATASHEET_DIR });
    assert.equal(rebuilt.catalog_version, catalog.catalog_version);
    assert.match(catalog.catalog_version, /^sha256:[0-9a-f]{64}$/);
  });
});

const SINGLE_ISAT_SOURCE = {
  manufacturer: "Coilcraft",
  series: "XEL4030",
  seriesUrl: "https://example.invalid/xel",
  datasheetUrl: "https://example.invalid/xel.pdf",
  documentNumber: "1321-1",
  revisionDate: "2026-02-19",
  tolerancePct: 20,
  specTempC: 25,
  testFrequencyMhz: 1,
  testVoltageVrms: 0.1,
  testDcBiasA: 0,
  orderableSuffix: "MEC",
  expectedCount: 2,
  shape: {
    columns: ["inductance_uh", "dcr_typ_mohm", "dcr_max_mohm", "srf_typ_mhz", "isat_30pct_a", "irms_20c_a", "irms_40c_a"],
    isatDrops: [30]
  }
};

const TRIPLE_ISAT_SOURCE = {
  ...SINGLE_ISAT_SOURCE,
  series: "XGL6060",
  documentNumber: "1621-1",
  shape: {
    columns: [
      "inductance_uh",
      "dcr_typ_mohm",
      "dcr_max_mohm",
      "srf_typ_mhz",
      "isat_10pct_a",
      "isat_20pct_a",
      "isat_30pct_a",
      "irms_20c_a",
      "irms_40c_a"
    ],
    isatDrops: [10, 20, 30]
  }
};

describe("coilcraft parser table shapes", () => {
  it("parses a single-Isat (XEL) table and leaves 10%/20% drops null", () => {
    const text = "40°C rise XEL4030-101ME_ 0.10 1.50 1.80 240 30.0 20.4 25.8 XEL4030-201ME_ 0.20 2.15 2.40 155 22.0 17.0 21.6";
    const parts = parseSeries(text, SINGLE_ISAT_SOURCE, "abc");
    assert.equal(parts.length, 2);
    assert.equal(parts[0].base_part_number, "XEL4030-101");
    assert.equal(parts[0].isat_30pct_a, 30);
    assert.equal(parts[0].isat_10pct_a, null);
    assert.equal(parts[0].isat_20pct_a, null);
    assert.equal(parts[1].dcr_typ_mohm, 2.15);
    assert.equal(parts[1].datasheet_sha256, "abc");
  });

  it("parses a triple-Isat (XGL) table with all three drop ratings", () => {
    const text = "40°C rise XGL6060-221ME_ 0.22 1.1 1.3 125 17.8 28.5 38.0 35.5 48.0 XGL6060-471ME_ 0.47 1.5 1.8 75 13.8 22.0 29.5 26.0 35.5";
    const parts = parseSeries(text, TRIPLE_ISAT_SOURCE, "def");
    assert.equal(parts.length, 2);
    assert.deepEqual(
      [parts[0].isat_10pct_a, parts[0].isat_20pct_a, parts[0].isat_30pct_a],
      [17.8, 28.5, 38.0]
    );
    assert.equal(parts[1].srf_typ_mhz, 75);
  });

  it("throws when a row is missing columns (datasheet layout drift)", () => {
    const text = "40°C rise XEL4030-101ME_ 0.10 1.50 1.80 XEL4030-201ME_ 0.20 2.15 2.40 155 22.0 17.0 21.6";
    assert.throws(() => parseSeries(text, SINGLE_ISAT_SOURCE, "abc"), /numeric columns|table rows/);
  });

  it("ignores the ordering example printed above the table", () => {
    // The "XEL4030-201MEC" ordering example appears before the header and must
    // not be mistaken for a data row.
    const text =
      "When ordering: XEL4030-201MEC ... 40°C rise " +
      "XEL4030-101ME_ 0.10 1.50 1.80 240 30.0 20.4 25.8 " +
      "XEL4030-201ME_ 0.20 2.15 2.40 155 22.0 17.0 21.6";
    const parts = parseSeries(text, SINGLE_ISAT_SOURCE, "abc");
    assert.deepEqual(parts.map((part) => part.base_part_number), ["XEL4030-101", "XEL4030-201"]);
  });
});

describe("coilcraft browser helpers", () => {
  it("prefers the 20% drop rating, then 30%, then 10%", () => {
    assert.deepEqual(selectIsat({ isat_10pct_a: 10, isat_20pct_a: 20, isat_30pct_a: 30 }), { value: 20, dropPct: 20 });
    assert.deepEqual(selectIsat({ isat_10pct_a: 10, isat_20pct_a: null, isat_30pct_a: 30 }), { value: 30, dropPct: 30 });
    assert.deepEqual(selectIsat({ isat_10pct_a: 10, isat_20pct_a: null, isat_30pct_a: null }), { value: 10, dropPct: 10 });
    assert.equal(selectIsat({ isat_10pct_a: null, isat_20pct_a: null, isat_30pct_a: null }), null);
  });

  it("selects DCR by mode", () => {
    const part = { dcr_typ_mohm: 4.3, dcr_max_mohm: 4.8 };
    assert.equal(dcrForMode(part, "typ"), 4.3);
    assert.equal(dcrForMode(part, "max"), 4.8);
    assert.equal(dcrForMode(part, "unknown"), 4.3);
  });

  it("groups parts by series in catalog order", () => {
    const groups = groupPartsBySeries(catalog.parts);
    assert.deepEqual(groups.map((group) => group.series), ["XEL4030", "XGL6060"]);
    assert.equal(groups[0].parts.length, 13);
    assert.equal(groups[1].parts.length, 20);
  });
});

describe("coilcraft validator catches regressions", () => {
  it("flags a non-monotonic saturation sweep", () => {
    const broken = structuredClone(catalog);
    const target = broken.parts.find((part) => part.base_part_number === "XGL6060-222");
    target.isat_30pct_a = 1; // now 7.9, 12.1, 1 — not monotonic
    assert.ok(validateCatalog(broken).some((message) => /monotonic/.test(message)));
  });

  it("flags max DCR below typical DCR", () => {
    const broken = structuredClone(catalog);
    broken.parts[0].dcr_max_mohm = 0.01;
    assert.ok(validateCatalog(broken).some((message) => /max DCR/.test(message)));
  });
});
