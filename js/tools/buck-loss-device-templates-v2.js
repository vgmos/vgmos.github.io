const source = (kind, detail, url = null, metadata = {}) => Object.freeze({ kind, detail, url, ...metadata });

const EPC_SOURCE = source(
  "datasheet-typical",
  "EPC2090, 25 °C typical unless noted; effective transition time remains a disclosed illustrative assumption.",
  "https://epc-co.com/epc/documents/datasheets/EPC2090_datasheet.pdf",
  { documentId: "EPC2090 datasheet", manufacturer: "EPC" }
);

const INFINEON_SOURCE = source(
  "datasheet-typical",
  "BSC010N04LS6 values at 25 °C and their stated test conditions. The same MOSFET is modeled high-side and low-side; unsupported transition timing and EOSS remain omitted.",
  "https://www.infineon.com/assets/row/public/documents/24/49/infineon-bsc010n04ls6-datasheet-en.pdf?fileId=5546d462689a790c0168bd076e184818",
  {
    documentId: "BSC010N04LS6",
    documentRevision: "Final Data Sheet Rev. 2.3 · 21-Jul-2022",
    manufacturer: "Infineon",
    productUrl: "https://www.infineon.com/part/BSC010N04LS6",
    model: Object.freeze({
      simulator: "PSpice macro · scoped native-LTspice characterization",
      library: "OptiMOS6_40V_Spice.lib",
      version: "280225 · 28-Feb-2025",
      url: "https://community.infineon.com/gfawx74859/attachments/gfawx74859/mosfetsisic/9679/1/OptiMOS6_40V_Spice.zip?nobounce",
      sourceThreadUrl: "https://community.infineon.com/t5/MOSFET-Si-SiC/Spice-model-of-Si-Mos/td-p/1110233",
      applicationNoteUrl: "https://www.infineon.com/assets/row/public/documents/24/42/infineon-applicationnote-powermosfet-simulationmodels-applicationnotes-en.pdf",
      requiredDirectives: Object.freeze([".options Thev_Induc=1"]),
      redistribution: "not-redistributed"
    })
  }
);

const TEACHING_SOURCE = source(
  "synthetic-teaching-fixture",
  "Rounded, deterministic illustrative values. This is not a vendor part or selection recommendation.",
  null,
  { documentId: "Synthetic teaching fixture" }
);

const symmetric = (values) => ({
  rdsHigh: values.rds,
  rdsLow: values.rds,
  qgHigh: values.qg,
  qgLow: values.qg,
  qgs2High: values.qgs2 ?? null,
  qgs2Low: values.qgs2 ?? null,
  qgdHigh: values.qgd ?? null,
  qgdLow: values.qgd ?? null,
  plateauHigh: values.plateau ?? null,
  plateauLow: values.plateau ?? null,
  gateResistanceOnHigh: values.rgOn ?? values.rg ?? null,
  gateResistanceOffHigh: values.rgOff ?? values.rg ?? null,
  gateResistanceOnLow: values.rgOn ?? values.rg ?? null,
  gateResistanceOffLow: values.rgOff ?? values.rg ?? null,
  cossErHigh: values.cossEr ?? null,
  cossErLow: values.cossEr ?? null,
  eossMaxVoltage: values.eossMaxVoltage ?? null,
  diodeVf: values.diodeVf,
  qrrRef: values.qrrRef,
  qrrRefCurrent: values.qrrRefCurrent ?? 10,
  vDrive: values.vDrive ?? 5
});

const makeTemplate = (config) => {
  const { provenanceOverrides = {}, ...template } = config;
  return Object.freeze({
    ...template,
    values: Object.freeze(config.values),
    provenance: Object.freeze({
      ...Object.fromEntries(Object.entries(config.values).map(([key, value]) => [key, value === null ? "missing" : config.source.kind])),
      ...provenanceOverrides
    })
  });
};

