const moduleVersion = new URL(import.meta.url).searchParams.get("v");

function versionedModuleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (moduleVersion) url.searchParams.set("v", moduleVersion);
  return url.href;
}

const [
  { animateDialog, animateFlip, animatePanelSwap, animatePointSeries, animateWaveformDomain },
  {
    BUCK_LOSS_GROUPS_V2,
    BUCK_LOSS_MODEL_REVISION,
    BUCK_LOSS_SCHEMA_V2,
    buckLossFieldKeysForGroupV2,
    normalizeBuckLossInputsV2,
    rawDefaultsV2,
    validateBuckLossInputsV2
  },
  {
    BUCK_LOSS_DEVICE_TEMPLATES_V2,
    applyBuckLossDeviceTemplateV2,
    getBuckLossDeviceTemplateV2,
    recommendedSiliconTemplateV2
  },
  { resolveBuckLossConditionsV2 },
  {
    BUCK_LOSS_PRESETS_V2,
    DEFAULT_BUCK_LOSS_PRESET_V2,
    getBuckLossPresetV2
  },
  { parseBuckLossUrlV2, serializeBuckLossUrlV2 },
  { evaluateBuckLossPointV2, evaluateBuckLossSweepV2 },
  { BUCK_LOSS_FAMILIES_V2 },
  {
    buildWaveformGeometryV2,
    calculateRingingModelV2,
    clampWaveformViewV2,
    defaultWaveformViewV2,
    edgePresetWaveformViewV2,
    panWaveformViewV2,
    phaseFromUnitV2,
    sampleWaveformAtPhaseV2,
    semanticWaveformViewV2,
    unitFromPhaseV2,
    waveformEdgeEvidenceV2,
    waveformTimeTicksV2,
    waveformTimelineV2,
    zoomWaveformViewV2
  },
  { dcrForMode, groupPartsBySeries, loadCoilcraftCatalog, selectIsat },
  { rememberBuckLossQueryV2 }
] = await Promise.all([
  import(versionedModuleUrl("./buck-loss-motion.js")),
  import(versionedModuleUrl("./buck-loss-schema-v2.js")),
  import(versionedModuleUrl("./buck-loss-device-templates-v2.js")),
  import(versionedModuleUrl("./buck-loss-condition-resolver-v2.js")),
  import(versionedModuleUrl("./buck-loss-presets-v2.js")),
  import(versionedModuleUrl("./buck-loss-url-v2.js")),
  import(versionedModuleUrl("./buck-loss-evaluator-v2.js")),
  import(versionedModuleUrl("./buck-loss-equations-v2.js")),
  import(versionedModuleUrl("./buck-loss-waveform-view-v2.js")),
  import(versionedModuleUrl("./coilcraft-catalog.js")),
  import(versionedModuleUrl("./buck-loss-entry-v2.js"))
]);

const DEVICE_MEMORY_KEY = "buck-loss-v2-device";
const IMPORT_MEMORY_KEY = "buck-loss-v1-import";
const PRIMARY_GROUP = BUCK_LOSS_GROUPS_V2.find((group) => group.primary);
const visibleFieldKeys = (groupId) => buckLossFieldKeysForGroupV2(groupId)
  .filter((key) => !BUCK_LOSS_SCHEMA_V2[key]?.uiHidden);
const PRIMARY_KEYS = Object.freeze(visibleFieldKeys(PRIMARY_GROUP.id));
const ADVANCED_GROUPS = Object.freeze(BUCK_LOSS_GROUPS_V2
  .filter((group) => !group.primary)
  .map((group) => Object.freeze({ ...group, keys: Object.freeze(visibleFieldKeys(group.id)) })));

const CONDITIONED_DEVICE_KEYS = new Set([
  "rdsHigh",
  "rdsLow",
  "qgHigh",
  "qgLow",
  "qgs2High",
  "qgs2Low",
  "qgdHigh",
  "qgdLow",
  "plateauHigh",
  "plateauLow",
  "effectiveTurnOn",
  "effectiveTurnOff"
]);
const EXPLICIT_CONDITION_PROVENANCE = new Set(["entered", "url-entered", "entered-blank"]);

const FAMILY_STYLE = Object.freeze({
  mosfetConduction: { color: "--blx-cond", short: "FET conduction" },
  magnetics: { color: "--blx-dcr", short: "Magnetics" },
  capacitors: { color: "--blx-other", short: "Capacitors" },
  switchingTransitions: { color: "--blx-sw", short: "Transitions" },
  deadTimeRecovery: { color: "--blx-dead", short: "Dead time + QRR" },
  gateDrive: { color: "--blx-gate", short: "Gate drive" },
  nodeEnergy: { color: "--blx-inductor-ac", short: "EOSS" },
  controllerBias: { color: "--blx-bias", short: "Controller" }
});

const FAMILY_INTUITION = Object.freeze({
  mosfetConduction: "Inductor current heats each switch while its channel is on. Because this loss follows current squared, it rises quickly with load and with RDS(on).",
  magnetics: "The winding turns RMS current into copper heat. Ripple current also works the winding and core back and forth at the switching frequency.",
  capacitors: "The capacitors store and return energy, but ripple current still circulates through their ESR and leaves a little heat behind each cycle.",
  switchingTransitions: "During an edge, current is already flowing while voltage still remains across the switch. That brief overlap spends energy twice per cycle and repeats at fSW.",
  deadTimeRecovery: "During dead time neither channel carries the inductor current, so it is forced through the reverse path. The next turn-on may also have to remove stored recovery charge.",
  gateDrive: "Every cycle the driver fills and empties both MOSFET gates. That charge is discarded each cycle, so this loss scales with QG, drive voltage, and fSW.",
  nodeEnergy: "The switch node charges and discharges the devices’ output capacitance every cycle. Unless that stored electric-field energy is recovered, it becomes heat.",
  controllerBias: "The controller draws standing current even when the load is light, creating a nearly fixed loss floor that matters most near no load."
});

const TERM_PARAMETERS = Object.freeze({
  highSideConduction: ["rdsHigh"],
  lowSideConduction: ["rdsLow"],
  inductorDcCopper: ["dcr"],
  inductorAcCopper: ["rac"],
  inductorCoreResidual: ["inductorAcManual"],
  inputCapEsr: ["inputEsr"],
  outputCapEsr: ["esr"],
  turnOnOverlap: ["qgs2High", "qgdHigh", "plateauHigh", "gateResistanceOnHigh", "effectiveTurnOn"],
  turnOffOverlap: ["qgs2High", "qgdHigh", "plateauHigh", "gateResistanceOffHigh", "effectiveTurnOff"],
  deadTimeConduction: ["deadTimeHighToLow", "deadTimeLowToHigh", "diodeVf", "reversePathResistance"],
  reverseRecovery: ["deadTimeLowToHigh", "qrrRef", "qrrRefCurrent"],
  gateDriveHigh: ["qgHigh", "vDrive"],
  gateDriveLow: ["qgLow", "vDrive"],
  nodeEnergy: ["cossErHigh", "cossErLow", "eossMaxVoltage"],
  controllerBias: ["iq", "vBias"]
});

const PROVENANCE_LABELS = Object.freeze({
  entered: "entered",
  "url-entered": "URL",
  default: "default",
  missing: "missing",
  "entered-blank": "blank",
  "datasheet-typical": "datasheet",
  "datasheet-test-condition": "datasheet test condition",
  "datasheet-plus-test-condition": "datasheet + test condition",
  "manufacturer-measured-typical": "vendor measured",
  "ti-evm-design-value": "TI EVM design value",
  "vendor-model-measured": "vendor measured",
  "vendor-model-test-condition": "vendor test condition",
  "synthetic-teaching-fixture": "illustrative fixture",
  "inferred-qgs-minus-qgth": "inferred",
  "inferred-effective-overlap": "assumption",
  "inferred-gate-charge-curve": "curve inferred",
  "inferred-controller-driver-time": "driver timing inferred",
  "inferred-triangular-trr": "triangular tRR proxy",
  "controller-datasheet-typical": "controller datasheet",
  "inferred-from-vin": "inferred from VIN",
  "inferred-rac-equals-rdc": "inferred from RDC",
  "inferred-from-dead-time": "fallback dead time",
  "coilcraft-datasheet": "datasheet",
  "calculated-condition-rds": "calculated from drive",
  "calculated-condition-plateau": "calculated at IOUT,max",
  "calculated-condition-qgs2": "calculated at IOUT,max",
  "calculated-condition-qgd": "calculated from VIN",
  "source-held-qgd-anchor": "source-held outside VIN curve",
  "calculated-condition-total-qg": "calculated from drive + current",
  "calculated-condition-effective-time": "calculated from phase charge"
});

const QUIET_RAIL_PROVENANCE = new Set(["entered", "url-entered", "default", "missing", "entered-blank"]);

function provenanceLabel(state, key, value) {
  const label = PROVENANCE_LABELS[value] || value;
  if (!value.startsWith("calculated-condition-")) return label;
  const source = state.template?.provenance?.[key];
  if (!source || source === "missing" || source === value) return label;
  return `${label} · ${PROVENANCE_LABELS[source] || source} source`;
}

const GAP_COPY = Object.freeze({
  inductorCoreResidualMissingData: "inductor AC/core residual is unavailable",
  inductorCoreResidualDcmWaveform: "catalog magnetics residual is outside its DCM waveform domain",
  switchingTransitionsMissingData: "switching-transition timing is incomplete",
  zeroLoadControlBehavior: "zero-load controller behavior is outside scope",
  reverseRecoveryMissingData: "reverse-recovery data is unavailable",
  gateDriveMissingData: "gate-charge data is unavailable",
  nodeEnergyMissingData: "energy-equivalent switch-node capacitance is unavailable",
  nodeEnergyOutsideVoltageDomain: "switch-node energy is outside its characterized voltage domain",
  nodeEnergyDcmCommutationUnmodeled: "DCM switch-node commutation is not modeled"
});

