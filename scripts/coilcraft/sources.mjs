// Canonical description of every Coilcraft source this pipeline understands.
//
// The electrical values themselves are never hard-coded here — they are parsed
// out of the datasheet PDF. This manifest only records provenance (URLs, the
// document number and revision printed on the sheet) and the shape of the
// datasheet's specification table so the parser knows how to read each row.

export const CATALOG_ID = "coilcraft-inductors";
export const SCHEMA_VERSION = 1;

export const DISCLAIMER =
  "Electrical values are transcribed from the referenced Coilcraft datasheets and are provided " +
  "for first-order modeling only. DCR represents modeled DC copper loss; AC and core loss are not " +
  "modeled. Always verify against the current manufacturer datasheet before design release. This " +
  "project is not affiliated with, endorsed by, or sponsored by Coilcraft, Inc.";

// A datasheet-table "shape": how many numeric columns follow the part-number
// anchor on each row and which of those columns are saturation-current ratings
// at a given inductance-drop percentage. `null` drops are simply not published
// for that series and must never be inferred.
const XEL_SHAPE = {
  // L, DCR typ, DCR max, SRF, Isat(30%), Irms 20C, Irms 40C
  columns: ["inductance_uh", "dcr_typ_mohm", "dcr_max_mohm", "srf_typ_mhz", "isat_30pct_a", "irms_20c_a", "irms_40c_a"],
  isatDrops: [30]
};

const XGL_SHAPE = {
  // L, DCR typ, DCR max, SRF, Isat(10%), Isat(20%), Isat(30%), Irms 20C, Irms 40C
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
};

export const SOURCES = [
  {
    manufacturer: "Coilcraft",
    series: "XEL4030",
    seriesUrl: "https://www.coilcraft.com/en-us/products/power/shielded-inductors/molded-inductor/xel/xel4030/",
    datasheetUrl: "https://www.coilcraft.com/getmedia/8245f050-f190-4295-8c41-7c03d662ee3d/xel4030.pdf",
    datasheetFile: "xel4030.pdf",
    documentNumber: "1321-1",
    revisionDate: "2026-02-19",
    tolerancePct: 20,
    specTempC: 25,
    testFrequencyMhz: 1,
    testVoltageVrms: 0.1,
    testDcBiasA: 0,
    orderableSuffix: "MEC",
    expectedCount: 13,
    shape: XEL_SHAPE
  },
  {
    manufacturer: "Coilcraft",
    series: "XGL6060",
    seriesUrl: "https://www.coilcraft.com/en-us/products/power/shielded-inductors/molded-inductor/xgl/xgl6060/",
    datasheetUrl: "https://www.coilcraft.com/getmedia/329fe97c-7311-4726-9bf3-37718f42b168/xgl6060.pdf",
    datasheetFile: "xgl6060.pdf",
    documentNumber: "1621-1",
    revisionDate: "2026-02-19",
    tolerancePct: 20,
    specTempC: 25,
    testFrequencyMhz: 1,
    testVoltageVrms: 0.1,
    testDcBiasA: 0,
    orderableSuffix: "MEC",
    expectedCount: 20,
    shape: XGL_SHAPE
  }
];

export function getSource(series) {
  return SOURCES.find((source) => source.series === series) ?? null;
}
