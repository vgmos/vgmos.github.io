const source = (kind, detail, url = null) => Object.freeze({ kind, detail, url });

const EPC_SOURCE = source(
  "datasheet-typical",
  "EPC2090, 25 °C typical unless noted; effective transition time remains a disclosed teaching assumption.",
  "https://epc-co.com/epc/documents/datasheets/EPC2090_datasheet.pdf"
);

const TEACHING_SOURCE = source(
  "synthetic-teaching-fixture",
  "Rounded, deterministic teaching values. This is not a vendor part or selection recommendation."
);

const symmetric = (values) => ({
  rdsHigh: values.rds,
  rdsLow: values.rds,
  qgHigh: values.qg,
  qgLow: values.qg,
  qgs2High: values.qgs2,
  qgs2Low: values.qgs2,
  qgdHigh: values.qgd,
  qgdLow: values.qgd,
  plateauHigh: values.plateau,
  plateauLow: values.plateau,
  gateResistanceOnHigh: values.rg,
  gateResistanceOffHigh: values.rg,
  gateResistanceOnLow: values.rg,
  gateResistanceOffLow: values.rg,
  cossErHigh: values.cossEr,
  cossErLow: values.cossEr,
  eossMaxVoltage: values.eossMaxVoltage,
  diodeVf: values.diodeVf,
  qrrRef: values.qrrRef,
  qrrRefCurrent: values.qrrRefCurrent ?? 10,
  vDrive: 5
});

const makeTemplate = (config) => {
  const { provenanceOverrides = {}, ...template } = config;
  return Object.freeze({
    ...template,
    values: Object.freeze(config.values),
    provenance: Object.freeze({
      ...Object.fromEntries(Object.keys(config.values).map((key) => [key, config.source.kind])),
      ...provenanceOverrides
    })
  });
};

export const BUCK_LOSS_DEVICE_TEMPLATES_V2 = Object.freeze([
  makeTemplate({
    id: "epc2090",
    label: "EPC2090 GaN",
    technology: "gan",
    voltageClass: 100,
    timingMode: "effective",
    source: EPC_SOURCE,
    notes: Object.freeze([
      "QGS2 is inferred as QGS − QG(TH).",
      "COSS(ER) is characterized over 0–50 V; EOSS is omitted above that domain.",
      "7.5 ns turn-on and turn-off effective overlaps are teaching assumptions, not datasheet switching times."
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
      effectiveTurnOn: 7.5,
      effectiveTurnOff: 7.5
    }
  }),
  ...[
    { id: "silicon-30v", label: "Silicon teaching · 30 V", voltageClass: 30, rds: 5, qg: 20, qgs2: 4, qgd: 5, plateau: 2.5, cossEr: 800, qrrRef: 30, diodeVf: 0.8, rg: 2 },
    { id: "silicon-60v", label: "Silicon teaching · 60 V", voltageClass: 60, rds: 10, qg: 30, qgs2: 6, qgd: 8, plateau: 3, cossEr: 500, qrrRef: 60, diodeVf: 0.85, rg: 3 },
    { id: "silicon-100v", label: "Silicon teaching · 100 V", voltageClass: 100, rds: 20, qg: 45, qgs2: 9, qgd: 12, plateau: 3.5, cossEr: 350, qrrRef: 100, diodeVf: 0.9, rg: 4 }
  ].map((item) => makeTemplate({
    id: item.id,
    label: item.label,
    technology: "silicon",
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
  return {
    template,
    rawInputs: {
      ...rawInputs,
      ...template.values,
      __provenance: {
        ...(rawInputs.__provenance || {}),
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