const SCALING_PRESENTATION = Object.freeze({
  fixedLike: { label: "fixed", color: "var(--blx-fixed-band)" },
  currentLike: { label: "transition + dead time", color: "var(--blx-current-band)" },
  currentSquaredLike: { label: "conduction", color: "var(--blx-squared-band)" },
  unclassified: { label: "unclassified", color: "var(--blx-unclassified-band)" }
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value) {
  return Number.isFinite(value);
}

const EXAMPLE_RINGING_LOOP_INDUCTANCE_H = 2e-9;
const EXAMPLE_RINGING_LOOP_RESISTANCE_OHM = 0.35;

function waveformRingingForTemplate(template, rawInputs, previous = null) {
  const sourcedCoss = Number(template?.waveformRinging?.cossPerDevicePf);
  const nodeCapacitanceF = finite(sourcedCoss) && sourcedCoss > 0
    ? 2 * sourcedCoss * 1e-12
    : null;
  return {
    nodeCapacitanceF,
    loopInductanceH: previous?.loopInductanceH ?? EXAMPLE_RINGING_LOOP_INDUCTANCE_H,
    loopResistanceOhm: previous?.loopResistanceOhm ?? EXAMPLE_RINGING_LOOP_RESISTANCE_OHM,
    capacitanceSource: finite(sourcedCoss) && sourcedCoss > 0
      ? template.waveformRinging.sourceLabel
      : "No small-signal device capacitance source available",
    characterizationVoltageV: template?.waveformRinging?.characterizationVoltageV ?? null,
    loopAssumptionSource: previous?.loopAssumptionSource ?? "illustrative-starting-point"
  };
}

function cloneRaw(raw) {
  return { ...raw, __provenance: { ...(raw?.__provenance || {}) } };
}

function applyConditioning(state) {
  const conditioning = resolveBuckLossConditionsV2(state.rawInputs, state.template, {
    currentA: state.rawInputs.ioutMax
  });
  state.rawInputs = cloneRaw(conditioning.rawInputs);
  state.conditioning = conditioning;
  return conditioning;
}

function resetConditionedField(state, key) {
  if (!CONDITIONED_DEVICE_KEYS.has(key)) return;
  state.rawInputs[key] = state.template.values[key] ?? null;
  state.rawInputs.__provenance = {
    ...(state.rawInputs.__provenance || {}),
    [key]: state.template.provenance[key]
      || (state.template.values[key] === null ? "missing" : state.template.source.kind)
  };
  applyConditioning(state);
}

function conditionErrorField(error) {
  return error?.field || (error?.code === "invalid-condition-current" ? "ioutMax" : "vDrive");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function displayNumber(value, digits = 3) {
  if (!finite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function quantizeSignificant(value, digits = 3) {
  if (!finite(value) || value === 0) return finite(value) ? value : 0;
  return Number(value.toPrecision(digits));
}

function quantizeCurrent(value, maximum = Infinity) {
  return clamp(quantizeSignificant(Math.max(0, Number(value) || 0), 3), 0, maximum);
}

function cursorKeyboardStep(current, maximum) {
  const baseline = current > 0 ? current : Math.max(maximum, 1);
  const significantStep = 10 ** (Math.floor(Math.log10(baseline)) - 2);
  return Math.max(maximum / 1000, significantStep);
}

function formatPower(value) {
  if (!finite(value)) return "—";
  if (value < 1e-3) return `${displayNumber(value * 1e6, 2)} µW`;
  if (value < 1) return `${displayNumber(value * 1e3, 2)} mW`;
  return `${displayNumber(value, 3)} W`;
}

function formatEnergy(value) {
  if (!finite(value)) return "—";
  if (value < 1e-9) return `${displayNumber(value * 1e12, 2)} pJ`;
  if (value < 1e-6) return `${displayNumber(value * 1e9, 2)} nJ`;
  if (value < 1e-3) return `${displayNumber(value * 1e6, 3)} µJ`;
  return `${displayNumber(value * 1e3, 3)} mJ`;
}

function formatCurrent(value) {
  if (!finite(value)) return "—";
  if (value < 0.1) return `${displayNumber(value * 1e3, 1)} mA`;
  return `${displayNumber(value, 3)} A`;
}

function formatPercent(value) {
  return finite(value) ? `${displayNumber(value * 100, 2)}%` : "—";
}

function compactMode(mode) {
  if (mode === "ccm") return "CCM";
  if (mode === "dcm") return "DCM";
  if (mode === "zero-load-unmodeled") return "Zero load";
  return "Unavailable";
}

function stepFor(config) {
  const span = config.max - config.min;
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return 1;
}

function useLogScale(config) {
  return config.min > 0 && config.max / config.min >= 100;
}

function toSlider(config, value) {
  const safe = clamp(finite(Number(value)) ? Number(value) : config.default ?? config.min, config.min, config.max);
  if (!useLogScale(config)) return 1000 * (safe - config.min) / (config.max - config.min);
  return 1000 * Math.log(safe / config.min) / Math.log(config.max / config.min);
}

function fromSlider(config, value) {
  const fraction = clamp(Number(value) / 1000, 0, 1);
  if (!useLogScale(config)) return config.min + fraction * (config.max - config.min);
  return config.min * (config.max / config.min) ** fraction;
}

function fieldMarkup(key, options = {}) {
  const config = BUCK_LOSS_SCHEMA_V2[key];
  const technology = config.technology ?? "all";
  const timing = config.timingMode ?? "all";
  const id = `blx-v2-${key}`;
  return `<div class="blx-field blx-v2-field" data-blx-field="${key}" data-blx-tech="${technology}" data-blx-timing="${timing}">
    <div class="blx-field-head">
      <label for="${id}">${escapeHtml(config.label)}</label>
      <span class="blx-entry"><input id="${id}" data-blx-v2-input="${key}" type="number" inputmode="decimal" min="${config.min}" max="${config.max}" step="${stepFor(config)}"${config.optional ? ' placeholder="blank"' : ""}><span class="blx-unit">${escapeHtml(config.unit)}</span></span>
    </div>
    ${options.slider ? `<input data-blx-v2-range="${key}" type="range" min="0" max="1000" step="1" aria-label="${escapeHtml(config.label)} slider">` : ""}
    ${options.catalog ? catalogMarkup() : ""}
    <p class="blx-field-message" data-blx-v2-message="${key}" hidden></p>
    <div class="blx-v2-field-meta"><p class="blx-v2-provenance" data-blx-v2-provenance="${key}"></p>${CONDITIONED_DEVICE_KEYS.has(key) ? `<button class="blx-v2-condition-reset" type="button" data-blx-condition-reset="${key}" hidden>Use calculated</button>` : ""}</div>
  </div>`;
}

function catalogMarkup() {
  return `<div class="blx-catalog blx-catalog-compact" data-blx-catalog data-catalog-state="loading">
    <p class="blx-catalog-heading">Or choose a characterized inductor</p>
    <div class="blx-catalog-fields">
    <div class="blx-catalog-field">
      <label for="blx-v2-catalog-part">Coilcraft part</label>
      <div class="blx-select-wrap"><select id="blx-v2-catalog-part" data-blx-catalog-part><option value="">Generic / manual</option></select></div>
    </div>
    <div class="blx-catalog-field">
      <label for="blx-v2-catalog-dcr">DCR corner</label>
      <div class="blx-select-wrap"><select id="blx-v2-catalog-dcr" data-blx-catalog-dcr disabled><option value="typ">Typical</option><option value="max">Maximum</option></select></div>
    </div>
    </div>
    <p class="blx-catalog-meta" data-blx-catalog-meta hidden></p>
    <p class="blx-catalog-message" data-blx-catalog-message role="status" hidden></p>
    <details class="blx-catalog-source-note"><summary>Source-data note</summary><p>Coilcraft names and data identify the selected source only; this independent tool is not affiliated with or endorsed by Coilcraft. Characterized residuals use their typical-data basis, even when maximum DCR is selected for copper loss.</p></details>
  </div>`;
}

function advancedMarkup(group) {
  const controls = group.modeControl === "timing"
    ? `<div class="blx-v2-select-row"><label for="blx-v2-timing-mode">Transition method</label><select id="blx-v2-timing-mode" data-blx-timing-mode><option value="auto">Automatic evidence hierarchy</option><option value="derived">Force gate-charge derivation</option><option value="effective">Force effective-time override</option></select></div>`
    : group.modeControl === "control"
      ? `<div class="blx-v2-select-row"><label for="blx-v2-control-mode">Low-current comparison</label><select id="blx-v2-control-mode" data-blx-control-mode><option value="auto-dcm">Automatic diode-emulation DCM</option><option value="forced-ccm">Forced CCM comparison</option></select></div>`
      : "";
  return `<details data-blx-v2-group="${group.id}">
    <summary><span>${escapeHtml(group.label)}</span><span class="blx-acc-chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 6.5 8 10.5 12 6.5"></path></svg></span></summary>
    <div class="blx-detail-panel"><div class="blx-detail-body">${controls}<div class="blx-detail-grid">${group.keys.map((key) => fieldMarkup(key)).join("")}</div></div></div>
  </details>`;
}

function prepareMarkup(root) {
  root.dataset.blxModel = "2";
  root.dataset.blxRevision = BUCK_LOSS_MODEL_REVISION;

  const sticky = root.querySelector(".blx-input-sticky");
  if (sticky) sticky.innerHTML = `<div class="blx-rail-heading"><h2>Operating point</h2><button class="blx-reset" type="button" data-blx-reset>Reset</button></div>
    <div class="blx-presets" data-blx-presets role="group" aria-label="Operating-point presets"></div>
    <p class="blx-prompt" data-blx-prompt></p>
    <div class="blx-device-note blx-v2-device-note"><div><strong data-blx-device-label>Choose a device</strong><br><span data-blx-device-summary></span> <a data-blx-device-source hidden target="_blank" rel="noopener noreferrer">Official datasheet ↗</a> <a data-blx-device-model-source hidden target="_blank" rel="noopener noreferrer">Simulator model ↗</a> <a data-blx-device-model-guide hidden target="_blank" rel="noopener noreferrer">Model guide ↗</a><p class="blx-v2-device-condition-summary" data-blx-device-condition-summary></p><details class="blx-v2-device-conditions" data-blx-device-conditions hidden><summary>Conditions &amp; notes</summary><p class="blx-v2-device-model-note" data-blx-device-model-note hidden></p><ul class="blx-v2-device-notes" data-blx-device-notes></ul><ul data-blx-device-condition-list></ul></details></div><button type="button" data-blx-change-device>Change device</button></div>
    <section class="blx-controls" aria-label="Primary buck inputs">${PRIMARY_KEYS.map((key) => fieldMarkup(key, { slider: true, catalog: key === "inductance" })).join("")}</section>
    <div class="blx-current-control"><div class="blx-current-head"><label for="blx-v2-current-range">Load current</label><output data-blx-out="current">—</output></div><input id="blx-v2-current-range" class="blx-current-range" data-blx-cursor-input data-blx-cursor-rail type="range" min="0" max="1000" step="1" role="slider" tabindex="0" aria-label="Selected load current"><div class="blx-current-ticks" role="group" aria-label="Load current shortcuts"><button type="button" data-blx-current-fraction="0" aria-label="Set load current to zero">0</button><button type="button" data-blx-current-fraction="0.25" aria-label="Set load current to 25 percent">25%</button><button type="button" data-blx-current-fraction="0.5" aria-label="Set load current to 50 percent">50%</button><button type="button" data-blx-current-fraction="0.75" aria-label="Set load current to 75 percent">75%</button><button type="button" data-blx-current-fraction="1" aria-label="Set load current to maximum">I<sub>MAX</sub></button></div></div>
    <section class="blx-advanced" aria-label="Advanced assumptions">${ADVANCED_GROUPS.map(advancedMarkup).join("")}</section>`;

  const point = root.querySelector('[data-blx-view-panel="point"]');
  if (point) point.innerHTML = `<div class="blx-primary-result">
      <div><p class="blx-efficiency-value"><span data-blx-out="efficiency">—</span><button type="button" class="blx-term-trigger" data-blx-coverage-trigger data-blx-efficiency-label>efficiency</button></p><p class="blx-current-caption">at <span data-blx-out="current-caption">—</span> · <span data-blx-out="regime">—</span> · <button type="button" class="blx-term-trigger" data-blx-coverage-trigger data-blx-availability-label>Total</button></p></div>
      <div class="blx-summary-metrics"><div class="blx-summary-metric"><strong data-blx-out="pout">—</strong><span>output</span></div><div class="blx-summary-metric"><strong data-blx-out="loss">—</strong><span data-blx-loss-label>modeled loss</span></div><div class="blx-summary-metric"><strong data-blx-out="pin">—</strong><button type="button" class="blx-term-trigger blx-metric-label" data-blx-coverage-trigger data-blx-input-label>estimated input</button></div></div>
    </div>
    <div class="blx-v2-badges" data-blx-result-badges></div>
    <section class="blx-section blx-v2-confidence" data-blx-valid-only aria-label="Model confidence and sensitivity"><div class="blx-section-heading"><h2>Model confidence</h2><span class="blx-section-total" data-blx-confidence-status>—</span></div><div class="blx-operating-metrics" data-blx-confidence-metrics></div><p class="blx-sentence" data-blx-confidence-copy></p></section>
    <section class="blx-section blx-v2-failure" data-blx-model-failure hidden><div class="blx-failure-copy"><h2 data-blx-failure-title>This point cannot regulate</h2><p data-blx-failure-explanation></p><p data-blx-failure-recovery></p></div><p class="blx-failure-equation" data-blx-failure-equation></p><p>Results resume as soon as the operating point is feasible.</p><div class="blx-actions"><button type="button" data-blx-fix-output hidden>Fix output voltage</button><button type="button" data-blx-reset-invalid hidden>Reset operating point</button><button type="button" data-blx-copy>Copy link</button></div></section>
    <section class="blx-section blx-waveform-section" data-blx-valid-only aria-label="Switching waveforms and mode intervals">
      <div class="blx-section-heading"><h2>Switching cycle</h2></div>
      <div class="blx-waveform-toolbar" aria-label="Waveform view controls">
        <div class="blx-waveform-view-modes" role="group" aria-label="Waveform view">
          <button type="button" data-blx-waveform-mode="full" aria-pressed="true">Full cycle</button>
          <button type="button" data-blx-waveform-mode="rising" aria-pressed="false">Rising edge</button>
          <button type="button" data-blx-waveform-mode="falling" aria-pressed="false">Falling edge</button>
        </div>
        <div class="blx-waveform-view-actions" role="group" aria-label="Zoom and pan">
          <button type="button" data-blx-waveform-action="zoom-in" aria-label="Zoom in horizontally">+</button>
          <button type="button" data-blx-waveform-action="zoom-out" aria-label="Zoom out horizontally">−</button>
          <button type="button" data-blx-waveform-action="pan-left" aria-label="Pan waveform left">←</button>
          <button type="button" data-blx-waveform-action="pan-right" aria-label="Pan waveform right">→</button>
        </div>
      </div>
      <output class="blx-waveform-view-status" data-blx-waveform-view-status aria-live="polite">Full cycle</output>
      <div class="blx-waveform-overview" data-blx-waveform-overview role="img" aria-label="One-cycle waveform overview and visible time window"></div>
      <div class="blx-waveform-detail" data-blx-waveform-diagram tabindex="0" role="group" aria-label="Zoomable switching-cycle detail plot">
        <div class="blx-waveform-edge-flags" aria-label="Switching edges">
          <button type="button" data-blx-waveform-edge-flag="rising">▼ rising</button>
          <button type="button" data-blx-waveform-edge-flag="falling">▼ falling</button>
        </div>
        <div class="blx-waveform-selection" data-blx-waveform-selection hidden></div>
      </div>
      <div class="blx-waveform-probe"><label for="blx-v2-waveform-probe">Time probe</label><input id="blx-v2-waveform-probe" data-blx-waveform-probe type="range" min="0" max="1000" step="1" value="500" aria-label="Time within the visible waveform window"><output data-blx-waveform-readout>—</output></div>
      <details class="blx-waveform-ringing-model" data-blx-waveform-ringing-model>
        <summary><span>First-order series-RLC response</span><span data-blx-waveform-ringing-status>—</span></summary>
        <div class="blx-waveform-ringing-controls">
          <label><span>Node C<small>OSS</small></span><span><input type="number" min="1" step="1" inputmode="decimal" data-blx-waveform-ringing-input="nodeCapacitancePf" aria-label="Effective switch-node capacitance in picofarads"> pF</span></label>
          <label><span>Power-loop L</span><span><input type="number" min="0.01" step="0.1" inputmode="decimal" data-blx-waveform-ringing-input="loopInductanceNh" aria-label="Commutation-loop inductance in nanohenries"> nH</span></label>
          <label><span>Loop damping R</span><span><input type="number" min="0.001" step="0.01" inputmode="decimal" data-blx-waveform-ringing-input="loopResistanceOhm" aria-label="Commutation-loop damping resistance in ohms"> Ω</span></label>
          <p data-blx-waveform-ringing-source></p>
        </div>
      </details>
      <p class="blx-waveform-note">The detail plot uses exact dead-time widths and auto-fits iL vertically in edge views. The dashed trace is a calculated, step/ramp-excited first-order series-RLC response; it uses the disclosed C<small>OSS</small> seed and editable example loop-L/damping-R assumptions above and is excluded from the loss total.</p>
      <div class="blx-waveform-hint" data-blx-waveform-hint><span>drag to zoom · ⌘/Ctrl+scroll to zoom · double-click to reset</span><button type="button" data-blx-waveform-hint-dismiss aria-label="Dismiss waveform interaction hint">×</button></div>
    </section>
    <section class="blx-section" data-blx-valid-only aria-label="Ranked loss budget"><div class="blx-section-heading"><h2>Loss budget · ranked</h2><button type="button" class="blx-section-total blx-term-trigger" data-blx-coverage-trigger data-blx-out="loss-total">—</button></div><p class="blx-v2-subtotal-copy" data-blx-subtotal-copy hidden></p><ol class="blx-breakdown-list blx-v2-family-list" data-blx-family-list></ol></section>
    <section class="blx-section blx-v2-power-balance" data-blx-valid-only aria-label="Power balance"><div class="blx-section-heading"><h2>Power balance</h2><span class="blx-section-total" data-blx-power-copy>Output + analytical losses</span></div><div class="blx-power-balance" data-blx-power-balance></div><div class="blx-operating-metrics" data-blx-operating-metrics></div></section>
    <section class="blx-section blx-v2-reference" data-blx-valid-only data-blx-reference-card hidden></section>
    <div class="blx-section" data-blx-valid-only><div class="blx-actions"><button type="button" data-blx-reference><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11l-3.5-2-3.5 2z"></path></svg><span>Hold reference</span></button><button type="button" data-blx-copy>Copy link</button><a data-blx-report-mismatch target="_blank" rel="noopener noreferrer">Report a mismatch</a></div><div class="blx-warnings" data-blx-warnings></div><p class="blx-sentence" data-blx-insight></p></div>`;

  const load = root.querySelector('[data-blx-view-panel="load"]');
  if (load) load.innerHTML = `<div class="blx-result-heading"><h2>Performance across load</h2><p>Peak efficiency, the CCM/DCM boundary, and the selected point stay linked.</p></div>
    <div class="blx-chart-block"><p class="blx-chart-title"><span data-blx-efficiency-chart-label>Efficiency</span> <span data-blx-across-efficiency>—</span></p><div class="blx-plot" data-blx-efficiency-plot aria-label="Efficiency versus load current"></div></div>
    <div class="blx-chart-block"><p class="blx-chart-title">Loss families <span data-blx-across-loss>—</span></p><div class="blx-plot" data-blx-loss-plot aria-label="Loss-family power versus load current"></div><div class="blx-v2-series-controls" data-blx-series-controls aria-label="Loss series controls"></div></div>
    <p class="blx-v2-reference-key" data-blx-reference-key hidden></p>
    <section class="blx-loss-character" aria-label="Dominant loss character across load"><h3>Loss character</h3><div class="blx-loss-character-track" data-blx-loss-character></div><p data-blx-causal-insight></p></section>
    <div class="blx-section"><div class="blx-actions"><button type="button" data-blx-reference><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11l-3.5-2-3.5 2z"></path></svg><span>Hold reference</span></button><button type="button" data-blx-copy>Copy link</button><a data-blx-report-mismatch target="_blank" rel="noopener noreferrer">Report a mismatch</a></div></div>`;

  root.insertAdjacentHTML("beforeend", `<div class="blx-coverage-popover" data-blx-coverage-popover role="dialog" aria-modal="false" aria-labelledby="blx-coverage-title" hidden><button type="button" class="blx-coverage-close" data-blx-coverage-close aria-label="Close coverage explanation">×</button><h2 id="blx-coverage-title">Why this is a ceiling, not an estimate</h2><p data-blx-coverage-copy></p></div>`);

  const caveat = root.querySelector(".blx-top-caveat");
  if (caveat) caveat.textContent = "This is an analytical intuition model at a disclosed 25 °C parameter corner, not a part-level signoff tool. Confirm a real design with manufacturer models, SPICE, thermal analysis, and measurement.";
  const equations = root.querySelector(".blx-equations");
  if (equations) equations.innerHTML = `<h2>Equations in the open</h2><p>The tool solves regulated volt-second balance over explicit high-side, edge-specific dead-time, low-side, and zero-current intervals. Each interval carries exact <code>∫i dt</code> and <code>∫i² dt</code> moments.</p><p>Transition loss uses an evidence hierarchy: an in-domain measured table, an in-domain vendor-SPICE table, complete gate-charge timing, then a disclosed effective-time fallback. The analytical path follows EPC AN030: separate current and voltage phases use <code>QGS2(I)</code>, voltage-conditioned <code>QGD</code> when a CRSS curve is loaded (otherwise the source or entered QGD), the live Miller level, threshold voltage, and total source/sink gate-loop resistance. <code>EON</code> uses valley current and <code>EOFF</code> uses peak current. The surface tier is reserved for characterized data, but no shipped device template currently loads one; automatic mode exposes the fallback it selects. Table metadata declares whether EOSS or QRR is already included so those terms are never counted twice.</p><p>CCM excludes both effective dead-time windows from channel conduction; their unequal values can represent driver propagation mismatch. Reverse-path loss uses <code>VSD,0·|i| + RSD·i²</code> on each edge. The ZVS readout is a charge-and-energy availability diagnostic and does not silently reduce EOSS.</p><p>Most non-transition atomic rows cite Gabriel Alfonso Rincón-Mora, <em>Switched Inductor Power IC Design</em>, Chapter 4; analytical edge timing cites EPC AN030. Input power is reconstructed as <code>POUT + known PLOSS</code>; a subtotal therefore produces a known-loss efficiency ceiling. The displayed sensitivity interval is an engineering bound on modeled terms, not a statistical confidence interval.</p>`;
  const caveats = root.querySelector(".blx-caveats");
  if (caveats) caveats.innerHTML = `<h2>Scope &amp; caveats</h2><ol><li>Fixed-frequency diode-emulation DCM and forced CCM comparison are modeled; PFM, burst, and minimum-on-time control are not.</li><li>Manufacturer-sourced and example templates use disclosed 25 °C values without electrothermal iteration.</li><li>Catalog magnetics use RMS copper plus a characterized residual exactly once in its supported CCM waveform domain. A maximum-DCR selection changes copper only; the residual remains tied to its typical characterization.</li><li>DCM switch-node commutation remains omitted. CCM ZVS classification is diagnostic until a nonlinear COSS/QOSS commutation model or waveform measurement supports an energy credit.</li><li>Automatic transition selection falls back visibly when no condition-matched energy surface is present. Effective-time fallbacks carry the widest uncertainty bound.</li><li>The waveform viewer's linear RLC trace is a first-order parasitic estimate; ringing loss, nonlinear COSS, snubbers, probe loading, PCB/package resistance, bootstrap loss, and full IC leakage remain outside the power-loss total.</li></ol><p>Manufacturer names identify data sources only. This independent educational tool is not affiliated with or endorsed by any named device or magnetics manufacturer.</p>`;
}

function chooserCard(template, preloaded) {
  const metrics = [
    finite(template.values.rdsHigh) ? `${displayNumber(template.values.rdsHigh, 3)} mΩ` : null,
    finite(template.values.qgHigh) ? `${displayNumber(template.values.qgHigh, 3)} nC QG` : null,
    finite(template.values.qrrRef) ? `${displayNumber(template.values.qrrRef, 3)} nC QRR` : null
  ].filter(Boolean).join(" · ");
  return `<button type="button" class="blx-device-choice" data-blx-device-choice="${template.id}"><span><strong>${escapeHtml(template.label)}</strong></span><small>${escapeHtml(metrics || "Partial analytical coverage")}</small>${preloaded ? '<em>Continue with the preloaded example →</em>' : ""}</button>`;
}

function chooserGroup(kind, templates, selectedId) {
  if (!templates.length) return "";
  const label = kind === "manufacturer" ? "Manufacturer-sourced" : "Example FETs";
  return `<section class="blx-device-choice-group"><h3>${label}</h3><div class="blx-device-choice-grid">${templates.map((template) => chooserCard(template, template.id === selectedId)).join("")}</div></section>`;
}

export async function requestBuckLossDeviceV2(root, options = {}) {
  if (options.signal?.aborted) return null;
  let dialog = root.querySelector("[data-blx-device-dialog]");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "blx-device-dialog";
    dialog.dataset.blxDeviceDialog = "";
    dialog.setAttribute("aria-labelledby", "blx-device-dialog-title");
    root.appendChild(dialog);
  }
  const vin = Number(options.vin) || 12;
  const eligible = BUCK_LOSS_DEVICE_TEMPLATES_V2.filter((template) => template.voltageClass >= vin);
  const fallbackId = vin <= 18 ? "epc2090" : recommendedSiliconTemplateV2(vin);
  const requestedId = options.recommendedId || fallbackId;
  const preloaded = eligible.some((template) => template.id === requestedId) ? requestedId : fallbackId;
  const manufacturer = eligible.filter((template) => template.catalogKind === "manufacturer");
  const teaching = eligible.filter((template) => template.catalogKind !== "manufacturer");
  const message = options.message ? `<p>${escapeHtml(options.message)}</p>` : "";
  dialog.innerHTML = `<div class="blx-device-dialog-frame"><div class="blx-device-dialog-head"><h2 id="blx-device-dialog-title">${escapeHtml(options.title || "Choose a switch-pair model")}</h2>${message}</div>${chooserGroup("manufacturer", manufacturer, preloaded)}${chooserGroup("teaching", teaching, preloaded)}${options.allowCancel ? '<button class="blx-device-dialog-cancel" type="button" data-blx-device-cancel>Cancel</button>' : ""}</div>`;
  return new Promise((resolve) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      resolve(null);
    };
    const finish = async (value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener?.("abort", abort);
      await animateDialog(dialog, false);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelectorAll("[data-blx-device-choice]").forEach((button) => button.addEventListener("click", () => finish(button.dataset.blxDeviceChoice), { once: true }));
    dialog.querySelector("[data-blx-device-cancel]")?.addEventListener("click", () => finish(null), { once: true });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (options.allowCancel) finish(null);
    }, { once: true });
    options.signal?.addEventListener("abort", abort, { once: true });
    dialog.showModal();
    animateDialog(dialog, true);
    dialog.querySelector("[data-blx-device-choice]")?.focus();
  });
}

function stateContext(state) {
  return {
    technology: state.template.technology,
    deviceTemplate: state.deviceId,
    catalogKind: state.template.catalogKind,
    parameterCorner: state.template.cornerId,
    timingMode: state.timingMode,
    controlMode: state.controlMode,
    provenance: state.provenance,
    conditionModel: state.template.conditionModel,
    junctionTemperatureC: 25,
    inductorPartNumber: state.selectedPart,
    inductorAcDataset: state.inductorAcDataset
  };
}

function evaluateStatePoint(state, current = state.cursor) {
  return evaluateBuckLossPointV2(state.inputs, current, stateContext(state));
}

function displayedCursor(state) {
  const current = finite(state.previewCursor) ? state.previewCursor : state.cursor;
  return quantizeCurrent(current, Number(state.rawInputs.ioutMax) || 0);
}

function sweepCacheKey(state) {
  const inputs = Object.fromEntries(Object.keys(BUCK_LOSS_SCHEMA_V2).map((key) => [key, state.inputs[key]]));
  return JSON.stringify({
    revision: BUCK_LOSS_MODEL_REVISION,
    inputs,
    deviceId: state.deviceId,
    controlMode: state.controlMode,
    timingMode: state.timingMode,
    selectedPart: state.selectedPart,
    dcrMode: state.dcrMode,
    catalogEpoch: state.catalogEpoch
  });
}

function invalidateSweep(state) {
  state.sweepCacheKey = null;
  state.sweep = null;
}

function canonicalQuery(state) {
  return serializeBuckLossUrlV2({
    presetId: state.presetId,
    deviceId: state.deviceId,
    controlMode: state.controlMode,
    timingMode: state.timingMode,
    selectedInductorPart: state.selectedPart,
    inductorDcrMode: state.dcrMode,
    rawInputs: state.rawInputs,
    cursor: quantizeCurrent(state.cursor, Number(state.rawInputs.ioutMax) || Infinity)
  });
}

function canonicalHref(state) {
  const query = canonicalQuery(state);
  return typeof window === "undefined"
    ? `?${query}`
    : `${window.location.origin}${window.location.pathname}?${query}`;
}

function reportMismatchHref(state) {
  const point = state.point;
  const gaps = point?.coverageGaps?.map((gap) => gap.code).join(", ") || "none";
  const body = [
    `Canonical state: ${canonicalHref(state)}`,
    `Device: ${state.deviceId}`,
    `Operating point: ${formatCurrent(displayedCursor(state))}`,
    `Modes: ${point?.waveform?.mode || "unavailable"}; ${state.controlMode}; ${state.timingMode}`,
    `Coverage: ${point?.availability || "unavailable"}`,
    `Coverage gaps / omissions: ${gaps}`
  ].join("\n");
  const query = new URLSearchParams({
    title: "Buck loss calculation mismatch",
    body
  });
  return `https://github.com/vgmos/vgmos.github.io/issues/new?${query}`;
}

function renderMismatchLinks(root, state) {
  root.querySelectorAll("[data-blx-report-mismatch]").forEach((link) => {
    link.href = reportMismatchHref(state);
  });
}