const DEVICE_TEMPLATE_FIELDS = Object.freeze([
  "rdsHigh", "rdsLow", "qgHigh", "qgLow", "qgs2High", "qgs2Low", "qgdHigh", "qgdLow",
  "plateauHigh", "plateauLow", "gateResistanceOnHigh", "gateResistanceOffHigh",
  "gateResistanceOnLow", "gateResistanceOffLow", "effectiveTurnOn", "effectiveTurnOff",
  "cossErHigh", "cossErLow", "eossMaxVoltage", "diodeVf", "qrrRef", "qrrRefCurrent", "vDrive"
]);

export const BUCK_LOSS_DEVICE_TEMPLATES_V2 = Object.freeze([
  makeTemplate({
    id: "epc2090",
    label: "EPC2090 GaN",
    technology: "gan",
    catalogKind: "manufacturer",
    manufacturer: "EPC",
    partNumber: "EPC2090",
    cornerId: "mixed-datasheet-25c",
    cornerLabel: "Mixed datasheet typical · 25 °C",
    voltageClass: 100,
    timingMode: "effective",
    source: EPC_SOURCE,
    modelSource: Object.freeze({
      publisher: "Efficient Power Conversion Corporation",
      url: "https://epc-co.com/epc/documents/spice-files/LTSPICE/EPCGaNLibrary.zip",
      simulator: "LTspice 17.0.38",
      version: "1.104 · 22-Jul-2025",
      applicationNoteUrl: "https://epc-co.com/epc/documents/product-training/Circuit_Simulations_Using_Device_Models.pdf",
      requiredDirectives: Object.freeze([]),
      redistribution: "not-redistributed"
    }),
    notes: Object.freeze([
      "QGS2 is inferred as QGS − QG(TH).",
      "COSS(ER) is characterized over 0–50 V; EOSS is omitted above that domain.",
      "3 ns turn-on and 2 ns turn-off values are illustrative effective crossover intervals, not datasheet switching times."
    ]),
    provenanceOverrides: {
      qgs2High: "inferred-qgs-minus-qgth",
      qgs2Low: "inferred-qgs-minus-qgth",
      effectiveTurnOn: "inferred-effective-overlap",
      effectiveTurnOff: "inferred-effective-overlap"
    },
    values: {
      ...symmetric({
        rds: 3.8,
        qg: 7.3,
        qgs2: 0.7,
        qgd: 0.7,
        plateau: null,
        rg: 0.4,
        cossEr: 441,
        eossMaxVoltage: 50,
        diodeVf: 1.5,
        qrrRef: 0
      }),
      effectiveTurnOn: 3,
      effectiveTurnOff: 2
    }
  }),
  makeTemplate({
    id: "infineon-bsc010n04ls6-4v5",
    label: "Infineon BSC010N04LS6 pair",
    technology: "silicon",
    catalogKind: "manufacturer",
    manufacturer: "Infineon",
    partNumber: "BSC010N04LS6",
    cornerId: "mixed-datasheet-25c-vgs4v5",
    cornerLabel: "Mixed datasheet typical · 25 °C · VGS 4.5 V",
    voltageClass: 40,
    timingMode: "effective",
    source: INFINEON_SOURCE,
    modelSource: Object.freeze({
      publisher: "Infineon Technologies AG",
      url: "https://community.infineon.com/gfawx74859/attachments/gfawx74859/mosfetsisic/9679/1/OptiMOS6_40V_Spice.zip?nobounce",
      simulator: "LTspice 17.0.38",
      version: "280225 · 28-Feb-2025",
      applicationNoteUrl: "https://www.infineon.com/assets/row/public/documents/24/42/infineon-applicationnote-powermosfet-simulationmodels-applicationnotes-en.pdf",
      requiredDirectives: Object.freeze([".options Thev_Induc=1"]),
      redistribution: "not-redistributed"
    }),
    conditions: Object.freeze({
      rdsHigh: "VGS = 4.5 V, ID = 50 A; 1.10 mΩ typical, 1.40 mΩ maximum",
      qgHigh: "VDD = 20 V, ID = 50 A, VGS = 0 to 4.5 V",
      qgs2High: "Inferred as QGS − QG(th) = 12 nC − 7.3 nC; VDD = 20 V, ID = 50 A, VGS = 0 to 10 V",
      qgdHigh: "VDD = 20 V, ID = 50 A, VGS = 0 to 10 V",
      plateauHigh: "VDD = 20 V, ID = 50 A, VGS = 0 to 10 V",
      diodeVf: "VGS = 0 V, IF = 50 A, TJ = 25 °C",
      qrrRef: "VR = 20 V, IF = 10 A, dIF/dt = 400 A/µs, TJ = 25 °C"
    }),
    parameterConditions: Object.freeze({
      rdsHigh: Object.freeze({ statistic: "typical", conditions: "VGS = 4.5 V, ID = 50 A, TJ = 25 °C", maximum: 1.4 }),
      rdsLow: Object.freeze({ statistic: "typical", conditions: "VGS = 4.5 V, ID = 50 A, TJ = 25 °C", maximum: 1.4 }),
      qgHigh: Object.freeze({ statistic: "typical", conditions: "VDD = 20 V, ID = 50 A, VGS = 0 to 4.5 V, TJ = 25 °C" }),
      qgLow: Object.freeze({ statistic: "typical", conditions: "VDD = 20 V, ID = 50 A, VGS = 0 to 4.5 V, TJ = 25 °C" }),
      qgs2High: Object.freeze({ statistic: "inferred", conditions: "QGS 12 nC − QG(th) 7.3 nC; VDD = 20 V, ID = 50 A, VGS = 0 to 10 V, TJ = 25 °C" }),
      qgs2Low: Object.freeze({ statistic: "inferred", conditions: "QGS 12 nC − QG(th) 7.3 nC; VDD = 20 V, ID = 50 A, VGS = 0 to 10 V, TJ = 25 °C" }),
      qgdHigh: Object.freeze({ statistic: "typical", conditions: "VDD = 20 V, ID = 50 A, VGS = 0 to 10 V, TJ = 25 °C", maximum: 12, qualification: "Defined by design; not subject to production test." }),
      qgdLow: Object.freeze({ statistic: "typical", conditions: "VDD = 20 V, ID = 50 A, VGS = 0 to 10 V, TJ = 25 °C", maximum: 12, qualification: "Defined by design; not subject to production test." }),
      plateauHigh: Object.freeze({ statistic: "typical", conditions: "VDD = 20 V, ID = 50 A, VGS = 0 to 10 V, TJ = 25 °C" }),
      plateauLow: Object.freeze({ statistic: "typical", conditions: "VDD = 20 V, ID = 50 A, VGS = 0 to 10 V, TJ = 25 °C" }),
      diodeVf: Object.freeze({ statistic: "typical", conditions: "VGS = 0 V, IF = 50 A, TJ = 25 °C", maximum: 1 }),
      qrrRef: Object.freeze({ statistic: "typical", conditions: "VR = 20 V, IF = 10 A, dIF/dt = 400 A/µs, TJ = 25 °C", maximum: 194, qualification: "Defined by design; not subject to production test." }),
      qrrRefCurrent: Object.freeze({ statistic: "reference condition", conditions: "IF = 10 A for QRR at VR = 20 V, dIF/dt = 400 A/µs, TJ = 25 °C" }),
      vDrive: Object.freeze({ statistic: "selected test condition", conditions: "VGS = 4.5 V to match the active RDS(on) and total-gate-charge corner at TJ = 25 °C" })
    }),
    notes: Object.freeze([
      "Active values retain their individual datasheet conditions: RDS(on) and QG use the 4.5 V corner; QGS2 is inferred, while QGD and plateau use the 10 V gate-charge test. QGD and QRR are defined by design, not production-tested.",
      "The published 1 Ω internal gate resistance is not the total driver-plus-external gate path, so overlap remains omitted until a complete gate path or effective time is entered.",
      "QRR scales linearly from its 10 A reference point; VSD remains a load-independent first-order value.",
      "QOSS and small-signal COSS are not substituted for energy-equivalent COSS(ER), so switch-node energy remains omitted.",
      "The official PSpice library is checked in native LTspice only for scoped validation; the vendor model is not redistributed."
    ]),
    provenanceOverrides: {
      qrrRefCurrent: "datasheet-test-condition",
      vDrive: "datasheet-test-condition",
      qgs2High: "inferred-qgs-minus-qgth",
      qgs2Low: "inferred-qgs-minus-qgth",
      gateResistanceOnHigh: "missing",
      gateResistanceOffHigh: "missing",
      gateResistanceOnLow: "missing",
      gateResistanceOffLow: "missing",
      effectiveTurnOn: "missing",
      effectiveTurnOff: "missing",
      cossErHigh: "missing",
      cossErLow: "missing",
      eossMaxVoltage: "missing"
    },
    values: {
      ...symmetric({
        rds: 1.1,
        qg: 32,
        qgs2: 4.7,
        qgd: 8.1,
        plateau: 2.7,
        rg: null,
        cossEr: null,
        eossMaxVoltage: null,
        diodeVf: 0.8,
        qrrRef: 97,
        qrrRefCurrent: 10,
        vDrive: 4.5
      }),
      effectiveTurnOn: null,
      effectiveTurnOff: null
    }
  }),
  ...[
    { id: "silicon-30v", label: "Silicon · 30 V", voltageClass: 30, rds: 5, qg: 20, qgs2: 4, qgd: 5, plateau: 2.5, cossEr: 800, qrrRef: 30, diodeVf: 0.8, rg: 2 },
    { id: "silicon-60v", label: "Silicon · 60 V", voltageClass: 60, rds: 10, qg: 30, qgs2: 6, qgd: 8, plateau: 3, cossEr: 500, qrrRef: 60, diodeVf: 0.85, rg: 3 },
    { id: "silicon-100v", label: "Silicon · 100 V", voltageClass: 100, rds: 20, qg: 45, qgs2: 9, qgd: 12, plateau: 3.5, cossEr: 350, qrrRef: 100, diodeVf: 0.9, rg: 4 }
  ].map((item) => makeTemplate({
    id: item.id,
    label: item.label,
    technology: "silicon",
    catalogKind: "teaching",
    manufacturer: null,
    partNumber: null,
    cornerId: "synthetic-typical-25c",
    cornerLabel: "Synthetic typical · 25 °C",
    voltageClass: item.voltageClass,
    timingMode: "derived",
    source: TEACHING_SOURCE,
    notes: Object.freeze([
      "All values are synthetic and fixed at 25 °C for reproducible teaching examples.",
      "QRR scales linearly from the 10 A reference current."
    ]),
    values: symmetric({ ...item, eossMaxVoltage: item.voltageClass })
  }))
]);