function updateCanonicalUrl(root, state, immediate = false) {
  if (state.disposed) return;
  const href = canonicalHref(state);
  root.querySelectorAll("[data-blx-copy-url]").forEach((input) => { input.value = href; });
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  clearTimeout(state.urlTimer);
  const commit = () => {
    if (state.disposed) return;
    state.urlTimer = 0;
    const query = canonicalQuery(state);
    rememberBuckLossQueryV2(query);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}${window.location.hash || ""}`);
  };
  if (immediate) commit();
  else state.urlTimer = setTimeout(commit, 260);
}

async function copyCanonicalUrl(root, state, button) {
  if (state.disposed) return;
  const href = canonicalHref(state);
  try {
    await navigator.clipboard.writeText(href);
  } catch {
    const input = root.querySelector("[data-blx-copy-url]");
    if (input) {
      input.value = href;
      input.focus();
      input.select();
      document.execCommand("copy");
    }
  }
  if (state.disposed) return;
  const original = button.textContent;
  button.textContent = "Copied";
  clearTimeout(button.blxTimer);
  button.blxTimer = setTimeout(() => { button.textContent = original; }, 1200);
}

function setText(root, selector, value) {
  root.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
}

function syncControls(root, state) {
  const cursor = displayedCursor(state);
  const driveOutsideDomain = state.conditioning?.errors?.some(({ code }) => code === "drive-outside-condition-domain");
  root.querySelectorAll("[data-blx-v2-input]").forEach((input) => {
    const key = input.dataset.blxV2Input;
    if (document.activeElement !== input) input.value = state.rawInputs[key] ?? "";
  });
  root.querySelectorAll("[data-blx-v2-range]").forEach((range) => {
    const key = range.dataset.blxV2Range;
    range.value = String(toSlider(BUCK_LOSS_SCHEMA_V2[key], state.rawInputs[key]));
    range.setAttribute("aria-valuetext", `${displayNumber(state.rawInputs[key], 3)} ${BUCK_LOSS_SCHEMA_V2[key].unit}`);
  });
  root.querySelectorAll("[data-blx-cursor-input]").forEach((range) => {
    range.value = String(state.rawInputs.ioutMax > 0 ? 1000 * cursor / state.rawInputs.ioutMax : 0);
    range.setAttribute("aria-valuemin", "0");
    range.setAttribute("aria-valuemax", String(state.rawInputs.ioutMax));
    range.setAttribute("aria-valuenow", String(cursor));
    range.setAttribute("aria-valuetext", formatCurrent(cursor));
  });
  root.querySelectorAll("[data-blx-current-fraction]").forEach((button) => {
    const target = Number(button.dataset.blxCurrentFraction) * state.rawInputs.ioutMax;
    const active = Math.abs(cursor - target) <= Math.max(state.rawInputs.ioutMax * 1e-4, 1e-9);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const timing = root.querySelector("[data-blx-timing-mode]");
  const control = root.querySelector("[data-blx-control-mode]");
  if (timing) timing.value = state.timingMode;
  if (control) control.value = state.controlMode;
  root.querySelectorAll("[data-blx-tech]").forEach((field) => {
    field.hidden = field.dataset.blxTech !== "all" && field.dataset.blxTech !== state.template.technology;
  });
  root.querySelectorAll("[data-blx-timing]").forEach((field) => {
    if (field.dataset.blxTiming !== "all") field.hidden = state.timingMode !== "auto" && field.dataset.blxTiming !== state.timingMode;
  });
  root.querySelectorAll("[data-blx-v2-provenance]").forEach((node) => {
    const key = node.dataset.blxV2Provenance;
    const value = state.provenance[key] || "missing";
    const unresolvedCondition = driveOutsideDomain && CONDITIONED_DEVICE_KEYS.has(key);
    node.textContent = unresolvedCondition ? "not applied · unsupported drive" : provenanceLabel(state, key, value);
    node.hidden = !unresolvedCondition && QUIET_RAIL_PROVENANCE.has(value);
  });
  root.querySelectorAll("[data-blx-condition-reset]").forEach((button) => {
    const key = button.dataset.blxConditionReset;
    const provenance = state.rawInputs.__provenance?.[key] || state.provenance[key] || "missing";
    const manual = EXPLICIT_CONDITION_PROVENANCE.has(provenance);
    button.hidden = !manual;
    button.setAttribute("aria-label", `Use the calculated ${BUCK_LOSS_SCHEMA_V2[key]?.label || key}`);
  });
}

function renderValidation(root, state) {
  const invalid = new Set(state.validation.errors.map((key) => key === "vout-lt-vin" ? "vout" : key));
  root.querySelectorAll("[data-blx-v2-message]").forEach((message) => {
    const key = message.dataset.blxV2Message;
    const active = invalid.has(key);
    message.hidden = !active;
    const conditionMessages = (state.conditioning?.errors || [])
      .filter((error) => conditionErrorField(error) === key)
      .map((error) => error.message);
    message.textContent = key === "vout" && state.validation.errors.includes("vout-lt-vin")
      ? "VOUT must remain below VIN."
      : conditionMessages.length ? conditionMessages.join(" ")
        : active ? "Enter a value inside the declared range." : "";
    const input = root.querySelector(`[data-blx-v2-input="${key}"]`);
    if (active) input?.setAttribute("aria-invalid", "true");
    else input?.removeAttribute("aria-invalid");
  });
}

function renderDevice(root, state) {
  const template = state.template;
  setText(root, "[data-blx-device-label]", template.label);
  const sourceKind = template.catalogKind === "manufacturer"
    ? `${template.manufacturer}-sourced`
    : "example values";
  const summary = `${template.voltageClass} V ${template.technology === "gan" ? "GaN" : "silicon"} · ${sourceKind} · ${template.cornerLabel || template.cornerId}`;
  setText(root, "[data-blx-device-summary]", summary);
  const sourceCondition = template.id === "infineon-bsc010n04ls6-4v5"
    ? "Reference anchors mix datasheet corners: RDS(on)/QG at VGS 4.5 V; QGD and plateau use the 10 V test; QGS2 is inferred for the source partition before the live condition calculation."
    : template.id === "epc2090"
      ? "Reference QG/QGD originate at their 50 V / 16 A test conditions; live QGD integrates the normalized CRSS(V) curve at VIN, QG is condition-resolved, COSS(ER) is a 0–50 V energy-equivalent scalar, and transition overlap uses a disclosed fallback."
      : `Values use the ${template.cornerLabel || template.cornerId} corner; detailed conditions and notes are disclosed below.`;
  const diagnostics = state.conditioning?.diagnostics || {};
  const high = diagnostics.lanes?.high || {};
  const driveOutsideDomain = state.conditioning?.errors?.some(({ code }) => code === "drive-outside-condition-domain");
  const resolvedHeadroomV = finite(diagnostics.driveVoltageV) && finite(high.plateauV)
    ? diagnostics.driveVoltageV - high.plateauV
    : diagnostics.driveHeadroomV;
  const effectiveTimingComplete = finite(diagnostics.effectiveTurnOnNs) && finite(diagnostics.effectiveTurnOffNs);
  const gateChargeTimingComplete = [
    "qgs2High",
    "qgdHigh",
    "plateauHigh",
    "gateResistanceOnHigh",
    "gateResistanceOffHigh"
  ].every((key) => finite(state.rawInputs[key])) && resolvedHeadroomV > 0;
  const edgeSummary = driveOutsideDomain
    ? "conditioned channel, charge, and edge outputs unavailable outside the fitted drive domain"
    : state.timingMode !== "derived" && effectiveTimingComplete
    ? `conditioned edge times ${displayNumber(diagnostics.effectiveTurnOnNs, 3)}/${displayNumber(diagnostics.effectiveTurnOffNs, 3)} ns on/off`
    : state.timingMode !== "effective" && gateChargeTimingComplete
      ? "edge timing from the complete gate-charge path"
      : "edge timing unavailable with the current evidence";
  const resolvedCondition = [
    finite(diagnostics.currentA) ? `At IOUT,max ${displayNumber(diagnostics.currentA, 3)} A` : null,
    finite(diagnostics.driveVoltageV) ? `VDRIVE ${displayNumber(diagnostics.driveVoltageV, 3)} V` : null,
    finite(high.rdsOnMohm) ? `RDS(on) ${displayNumber(high.rdsOnMohm, 3)} mΩ` : null,
    finite(high.totalGateChargeNc) ? `QG ${displayNumber(high.totalGateChargeNc, 3)} nC` : null,
    finite(high.plateauV) ? `plateau ${displayNumber(high.plateauV, 3)} V` : null,
    finite(resolvedHeadroomV) ? `drive headroom ${displayNumber(resolvedHeadroomV, 3)} V` : null,
    edgeSummary
  ].filter(Boolean).join(" · ");
  const conditionIssues = [...(state.conditioning?.errors || []), ...(state.conditioning?.warnings || [])];
  const qgdConditionCopy = template.conditionModel?.gateCharge?.qgdVoltage?.method
    ? "VIN changes QGD through the loaded CRSS curve"
    : "QGD stays at its source anchor unless you enter an override";
  const conditionCopy = [
    resolvedCondition ? `${resolvedCondition}.` : null,
    `The setup fields use IOUT,max as their preview current; live EON/EOFF re-resolve the transfer fit at the actual valley/peak edge currents. ${qgdConditionCopy}, while the drive rail changes headroom, RDS(on), QG, and supported edge timing.`,
    sourceCondition,
    conditionIssues.length ? `Condition check: ${conditionIssues.map((entry) => entry.message).join(" ")}` : null
  ].filter(Boolean).join(" ");
  setText(root, "[data-blx-device-condition-summary]", conditionCopy);
  root.querySelectorAll("[data-blx-device-condition-summary]").forEach((node) => {
    node.dataset.tone = state.conditioning?.errors?.length ? "error" : diagnostics.supported ? "calculated" : "";
  });
  const sourceLink = root.querySelector("[data-blx-device-source]");
  if (sourceLink) {
    sourceLink.hidden = !template.source.url;
    if (template.source.url) sourceLink.href = template.source.url;
    else sourceLink.removeAttribute("href");
  }
  const modelLink = root.querySelector("[data-blx-device-model-source]");
  const modelGuide = root.querySelector("[data-blx-device-model-guide]");
  const modelNote = root.querySelector("[data-blx-device-model-note]");
  const modelMetadata = template.modelSource || template.source.model || null;
  if (modelLink) {
    const modelUrl = modelMetadata?.url;
    modelLink.hidden = !modelUrl;
    if (modelUrl) {
      modelLink.href = modelUrl;
      const directives = modelMetadata?.requiredDirectives || template.source.model?.requiredDirectives || [];
      modelLink.title = directives.length
        ? `Official vendor model archive. LTspice requires ${directives.join(", ")}.`
        : "Official vendor model archive.";
    } else {
      modelLink.removeAttribute("href");
      modelLink.removeAttribute("title");
    }
  }
  if (modelGuide) {
    const guideUrl = modelMetadata?.applicationNoteUrl || template.source.model?.applicationNoteUrl;
    modelGuide.hidden = !guideUrl;
    if (guideUrl) modelGuide.href = guideUrl;
    else modelGuide.removeAttribute("href");
  }
  if (modelNote) {
    const directives = modelMetadata?.requiredDirectives || template.source.model?.requiredDirectives || [];
    const copy = [
      modelMetadata?.version ? `Vendor archive ${modelMetadata.version}` : null,
      directives.length ? `LTspice requires ${directives.join(", ")}` : null
    ].filter(Boolean).join(" · ");
    modelNote.hidden = !copy;
    modelNote.textContent = copy;
  }
  const notes = root.querySelector("[data-blx-device-notes]");
  if (notes) {
    notes.replaceChildren(...(template.notes || []).map((copy) => {
      const item = document.createElement("li");
      item.textContent = copy;
      return item;
    }));
  }
  const conditionDetails = root.querySelector("[data-blx-device-conditions]");
  const conditionList = root.querySelector("[data-blx-device-condition-list]");
  if (conditionDetails && conditionList) {
    const grouped = new Map();
    Object.entries(template.parameterConditions || {}).forEach(([key, metadata]) => {
      const value = template.values[key];
      if (!finite(value)) return;
      const signature = JSON.stringify([value, metadata]);
      const existing = grouped.get(signature);
      if (existing) existing.keys.push(key);
      else grouped.set(signature, { keys: [key], value, metadata });
    });
    const rows = [...grouped.values()].map(({ keys, value, metadata }) => {
      const labels = keys.map((key) => BUCK_LOSS_SCHEMA_V2[key]?.label || key);
      let label = labels.join(" / ");
      if (labels.length === 2) {
        const first = labels[0].replace(/^High-side /, "");
        const second = labels[1].replace(/^Low-side /, "");
        if (first === second) label = `High/low-side ${first}`;
      }
      const unit = BUCK_LOSS_SCHEMA_V2[keys[0]]?.unit || "";
      const maximum = finite(metadata.maximum) ? `; maximum ${displayNumber(metadata.maximum, 3)} ${unit}` : "";
      const qualification = metadata.qualification ? ` ${metadata.qualification}` : "";
      const item = document.createElement("li");
      item.textContent = `${label}: ${displayNumber(value, 3)} ${unit} ${metadata.statistic}; ${metadata.conditions}${maximum}.${qualification}`;
      return item;
    });
    conditionDetails.hidden = rows.length === 0;
    conditionList.replaceChildren(...rows);
  }
  root.dataset.blxTechnology = template.technology;
  root.querySelectorAll("[data-blx-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", !state.custom && button.dataset.blxPreset === state.presetId ? "true" : "false");
  });
  const preset = getBuckLossPresetV2(state.presetId);
  setText(root, "[data-blx-prompt]", preset?.prompt || "Custom operating point. Change one assumption at a time.");
}

function renderBadges(root, point, template = null) {
  const holder = root.querySelector("[data-blx-result-badges]");
  if (!holder) return;
  if (point.valid) {
    holder.replaceChildren();
    return;
  }
  const labels = [
    `Out of regulation · ${point.failure?.code || "infeasible"}`,
    "No result"
  ];
  holder.replaceChildren(...labels.map((label, index) => {
    const span = document.createElement("span");
    span.textContent = label;
    if (index === labels.length - 1) span.dataset.tone = point.valid ? point.availability : "failure";
    return span;
  }));
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function formatWaveformTime(seconds) {
  if (!finite(seconds)) return "—";
  if (Math.abs(seconds) < 1e-6) return `${displayNumber(seconds * 1e9, 3)} ns`;
  return `${displayNumber(seconds * 1e6, 3)} µs`;
}

function waveformStateLabel(segment) {
  return {
    "high-side": "high side on",
    "low-side": "low side on",
    "dead-time": "dead time · both gates off",
    "zero-current": "zero-current window · switch node floating"
  }[segment?.state] || "transition";
}

const WAVEFORM_DETAIL_HEIGHT = 318;
const WAVEFORM_OVERVIEW_HEIGHT = 78;
const WAVEFORM_MIN_SPAN = 1 / 1000;

function waveformTickLabel(seconds, spanSeconds) {
  const useNanoseconds = Math.abs(spanSeconds) < 2e-6;
  const scale = useNanoseconds ? 1e9 : 1e6;
  const value = Math.abs(seconds) < Math.abs(spanSeconds) * 1e-9 ? 0 : seconds * scale;
  return `${displayNumber(value, 3)} ${useNanoseconds ? "ns" : "µs"}`;
}

function waveformPath(samples, xForPhase, yForValue, key) {
  if (!samples.length) return "";
  let drawing = false;
  const commands = [];
  samples.forEach((sample) => {
    const value = sample[key];
    if (!finite(value)) {
      drawing = false;
      return;
    }
    commands.push(`${drawing ? "L" : "M"}${xForPhase(sample.phase)},${yForValue(value)}`);
    drawing = true;
  });
  return commands.join(" ");
}

function createWaveformGroup(svg, className) {
  const group = svgNode("g", { class: className });
  svg.append(group);
  return group;
}

function ensureDetailWaveformScene(holder) {
  if (holder.blxWaveformScene) return holder.blxWaveformScene;
  const svg = svgNode("svg", { role: "img" });
  svg.classList.add("blx-waveform-svg", "blx-waveform-detail-svg");
  const scene = {
    svg,
    grid: createWaveformGroup(svg, "blx-waveform-grid"),
    unresolved: createWaveformGroup(svg, "blx-waveform-unresolved"),
    intervals: createWaveformGroup(svg, "blx-waveform-intervals"),
    dead: createWaveformGroup(svg, "blx-waveform-dead-times"),
    traces: createWaveformGroup(svg, "blx-waveform-traces"),
    evidence: createWaveformGroup(svg, "blx-waveform-evidence"),
    axis: createWaveformGroup(svg, "blx-waveform-axis"),
    labels: createWaveformGroup(svg, "blx-waveform-labels"),
    cursors: createWaveformGroup(svg, "blx-waveform-cursors")
  };
  scene.paths = {
    ideal: svgNode("path", { class: "blx-waveform-voltage-ideal", "data-blx-waveform-trace": "switch-node-ideal" }),
    supported: svgNode("path", { class: "blx-waveform-voltage", "data-blx-waveform-trace": "switch-node" }),
    ringing: svgNode("path", { class: "blx-waveform-ringing", "data-blx-waveform-trace": "switch-node-ringing" }),
    current: svgNode("path", { class: "blx-waveform-current", "data-blx-waveform-trace": "inductor-current" })
  };
  scene.traces.append(...Object.values(scene.paths));
  const makeCursor = (kind) => {
    const group = svgNode("g", { class: `blx-waveform-${kind}-cursor`, "data-blx-waveform-cursor": kind });
    const line = svgNode("line", { class: "blx-waveform-cursor" });
    const voltage = svgNode("circle", { r: kind === "probe" ? 4 : 3, class: "blx-waveform-marker" });
    const current = svgNode("circle", { r: kind === "probe" ? 4 : 3, class: "blx-waveform-marker" });
    group.append(line, voltage, current);
    scene.cursors.append(group);
    return { group, line, voltage, current };
  };
  scene.probe = makeCursor("probe");
  scene.ghost = makeCursor("ghost");
  holder.prepend(svg);
  holder.blxWaveformScene = scene;
  return scene;
}

function ensureOverviewWaveformScene(holder) {
  if (holder.blxWaveformScene) return holder.blxWaveformScene;
  const svg = svgNode("svg", { role: "img", "aria-label": "Full switching cycle with adjustable detail window" });
  svg.classList.add("blx-waveform-svg", "blx-waveform-overview-svg");
  const scene = {
    svg,
    intervals: createWaveformGroup(svg, "blx-waveform-overview-intervals"),
    dead: createWaveformGroup(svg, "blx-waveform-overview-dead"),
    traces: createWaveformGroup(svg, "blx-waveform-overview-traces"),
    edges: createWaveformGroup(svg, "blx-waveform-overview-edges"),
    brush: createWaveformGroup(svg, "blx-waveform-brush")
  };
  scene.ideal = svgNode("path", { class: "blx-waveform-voltage-ideal" });
  scene.supported = svgNode("path", { class: "blx-waveform-voltage" });
  scene.traces.append(scene.ideal, scene.supported);
  scene.brushTrue = svgNode("rect", { class: "blx-waveform-brush-true" });
  scene.brushVisual = svgNode("rect", { class: "blx-waveform-brush-visual", "data-blx-overview-brush": "body" });
  scene.handleStart = svgNode("rect", { class: "blx-waveform-brush-handle", "data-blx-overview-brush": "start", tabindex: "0" });
  scene.handleEnd = svgNode("rect", { class: "blx-waveform-brush-handle", "data-blx-overview-brush": "end", tabindex: "0" });
  scene.brush.append(scene.brushTrue, scene.brushVisual, scene.handleStart, scene.handleEnd);
  holder.append(svg);
  holder.blxWaveformScene = scene;
  return scene;
}

function waveformCommutationCopy(edge) {
  const commutation = edge?.commutation;
  if (!commutation) return "commutation unresolved";
  const classification = commutation.classification || commutation.class || commutation.mode || "commutation resolved";
  const device = commutation.turnOnDevice || commutation.device;
  return `${device ? `${device} · ` : ""}${String(classification).replaceAll("-", " ")}`;
}

function setWaveformCursor(cursor, sample, xForPhase, voltageY, currentY, top, bottom) {
  if (!sample) {
    cursor.group.setAttribute("hidden", "");
    return;
  }
  cursor.group.removeAttribute("hidden");
  const x = xForPhase(sample.phase);
  cursor.line.setAttribute("x1", x);
  cursor.line.setAttribute("x2", x);
  cursor.line.setAttribute("y1", top);
  cursor.line.setAttribute("y2", bottom);
  cursor.voltage.setAttribute("cx", x);
  cursor.voltage.setAttribute("cy", voltageY(finite(sample.ringingVoltage) ? sample.ringingVoltage : sample.supportedVoltage));
  cursor.current.setAttribute("cx", x);
  cursor.current.setAttribute("cy", currentY(sample.current));
}

function renderDetailWaveform(controller) {
  const { root, state, point, holder } = controller;
  const scene = ensureDetailWaveformScene(holder);
  const width = Math.max(280, Math.round(holder.clientWidth || 720));
  const height = WAVEFORM_DETAIL_HEIGHT;
  const left = width < 420 ? 42 : 52;
  const right = 14;
  const plotWidth = Math.max(1, width - left - right);
  const view = state.waveformView;
  const geometry = buildWaveformGeometryV2({ point, inputs: state.inputs, view, width: plotWidth, parasitics: state.waveformRinging });
  const xForPhase = (phase) => left + unitFromPhaseV2(view, phase) * plotWidth;
  const visibleCurrents = geometry.samples.map((sample) => sample.current).filter(finite);
  const autoFitCurrent = view.mode !== "full" && view.endPhase - view.startPhase < 1 - 1e-10;
  let currentMin = autoFitCurrent ? Math.min(...visibleCurrents) : Math.min(0, point.waveform.iValley);
  let currentMax = autoFitCurrent ? Math.max(...visibleCurrents) : Math.max(0, point.waveform.iPeak);
  if (!finite(currentMin) || !finite(currentMax)) {
    currentMin = 0;
    currentMax = 1;
  }
  if (autoFitCurrent) {
    const rawSpan = currentMax - currentMin;
    const fallbackSpan = Math.max(Math.abs((currentMax + currentMin) / 2) * 0.02, Math.abs(point.waveform.iPeak - point.waveform.iValley) * 0.01, 1e-3);
    const paddedSpan = Math.max(rawSpan, fallbackSpan);
    const center = (currentMin + currentMax) / 2;
    currentMin = center - paddedSpan * 0.58;
    currentMax = center + paddedSpan * 0.58;
  }
  const currentSpan = Math.max(1e-9, currentMax - currentMin);
  const currentTop = 138;
  const currentBottom = 242;
  const currentY = (current) => currentBottom - ((current - currentMin) / currentSpan) * (currentBottom - currentTop);
  const visibleVoltages = geometry.samples.flatMap((sample) => [sample.supportedVoltage, sample.ringingVoltage]).filter(finite);
  const voltageDataMin = visibleVoltages.length ? Math.min(...visibleVoltages) : 0;
  const voltageDataMax = visibleVoltages.length ? Math.max(...visibleVoltages) : state.inputs.vin;
  const voltagePadding = Math.max(0.04 * state.inputs.vin, 0.08 * (voltageDataMax - voltageDataMin));
  const voltageMin = Math.min(-0.2 * state.inputs.vin, -1.4 * state.inputs.diodeVf, voltageDataMin - voltagePadding);
  const voltageMax = Math.max(1.22 * state.inputs.vin, voltageDataMax + voltagePadding);
  const voltageY = (voltage) => 104 - ((voltage - voltageMin) / Math.max(1e-9, voltageMax - voltageMin)) * 70;
  const intervalY = 260;
  controller.layout = { left, right, width, plotWidth, height };
  controller.geometry = geometry;
  controller.timeline = geometry.timeline;
  scene.svg.removeAttribute("hidden");
  scene.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.svg.setAttribute("width", width);
  scene.svg.setAttribute("height", height);
  scene.svg.setAttribute("aria-label", `${compactMode(point.waveform.mode)} switch-node voltage, auto-fitted inductor current, first-order series-RLC response, edge evidence, and exact dead time`);

  const gridLines = [svgNode("line", { x1: left, y1: voltageY(0), x2: width - right, y2: voltageY(0), class: "blx-waveform-zero" })];
  if (currentMin <= 0 && currentMax >= 0) {
    gridLines.push(svgNode("line", { x1: left, y1: currentY(0), x2: width - right, y2: currentY(0), class: "blx-waveform-zero" }));
  }
  scene.grid.replaceChildren(...gridLines);
  const laneLabels = [["VSW", 25], ["iL", 132]];
  scene.labels.replaceChildren(...laneLabels.map(([copy, y]) => {
    const label = svgNode("text", { x: left - 9, y, "text-anchor": "end", class: "blx-waveform-lane-label" });
    label.textContent = copy;
    return label;
  }));
  scene.paths.ideal.setAttribute("d", waveformPath(geometry.samples, xForPhase, voltageY, "idealVoltage"));
  scene.paths.supported.setAttribute("d", waveformPath(geometry.samples, xForPhase, voltageY, "supportedVoltage"));
  const showRinging = point.waveform.mode === "ccm" && geometry.ringingModel.available;
  scene.paths.ringing.setAttribute("d", showRinging ? waveformPath(geometry.samples, xForPhase, voltageY, "ringingVoltage") : "");
  scene.paths.ringing.toggleAttribute("hidden", !showRinging);
  scene.paths.current.setAttribute("d", waveformPath(geometry.samples, xForPhase, currentY, "current"));

  const stateClass = { "high-side": "high", "low-side": "low", "dead-time": "dead", "zero-current": "zero" };
  const intervalNodes = [];
  const deadNodes = [];
  const unresolvedNodes = [];
  geometry.segments.forEach((segment) => {
    const x0 = xForPhase(segment.visibleStartPhase);
    const x1 = xForPhase(segment.visibleEndPhase);
    intervalNodes.push(svgNode("rect", { x: x0, y: intervalY, width: Math.max(0.35, x1 - x0), height: 12, class: `blx-interval-${stateClass[segment.state]}` }));
    if (segment.state === "dead-time") {
      const band = svgNode("rect", { x: x0, y: 16, width: Math.max(0.25, x1 - x0), height: intervalY - 11, class: "blx-waveform-dead-band", "data-blx-dead-time-band": "" });
      deadNodes.push(band);
      if (x1 - x0 < 1) deadNodes.push(svgNode("line", { x1: (x0 + x1) / 2, x2: (x0 + x1) / 2, y1: 16, y2: intervalY + 1, class: "blx-waveform-dead-hairline" }));
      const marker = svgNode("text", { x: clamp((x0 + x1) / 2, left + 22, width - right - 22), y: intervalY - 5, "text-anchor": "middle", class: "blx-waveform-dead-label" });
      marker.textContent = formatWaveformTime(segment.duration);
      deadNodes.push(marker);
    }
    if (segment.state === "zero-current") {
      unresolvedNodes.push(svgNode("rect", { x: x0, y: 16, width: Math.max(0.4, x1 - x0), height: 92, class: "blx-waveform-unresolved-region" }));
    }
    if (x1 - x0 > 58) {
      const label = svgNode("text", { x: (x0 + x1) / 2, y: 292, "text-anchor": "middle", class: "blx-waveform-interval-label" });
      label.textContent = segment.state.replace("-", " ");
      intervalNodes.push(label);
    }
  });
  if (point.waveform.mode !== "ccm" && unresolvedNodes.length) {
    const label = svgNode("text", { x: left + 8, y: 96, class: "blx-waveform-unresolved-label" });
    label.textContent = "unresolved DCM commutation · VSW floats";
    unresolvedNodes.push(label);
  }
  scene.intervals.replaceChildren(...intervalNodes);
  scene.dead.replaceChildren(...deadNodes);
  scene.unresolved.replaceChildren(...unresolvedNodes);

  const evidenceNodes = [];
  geometry.edges.forEach((edge) => {
    const x = xForPhase(edge.visiblePhase);
    const durationPhase = edge.timing.durationSeconds / point.waveform.period;
    const xEnd = xForPhase(Math.min(view.endPhase, edge.visiblePhase + durationPhase));
    if (edge.timing.kind === "effective-bracket" && durationPhase > 0) {
      evidenceNodes.push(svgNode("rect", { x, y: 20, width: Math.max(1, xEnd - x), height: 238, class: "blx-waveform-overlap-bracket" }));
    }
    if (view.endPhase - view.startPhase < 0.35 && plotWidth >= 360) {
      const timingLabel = svgNode("text", { x: clamp(x + 6, left + 4, width - right - 100), y: 46, class: "blx-waveform-evidence-label" });
      timingLabel.textContent = edge.timing.kind === "energy-only"
        ? "energy evidence only · edge time unavailable"
        : `${edge.timing.label.toLowerCase()} · ${formatWaveformTime(edge.timing.durationSeconds)}`;
      evidenceNodes.push(timingLabel);
      const commutation = svgNode("text", { x: clamp(x + 6, left + 4, width - right - 100), y: 59, class: "blx-waveform-commutation-label" });
      commutation.textContent = waveformCommutationCopy(edge);
      evidenceNodes.push(commutation);
    }
    if (showRinging && view.endPhase - view.startPhase < 0.22 && plotWidth >= 420) {
      const label = svgNode("text", { x: clamp(x + 8, left + 4, width - right - 105), y: 116, class: "blx-waveform-ringing-label" });
      label.textContent = `series RLC · ${displayNumber(geometry.ringingModel.frequencyHz / 1e6, 3)} MHz · ζ ${displayNumber(geometry.ringingModel.dampingRatio, 2)}`;
      evidenceNodes.push(label);
    }
  });
  scene.evidence.replaceChildren(...evidenceNodes);

  const axisNodes = [];
  const spanSeconds = (view.endPhase - view.startPhase) * point.waveform.period;
  waveformTimeTicksV2(point, view).forEach((tick) => {
    const x = xForPhase(tick.phase);
    axisNodes.push(svgNode("line", { x1: x, x2: x, y1: 278, y2: 283, class: "blx-waveform-tick" }));
    const label = svgNode("text", { x, y: 309, "text-anchor": "middle", class: "blx-waveform-tick-label" });
    label.textContent = waveformTickLabel(tick.timeSeconds, spanSeconds);
    axisNodes.push(label);
  });
  scene.axis.replaceChildren(...axisNodes);

  const inView = (phase) => phase >= view.startPhase - 1e-12 && phase <= view.endPhase + 1e-12;
  const probeSample = inView(view.probePhase) ? sampleWaveformAtPhaseV2(point, state.inputs, geometry.timeline, view.probePhase, state.waveformRinging) : null;
  const ghostSample = finite(state.waveformGhostPhase) && inView(state.waveformGhostPhase)
    ? sampleWaveformAtPhaseV2(point, state.inputs, geometry.timeline, state.waveformGhostPhase, state.waveformRinging)
    : null;
  setWaveformCursor(scene.probe, probeSample, xForPhase, voltageY, currentY, 16, intervalY + 12);
  setWaveformCursor(scene.ghost, ghostSample, xForPhase, voltageY, currentY, 16, intervalY + 12);

  const flags = root.querySelectorAll("[data-blx-waveform-edge-flag]");
  flags.forEach((flag) => {
    const id = flag.dataset.blxWaveformEdgeFlag;
    const edge = geometry.edges.find((candidate) => candidate.id === id);
    flag.hidden = !edge;
    if (!edge) return;
    flag.style.left = `${clamp(xForPhase(edge.visiblePhase), left, width - right)}px`;
    flag.title = `${edge.label} · dead time ${formatWaveformTime(edge.deadTimeSeconds)} · ${edge.timing.label} · ${waveformCommutationCopy(edge)}`;
  });
  updateWaveformReadout(controller);
}

function renderOverviewWaveform(controller) {
  const { state, point, overview } = controller;
  const scene = ensureOverviewWaveformScene(overview);
  const width = Math.max(280, Math.round(overview.clientWidth || 720));
  const height = WAVEFORM_OVERVIEW_HEIGHT;
  const left = width < 420 ? 42 : 52;
  const right = 14;
  const plotWidth = Math.max(1, width - left - right);
  const full = defaultWaveformViewV2(point, state.waveformView.probePhase);
  const geometry = buildWaveformGeometryV2({ point, inputs: state.inputs, view: full, width: plotWidth });
  const xForPhase = (phase) => left + unitFromPhaseV2(full, phase) * plotWidth;
  const voltageMin = Math.min(-0.2 * state.inputs.vin, -1.4 * state.inputs.diodeVf);
  const voltageMax = 1.22 * state.inputs.vin;
  const voltageY = (voltage) => 39 - ((voltage - voltageMin) / Math.max(1e-9, voltageMax - voltageMin)) * 27;
  controller.overviewLayout = { left, right, width, plotWidth, full };
  scene.svg.removeAttribute("hidden");
  scene.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.svg.setAttribute("width", width);
  scene.svg.setAttribute("height", height);
  scene.ideal.setAttribute("d", waveformPath(geometry.samples, xForPhase, voltageY, "idealVoltage"));
  scene.supported.setAttribute("d", waveformPath(geometry.samples, xForPhase, voltageY, "supportedVoltage"));
  const stateClass = { "high-side": "high", "low-side": "low", "dead-time": "dead", "zero-current": "zero" };
  scene.intervals.replaceChildren(...geometry.segments.map((segment) => svgNode("rect", {
    x: xForPhase(segment.visibleStartPhase), y: 48,
    width: Math.max(0.35, xForPhase(segment.visibleEndPhase) - xForPhase(segment.visibleStartPhase)),
    height: 9, class: `blx-interval-${stateClass[segment.state]}`
  })));
  const deadNodes = [];
  geometry.segments.filter((segment) => segment.state === "dead-time").forEach((segment) => {
    const x0 = xForPhase(segment.visibleStartPhase);
    const x1 = xForPhase(segment.visibleEndPhase);
    const exactWidth = Math.max(0.25, x1 - x0);
    const marker = svgNode("rect", { x: (x0 + x1) / 2 - Math.max(6, exactWidth) / 2, y: 5, width: Math.max(6, exactWidth), height: 54, class: "blx-waveform-overview-dead-marker" });
    const title = svgNode("title");
    title.textContent = `Exact dead time ${formatWaveformTime(segment.duration)}`;
    marker.append(title);
    deadNodes.push(marker);
  });
  scene.dead.replaceChildren(...deadNodes);
  scene.edges.replaceChildren(...geometry.edges.map((edge) => {
    const group = svgNode("g", { class: "blx-waveform-overview-edge" });
    const x = xForPhase(edge.visiblePhase);
    const line = svgNode("line", { x1: x, x2: x, y1: 3, y2: 59 });
    const text = svgNode("text", { x, y: 72, "text-anchor": "middle" });
    text.textContent = edge.id === "rising" ? "R" : "F";
    group.append(line, text);
    return group;
  }));
  const startX = xForPhase(state.waveformView.startPhase);
  const endX = xForPhase(state.waveformView.endPhase);
  const exactWidth = Math.max(0.5, endX - startX);
  const visualWidth = Math.max(8, exactWidth);
  const visualX = clamp((startX + endX) / 2 - visualWidth / 2, left, width - right - visualWidth);
  [scene.brushTrue, scene.brushVisual].forEach((node) => {
    node.setAttribute("y", 2);
    node.setAttribute("height", 58);
  });
  scene.brushTrue.setAttribute("x", startX);
  scene.brushTrue.setAttribute("width", exactWidth);
  scene.brushVisual.setAttribute("x", visualX);
  scene.brushVisual.setAttribute("width", visualWidth);
  scene.handleStart.setAttribute("x", startX - 6);
  scene.handleEnd.setAttribute("x", endX - 6);
  [scene.handleStart, scene.handleEnd].forEach((node) => {
    node.setAttribute("y", 0);
    node.setAttribute("width", 12);
    node.setAttribute("height", 62);
  });
}

function updateWaveformReadout(controller) {
  const { root, state, point } = controller;
  const view = state.waveformView;
  const timeline = controller.timeline || waveformTimelineV2(point.waveform);
  const phase = finite(state.waveformGhostPhase) ? state.waveformGhostPhase : view.probePhase;
  const sample = sampleWaveformAtPhaseV2(point, state.inputs, timeline, phase, state.waveformRinging);
  const model = calculateRingingModelV2(state.waveformRinging);
  const ringingCopy = point.waveform.mode === "ccm" && model.available && view.endPhase - view.startPhase < 0.22
    ? ` · RLC ${displayNumber(model.frequencyHz / 1e6, 3)} MHz`
    : "";
  const pinnedOutside = !finite(state.waveformGhostPhase) && (view.probePhase < view.startPhase || view.probePhase > view.endPhase);
  const voltageCopy = finite(sample.ringingVoltage)
    ? `VSW RLC ≈ ${displayNumber(sample.ringingVoltage, 3)} V · drive target ${displayNumber(sample.supportedVoltage, 3)} V`
    : `VSW ≈ ${displayNumber(sample.supportedVoltage, 3)} V`;
  const copy = `${formatWaveformTime(sample.timeSeconds)} · ${waveformStateLabel(sample.segment)} · ${voltageCopy} · iL ${formatCurrent(sample.current)}${ringingCopy}${pinnedOutside ? " · pinned time outside view" : ""}`;
  const readout = root.querySelector("[data-blx-waveform-readout]");
  const probe = root.querySelector("[data-blx-waveform-probe]");
  if (readout) readout.textContent = copy;
  if (probe) {
    probe.value = String(Math.round(clamp(unitFromPhaseV2(view, view.probePhase), 0, 1) * 1000));
    probe.setAttribute("aria-valuetext", copy);
  }
  const status = root.querySelector("[data-blx-waveform-view-status]");
  if (status) {
    const mode = { full: "Full cycle", rising: "Rising edge", falling: "Falling edge", custom: "Custom window" }[view.mode] || "Custom window";
    const span = view.endPhase - view.startPhase;
    status.textContent = `${mode} · ${formatWaveformTime(span * point.waveform.period)} window · ${displayNumber(1 / span, 3)}× zoom${pinnedOutside ? " · pinned time outside view" : ""}`;
  }
  root.querySelectorAll("[data-blx-waveform-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.blxWaveformMode === view.mode ? "true" : "false");
    if (button.dataset.blxWaveformMode !== "full") button.disabled = !waveformEdgeEvidenceV2(point).available;
  });
  const full = defaultWaveformViewV2(point, view.probePhase);
  const span = view.endPhase - view.startPhase;
  const buttons = Object.fromEntries([...root.querySelectorAll("[data-blx-waveform-action]")].map((button) => [button.dataset.blxWaveformAction, button]));
  if (buttons["zoom-in"]) buttons["zoom-in"].disabled = span <= WAVEFORM_MIN_SPAN + 1e-10;
  if (buttons["zoom-out"]) buttons["zoom-out"].disabled = span >= 1 - 1e-10;
  if (buttons["pan-left"]) buttons["pan-left"].disabled = view.startPhase <= full.startPhase + 1e-10;
  if (buttons["pan-right"]) buttons["pan-right"].disabled = view.endPhase >= full.endPhase - 1e-10;
}

function createWaveformController(root, state, holder, overview) {
  const controller = {
    root,
    state,
    holder,
    overview,
    point: null,
    frame: 0,
    destroyed: false,
    update(point) {
      if (this.destroyed || state.disposed) return;
      this.point = point;
      state.waveformAnimation?.cancel?.();
      state.waveformAnimation = null;
      state.waveformView = semanticWaveformViewV2(point, state.waveformView);
      this.render();
    },
    render() {
      if (this.destroyed || state.disposed || !this.point?.valid) return;
      renderDetailWaveform(this);
      renderOverviewWaveform(this);
    },
    schedule() {
      if (this.destroyed || state.disposed || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.destroyed || state.disposed) return;
        this.render();
      });
    },
    setView(next, { animate = false } = {}) {
      if (!this.point) return;
      const target = clampWaveformViewV2(this.point, next, next.mode || "custom");
      state.waveformAnimation?.cancel?.();
      if (!animate) {
        state.waveformView = target;
        this.schedule();
        return;
      }
      const mode = target.mode;
      state.waveformAnimation = animateWaveformDomain({
        from: state.waveformView,
        to: target,
        duration: 150,
        draw: (view) => {
          if (this.destroyed || state.disposed) return;
          state.waveformView = { ...view, mode, probePhase: target.probePhase };
          this.render();
        }
      });
    },
    setMode(mode, animate = true) {
      if (!this.point) return;
      const target = mode === "full"
        ? defaultWaveformViewV2(this.point, state.waveformView.probePhase)
        : edgePresetWaveformViewV2(this.point, mode, state.waveformView.probePhase);
      this.setView(target, { animate });
    },
    zoom(anchorPhase, factor, animate = false) {
      this.setView(zoomWaveformViewV2(this.point, state.waveformView, anchorPhase, factor), { animate });
    },
    pan(deltaPhase, animate = false) {
      this.setView(panWaveformViewV2(this.point, state.waveformView, deltaPhase), { animate });
    },
    setProbe(phase) {
      state.waveformView = { ...state.waveformView, probePhase: phase };
      state.waveformGhostPhase = null;
      this.schedule();
    },
    setGhost(phase) {
      state.waveformGhostPhase = finite(phase) ? phase : null;
      this.schedule();
    },
    phaseFromClientX(clientX) {
      const rect = holder.getBoundingClientRect();
      const layout = this.layout || { left: 52, plotWidth: Math.max(1, rect.width - 66) };
      const unit = clamp((clientX - rect.left - layout.left) / layout.plotWidth, 0, 1);
      return phaseFromUnitV2(state.waveformView, unit);
    },
    overviewPhaseFromClientX(clientX) {
      const rect = overview.getBoundingClientRect();
      const layout = this.overviewLayout;
      if (!layout) return 0;
      return phaseFromUnitV2(layout.full, clamp((clientX - rect.left - layout.left) / layout.plotWidth, 0, 1));
    },
    resize() {
      this.schedule();
    },
    clear() {
      state.waveformAnimation?.cancel?.();
      if (holder.blxWaveformScene) holder.blxWaveformScene.svg.setAttribute("hidden", "");
      if (overview.blxWaveformScene) overview.blxWaveformScene.svg.setAttribute("hidden", "");
      root.querySelectorAll("[data-blx-waveform-edge-flag]").forEach((flag) => { flag.hidden = true; });
    },
    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      state.waveformAnimation?.cancel?.();
      state.waveformAnimation = null;
      holder.blxWaveformController = null;
      overview.blxWaveformController = null;
    }
  };
  holder.blxWaveformController = controller;
  overview.blxWaveformController = controller;
  return controller;
}

function renderWaveformDiagram(root, state, point) {
  const holder = root.querySelector("[data-blx-waveform-diagram]");
  const overview = root.querySelector("[data-blx-waveform-overview]");
  if (!holder || !overview || !point.valid) return;
  const controller = holder.blxWaveformController || createWaveformController(root, state, holder, overview);
  controller.update(point);
  const model = calculateRingingModelV2(state.waveformRinging);
  root.querySelectorAll("[data-blx-waveform-ringing-input]").forEach((input) => {
    const key = input.dataset.blxWaveformRingingInput;
    const values = {
      nodeCapacitancePf: finite(state.waveformRinging.nodeCapacitanceF) ? state.waveformRinging.nodeCapacitanceF * 1e12 : null,
      loopInductanceNh: finite(state.waveformRinging.loopInductanceH) ? state.waveformRinging.loopInductanceH * 1e9 : null,
      loopResistanceOhm: finite(state.waveformRinging.loopResistanceOhm) ? state.waveformRinging.loopResistanceOhm : null
    };
    const value = values[key];
    if (document.activeElement !== input) input.value = finite(value) ? String(Number(value.toPrecision(6))) : "";
  });
  const status = root.querySelector("[data-blx-waveform-ringing-status]");
  if (status) {
    status.textContent = point.waveform.mode !== "ccm"
      ? "unresolved in DCM"
      : model.available
        ? `${displayNumber(model.frequencyHz / 1e6, 3)} MHz · ζ ${displayNumber(model.dampingRatio, 2)} · ${state.waveformRinging.loopAssumptionSource === "user-entered" ? "user L/R" : "example L/R"}`
        : model.status === "non-oscillatory" ? "non-oscillatory at these values" : "enter C, L, and R";
  }
  const source = root.querySelector("[data-blx-waveform-ringing-source]");
  if (source) {
    const voltage = state.waveformRinging.characterizationVoltageV;
    const loopCopy = state.waveformRinging.loopAssumptionSource === "user-entered"
      ? "Loop L/R are user-entered board assumptions."
      : "The default 2 nH loop L and 0.35 Ω damping R are illustrative board-level starting assumptions.";
    source.textContent = `${state.waveformRinging.capacitanceSource}${finite(voltage) ? `; characterized at ${displayNumber(voltage, 3)} V` : ""}. This is a device-only, non-VIN-adjusted seed—confirm or edit it for the operating point. ${loopCopy} This first-order linear response excludes nonlinear COSS, edge-current/QRR excitation, clamps, and probe loading.`;
  }
}

function initializeWaveformInteractions(root, state) {
  const holder = root.querySelector("[data-blx-waveform-diagram]");
  const overview = root.querySelector("[data-blx-waveform-overview]");
  const probe = root.querySelector("[data-blx-waveform-probe]");
  const selection = root.querySelector("[data-blx-waveform-selection]");
  if (!holder || !overview || !probe || !selection) return;
  const controller = () => holder.blxWaveformController;
  const ringingScales = { nodeCapacitancePf: 1e-12, loopInductanceNh: 1e-9, loopResistanceOhm: 1 };
  root.querySelectorAll("[data-blx-waveform-ringing-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.blxWaveformRingingInput;
      const value = Number(input.value);
      const target = { nodeCapacitancePf: "nodeCapacitanceF", loopInductanceNh: "loopInductanceH", loopResistanceOhm: "loopResistanceOhm" }[key];
      if (!target) return;
      state.waveformRinging[target] = input.value !== "" && finite(value) && value > 0 ? value * ringingScales[key] : null;
      if (key === "nodeCapacitancePf") {
        state.waveformRinging.capacitanceSource = "User-entered effective node capacitance";
        state.waveformRinging.characterizationVoltageV = null;
      } else {
        state.waveformRinging.loopAssumptionSource = "user-entered";
      }
      if (state.point?.valid) renderWaveformDiagram(root, state, state.point);
    });
  });
  const setSelection = (startClientX, endClientX) => {
    const rect = holder.getBoundingClientRect();
    const layout = controller()?.layout;
    if (!layout) return;
    const start = clamp(startClientX - rect.left, layout.left, layout.left + layout.plotWidth);
    const end = clamp(endClientX - rect.left, layout.left, layout.left + layout.plotWidth);
    selection.style.left = `${Math.min(start, end)}px`;
    selection.style.width = `${Math.abs(end - start)}px`;
    selection.hidden = Math.abs(end - start) < 6;
  };
  const endPointer = (event, cancelled = false) => {
    const active = state.waveformPointer;
    if (!active || active.pointerId !== event.pointerId) return;
    const api = controller();
    const dx = event.clientX - active.startX;
    const distance = Math.abs(dx);
    if (!cancelled && active.mode === "select" && distance >= 6) {
      const startPhase = api.phaseFromClientX(active.startX);
      const endPhase = api.phaseFromClientX(event.clientX);
      api.setView({
        ...state.waveformView,
        mode: "custom",
        startPhase: Math.min(startPhase, endPhase),
        endPhase: Math.max(startPhase, endPhase)
      });
    } else if (!cancelled && active.mode === "select" && distance < 6) {
      api.setProbe(api.phaseFromClientX(event.clientX));
    } else if (!cancelled && active.mode === "touch" && Math.hypot(dx, event.clientY - active.startY) < 7) {
      api.setProbe(api.phaseFromClientX(event.clientX));
    }
    selection.hidden = true;
    state.waveformPointer = null;
    try { holder.releasePointerCapture(event.pointerId); } catch {}
  };

  probe.addEventListener("input", () => {
    const api = controller();
    if (!api) return;
    api.setProbe(phaseFromUnitV2(state.waveformView, Number(probe.value) / 1000));
  });
  holder.addEventListener("pointerdown", (event) => {
    const api = controller();
    if (!api || event.target.closest?.("button, input, a, select, textarea") || (event.button !== 0 && event.button !== 1)) return;
    const mode = event.pointerType === "touch" ? "touch" : event.button === 1 || event.shiftKey ? "pan" : "select";
    state.waveformPointer = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startView: { ...state.waveformView },
      horizontal: false,
      vertical: false
    };
    if (event.pointerType !== "touch") {
      try { holder.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    }
    holder.focus({ preventScroll: true });
  });
  holder.addEventListener("pointermove", (event) => {
    const api = controller();
    if (!api) return;
    const active = state.waveformPointer;
    if (!active || active.pointerId !== event.pointerId) {
      if (event.pointerType !== "touch") api.setGhost(api.phaseFromClientX(event.clientX));
      return;
    }
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.mode === "touch") {
      if (!active.horizontal && !active.vertical && Math.hypot(dx, dy) >= 6) {
        active.horizontal = Math.abs(dx) > Math.abs(dy);
        active.vertical = !active.horizontal;
        if (active.horizontal) {
          try { holder.setPointerCapture(event.pointerId); } catch {}
        }
      }
      if (active.horizontal) {
        api.setGhost(api.phaseFromClientX(event.clientX));
        event.preventDefault();
      }
      return;
    }
    if (active.mode === "pan") {
      const span = active.startView.endPhase - active.startView.startPhase;
      const delta = -dx / Math.max(1, api.layout.plotWidth) * span;
      api.setView(panWaveformViewV2(api.point, active.startView, delta));
      event.preventDefault();
      return;
    }
    api.setGhost(api.phaseFromClientX(event.clientX));
    setSelection(active.startX, event.clientX);
    event.preventDefault();
  });
  holder.addEventListener("pointerup", (event) => endPointer(event));
  holder.addEventListener("pointercancel", (event) => endPointer(event, true));
  holder.addEventListener("pointerleave", (event) => {
    if (!state.waveformPointer && event.pointerType !== "touch") controller()?.setGhost(null);
  });
  holder.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  holder.addEventListener("wheel", (event) => {
    const api = controller();
    if (!api) return;
    if (event.ctrlKey || event.metaKey) {
      const anchor = api.phaseFromClientX(event.clientX);
      const next = zoomWaveformViewV2(api.point, state.waveformView, anchor, clamp(Math.exp(event.deltaY * 0.0015), 0.5, 2));
      if (next.startPhase !== state.waveformView.startPhase || next.endPhase !== state.waveformView.endPhase) {
        event.preventDefault();
        api.setView(next);
      }
      return;
    }
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || state.waveformView.endPhase - state.waveformView.startPhase >= 1 - 1e-10) return;
    const delta = event.deltaX / Math.max(1, api.layout.plotWidth) * (state.waveformView.endPhase - state.waveformView.startPhase);
    const next = panWaveformViewV2(api.point, state.waveformView, delta);
    if (next.startPhase !== state.waveformView.startPhase || next.endPhase !== state.waveformView.endPhase) {
      event.preventDefault();
      api.setView(next);
    }
  }, { passive: false });
  holder.addEventListener("dblclick", (event) => {
    event.preventDefault();
    controller()?.setMode("full", true);
  });
  holder.addEventListener("keydown", (event) => {
    const api = controller();
    if (!api) return;
    if (event.key === "Escape" && state.waveformPointer) {
      selection.hidden = true;
      state.waveformPointer = null;
      api.setGhost(null);
      event.preventDefault();
      return;
    }
    const anchor = state.waveformView.probePhase >= state.waveformView.startPhase && state.waveformView.probePhase <= state.waveformView.endPhase
      ? state.waveformView.probePhase
      : (state.waveformView.startPhase + state.waveformView.endPhase) / 2;
    if (["+", "="].includes(event.key)) api.zoom(anchor, 0.5, true);
    else if (event.key === "-") api.zoom(anchor, 2, true);
    else if (event.key === "Home") api.setMode("full", true);
    else if (event.key.toLowerCase() === "r") api.setMode("rising", true);
    else if (event.key.toLowerCase() === "f") api.setMode("falling", true);
    else if (event.shiftKey && event.key === "ArrowLeft") api.pan(-0.15 * (state.waveformView.endPhase - state.waveformView.startPhase), true);
    else if (event.shiftKey && event.key === "ArrowRight") api.pan(0.15 * (state.waveformView.endPhase - state.waveformView.startPhase), true);
    else return;
    event.preventDefault();
  });

  root.querySelectorAll("[data-blx-waveform-mode]").forEach((button) => {
    button.addEventListener("click", () => controller()?.setMode(button.dataset.blxWaveformMode, true));
  });
  root.querySelectorAll("[data-blx-waveform-edge-flag]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      controller()?.setMode(button.dataset.blxWaveformEdgeFlag, true);
    });
  });
  root.querySelectorAll("[data-blx-waveform-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const api = controller();
      if (!api) return;
      const action = button.dataset.blxWaveformAction;
      const span = state.waveformView.endPhase - state.waveformView.startPhase;
      const anchor = state.waveformView.probePhase >= state.waveformView.startPhase && state.waveformView.probePhase <= state.waveformView.endPhase
        ? state.waveformView.probePhase
        : (state.waveformView.startPhase + state.waveformView.endPhase) / 2;
      if (action === "zoom-in") api.zoom(anchor, 0.5, true);
      if (action === "zoom-out") api.zoom(anchor, 2, true);
      if (action === "pan-left") api.pan(-0.2 * span, true);
      if (action === "pan-right") api.pan(0.2 * span, true);
    });
  });
  const overviewPointerEnd = (event) => {
    if (state.waveformOverviewPointer?.pointerId !== event.pointerId) return;
    state.waveformOverviewPointer = null;
    try { overview.releasePointerCapture(event.pointerId); } catch {}
  };
  overview.addEventListener("pointerdown", (event) => {
    const api = controller();
    if (!api || event.button !== 0) return;
    let role = event.target?.dataset?.blxOverviewBrush || "center";
    const scene = overview.blxWaveformScene;
    const visualWidth = Number(scene?.brushVisual?.getAttribute("width"));
    if (["start", "end"].includes(role) && visualWidth <= 16) {
      const rect = overview.getBoundingClientRect();
      const visualStart = Number(scene.brushVisual.getAttribute("x"));
      const localX = event.clientX - rect.left;
      const midpoint = visualStart + visualWidth / 2;
      role = Math.abs(localX - midpoint) <= 3 ? "body" : localX < midpoint ? "start" : "end";
    }
    const phase = api.overviewPhaseFromClientX(event.clientX);
    if (role === "center") {
      const span = state.waveformView.endPhase - state.waveformView.startPhase;
      api.setView({ ...state.waveformView, mode: "custom", startPhase: phase - span / 2, endPhase: phase + span / 2 });
      return;
    }
    state.waveformOverviewPointer = { pointerId: event.pointerId, role, startX: event.clientX, startView: { ...state.waveformView } };
    try { overview.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });
  overview.addEventListener("pointermove", (event) => {
    const active = state.waveformOverviewPointer;
    const api = controller();
    if (!api || !active || active.pointerId !== event.pointerId) return;
    const phase = api.overviewPhaseFromClientX(event.clientX);
    if (active.role === "body") {
      const delta = (event.clientX - active.startX) / Math.max(1, api.overviewLayout.plotWidth);
      api.setView(panWaveformViewV2(api.point, active.startView, delta));
    } else if (active.role === "start") {
      api.setView({ ...active.startView, mode: "custom", startPhase: Math.min(phase, active.startView.endPhase - WAVEFORM_MIN_SPAN) });
    } else if (active.role === "end") {
      api.setView({ ...active.startView, mode: "custom", endPhase: Math.max(phase, active.startView.startPhase + WAVEFORM_MIN_SPAN) });
    }
    event.preventDefault();
  });
  overview.addEventListener("pointerup", overviewPointerEnd);
  overview.addEventListener("pointercancel", overviewPointerEnd);

  const hint = root.querySelector("[data-blx-waveform-hint]");
  if (hint) {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem("blx-waveform-hint-dismissed") === "true"; } catch {}
    hint.hidden = dismissed || !matchMedia("(pointer: fine)").matches;
    root.querySelector("[data-blx-waveform-hint-dismiss]")?.addEventListener("click", () => {
      hint.hidden = true;
      try { sessionStorage.setItem("blx-waveform-hint-dismissed", "true"); } catch {}
    });
  }
}

function sourceCopy(source) {
  if (!source) return "No source assigned.";
  const relation = source.relation === "adapted" ? "Adapted" : "Direct";
  const title = source.title === "Switched Inductor Power IC Design" ? "" : `${source.title || "Model disclosure"} · `;
  if (source.references?.length) {
    const references = source.references
      .map((reference) => `Eq. ${reference.equation} · printed p. ${reference.printedPage} · PDF p. ${reference.pdfPage}`)
      .join("; ");
    return `${title}${references} · ${relation}`;
  }
  if (source.equation) return `${title}Eq. ${source.equation} · printed p. ${source.printedPage} · PDF p. ${source.pdfPage} · ${relation}`;
  if (source.printedPage && source.pdfPage) return `${title}printed p. ${source.printedPage} · PDF p. ${source.pdfPage} · ${relation}`;
  return `${title}${relation}`;
}

function omittedAtomicTermCount(point) {
  return BUCK_LOSS_FAMILIES_V2.reduce(
    (count, family) => count + family.terms.filter((key) => !finite(point.losses[key])).length,
    0
  );
}

function totalAtomicTermCount() {
  return BUCK_LOSS_FAMILIES_V2.reduce((count, family) => count + family.terms.length, 0);
}

function coverageExplanation(point) {
  const omitted = omittedAtomicTermCount(point);
  const total = totalAtomicTermCount();
  const reasons = [...new Set(point.coverageGaps.map((gap) => GAP_COPY[gap.code] || gap.code))];
  const reasonCopy = reasons.length ? ` Omitted here: ${reasons.join("; ")}.` : "";
  return `${formatPower(point.pLoss)} counts ${total - omitted} of ${total} analytical loss terms.${reasonCopy} Missing terms are never counted as zero, so true efficiency is at or below ${formatPercent(point.efficiency)} and true input power is at or above ${formatPower(point.pInEstimated)}.`;
}

function setCoverageTriggerState(root, enabled) {
  root.querySelectorAll("[data-blx-coverage-trigger]").forEach((trigger) => {
    if (trigger.tagName === "BUTTON") trigger.disabled = !enabled;
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
  });
}

function initializeCoveragePopover(root, state, signal) {
  const popover = root.querySelector("[data-blx-coverage-popover]");
  if (!popover || signal?.aborted) return;
  let activeTrigger = null;
  let openTimer = 0;
  let closeTimer = 0;
  let focusTimer = 0;
  let suppressFocusOpen = false;
  let pendingPointerType = "";
  let touchPinned = false;
  const coarsePointer = () => Boolean(window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches);
  const close = ({ restoreFocus = false } = {}) => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    popover.hidden = true;
    const returnTarget = activeTrigger;
    if (returnTarget) returnTarget.setAttribute("aria-expanded", "false");
    activeTrigger = null;
    pendingPointerType = "";
    touchPinned = false;
    if (restoreFocus && returnTarget) {
      suppressFocusOpen = true;
      returnTarget.focus();
      queueMicrotask(() => { suppressFocusOpen = false; });
    }
  };
  const position = (trigger) => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    const left = clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12);
    const below = rect.bottom + 10;
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(below, window.innerHeight - popover.offsetHeight - 12)}px`;
  };
  const open = (trigger, { pinForTouch = false } = {}) => {
    if (!state.point?.valid || state.point.availability !== "subtotal") return;
    if (activeTrigger && activeTrigger !== trigger) activeTrigger.setAttribute("aria-expanded", "false");
    if (pinForTouch) touchPinned = true;
    activeTrigger = trigger;
    setText(popover, "[data-blx-coverage-copy]", coverageExplanation(state.point));
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position(trigger);
  };
  root.addEventListener("pointerdown", (event) => {
    pendingPointerType = event.target.closest("[data-blx-coverage-trigger]") ? event.pointerType : "";
  }, true);
  root.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-blx-coverage-trigger]");
    if (!trigger || trigger.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const pinForTouch = pendingPointerType === "touch" || coarsePointer();
    pendingPointerType = "";
    open(trigger, { pinForTouch });
  });
  root.addEventListener("keydown", (event) => {
    const trigger = event.target.closest("[data-blx-coverage-trigger]");
    if (trigger && trigger.tagName !== "BUTTON" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      open(trigger);
    }
    if (event.key === "Escape" && !popover.hidden) {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  });
  root.addEventListener("focusin", (event) => {
    if (suppressFocusOpen) return;
    const trigger = event.target.closest("[data-blx-coverage-trigger]");
    if (trigger && !trigger.disabled) open(trigger);
  });
  root.addEventListener("focusout", (event) => {
    clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      focusTimer = 0;
      if (signal?.aborted) return;
      if (touchPinned) return;
      const focused = document.activeElement;
      if (!popover.hidden && !popover.contains(focused) && !focused?.closest?.("[data-blx-coverage-trigger]")) close();
    }, 0);
  });
  root.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const trigger = event.target.closest("[data-blx-coverage-trigger]");
    if (!trigger || trigger.disabled) return;
    clearTimeout(closeTimer);
    openTimer = window.setTimeout(() => open(trigger), 150);
  });
  root.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch" || touchPinned) return;
    if (!event.target.closest("[data-blx-coverage-trigger], [data-blx-coverage-popover]")) return;
    clearTimeout(openTimer);
    closeTimer = window.setTimeout(() => close(), 200);
  });
  popover.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  popover.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch" || touchPinned) return;
    closeTimer = window.setTimeout(() => close(), 200);
  });
  popover.querySelector("[data-blx-coverage-close]")?.addEventListener("click", () => close({ restoreFocus: true }));
  document.addEventListener("pointerdown", (event) => {
    if (touchPinned) return;
    if (!popover.hidden && !popover.contains(event.target) && !event.target.closest("[data-blx-coverage-trigger]")) close();
  }, signal ? { signal } : undefined);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  }, signal ? { signal } : undefined);
  window.addEventListener("resize", () => { if (!popover.hidden && activeTrigger) position(activeTrigger); }, signal ? { signal } : undefined);
  signal?.addEventListener("abort", () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    clearTimeout(focusTimer);
    activeTrigger = null;
    popover.hidden = true;
  }, { once: true });
}

function renderFamilyList(root, state, point) {
  const holder = root.querySelector("[data-blx-family-list]");
  if (!holder) return;
  const ranked = BUCK_LOSS_FAMILIES_V2
    .map((family) => ({
      family,
      available: family.terms.some((key) => finite(point.losses[key])),
      value: point.groupedLosses[family.id] ?? 0
    }))
    .sort((left, right) => Number(right.available) - Number(left.available) || right.value - left.value);
  const maximum = Math.max(...ranked.map((item) => item.value), 1e-12);
  const existing = new Map([...holder.querySelectorAll("[data-blx-family]")].map((item) => [item.dataset.blxFamily, item]));
  const beforeRects = new Map([...existing.values()].map((item) => [item, item.getBoundingClientRect()]));
  const focusedFamily = document.activeElement?.closest?.("[data-blx-family]")?.dataset.blxFamily;
  const focusedSummary = Boolean(document.activeElement?.matches?.("summary"));
  ranked.forEach(({ family, available, value }, index) => {
    let item = existing.get(family.id);
    if (!item) {
      item = document.createElement("li");
      item.className = "blx-loss-row blx-v2-family-row";
      item.dataset.blxFamily = family.id;
      const details = document.createElement("details");
      details.open = state.openFamilies.has(family.id);
      const summary = document.createElement("summary");
      summary.innerHTML = `<span class="blx-v2-rank"></span><span class="blx-loss-name"><i></i><b></b></span><strong></strong><span class="blx-v2-family-bar"></span>`;
      const body = document.createElement("div");
      body.className = "blx-v2-atomic-list";
      details.append(summary, body);
      details.addEventListener("toggle", () => {
        if (details.open) state.openFamilies.add(family.id);
        else state.openFamilies.delete(family.id);
        item.classList.toggle("is-open", details.open);
      });
      item.append(details);
    }
    const details = item.querySelector("details");
    details.open = state.openFamilies.has(family.id);
    item.classList.toggle("is-open", details.open);
    const summary = item.querySelector("summary");
    const rank = item.querySelector(".blx-v2-rank");
    const name = item.querySelector(".blx-loss-name b");
    const dot = item.querySelector(".blx-loss-name i");
    const amount = summary.querySelector(":scope > strong");
    const bar = item.querySelector(".blx-v2-family-bar");
    const body = item.querySelector(".blx-v2-atomic-list");
    rank.textContent = String(index + 1).padStart(2, "0");
    name.textContent = family.label;
    name.title = FAMILY_INTUITION[family.id] || "";
    dot.style.background = `var(${FAMILY_STYLE[family.id].color})`;
    amount.textContent = available ? formatPower(value) : "—";
    amount.setAttribute("aria-label", available ? formatPower(value) : "Not available");
    if (available) {
      amount.removeAttribute("data-blx-coverage-trigger");
      amount.removeAttribute("role");
      amount.removeAttribute("tabindex");
    } else {
      amount.dataset.blxCoverageTrigger = "";
      amount.setAttribute("role", "button");
      amount.setAttribute("tabindex", "0");
      amount.setAttribute("aria-haspopup", "dialog");
    }
    item.dataset.blxAvailability = available ? "known" : "unavailable";
    bar.style.setProperty("--blx-family-width", `${available ? 100 * value / maximum : 0}%`);
    bar.style.setProperty("--blx-family-color", `var(${FAMILY_STYLE[family.id].color})`);
    body.replaceChildren();
    const intuition = document.createElement("p");
    intuition.className = "blx-v2-family-intuition";
    intuition.textContent = FAMILY_INTUITION[family.id] || "";
    body.append(intuition);
    family.terms.forEach((key) => {
      const metadata = point.equationProvenance[key];
      const row = document.createElement("div");
      row.className = "blx-v2-atomic-row";
      const heading = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = metadata.label;
      const termValue = document.createElement("span");
      termValue.textContent = finite(point.losses[key]) ? formatPower(point.losses[key]) : "Not available";
      heading.append(label, termValue);
      const formula = document.createElement("code");
      formula.textContent = metadata.formula;
      const citation = document.createElement("p");
      citation.textContent = `${sourceCopy(metadata.source)}. ${metadata.source.note}`;
      const provenance = document.createElement("p");
      provenance.className = "blx-v2-term-provenance";
      let chips = (TERM_PARAMETERS[key] || [])
        .filter((parameter) => state.provenance[parameter])
        .map((parameter) => `${BUCK_LOSS_SCHEMA_V2[parameter]?.label || parameter}: ${provenanceLabel(state, parameter, state.provenance[parameter])}`);
      if (key === "inductorCoreResidual" && point.inductorAcIncluded) {
        chips = [
          `${state.selectedPart || "Catalog part"} characterization: sourced (${point.inductorAcEstimate.status})`,
          ...chips.filter((chip) => !chip.endsWith(": missing"))
        ];
      }
      provenance.textContent = chips.length ? chips.join(" · ") : "Waveform-derived";
      row.append(heading, formula, citation, provenance);
      body.append(row);
    });
    holder.append(item);
  });
  if (focusedFamily && focusedSummary) {
    holder.querySelector(`[data-blx-family="${focusedFamily}"] summary`)?.focus({ preventScroll: true });
  }
  animateFlip([...holder.children], beforeRects, { duration: 220, easing: "cubic-bezier(.22,1,.36,1)" });
}