export const BUCK_LOSS_DEVICE_TEMPLATE_MAP_V2 = new Map(
  BUCK_LOSS_DEVICE_TEMPLATES_V2.map((template) => [template.id, template])
);

export function getBuckLossDeviceTemplateV2(id) {
  return BUCK_LOSS_DEVICE_TEMPLATE_MAP_V2.get(id) ?? null;
}

export function applyBuckLossDeviceTemplateV2(rawInputs = {}, templateId) {
  const template = getBuckLossDeviceTemplateV2(templateId);
  if (!template) return { rawInputs: { ...rawInputs }, template: null };
  const clearedValues = Object.fromEntries(DEVICE_TEMPLATE_FIELDS.map((key) => [key, null]));
  const clearedProvenance = Object.fromEntries(DEVICE_TEMPLATE_FIELDS.map((key) => [key, "missing"]));
  return {
    template,
    rawInputs: {
      ...rawInputs,
      ...clearedValues,
      ...template.values,
      __provenance: {
        ...(rawInputs.__provenance || {}),
        ...clearedProvenance,
        ...template.provenance
      }
    }
  };
}

export function recommendedSiliconTemplateV2(vin) {
  if (vin <= 24) return "silicon-30v";
  if (vin <= 48) return "silicon-60v";
  return "silicon-100v";
}