function renderPowerBalance(root, point) {
  const holder = root.querySelector("[data-blx-power-balance]");
  if (holder) {
    const total = Math.max(point.pInEstimated || 0, 1e-12);
    const outputWidth = 100 * (point.pOut || 0) / total;
    holder.innerHTML = `<div class="blx-v2-power-track" role="img" aria-label="${displayNumber(outputWidth, 1)} percent output and ${displayNumber(100 - outputWidth, 1)} percent loss"><span style="width:${outputWidth}%"></span><i style="width:${100 - outputWidth}%"></i></div><div class="blx-v2-power-legend"><span>Output ${formatPower(point.pOut)}</span><span>${point.availability === "total" ? "Loss" : "Known loss"} ${formatPower(point.pLoss)}</span></div>`;
  }
  const metrics = root.querySelector("[data-blx-operating-metrics]");
  if (!metrics) return;
  const omittedTerms = omittedAtomicTermCount(point);
  const entries = [
    ["High-side duty", formatPercent(point.waveform.duties.highSide)],
    ["Low-side duty", formatPercent(point.waveform.duties.lowSide)],
    ["Zero-current window", formatPercent(point.waveform.duties.zeroCurrent)],
    ["Peak / valley", `${formatCurrent(point.waveform.iPeak)} / ${formatCurrent(point.waveform.iValley)}`],
    ["EON / EOFF", `${formatEnergy(point.transition?.turnOnEnergyJ)} / ${formatEnergy(point.transition?.turnOffEnergyJ)}`],
    ["ION / IOFF", `${formatCurrent(point.transition?.turnOnCurrentA)} / ${formatCurrent(point.transition?.turnOffCurrentA)}`],
    ["Inductor RMS", formatCurrent(Math.sqrt(point.waveform.moments.iLrms2))],
    ["Coverage", point.availability === "total" ? "All terms modeled" : `${omittedTerms} term${omittedTerms === 1 ? "" : "s"} omitted`]
  ];
  metrics.innerHTML = entries.map(([label, value]) => label === "Coverage"
    ? `<div class="blx-operating-metric"><span>${escapeHtml(label)}</span><button type="button" class="blx-term-trigger blx-coverage-metric" data-blx-coverage-trigger>${escapeHtml(value)}</button></div>`
    : `<div class="blx-operating-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

const TRANSITION_METHOD_LABELS = Object.freeze({
  "measured-energy-surface": "Measured EON/EOFF table",
  "vendor-spice-energy-surface": "Vendor-SPICE EON/EOFF table",
  "derived-gate-charge": "Gate-charge derivation",
  "effective-fallback": "Effective-time fallback",
  "effective-override": "Effective-time override"
});

function renderModelConfidence(root, point) {
  const uncertainty = point.uncertainty;
  const metrics = root.querySelector("[data-blx-confidence-metrics]");
  const status = root.querySelector("[data-blx-confidence-status]");
  const copy = root.querySelector("[data-blx-confidence-copy]");
  if (!uncertainty || !metrics) return;
  const transitionLabel = TRANSITION_METHOD_LABELS[point.transition?.method] || "Transition loss unavailable";
  const efficiencyRange = finite(uncertainty.efficiency?.low) && finite(uncertainty.efficiency?.high)
    ? `${formatPercent(uncertainty.efficiency.low)}–${formatPercent(uncertainty.efficiency.high)}`
    : "—";
  const lossRange = finite(uncertainty.lossW?.low) && finite(uncertainty.lossW?.high)
    ? `${formatPower(uncertainty.lossW.low)}–${formatPower(uncertainty.lossW.high)}`
    : "—";
  const commutation = point.commutation?.edges;
  const commutationLabel = commutation
    ? `LS ${commutation.highToLow.classification} · HS ${commutation.lowToHigh.classification}`
    : "Unavailable";
  const entries = [
    [point.availability === "total" ? "Efficiency bound" : "Known-loss ceiling bound", efficiencyRange],
    [point.availability === "total" ? "Loss bound" : "Known-loss bound", lossRange],
    ["Transition evidence", `${transitionLabel} · ${point.transition?.confidence || "unavailable"}`],
    ["Commutation diagnostic", commutationLabel]
  ];
  metrics.innerHTML = entries.map(([label, value]) => `<div class="blx-operating-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  if (status) status.textContent = `${uncertainty.confidence} confidence`;
  const dominant = uncertainty.dominantSensitivity;
  if (copy) {
    const dominantLabel = dominant ? FAMILY_STYLE[dominant.family]?.short || dominant.family : "No nonzero family";
    copy.textContent = `${dominantLabel} is the largest modeled sensitivity (${dominant ? formatPower(dominant.spanW) : "—"} low-to-high span). These are engineering bounds, not a statistical confidence interval${point.availability === "subtotal" ? "; omitted mechanisms sit outside the range" : ""}.`;
  }
}

function renderWarningsAndInsight(root, state, point) {
  const holder = root.querySelector("[data-blx-warnings]");
  const messages = [];
  if (point.waveform.mode === "dcm") messages.push({ copy: "Fixed-frequency diode-emulation DCM: low-side conduction stops at zero current." });
  if (point.waveform.mode === "zero-load-unmodeled") messages.push({ copy: "Efficiency is undefined at zero load; PFM, burst, and minimum-on-time behavior depend on the controller." });
  if (point.warnings.includes("isat")) messages.push({ copy: "Peak current exceeds the selected inductor saturation rating.", strong: true });
  if (state.template.voltageClass < state.rawInputs.vin) messages.push({ copy: `${state.template.label} is below the entered VIN voltage class; choose an appropriate device before design work.`, strong: true });
  if (point.warnings.includes("negative-current-commutation-approximate")) messages.push({ copy: "Approximate commutation: forced CCM has negative valley current. ZVS, signed dead-time paths, QRR, turn-on overlap, and EOSS are only first-order estimates in this reverse-current region.", strong: true });
  else if (state.controlMode === "forced-ccm") messages.push({ copy: "Forced CCM is an expert comparison; watch the valley-current sign at light load." });
  if (state.selectedPart && state.dcrMode === "max") messages.push({ copy: "Maximum DCR changes copper loss only; the catalog AC/core residual remains tied to its typical characterization." });
  if (point.warnings.includes("switching-energy-surface-fallback")) messages.push({ copy: "The supplied switching-energy surface was outside its declared domain or conditions; the automatic hierarchy used the next supported method.", strong: true });
  if (point.transition?.method === "effective-fallback") {
    const conditionedTiming = ["effectiveTurnOn", "effectiveTurnOff"]
      .every((key) => state.rawInputs.__provenance?.[key] === "calculated-condition-effective-time");
    messages.push({
      copy: conditionedTiming
        ? "Transitions use the template's illustrative effective-time anchor, scaled per edge from QGS2, QGD(VIN), the live plateau, threshold, and drive using EPC AN030 phase-charge ratios; no condition-matched EON/EOFF surface is loaded."
        : "Transitions use a manually overridden effective-time fallback; no condition-matched EON/EOFF surface is loaded.",
      strong: true
    });
  }
  (state.conditioning?.warnings || []).forEach((warning) => messages.push({ copy: warning.message, strong: true }));
  if (state.conditioning?.diagnostics?.preservedKeys?.length) {
    messages.push({ copy: "Manual switch-parameter overrides are held fixed; use “Use calculated” beside a field to resume condition tracking." });
  }
  if (state.urlNotes.length) messages.push({ copy: "Some URL values were unknown or adjusted to the valid schema." });
  if (holder) holder.innerHTML = messages.map(({ copy, strong }) => `<p class="blx-note${strong ? " blx-note-strong" : ""}">${escapeHtml(copy)}</p>`).join("");
  const advisory = point.insights.fetAreaOptimumScale;
  const insight = finite(advisory)
    ? advisory > 1.08
      ? `Conduction dominates at this point: the RDS(on)·QG balance favors roughly ${displayNumber(advisory, 1)}× more switch area. Larger switches would trade extra gate-drive loss for lower channel loss. (Advisory excludes EOSS and QRR.)`
      : advisory < 0.92
        ? `Gate drive dominates at this point: the RDS(on)·QG balance favors roughly ${displayNumber(1 / advisory, 1)}× smaller switches. A lower-QG pair would trade a little conduction loss for much less drive loss. (Advisory excludes EOSS and QRR.)`
        : "Channel conduction and gate-drive loss are close to the textbook FET-area balance at this point."
    : "FET-area balance is unavailable until both channel and gate-drive loss are present.";
  setText(root, "[data-blx-insight]", insight);
}

function chartFrame(holder, yMaximum, yTicks, yFormatter) {
  const width = Math.max(360, Math.round(holder.getBoundingClientRect().width || 720));
  const height = 310;
  const margin = { left: 62, right: 20, top: 20, bottom: 48 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
  svg.classList.add("blx-v2-chart-svg");
  yTicks.forEach((tick) => {
    const fraction = yMaximum > 0 ? tick / yMaximum : 0;
    const y = margin.top + innerHeight * (1 - fraction);
    svg.append(svgNode("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "blx-chart-grid" }));
    const label = svgNode("text", { x: margin.left - 8, y: y + 4, "text-anchor": "end", class: "blx-chart-axis-label" });
    label.textContent = yFormatter(tick);
    svg.append(label);
  });
  for (let index = 0; index <= 4; index += 1) {
    const fraction = index / 4;
    const x = margin.left + innerWidth * fraction;
    const label = svgNode("text", { x, y: height - 22, "text-anchor": "middle", class: "blx-chart-axis-label" });
    label.textContent = index === 4 ? "IMAX" : `${index * 25}%`;
    svg.append(label);
  }
  const xLabel = svgNode("text", { x: margin.left + innerWidth / 2, y: height - 5, "text-anchor": "middle", class: "blx-chart-axis-title" });
  xLabel.textContent = "Load current";
  svg.append(xLabel);
  holder.blxChartScale = { left: margin.left / width, width: innerWidth / width };
  return { svg, width, height, margin, innerWidth, innerHeight };
}

function niceLossScale(value) {
  const maximum = Math.max(value, 1e-9);
  const rawStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = multiplier * magnitude;
  const niceMaximum = Math.max(step, Math.ceil(maximum / step) * step);
  const ticks = [];
  for (let tick = 0; tick <= niceMaximum + step * 0.25; tick += step) ticks.push(tick);
  return { maximum: niceMaximum, ticks };
}

function pathData(points) {
  return points.length ? `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")}` : "";
}

function animateChartPath(state, key, path, points) {
  const previous = state.chartPoints.get(key);
  state.chartPoints.set(key, points);
  state.chartAnimations.get(key)?.cancel?.();
  const animation = animatePointSeries({
    fromPoints: previous,
    toPoints: points,
    duration: 260,
    draw: (next) => path.setAttribute("d", pathData(next))
  });
  if (animation) state.chartAnimations.set(key, animation);
}

function addVerticalAnnotation(frame, fraction, label, className) {
  if (!finite(fraction) || fraction < 0 || fraction > 1) return;
  const x = frame.margin.left + frame.innerWidth * fraction;
  const alignRight = fraction > 0.78;
  frame.svg.append(svgNode("line", { x1: x, y1: frame.margin.top, x2: x, y2: frame.height - frame.margin.bottom, class: className }));
  const text = svgNode("text", {
    x: x + (alignRight ? -4 : 4),
    y: frame.margin.top + 11,
    "text-anchor": alignRight ? "end" : "start",
    class: "blx-chart-annotation-label"
  });
  text.textContent = label;
  frame.svg.append(text);
}

function setSvgAttributes(node, attributes) {
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
}

function cursorOverlay(frame) {
  const line = svgNode("line", { class: "blx-chart-cursor", "data-blx-chart-cursor-line": "" });
  const label = svgNode("text", { class: "blx-chart-cursor-label", "data-blx-chart-cursor-label": "" });
  frame.svg.append(line, label);
  return { line, label };
}

function renderEfficiencyChart(root, state) {
  const holder = root.querySelector("[data-blx-efficiency-plot]");
  if (!holder || !state.sweep?.points?.length) return;
  const valid = state.sweep.points.filter((point) => finite(point.efficiency));
  const frame = chartFrame(holder, 1, [0, 0.25, 0.5, 0.75, 1], (value) => `${Math.round(value * 100)}%`);
  const x = (value) => frame.margin.left + frame.innerWidth * value / state.inputs.ioutMax;
  const y = (value) => frame.margin.top + frame.innerHeight * (1 - clamp(value, 0, 1));
  const currentLine = svgNode("path", { class: "blx-chart-line blx-chart-efficiency" });
  frame.svg.append(currentLine);
  const currentPoints = valid.map((point) => [x(point.iout), y(point.efficiency)]);
  animateChartPath(state, "efficiency", currentLine, currentPoints);

  if (state.reference?.sweep) {
    const referencePoints = state.reference.sweep.points
      .filter((point) => finite(point.efficiency) && point.iout <= state.inputs.ioutMax)
      .map((point) => [x(point.iout), y(point.efficiency)]);
    const referenceLine = svgNode("path", { d: pathData(referencePoints), class: `blx-chart-line blx-chart-reference-line${state.referenceReveal ? " blx-reference-reveal" : ""}` });
    frame.svg.append(referenceLine);
  }

  const annotations = state.sweep.annotations;
  addVerticalAnnotation(frame, annotations.ccmBoundary / state.inputs.ioutMax, "CCM / DCM", "blx-chart-boundary");
  if (annotations.peakEfficiency) {
    const peakX = x(annotations.peakEfficiency.iout);
    const peakY = y(annotations.peakEfficiency.efficiency);
    const alignRight = peakX > frame.margin.left + frame.innerWidth * 0.72;
    const peak = svgNode("circle", { cx: peakX, cy: peakY, r: 4.5, class: "blx-chart-peak" });
    frame.svg.append(peak);
    const label = svgNode("text", {
      x: peakX + (alignRight ? -7 : 7),
      y: peakY - 7,
      "text-anchor": alignRight ? "end" : "start",
      class: "blx-chart-annotation-label"
    });
    label.textContent = `Peak ${formatPercent(annotations.peakEfficiency.efficiency)}`;
    frame.svg.append(label);
  }
  const overlay = cursorOverlay(frame);
  const marker = svgNode("circle", { r: 5, class: "blx-chart-marker blx-chart-efficiency-marker", "data-blx-chart-marker": "efficiency" });
  frame.svg.append(marker);
  holder.replaceChildren(frame.svg);
  holder.tabIndex = 0;
  holder.setAttribute("role", "slider");
  holder.setAttribute("aria-valuemin", "0");
  holder.setAttribute("aria-valuemax", String(state.inputs.ioutMax));
  holder.blxChartUpdate = (point, current) => {
    const safeCurrent = quantizeCurrent(current, state.inputs.ioutMax);
    const fraction = state.inputs.ioutMax > 0 ? safeCurrent / state.inputs.ioutMax : 0;
    const markerX = x(safeCurrent);
    const markerY = finite(point.efficiency) ? y(point.efficiency) : frame.margin.top;
    const alignRight = fraction > 0.68;
    setSvgAttributes(overlay.line, { x1: markerX, y1: frame.margin.top, x2: markerX, y2: frame.height - frame.margin.bottom });
    setSvgAttributes(marker, { cx: markerX, cy: markerY });
    marker.style.visibility = finite(point.efficiency) ? "visible" : "hidden";
    setSvgAttributes(overlay.label, {
      x: markerX + (alignRight ? -9 : 9),
      y: finite(point.efficiency) ? Math.max(frame.margin.top + 13, markerY - 10) : frame.margin.top + 13,
      "text-anchor": alignRight ? "end" : "start"
    });
    overlay.label.textContent = `${formatCurrent(safeCurrent)} · ${formatPercent(point.efficiency)}`;
    holder.setAttribute("aria-valuenow", String(safeCurrent));
    holder.setAttribute("aria-valuetext", `${formatCurrent(safeCurrent)}; ${formatPercent(point.efficiency)}`);
    setText(root, "[data-blx-across-efficiency]", `${formatPercent(point.efficiency)} at ${formatCurrent(safeCurrent)}`);
  };
  holder.blxChartUpdate(state.point, displayedCursor(state));
}

function rankedFamilyKeys(point) {
  return BUCK_LOSS_FAMILIES_V2
    .map((family) => ({ key: family.id, value: point.groupedLosses[family.id] ?? 0 }))
    .sort((left, right) => right.value - left.value)
    .map((item) => item.key);
}

function resolveSeriesSlots(state) {
  const ranking = rankedFamilyKeys(state.point);
  if (!state.seriesSlots.length) {
    state.seriesSlots = ranking.slice(0, 3).map((key) => ({ key, pinned: false }));
  }
  const pinned = new Set(state.seriesSlots.filter((slot) => slot.pinned).map((slot) => slot.key));
  const used = new Set(pinned);
  state.seriesSlots.forEach((slot) => {
    if (slot.pinned) return;
    const next = ranking.find((key) => !used.has(key));
    if (next) slot.key = next;
    used.add(slot.key);
  });
}

function renderSeriesControls(root, state) {
  const holder = root.querySelector("[data-blx-series-controls]");
  if (!holder) return;
  holder.replaceChildren();
  state.seriesSlots.forEach((slot, index) => {
    const row = document.createElement("div");
    row.className = "blx-v2-series-slot";
    const swatch = document.createElement("i");
    swatch.style.background = `var(${FAMILY_STYLE[slot.key].color})`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Loss series ${index + 1}`);
    BUCK_LOSS_FAMILIES_V2.forEach((family) => {
      const option = document.createElement("option");
      option.value = family.id;
      option.textContent = family.label;
      option.selected = family.id === slot.key;
      select.append(option);
    });
    select.addEventListener("change", () => {
      slot.key = select.value;
      slot.pinned = true;
      renderLossChart(root, state);
    });
    const pin = document.createElement("button");
    pin.type = "button";
    pin.setAttribute("aria-pressed", slot.pinned ? "true" : "false");
    pin.textContent = slot.pinned ? "Pinned" : "Series · Auto";
    pin.addEventListener("click", () => {
      slot.pinned = !slot.pinned;
      renderLossChart(root, state);
    });
    row.append(swatch, select, pin);
    holder.append(row);
  });
}

function renderLossChart(root, state) {
  const holder = root.querySelector("[data-blx-loss-plot]");
  if (!holder || !state.sweep?.points?.length) return;
  resolveSeriesSlots(state);
  const validPoints = state.sweep.points.filter((point) => point.valid);
  const values = validPoints.flatMap((point) => state.seriesSlots.map((slot) => point.groupedLosses[slot.key] || 0));
  if (state.reference?.sweep) {
    values.push(...state.reference.sweep.points
      .filter((point) => point.iout <= state.inputs.ioutMax)
      .flatMap((point) => state.seriesSlots.map((slot) => point.groupedLosses[slot.key] || 0)));
  }
  const scale = niceLossScale(Math.max(...values, 1e-6) * 1.08);
  const maximum = scale.maximum;
  const frame = chartFrame(holder, maximum, scale.ticks, (value) => value < 1 ? `${displayNumber(value * 1e3, 0)}mW` : `${displayNumber(value, 2)}W`);
  const x = (value) => frame.margin.left + frame.innerWidth * value / state.inputs.ioutMax;
  const y = (value) => frame.margin.top + frame.innerHeight * (1 - clamp(value / maximum, 0, 1));
  const markers = [];
  state.seriesSlots.forEach((slot, index) => {
    const path = svgNode("path", { class: "blx-chart-line blx-chart-family-line", stroke: `var(${FAMILY_STYLE[slot.key].color})`, "data-series": slot.key });
    frame.svg.append(path);
    const points = validPoints.map((point) => [x(point.iout), y(point.groupedLosses[slot.key] || 0)]);
    animateChartPath(state, `loss-${index}-${slot.key}`, path, points);
    if (state.reference?.sweep) {
      const referencePoints = state.reference.sweep.points
        .filter((point) => point.iout <= state.inputs.ioutMax)
        .map((point) => [x(point.iout), y(point.groupedLosses[slot.key] || 0)]);
      const referencePath = svgNode("path", {
        d: pathData(referencePoints),
        class: `blx-chart-line blx-chart-reference-line${state.referenceReveal ? " blx-reference-reveal" : ""}`,
        "data-reference-series": slot.key
      });
      referencePath.style.stroke = `var(${FAMILY_STYLE[slot.key].color})`;
      frame.svg.append(referencePath);
    }
    const marker = svgNode("circle", {
      r: 4.5,
      class: "blx-chart-marker blx-chart-family-marker",
      fill: `var(${FAMILY_STYLE[slot.key].color})`,
      "data-blx-chart-marker": slot.key
    });
    frame.svg.append(marker);
    markers.push({ marker, key: slot.key });
  });
  addVerticalAnnotation(frame, state.sweep.annotations.ccmBoundary / state.inputs.ioutMax, "Boundary", "blx-chart-boundary");
  const overlay = cursorOverlay(frame);
  holder.replaceChildren(frame.svg);
  holder.tabIndex = 0;
  holder.setAttribute("role", "slider");
  holder.setAttribute("aria-valuemin", "0");
  holder.setAttribute("aria-valuemax", String(state.inputs.ioutMax));
  holder.blxChartUpdate = (point, current) => {
    const safeCurrent = quantizeCurrent(current, state.inputs.ioutMax);
    const fraction = state.inputs.ioutMax > 0 ? safeCurrent / state.inputs.ioutMax : 0;
    const markerX = x(safeCurrent);
    const alignRight = fraction > 0.68;
    setSvgAttributes(overlay.line, { x1: markerX, y1: frame.margin.top, x2: markerX, y2: frame.height - frame.margin.bottom });
    setSvgAttributes(overlay.label, {
      x: markerX + (alignRight ? -9 : 9),
      y: frame.margin.top + 13,
      "text-anchor": alignRight ? "end" : "start"
    });
    overlay.label.textContent = `${formatCurrent(safeCurrent)} · ${formatPower(point.pLoss)}`;
    markers.forEach(({ marker: pointMarker, key }) => {
      const value = point.groupedLosses?.[key];
      setSvgAttributes(pointMarker, { cx: markerX, cy: y(value || 0) });
      pointMarker.style.visibility = finite(value) ? "visible" : "hidden";
    });
    holder.setAttribute("aria-valuenow", String(safeCurrent));
    holder.setAttribute("aria-valuetext", `${formatCurrent(safeCurrent)}; ${formatPower(point.pLoss)} known loss`);
    setText(root, "[data-blx-across-loss]", `${formatPower(point.pLoss)} at ${formatCurrent(safeCurrent)}`);
  };
  holder.blxChartUpdate(state.point, displayedCursor(state));
  renderSeriesControls(root, state);
}

function renderLossCharacter(root, state) {
  const holder = root.querySelector("[data-blx-loss-character]");
  const insight = root.querySelector("[data-blx-causal-insight]");
  if (!holder || !state.sweep?.annotations) return;
  const regions = state.sweep.annotations.dominanceRegions || [];
  holder.replaceChildren(...regions.map((region) => {
    const segment = document.createElement("span");
    const presentation = SCALING_PRESENTATION[region.kind] || SCALING_PRESENTATION.unclassified;
    const width = state.inputs.ioutMax > 0 ? 100 * (region.endIout - region.startIout) / state.inputs.ioutMax : 0;
    segment.style.width = `${Math.max(0, width)}%`;
    segment.style.background = presentation.color;
    segment.dataset.kind = region.kind;
    segment.title = `${presentation.label}: ${formatCurrent(region.startIout)}–${formatCurrent(region.endIout)} · ${formatPercent(region.averageShare)} average share`;
    if (width > 17) segment.textContent = presentation.label;
    return segment;
  }));
  const scaling = state.point.insights?.lossScaling || {};
  const total = Object.values(scaling).reduce((sum, value) => sum + (finite(value) ? Math.max(0, value) : 0), 0);
  const kind = Object.keys(SCALING_PRESENTATION).reduce(
    (best, key) => (scaling[key] || 0) > (scaling[best] || 0) ? key : best,
    "fixedLike"
  );
  const share = total > 0 ? (scaling[kind] || 0) / total : null;
  if (insight) {
    const label = SCALING_PRESENTATION[kind]?.label || "unclassified";
    insight.textContent = finite(share)
      ? `At ${formatCurrent(displayedCursor(state))}, ${label} terms lead at ${formatPercent(share)} of known loss. The band shows where that balance changes across load.`
      : "Loss character becomes available when at least one analytical term is known.";
  }
}

function makeReference(state) {
  return {
    modelVersion: 2,
    modelRevision: BUCK_LOSS_MODEL_REVISION,
    deviceId: state.deviceId,
    technology: state.template.technology,
    controlMode: state.controlMode,
    timingMode: state.timingMode,
    cursor: displayedCursor(state),
    point: state.point,
    sweep: state.sweep,
    label: state.template.label,
    mode: state.point.waveform.mode,
    corner: state.template.cornerLabel || state.template.cornerId,
    availability: state.point.availability
  };
}

function renderReference(root, state) {
  root.querySelectorAll("[data-blx-reference]").forEach((button) => {
    button.dataset.active = state.reference ? "true" : "false";
    const span = button.querySelector("span");
    if (span) span.textContent = state.reference ? "Clear reference" : "Hold reference";
  });
  const card = root.querySelector("[data-blx-reference-card]");
  const key = root.querySelector("[data-blx-reference-key]");
  if (!card) return;
  if (!state.reference) {
    card.hidden = true;
    card.replaceChildren();
    if (key) {
      key.hidden = true;
      key.textContent = "";
    }
    return;
  }
  const reference = state.reference;
  const comparableEfficiency = state.point.availability === "total" && reference.point.availability === "total";
  const efficiencyDelta = comparableEfficiency && finite(state.point.efficiency) && finite(reference.point.efficiency)
    ? state.point.efficiency - reference.point.efficiency
    : null;
  const lossDelta = state.point.pLoss - reference.point.pLoss;
  card.hidden = false;
  const deltaCopy = finite(efficiencyDelta)
    ? `${efficiencyDelta >= 0 ? "+" : ""}${displayNumber(efficiencyDelta * 100, 2)} percentage points · known loss ${lossDelta >= 0 ? "+" : "−"}${formatPower(Math.abs(lossDelta))} vs. reference.`
    : `Known loss ${lossDelta >= 0 ? "+" : "−"}${formatPower(Math.abs(lossDelta))} vs. reference. Efficiency deltas stay hidden while either run has omitted terms — subtotals cannot be subtracted honestly.`;
  card.innerHTML = `<div class="blx-section-heading"><h2>Held reference</h2><span class="blx-section-total">${escapeHtml(reference.label)}</span></div><div class="blx-v2-reference-sides"><div><span>Reference</span><strong>${formatPercent(reference.point.efficiency)} · ${formatPower(reference.point.pLoss)}</strong><small>${reference.technology === "gan" ? "GaN" : "Silicon"} · ${compactMode(reference.mode)} · ${reference.corner} · ${reference.point.availability}</small></div><div><span>Current</span><strong>${formatPercent(state.point.efficiency)} · ${formatPower(state.point.pLoss)}</strong><small>${state.template.technology === "gan" ? "GaN" : "Silicon"} · ${compactMode(state.point.waveform.mode)} · ${state.template.cornerLabel || state.template.cornerId} · ${state.point.availability}</small></div></div><p>${deltaCopy}</p>`;
  if (key) {
    key.hidden = false;
    key.textContent = `Solid: ${state.template.label} · ${state.controlMode} · ${state.template.cornerLabel || state.template.cornerId} · ${state.point.availability}. Dashed: ${reference.label} · ${reference.controlMode} · ${reference.corner} · ${reference.point.availability}.`;
  }
}

function setResultAvailability(root, available) {
  root.querySelectorAll("[data-blx-valid-only]").forEach((node) => { node.hidden = !available; });
  root.querySelectorAll("[data-blx-reference]").forEach((button) => { button.disabled = !available; });
  const loadTab = root.querySelector('[data-blx-view="load"]');
  if (loadTab) loadTab.disabled = !available;
}

function clearResultContent(root, state = null) {
  setText(root, '[data-blx-out="efficiency"]', "—");
  setText(root, '[data-blx-out="pout"]', "—");
  setText(root, '[data-blx-out="loss"]', "—");
  setText(root, '[data-blx-out="pin"]', "—");
  setText(root, '[data-blx-out="loss-total"]', "Unavailable");
  setText(root, "[data-blx-loss-label]", "loss");
  setText(root, "[data-blx-input-label]", "input");
  setText(root, "[data-blx-efficiency-label]", "efficiency");
  setText(root, "[data-blx-availability-label]", "No result");
  setCoverageTriggerState(root, false);
  setText(root, '[data-blx-out="sheet-efficiency"]', "—");
  setText(root, '[data-blx-out="sheet-loss"]', "—");
  root.querySelector("[data-blx-result-badges]")?.replaceChildren();
  const warnings = root.querySelector("[data-blx-warnings]");
  if (warnings) warnings.replaceChildren();
  root.querySelector("[data-blx-family-list]")?.replaceChildren();
  root.querySelector("[data-blx-waveform-diagram]")?.blxWaveformController?.clear();
  if (state) {
    state.waveformAnimation?.cancel?.();
    state.waveformView = { mode: "full", startPhase: null, endPhase: null, probePhase: 0.32 };
    state.waveformGhostPhase = null;
    state.waveformPointer = null;
    state.waveformOverviewPointer = null;
    state.waveformAnimation = null;
  }
  root.querySelector("[data-blx-power-balance]")?.replaceChildren();
  root.querySelector("[data-blx-operating-metrics]")?.replaceChildren();
  root.querySelector("[data-blx-confidence-metrics]")?.replaceChildren();
  setText(root, "[data-blx-confidence-status]", "—");
  setText(root, "[data-blx-confidence-copy]", "");
  root.querySelector("[data-blx-efficiency-plot]")?.replaceChildren();
  root.querySelector("[data-blx-loss-plot]")?.replaceChildren();
  root.querySelector("[data-blx-series-controls]")?.replaceChildren();
  root.querySelector("[data-blx-loss-character]")?.replaceChildren();
  setText(root, "[data-blx-causal-insight]", "");
  const card = root.querySelector("[data-blx-reference-card]");
  if (card) {
    card.hidden = true;
    card.replaceChildren();
  }
  const referenceKey = root.querySelector("[data-blx-reference-key]");
  if (referenceKey) {
    referenceKey.hidden = true;
    referenceKey.textContent = "";
  }
}

function renderInvalid(root, state) {
  clearResultContent(root, state);
  setResultAvailability(root, false);
  root.querySelectorAll("[data-blx-view]").forEach((tab) => {
    const active = tab.dataset.blxView === "point";
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll("[data-blx-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.blxViewPanel !== "point"; });
  state.view = "point";
  const failure = root.querySelector("[data-blx-model-failure]");
  if (failure) failure.hidden = false;
  setText(root, '[data-blx-out="regime"]', "Invalid inputs");
  const voutInvalid = state.validation.errors.includes("vout-lt-vin");
  const conditionErrors = state.conditioning?.errors || [];
  const conditionInvalid = conditionErrors.length > 0;
  setText(root, "[data-blx-failure-title]", voutInvalid
    ? "No result — the output must stay below the input."
    : conditionInvalid ? "No result — the gate-drive condition is unsupported."
      : "No result — check the highlighted inputs.");
  setText(root, "[data-blx-failure-explanation]", voutInvalid
    ? `VOUT is ${displayNumber(state.rawInputs.vout, 3)} V but VIN is ${displayNumber(state.rawInputs.vin, 3)} V; a buck converter can only step down.`
    : conditionInvalid ? conditionErrors.map((error) => error.message).join(" ")
      : "One or more inputs sit outside the model's declared range.");
  setText(root, "[data-blx-failure-recovery]", voutInvalid
    ? "Fix the output voltage or reset the operating point."
    : conditionInvalid ? "Choose a gate voltage inside the selected device model's characterized domain, or change the device."
      : "Correct the highlighted values or reset the operating point.");
  setText(root, "[data-blx-failure-equation]", voutInvalid
    ? "VOUT < VIN is required for buck regulation"
    : conditionInvalid ? "VDRIVE > VPLATEAU and inside the condition-model domain"
      : "No valid operating point");
  root.querySelector("[data-blx-fix-output]")?.toggleAttribute("hidden", !voutInvalid);
  root.querySelector("[data-blx-reset-invalid]")?.removeAttribute("hidden");
  root.dataset.blxMode = "invalid";
  state.point = null;
  state.sweep = null;
}

function failurePresentation(point) {
  const failure = point.failure || { code: point.errors?.[0] || "infeasible", values: {} };
  const values = failure.values || {};
  const copies = {
    dropout: {
      title: "Not enough input headroom to regulate",
      explanation: "The requested output plus channel and inductor drop leaves no positive high-side inductor voltage.",
      recovery: "Raise VIN, lower VOUT or load current, or reduce the high-side and inductor resistance.",
      equation: `VIN − VOUT − IO(RDS,HS + RDC) = ${finite(values.highVoltage) ? displayNumber(values.highVoltage, 4) : "—"} V`
    },
    "dead-time-infeasible": {
      title: "Dead time consumes the switching period",
      explanation: "The two dead-time windows leave no usable pair of high-side and low-side intervals.",
      recovery: "Reduce dead time or switching frequency.",
      equation: `(tDEAD,HS→LS + tDEAD,LS→HS) / TSW = ${finite(values.deadFractionTotal) ? displayNumber(values.deadFractionTotal, 4) : finite(values.deadFraction) ? displayNumber(2 * values.deadFraction, 4) : "—"}`
    },
    "low-side-window-negative": {
      title: "The required duty leaves a negative low-side window",
      explanation: "Regulated volt-second balance needs more high-side time than the switching period can provide after dead time.",
      recovery: "Raise VIN, lower VOUT, reduce dead time, or reduce conduction drop.",
      equation: `DLS = ${finite(values.lowFraction) ? displayNumber(values.lowFraction, 5) : "—"}`
    },
    "duty-infeasible": {
      title: "The required duty is infeasible",
      explanation: "No positive high-side and low-side timing solution satisfies regulated volt-second balance.",
      recovery: "Adjust VIN, VOUT, switching frequency, dead time, or conduction resistance.",
      equation: `DHS,required = ${finite(values.requiredHighFraction) ? displayNumber(values.requiredHighFraction, 5) : "—"}`
    },
    "volt-second-solve": {
      title: "Volt-second balance did not converge",
      explanation: "The interval solver left a nonzero cycle-to-cycle current change.",
      recovery: "Review the operating point and timing assumptions; report the state if this persists.",
      equation: `ΔIL,cycle = ${finite(values.residualCurrent) ? formatCurrent(values.residualCurrent) : "—"}`
    },
    "dcm-load-solve": {
      title: "The DCM operating point did not converge",
      explanation: "The diode-emulation interval solver could not reproduce the requested average current.",
      recovery: "Move away from the boundary or report this canonical state for review.",
      equation: `IO,requested = ${finite(values.requestedCurrent) ? formatCurrent(values.requestedCurrent) : "—"}`
    },
    "dcm-load-above-boundary": {
      title: "The requested load is above the DCM boundary",
      explanation: "A zero-current interval cannot coexist with this load at the present operating point.",
      recovery: "Use automatic mode so the point enters CCM, or reduce the load current.",
      equation: `IO,BOUNDARY = ${finite(values.boundaryCurrent) ? formatCurrent(values.boundaryCurrent) : "—"}`
    }
  };
  return copies[failure.code] || {
    title: "This operating point is infeasible",
    explanation: `The analytical solver stopped safely (${failure.code}).`,
    recovery: "Adjust the highlighted operating assumptions or report this canonical state.",
    equation: "No valid regulated interval solution"
  };
}

function renderModelFailure(root, state, point) {
  clearResultContent(root, state);
  setResultAvailability(root, false);
  root.querySelectorAll("[data-blx-view]").forEach((tab) => {
    const active = tab.dataset.blxView === "point";
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll("[data-blx-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.blxViewPanel !== "point";
  });
  const tabList = root.querySelector(".blx-view-tabs");
  if (tabList) tabList.dataset.activeView = "point";
  state.view = "point";
  state.sweep = null;
  root.dataset.blxMode = "infeasible";
  setText(root, '[data-blx-out="regime"]', "Infeasible");
  const panel = root.querySelector("[data-blx-model-failure]");
  const copy = failurePresentation(point);
  if (panel) panel.hidden = false;
  root.querySelector("[data-blx-fix-output]")?.setAttribute("hidden", "");
  root.querySelector("[data-blx-reset-invalid]")?.setAttribute("hidden", "");
  setText(root, "[data-blx-failure-title]", copy.title);
  setText(root, "[data-blx-failure-explanation]", copy.explanation);
  setText(root, "[data-blx-failure-recovery]", copy.recovery);
  setText(root, "[data-blx-failure-equation]", copy.equation);
  renderBadges(root, point, state.template);
}

function renderImportDelta(root, state) {
  if (!state.importPayload || state.importRendered || !state.point || (state.selectedPart && !state.catalog)) return;
  state.importRendered = true;
  const banner = document.createElement("section");
  banner.className = "blx-import-delta";
  banner.dataset.blxImportDelta = "";
  const old = state.importPayload.result;
  const efficiencyDelta = finite(old?.efficiency) && finite(state.point.efficiency)
    ? state.point.efficiency - old.efficiency
    : null;
  const lossDelta = finite(old?.pLoss) ? state.point.pLoss - old.pLoss : null;
  banner.innerHTML = `<div><p class="blx-eyebrow">Updated shared calculation</p><h2>This point was recalculated</h2><p>The earlier result remains unchanged and read-only. Compatible inputs were carried over; ${escapeHtml(state.template.label)} supplies the additional device-physics fields.</p></div><div class="blx-import-delta-metrics"><span><small>Efficiency delta</small><strong>${finite(efficiencyDelta) ? `${efficiencyDelta >= 0 ? "+" : ""}${displayNumber(efficiencyDelta * 100, 2)} pp` : "—"}</strong></span><span><small>Loss delta</small><strong>${finite(lossDelta) ? `${lossDelta >= 0 ? "+" : "−"}${formatPower(Math.abs(lossDelta))}` : "—"}</strong></span></div>`;
  root.querySelector(".blx-workspace")?.before(banner);
  try { sessionStorage.removeItem(IMPORT_MEMORY_KEY); } catch {}
}

function render(root, state, options = {}) {
  if (state.disposed) return;
  applyConditioning(state);
  const normalized = normalizeBuckLossInputsV2(state.rawInputs);
  state.inputs = normalized.inputs;
  state.provenance = normalized.provenance;
  const schemaValidation = validateBuckLossInputsV2(state.inputs);
  const conditionFields = (state.conditioning?.errors || []).map(conditionErrorField);
  const validationErrors = [...new Set([...schemaValidation.errors, ...conditionFields])];
  state.validation = { valid: validationErrors.length === 0, errors: validationErrors };
  const maximumCurrent = Number(state.rawInputs.ioutMax) || 0;
  state.cursor = quantizeCurrent(state.cursor, maximumCurrent);
  if (finite(state.previewCursor)) state.previewCursor = clamp(state.previewCursor, 0, maximumCurrent);
  const cursor = displayedCursor(state);
  syncControls(root, state);
  renderValidation(root, state);
  renderDevice(root, state);
  setText(root, '[data-blx-out="current"]', formatCurrent(cursor));
  setText(root, '[data-blx-out="mobile-current"]', formatCurrent(cursor));
  setText(root, '[data-blx-out="current-caption"]', formatCurrent(cursor));
  const contextSummary = `${displayNumber(state.rawInputs.vin, 3)} V → ${displayNumber(state.rawInputs.vout, 3)} V · ${formatCurrent(cursor)} · ${displayNumber(state.rawInputs.fsw / 1000, 3)} MHz · ${state.template.partNumber || state.template.label}`;
  setText(root, "[data-blx-mobile-summary]", contextSummary);
  if (!state.validation.valid) {
    renderInvalid(root, state);
    renderMismatchLinks(root, state);
    if (options.updateUrl !== false) updateCanonicalUrl(root, state, options.immediateUrl);
    return;
  }

  state.point = evaluateStatePoint(state, cursor);
  const point = state.point;
  if (!point.valid) {
    renderModelFailure(root, state, point);
    renderMismatchLinks(root, state);
    if (options.updateUrl !== false) updateCanonicalUrl(root, state, options.immediateUrl);
    return;
  }
  setResultAvailability(root, true);
  const failurePanel = root.querySelector("[data-blx-model-failure]");
  if (failurePanel) failurePanel.hidden = true;
  const cacheKey = sweepCacheKey(state);
  if (!state.sweep || state.sweepCacheKey !== cacheKey) {
    state.sweep = evaluateBuckLossSweepV2(state.inputs, stateContext(state), { points: 180, iMin: 0, iMax: state.inputs.ioutMax });
    state.sweepCacheKey = cacheKey;
  }
  root.dataset.blxMode = point.waveform.mode;
  setText(root, '[data-blx-out="efficiency"]', formatPercent(point.efficiency));
  setText(root, '[data-blx-out="pout"]', formatPower(point.pOut));
  setText(root, '[data-blx-out="loss"]', formatPower(point.pLoss));
  setText(root, '[data-blx-out="pin"]', formatPower(point.pInEstimated));
  setText(root, '[data-blx-out="regime"]', compactMode(point.waveform.mode));
  setText(root, '[data-blx-out="loss-total"]', point.availability === "total" ? `Total · ${formatPower(point.pLoss)}` : `Subtotal · ${formatPower(point.pLoss)}`);
  setText(root, "[data-blx-loss-label]", point.availability === "total" ? "total loss" : "known loss");
  setText(root, "[data-blx-input-label]", point.availability === "total" ? "estimated input" : "input · floor");
  setText(root, "[data-blx-efficiency-label]", point.availability === "total" ? "efficiency" : "known-loss ceiling");
  setText(root, "[data-blx-availability-label]", point.availability === "total" ? "Total" : "Subtotal");
  setText(root, "[data-blx-efficiency-chart-label]", point.availability === "total" ? "Efficiency" : "Known-loss efficiency ceiling");
  setText(root, "[data-blx-power-copy]", point.availability === "total" ? "Output + analytical losses" : "Output + known analytical losses");
  setText(root, '[data-blx-out="sheet-efficiency"]', formatPercent(point.efficiency));
  setText(root, '[data-blx-out="sheet-loss"]', formatPower(point.pLoss));
  renderBadges(root, point, state.template);
  renderWaveformDiagram(root, state, point);
  renderFamilyList(root, state, point);
  renderPowerBalance(root, point);
  renderModelConfidence(root, point);
  const omittedTerms = omittedAtomicTermCount(point);
  const subtotalCopy = root.querySelector("[data-blx-subtotal-copy]");
  if (subtotalCopy) {
    subtotalCopy.hidden = point.availability !== "subtotal";
    subtotalCopy.innerHTML = point.availability === "subtotal"
      ? `Subtotal — ${omittedTerms} of ${totalAtomicTermCount()} loss terms lack data here and are never counted as zero. <button type="button" class="blx-term-trigger" data-blx-coverage-trigger>Why →</button>`
      : "";
  }
  setCoverageTriggerState(root, point.availability === "subtotal");
  renderWarningsAndInsight(root, state, point);
  renderReference(root, state);
  if (state.view === "load") {
    renderEfficiencyChart(root, state);
    renderLossChart(root, state);
    renderLossCharacter(root, state);
    state.referenceReveal = false;
  }
  renderImportDelta(root, state);
  renderMismatchLinks(root, state);
  if (options.updateUrl !== false) updateCanonicalUrl(root, state, options.immediateUrl);
}

function scheduleRender(root, state, options = {}) {
  if (state.disposed) return;
  state.pendingOptions = { ...state.pendingOptions, ...options };
  if (state.renderFrame) return;
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = 0;
    if (state.disposed) return;
    const next = state.pendingOptions || {};
    state.pendingOptions = null;
    render(root, state, next);
  });
}

function inputChanged(root, state, key, value, commit) {
  const config = BUCK_LOSS_SCHEMA_V2[key];
  const racWasLinked = key === "dcr"
    && (state.rawInputs.__provenance?.rac === "inferred-rac-equals-rdc"
      || state.provenance.rac === "inferred-rac-equals-rdc");
  state.rawInputs[key] = value === "" && config.optional ? null : Number(value);
  state.rawInputs.__provenance = { ...(state.rawInputs.__provenance || {}), [key]: value === "" ? "entered-blank" : "entered" };
  if (racWasLinked) {
    state.rawInputs.rac = state.rawInputs.dcr;
    state.rawInputs.__provenance.rac = "inferred-rac-equals-rdc";
  }
  state.custom = true;
  state.previewCursor = null;
  invalidateSweep(state);
  if (["inductance", "dcr", "rac", "inductorIsat"].includes(key) && state.selectedPart) {
    state.selectedPart = null;
    const partSelect = root.querySelector("[data-blx-catalog-part]");
    const dcrSelect = root.querySelector("[data-blx-catalog-dcr]");
    if (partSelect) partSelect.value = "";
    if (dcrSelect) dcrSelect.disabled = true;
    renderCatalogMeta(root, state);
  }
  if (key === "ioutMax") state.cursor = quantizeCurrent(state.cursor, Number(value) || 0);
  scheduleRender(root, state, { immediateUrl: commit });
}

function initializeInputs(root, state) {
  root.querySelectorAll("[data-blx-v2-input]").forEach((input) => {
    const key = input.dataset.blxV2Input;
    input.addEventListener("input", () => inputChanged(root, state, key, input.value, false));
    input.addEventListener("change", () => inputChanged(root, state, key, input.value, true));
  });
  root.querySelectorAll("[data-blx-v2-range]").forEach((range) => {
    const key = range.dataset.blxV2Range;
    range.addEventListener("input", () => inputChanged(root, state, key, fromSlider(BUCK_LOSS_SCHEMA_V2[key], range.value), false));
    range.addEventListener("change", () => updateCanonicalUrl(root, state, true));
  });
  root.querySelectorAll("[data-blx-condition-reset]").forEach((button) => {
    button.addEventListener("click", () => {
      resetConditionedField(state, button.dataset.blxConditionReset);
      state.custom = true;
      state.previewCursor = null;
      invalidateSweep(state);
      render(root, state, { immediateUrl: true });
    });
  });
  root.querySelectorAll("[data-blx-cursor-input]").forEach((range) => {
    range.addEventListener("keydown", (event) => {
      const maximum = Number(state.rawInputs.ioutMax) || 0;
      const step = cursorKeyboardStep(state.cursor, maximum);
      let next = null;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = maximum;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = state.cursor - step;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") next = state.cursor + step;
      if (next === null) return;
      event.preventDefault();
      state.cursor = quantizeCurrent(next, maximum);
      state.previewCursor = null;
      render(root, state, { immediateUrl: true });
    });
    range.addEventListener("input", () => {
      state.cursor = quantizeCurrent(state.rawInputs.ioutMax * Number(range.value) / 1000, state.rawInputs.ioutMax);
      state.previewCursor = null;
      scheduleRender(root, state, { updateUrl: false });
    });
    range.addEventListener("change", () => {
      state.cursor = quantizeCurrent(state.cursor, state.rawInputs.ioutMax);
      render(root, state, { immediateUrl: true });
    });
  });
  root.querySelector("[data-blx-timing-mode]")?.addEventListener("change", (event) => {
    state.timingMode = ["auto", "derived", "effective"].includes(event.currentTarget.value) ? event.currentTarget.value : "auto";
    state.custom = true;
    state.previewCursor = null;
    invalidateSweep(state);
    render(root, state, { immediateUrl: true });
  });
  root.querySelector("[data-blx-control-mode]")?.addEventListener("change", (event) => {
    state.controlMode = event.currentTarget.value === "forced-ccm" ? "forced-ccm" : "auto-dcm";
    state.custom = true;
    state.previewCursor = null;
    invalidateSweep(state);
    render(root, state, { immediateUrl: true });
  });
}

function chartCursorFromPointer(holder, state, event) {
  const rect = holder.getBoundingClientRect();
  const scale = holder.blxChartScale || { left: 0.08, width: 0.88 };
  const fraction = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1) - scale.left) / scale.width, 0, 1);
  return quantizeCurrent(fraction * state.rawInputs.ioutMax, state.rawInputs.ioutMax);
}

function updateChartPreview(root, state, current) {
  const safeCurrent = quantizeCurrent(current, Number(state.rawInputs.ioutMax) || 0);
  const point = evaluateStatePoint(state, safeCurrent);
  if (!point?.valid) return;
  root.querySelectorAll("[data-blx-efficiency-plot], [data-blx-loss-plot]").forEach((holder) => {
    holder.blxChartUpdate?.(point, safeCurrent);
  });
}

function initializeChartInteractions(root, state) {
  root.querySelectorAll("[data-blx-efficiency-plot], [data-blx-loss-plot]").forEach((holder) => {
    const preview = (event) => {
      if (event.pointerType === "touch" && state.chartPointerId !== event.pointerId) return;
      // A focused chart is under keyboard control. WebKit can synthesize a
      // pointermove at the stationary cursor after its SVG is redrawn; letting
      // that event win would replace the committed keyboard value with a stale
      // hover preview. An active pointer capture still takes precedence below.
      if (state.chartPointerId === null && state.chartKeyboardMode) return;
      state.previewCursor = chartCursorFromPointer(holder, state, event);
      updateChartPreview(root, state, state.previewCursor);
    };
    holder.addEventListener("pointermove", preview);
    holder.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      state.chartKeyboardMode = false;
      state.chartPointerId = event.pointerId;
      holder.focus();
      try { holder.setPointerCapture(event.pointerId); } catch {}
      preview(event);
      event.preventDefault();
    });
    holder.addEventListener("pointerup", (event) => {
      if (state.chartPointerId !== event.pointerId) return;
      const current = finite(state.previewCursor) ? state.previewCursor : chartCursorFromPointer(holder, state, event);
      state.cursor = quantizeCurrent(current, state.rawInputs.ioutMax);
      state.previewCursor = null;
      state.chartPointerId = null;
      try { holder.releasePointerCapture(event.pointerId); } catch {}
      render(root, state, { immediateUrl: true });
    });
    holder.addEventListener("pointercancel", (event) => {
      if (state.chartPointerId !== event.pointerId) return;
      state.chartPointerId = null;
      state.previewCursor = null;
      updateChartPreview(root, state, state.cursor);
    });
    holder.addEventListener("pointerleave", () => {
      if (state.chartPointerId !== null) return;
      if (!finite(state.previewCursor)) return;
      state.previewCursor = null;
      updateChartPreview(root, state, state.cursor);
    });
    holder.addEventListener("keydown", (event) => {
      const maximum = Number(state.rawInputs.ioutMax) || 0;
      const step = cursorKeyboardStep(state.cursor, maximum);
      let next = null;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = maximum;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = state.cursor - step;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") next = state.cursor + step;
      if (next === null) return;
      event.preventDefault();
      state.chartKeyboardMode = true;
      state.cursor = quantizeCurrent(next, maximum);
      state.previewCursor = null;
      render(root, state, { immediateUrl: true });
      holder.focus({ preventScroll: true });
    });
  });
}

function populatePresets(root, state) {
  const holder = root.querySelector("[data-blx-presets]");
  if (!holder) return;
  holder.replaceChildren();
  BUCK_LOSS_PRESETS_V2.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.blxPreset = preset.id;
    button.textContent = preset.name;
    button.addEventListener("click", () => { void applyPreset(root, state, preset); });
    holder.append(button);
  });
}

function rawInputsForPreset(state, preset) {
  return cloneRaw({
    ...state.rawInputs,
    ...preset.rawInputs,
    __provenance: {
      ...(state.rawInputs.__provenance || {}),
      ...(preset.rawInputs.__provenance || {})
    }
  });
}

async function applyPreset(root, state, preset) {
  let deviceId = state.deviceId;
  if (state.template.voltageClass < preset.rawInputs.vin) {
    deviceId = await requestBuckLossDeviceV2(root, {
      title: `Choose a switch rated for ${displayNumber(preset.rawInputs.vin, 3)} V`,
      message: `${state.template.label} is below this preset's input-voltage class. Choose a compatible device to apply the preset.`,
      vin: preset.rawInputs.vin,
      allowCancel: true,
      signal: state.signal
    });
    if (!deviceId || state.disposed) return;
  }

  let nextRawInputs = rawInputsForPreset(state, preset);
  if (deviceId !== state.deviceId) {
    const applied = applyBuckLossDeviceTemplateV2(nextRawInputs, deviceId);
    nextRawInputs = cloneRaw(applied.rawInputs);
    state.deviceId = deviceId;
    state.template = applied.template;
    state.timingMode = applied.template.timingMode;
    state.waveformRinging = waveformRingingForTemplate(applied.template, applied.rawInputs, state.waveformRinging);
    try { localStorage.setItem(DEVICE_MEMORY_KEY, deviceId); } catch {}
  }
  state.rawInputs = nextRawInputs;
  state.presetId = preset.id;
  state.cursor = clamp(preset.cursor, 0, preset.rawInputs.ioutMax);
  state.selectedPart = preset.inductorPart;
  state.dcrMode = preset.dcrMode;
  state.custom = false;
  state.previewCursor = null;
  invalidateSweep(state);
  if (state.catalog) applyCatalogPart(root, state, state.selectedPart, { render: false });
  render(root, state, { immediateUrl: true });
}

async function changeDevice(root, state) {
  const deviceId = await requestBuckLossDeviceV2(root, {
    title: "Change switch technology",
    message: "The operating point and passive assumptions stay put; device-specific values are replaced by the selected typical template.",
    vin: state.rawInputs.vin,
    recommendedId: state.deviceId,
    allowCancel: true,
    signal: state.signal
  });
  if (!deviceId || state.disposed || deviceId === state.deviceId) return;
  const applied = applyBuckLossDeviceTemplateV2(state.rawInputs, deviceId);
  state.rawInputs = cloneRaw(applied.rawInputs);
  if (applied.template.timingMode === "derived") {
    state.rawInputs.effectiveTurnOn = null;
    state.rawInputs.effectiveTurnOff = null;
    state.rawInputs.__provenance.effectiveTurnOn = "missing";
    state.rawInputs.__provenance.effectiveTurnOff = "missing";
  }
  state.deviceId = deviceId;
  state.template = applied.template;
  state.waveformRinging = waveformRingingForTemplate(applied.template, applied.rawInputs, state.waveformRinging);
  state.timingMode = applied.template.timingMode;
  state.previewCursor = null;
  invalidateSweep(state);
  try { localStorage.setItem(DEVICE_MEMORY_KEY, deviceId); } catch {}
  render(root, state, { immediateUrl: true });
}

function initializeAccordions(root) {
  root.querySelectorAll(".blx-advanced details").forEach((detail) => {
    detail.dataset.open = detail.open ? "true" : "false";
    detail.addEventListener("toggle", () => { detail.dataset.open = detail.open ? "true" : "false"; });
  });
}

function initializeTabs(root, state) {
  const tabs = [...root.querySelectorAll("[data-blx-view]")];
  const panels = [...root.querySelectorAll("[data-blx-view-panel]")];
  const activate = async (view, focus = false) => {
    if (state.disposed) return;
    const previous = panels.find((panel) => !panel.hidden);
    const next = panels.find((panel) => panel.dataset.blxViewPanel === view);
    const previousIndex = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const nextIndex = tabs.findIndex((tab) => tab.dataset.blxView === view);
    tabs.forEach((tab) => {
      const active = tab.dataset.blxView === view;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    const tabList = root.querySelector(".blx-view-tabs");
    if (tabList) tabList.dataset.activeView = view;
    state.view = view;
    if (view === "load" && state.point) {
      renderEfficiencyChart(root, state);
      renderLossChart(root, state);
      renderLossCharacter(root, state);
      state.referenceReveal = false;
    }
    if (previous && next && previous !== next) {
      const animated = await animatePanelSwap(root.querySelector("[data-blx-view-panels]"), previous, next, nextIndex >= previousIndex ? 1 : -1);
      if (state.disposed) return;
      if (state.view !== view) {
        panels.forEach((panel) => { panel.hidden = panel.dataset.blxViewPanel !== state.view; });
        return;
      }
      if (!animated) panels.forEach((panel) => { panel.hidden = panel !== next; });
    } else panels.forEach((panel) => { panel.hidden = panel !== next; });
    if (focus) tabs[nextIndex]?.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab.dataset.blxView));
    tab.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs.at(-1);
      if (!next) return;
      event.preventDefault();
      activate(next.dataset.blxView, true);
    });
  });
  activate("point");
}

function initializeInputSheet(root, signal) {
  const disclosure = root.querySelector(".blx-input-disclosure");
  const desktopSlot = root.querySelector("[data-blx-desktop-input-slot]");
  const mobileSlot = root.querySelector("[data-blx-mobile-input-slot]");
  const dialog = root.querySelector("[data-blx-input-sheet]");
  const openButton = root.querySelector("[data-blx-input-open]");
  const closeButton = root.querySelector("[data-blx-input-close]");
  if (!disclosure || !desktopSlot || !mobileSlot || !dialog || signal?.aborted) return;
  const media = matchMedia("(max-width: 700px)");
  const close = async () => {
    if (!dialog.open) return;
    await animateDialog(dialog, false);
    if (dialog.open) dialog.close();
    if (!signal?.aborted) openButton?.focus();
  };
  openButton?.addEventListener("click", async () => {
    if (!media.matches || dialog.open) return;
    dialog.showModal();
    await animateDialog(dialog, true);
    if (!signal?.aborted) dialog.querySelector("h2")?.focus();
  });
  closeButton?.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  const sync = () => {
    disclosure.open = true;
    if (media.matches) mobileSlot.append(disclosure);
    else {
      if (dialog.open) dialog.close();
      desktopSlot.append(disclosure);
    }
  };
  sync();
  media.addEventListener?.("change", sync, signal ? { signal } : undefined);
  signal?.addEventListener("abort", () => {
    if (dialog.open) dialog.close();
  }, { once: true });
}

function findCatalogPart(state, partNumber) {
  return state.catalog?.parts?.find((part) => part.base_part_number === partNumber) || null;
}

function renderCatalogMeta(root, state) {
  const meta = root.querySelector("[data-blx-catalog-meta]");
  const message = root.querySelector("[data-blx-catalog-message]");
  const part = findCatalogPart(state, state.selectedPart);
  if (!meta) return;
  if (!part) {
    meta.hidden = true;
    return;
  }
  const isat = selectIsat(part);
  const modeled = state.inductorAcDataset?.permission_status === "approved" && state.inductorAcDataset.parts?.[part.base_part_number];
  meta.replaceChildren(document.createTextNode(`${part.base_part_number} · ${displayNumber(part.inductance_uh, 2)} µH · ${state.dcrMode} DCR ${displayNumber(dcrForMode(part, state.dcrMode), 2)} mΩ${isat ? ` · Isat ${displayNumber(isat.value, 2)} A (${isat.dropPct}% drop)` : ""} · ${modeled ? "characterized AC/core residual" : "AC/core residual unavailable"} · `));
  const link = document.createElement("a");
  link.href = part.datasheet_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Datasheet ↗";
  meta.append(link);
  meta.hidden = false;
  if (message) message.hidden = true;
}

function applyCatalogPart(root, state, partNumber, options = {}) {
  const part = findCatalogPart(state, partNumber);
  const select = root.querySelector("[data-blx-catalog-part]");
  const dcrSelect = root.querySelector("[data-blx-catalog-dcr]");
  if (!part) {
    state.selectedPart = null;
    if (select) select.value = "";
    if (dcrSelect) dcrSelect.disabled = true;
    renderCatalogMeta(root, state);
    invalidateSweep(state);
    if (options.render !== false) render(root, state, { immediateUrl: true });
    return;
  }
  const dcr = dcrForMode(part, state.dcrMode);
  const isat = selectIsat(part);
  state.selectedPart = part.base_part_number;
  invalidateSweep(state);
  state.rawInputs.inductance = part.inductance_uh;
  if (finite(dcr)) {
    state.rawInputs.dcr = dcr;
    state.rawInputs.rac = dcr;
  }
  state.rawInputs.inductorIsat = isat?.value ?? null;
  state.rawInputs.__provenance = {
    ...(state.rawInputs.__provenance || {}),
    inductance: "coilcraft-datasheet",
    dcr: "coilcraft-datasheet",
    rac: "inferred-rac-equals-rdc",
    inductorIsat: isat ? "coilcraft-datasheet" : "missing"
  };
  if (select) select.value = part.base_part_number;
  if (dcrSelect) {
    dcrSelect.disabled = false;
    dcrSelect.value = state.dcrMode;
  }
  renderCatalogMeta(root, state);
  if (options.render !== false) render(root, state, { immediateUrl: true });
}

function populateCatalog(root, state) {
  const select = root.querySelector("[data-blx-catalog-part]");
  if (!select || !state.catalog) return;
  select.querySelectorAll("optgroup").forEach((group) => group.remove());
  groupPartsBySeries(state.catalog.parts).forEach(({ series, parts }) => {
    const group = document.createElement("optgroup");
    group.label = series;
    parts.forEach((part) => {
      const option = document.createElement("option");
      option.value = part.base_part_number;
      const modeled = state.inductorAcDataset?.parts?.[part.base_part_number];
      option.textContent = `${part.base_part_number} · ${displayNumber(part.inductance_uh, 2)} µH${modeled ? " · AC modeled" : ""}`;
      group.append(option);
    });
    select.append(group);
  });
  select.addEventListener("change", () => {
    state.custom = true;
    applyCatalogPart(root, state, select.value);
  });
  const dcrSelect = root.querySelector("[data-blx-catalog-dcr]");
  dcrSelect?.addEventListener("change", () => {
    state.dcrMode = dcrSelect.value === "max" ? "max" : "typ";
    state.custom = true;
    applyCatalogPart(root, state, state.selectedPart);
  });
}

async function initializeCatalog(root, state, signal) {
  const container = root.querySelector("[data-blx-catalog]");
  if (!container || signal?.aborted || state.disposed) return;
  container.dataset.catalogState = "loading";
  try {
    const [catalog, lossResult] = await Promise.all([
      loadCoilcraftCatalog(root.dataset.blxCatalogUrl, { signal }),
      root.dataset.blxInductorAcLossUrl
        ? fetch(root.dataset.blxInductorAcLossUrl, { signal }).then((response) => response.ok ? response.json() : null).catch((error) => {
          if (error?.name === "AbortError") throw error;
          return null;
        })
        : Promise.resolve(null)
    ]);
    if (signal?.aborted || state.disposed) return;
    state.catalog = catalog;
    state.inductorAcDataset = lossResult;
    state.catalogEpoch += 1;
    invalidateSweep(state);
    populateCatalog(root, state);
    container.dataset.catalogState = "ready";
    if (state.selectedPart && findCatalogPart(state, state.selectedPart)) applyCatalogPart(root, state, state.selectedPart, { render: false });
    else if (state.selectedPart) state.urlNotes.push({ code: "unknown-inductor" });
    renderCatalogMeta(root, state);
    render(root, state);
  } catch (error) {
    if (signal?.aborted || state.disposed || error?.name === "AbortError") return;
    container.dataset.catalogState = "error";
    state.catalog = null;
    state.catalogEpoch += 1;
    invalidateSweep(state);
    const partSelect = root.querySelector("[data-blx-catalog-part]");
    const dcrSelect = root.querySelector("[data-blx-catalog-dcr]");
    if (partSelect) partSelect.disabled = true;
    if (dcrSelect) dcrSelect.disabled = true;
    const message = root.querySelector("[data-blx-catalog-message]");
    if (message) {
      message.textContent = "The catalog is unavailable; generic magnetic inputs remain editable.";
      message.hidden = false;
    }
    console.warn("Buck-loss catalog unavailable", error);
    render(root, state);
  }
}

function resetOperatingPoint(root, state) {
    const preset = getBuckLossPresetV2(DEFAULT_BUCK_LOSS_PRESET_V2);
    const base = { ...rawDefaultsV2(), ...preset.rawInputs };
    state.rawInputs = cloneRaw(applyBuckLossDeviceTemplateV2(base, state.deviceId).rawInputs);
    state.presetId = preset.id;
    state.cursor = preset.cursor;
    state.selectedPart = preset.inductorPart;
    state.dcrMode = preset.dcrMode;
    state.controlMode = "auto-dcm";
    state.timingMode = state.template.timingMode;
    state.custom = false;
    state.previewCursor = null;
    invalidateSweep(state);
    if (state.catalog) applyCatalogPart(root, state, state.selectedPart, { render: false });
    render(root, state, { immediateUrl: true });
}

function initializeActions(root, state) {
  root.querySelector("[data-blx-reset]")?.addEventListener("click", () => resetOperatingPoint(root, state));
  root.querySelector("[data-blx-reset-invalid]")?.addEventListener("click", () => resetOperatingPoint(root, state));
  root.querySelector("[data-blx-fix-output]")?.addEventListener("click", () => {
    const input = root.querySelector('[data-blx-v2-input="vout"]');
    if (matchMedia("(max-width: 700px)").matches) {
      root.querySelector("[data-blx-input-open]")?.click();
      clearTimeout(state.focusTimer);
      state.focusTimer = window.setTimeout(() => {
        state.focusTimer = 0;
        if (!state.disposed) input?.focus();
      }, 340);
    } else input?.focus();
  });
  root.querySelector("[data-blx-change-device]")?.addEventListener("click", () => changeDevice(root, state));
  root.querySelectorAll("[data-blx-reference]").forEach((button) => button.addEventListener("click", () => {
    const holding = !state.reference;
    state.reference = holding ? makeReference(state) : null;
    state.referenceReveal = holding;
    render(root, state);
  }));
  root.querySelectorAll("[data-blx-copy]").forEach((button) => button.addEventListener("click", () => copyCanonicalUrl(root, state, button)));
  root.querySelectorAll("[data-blx-current-fraction]").forEach((button) => button.addEventListener("click", () => {
    state.cursor = quantizeCurrent(Number(button.dataset.blxCurrentFraction) * state.rawInputs.ioutMax, state.rawInputs.ioutMax);
    state.previewCursor = null;
    state.chartKeyboardMode = false;
    render(root, state, { immediateUrl: true });
  }));
}

function readRememberedDevice() {
  try { return localStorage.getItem(DEVICE_MEMORY_KEY); } catch { return null; }
}

function readImportPayload() {
  try {
    const value = sessionStorage.getItem(IMPORT_MEMORY_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export async function initBuckLossExplorerV2(root, options = {}) {
  if (!root || root.dataset.blxInit === "v2" || options.signal?.aborted) return;
  const lifecycle = new AbortController();
  let state = null;
  let resizeObserver = null;
  let resizeFrame = 0;
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    options.signal?.removeEventListener?.("abort", destroy);
    if (state) {
      state.disposed = true;
      clearTimeout(state.urlTimer);
      clearTimeout(state.focusTimer);
      cancelAnimationFrame(state.renderFrame);
      state.waveformAnimation?.cancel?.();
      state.chartAnimations?.forEach((animation) => animation?.cancel?.());
      root.querySelector("[data-blx-waveform-diagram]")?.blxWaveformController?.destroy?.();
    }
    cancelAnimationFrame(resizeFrame);
    resizeObserver?.disconnect();
    root.blxResizeObserver?.disconnect?.();
    root.querySelectorAll("*").forEach((node) => {
      clearTimeout(node.blxTimer);
      clearTimeout(node.blxCopyTimer);
      clearTimeout(node.blxAccordionTimer);
      cancelAnimationFrame(node.blxAccordionFrame || 0);
      node.blxChart?.animations?.forEach?.((animation) => animation?.cancel?.());
    });
    try { root.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel()); } catch {}
    root.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    lifecycle.abort();
  };
  root.blxDestroy = destroy;
  options.signal?.addEventListener("abort", destroy, { once: true });
  root.dataset.blxInit = "v2";
  prepareMarkup(root);
  const rawSearch = typeof window === "undefined" ? "" : window.location.search;
  const searchParams = new URLSearchParams(rawSearch);
  let parsed = parseBuckLossUrlV2(rawSearch, { rememberedDeviceId: readRememberedDevice() });
  const parsedTemplate = getBuckLossDeviceTemplateV2(parsed.deviceId);
  const incompatibleRememberedDevice = !searchParams.has("device") && parsedTemplate && parsedTemplate.voltageClass < parsed.rawInputs.vin;
  if (parsed.needsDevice || incompatibleRememberedDevice) {
    const deviceId = await requestBuckLossDeviceV2(root, {
      title: incompatibleRememberedDevice ? `Choose a switch rated for ${displayNumber(parsed.rawInputs.vin, 3)} V` : undefined,
      message: incompatibleRememberedDevice ? `${parsedTemplate.label} is below this preset's input-voltage class.` : undefined,
      vin: parsed.rawInputs.vin,
      signal: lifecycle.signal
    });
    if (!deviceId || lifecycle.signal.aborted) return;
    try { localStorage.setItem(DEVICE_MEMORY_KEY, deviceId); } catch {}
    const chosenState = new URLSearchParams(rawSearch);
    chosenState.set("m", "2");
    chosenState.set("device", deviceId);
    parsed = parseBuckLossUrlV2(chosenState.toString(), { rememberedDeviceId: deviceId });
  }
  const template = getBuckLossDeviceTemplateV2(parsed.deviceId);
  if (!template) throw new Error("Buck loss v2 requires an explicit device template.");
  state = {
    rawInputs: cloneRaw(parsed.rawInputs),
    inputs: null,
    provenance: {},
    conditioning: null,
    validation: { valid: true, errors: [] },
    presetId: parsed.presetId,
    deviceId: parsed.deviceId,
    template,
    controlMode: parsed.controlMode,
    timingMode: parsed.timingMode,
    cursor: quantizeCurrent(parsed.cursor, parsed.rawInputs.ioutMax),
    previewCursor: null,
    chartPointerId: null,
    chartKeyboardMode: false,
    waveformView: { mode: "full", startPhase: null, endPhase: null, probePhase: 0.32 },
    waveformRinging: waveformRingingForTemplate(template, parsed.rawInputs),
    waveformGhostPhase: null,
    waveformPointer: null,
    waveformOverviewPointer: null,
    waveformAnimation: null,
    selectedPart: parsed.selectedInductorPart,
    dcrMode: parsed.inductorDcrMode,
    urlNotes: parsed.notes,
    catalog: null,
    inductorAcDataset: null,
    catalogEpoch: 0,
    custom: parsed.custom || parsed.notes.length > 0,
    point: null,
    sweep: null,
    sweepCacheKey: null,
    reference: null,
    referenceReveal: false,
    openFamilies: new Set(),
    seriesSlots: [],
    chartPoints: new Map(),
    chartAnimations: new Map(),
    renderFrame: 0,
    pendingOptions: null,
    urlTimer: 0,
    focusTimer: 0,
    signal: lifecycle.signal,
    disposed: false,
    view: "point",
    importPayload: readImportPayload(),
    importRendered: false
  };
  root.blxV2State = state;
  populatePresets(root, state);
  initializeInputs(root, state);
  initializeChartInteractions(root, state);
  initializeWaveformInteractions(root, state);
  initializeAccordions(root);
  initializeTabs(root, state);
  initializeInputSheet(root, lifecycle.signal);
  initializeActions(root, state);
  initializeCoveragePopover(root, state, lifecycle.signal);
  render(root, state, { immediateUrl: true });
  await initializeCatalog(root, state, lifecycle.signal);
  if (lifecycle.signal.aborted || state.disposed) return;
  root.dataset.blxStatus = "ready";
  root.setAttribute("aria-busy", "false");
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (state.disposed) return;
        if (state.point?.valid && state.view === "load") {
          renderEfficiencyChart(root, state);
          renderLossChart(root, state);
          renderLossCharacter(root, state);
        }
        root.querySelector("[data-blx-waveform-diagram]")?.blxWaveformController?.resize();
      });
    });
    root.querySelectorAll(".blx-plot, [data-blx-waveform-diagram], [data-blx-waveform-overview]").forEach((plot) => resizeObserver.observe(plot));
    root.blxResizeObserver = resizeObserver;
  }
}
