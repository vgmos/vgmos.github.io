const moduleVersion = new URL(import.meta.url).searchParams.get("v");

function versionedModuleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (moduleVersion) url.searchParams.set("v", moduleVersion);
  return url.href;
}

const [
  { animateDialog, animateFlip, animatePanelSwap, animatePointSeries },
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
  {
    BUCK_LOSS_PRESETS_V2,
    DEFAULT_BUCK_LOSS_PRESET_V2,
    getBuckLossPresetV2
  },
  { parseBuckLossUrlV2, serializeBuckLossUrlV2 },
  { evaluateBuckLossPointV2, evaluateBuckLossSweepV2 },
  { BUCK_LOSS_FAMILIES_V2 },
  { dcrForMode, groupPartsBySeries, loadCoilcraftCatalog, selectIsat }
] = await Promise.all([
  import(versionedModuleUrl("./buck-loss-motion.js")),
  import(versionedModuleUrl("./buck-loss-schema-v2.js")),
  import(versionedModuleUrl("./buck-loss-device-templates-v2.js")),
  import(versionedModuleUrl("./buck-loss-presets-v2.js")),
  import(versionedModuleUrl("./buck-loss-url-v2.js")),
  import(versionedModuleUrl("./buck-loss-evaluator-v2.js")),
  import(versionedModuleUrl("./buck-loss-equations-v2.js")),
  import(versionedModuleUrl("./coilcraft-catalog.js"))
]);

const DEVICE_MEMORY_KEY = "buck-loss-v2-device";
const IMPORT_MEMORY_KEY = "buck-loss-v1-import";
const PRIMARY_GROUP = BUCK_LOSS_GROUPS_V2.find((group) => group.primary);
const PRIMARY_KEYS = Object.freeze(buckLossFieldKeysForGroupV2(PRIMARY_GROUP.id));
const ADVANCED_GROUPS = Object.freeze(BUCK_LOSS_GROUPS_V2
  .filter((group) => !group.primary)
  .map((group) => Object.freeze({ ...group, keys: Object.freeze(buckLossFieldKeysForGroupV2(group.id)) })));

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
  deadTimeConduction: ["deadTime", "diodeVf"],
  reverseRecovery: ["qrrRef", "qrrRefCurrent"],
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
  "synthetic-teaching-fixture": "teaching fixture",
  "inferred-qgs-minus-qgth": "inferred",
  "inferred-effective-overlap": "assumption",
  "inferred-from-vin": "inferred from VIN",
  "inferred-rac-equals-rdc": "inferred from RDC",
  "coilcraft-datasheet": "datasheet"
});

const QUIET_RAIL_PROVENANCE = new Set(["entered", "url-entered", "default", "missing", "entered-blank"]);

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

function cloneRaw(raw) {
  return { ...raw, __provenance: { ...(raw?.__provenance || {}) } };
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
    <p class="blx-field-message" data-blx-v2-message="${key}" hidden></p>
    <p class="blx-v2-provenance" data-blx-v2-provenance="${key}"></p>
  </div>`;
}

function catalogMarkup() {
  return `<div class="blx-catalog" data-blx-catalog data-catalog-state="loading">
    <div class="blx-catalog-field">
      <label for="blx-v2-catalog-part">Coilcraft part</label>
      <div class="blx-select-wrap"><select id="blx-v2-catalog-part" data-blx-catalog-part><option value="">Generic / manual</option></select></div>
    </div>
    <div class="blx-catalog-field">
      <label for="blx-v2-catalog-dcr">DCR corner</label>
      <div class="blx-select-wrap"><select id="blx-v2-catalog-dcr" data-blx-catalog-dcr disabled><option value="typ">Typical</option><option value="max">Maximum</option></select></div>
    </div>
    <p class="blx-catalog-meta" data-blx-catalog-meta hidden></p>
    <p class="blx-catalog-message" data-blx-catalog-message role="status" hidden></p>
    <p class="blx-catalog-disclaimer">Coilcraft names and data identify the selected source only; this independent tool is not affiliated with or endorsed by Coilcraft. Characterized residuals use their typical-data basis, even when maximum DCR is selected for copper loss.</p>
  </div>`;
}

function advancedMarkup(group) {
  const special = group.catalog ? catalogMarkup() : "";
  const controls = group.modeControl === "timing"
    ? `<div class="blx-v2-select-row"><label for="blx-v2-timing-mode">Transition timing</label><select id="blx-v2-timing-mode" data-blx-timing-mode><option value="derived">Derived from gate charge</option><option value="effective">Effective-time override</option></select></div>`
    : group.modeControl === "control"
      ? `<div class="blx-v2-select-row"><label for="blx-v2-control-mode">Low-current comparison</label><select id="blx-v2-control-mode" data-blx-control-mode><option value="auto-dcm">Automatic diode-emulation DCM</option><option value="forced-ccm">Forced CCM comparison</option></select></div>`
      : "";
  return `<details data-blx-v2-group="${group.id}">
    <summary><span>${escapeHtml(group.label)}</span><span class="blx-acc-chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 6.5 8 10.5 12 6.5"></path></svg></span></summary>
    <div class="blx-detail-panel"><div class="blx-detail-body">${controls}${special}<div class="blx-detail-grid">${group.keys.map((key) => fieldMarkup(key)).join("")}</div></div></div>
  </details>`;
}

function prepareMarkup(root) {
  root.dataset.blxModel = "2";
  root.dataset.blxRevision = BUCK_LOSS_MODEL_REVISION;
  const eyebrow = root.querySelector(".blx-eyebrow");
  const dek = root.querySelector(".blx-dek");
  if (eyebrow) eyebrow.textContent = `Interactive tool · Analytical loss model v${BUCK_LOSS_MODEL_REVISION}`;
  if (dek) dek.textContent = "Trace conduction, switching, magnetics, and control loss through CCM and diode-emulation DCM.";

  const sticky = root.querySelector(".blx-input-sticky");
  if (sticky) sticky.innerHTML = `<div class="blx-rail-heading"><h2>Operating point</h2><button class="blx-reset" type="button" data-blx-reset>Reset</button></div>
    <div class="blx-presets" data-blx-presets role="group" aria-label="Operating-point presets"></div>
    <p class="blx-prompt" data-blx-prompt></p>
    <div class="blx-device-note blx-v2-device-note"><div><strong data-blx-device-label>Choose a device</strong><br><span data-blx-device-summary></span> <a data-blx-device-source hidden target="_blank" rel="noopener noreferrer">Official datasheet ↗</a> <a data-blx-device-model-source hidden target="_blank" rel="noopener noreferrer">Simulator model ↗</a> <a data-blx-device-model-guide hidden target="_blank" rel="noopener noreferrer">Model guide ↗</a><p class="blx-v2-device-model-note" data-blx-device-model-note hidden></p><ul class="blx-v2-device-notes" data-blx-device-notes></ul><details class="blx-v2-device-conditions" data-blx-device-conditions hidden><summary>Parameter conditions</summary><ul data-blx-device-condition-list></ul></details></div><button type="button" data-blx-change-device>Change device</button></div>
    <section class="blx-controls" aria-label="Primary buck inputs">${PRIMARY_KEYS.map((key) => fieldMarkup(key, { slider: true })).join("")}</section>
    <div class="blx-current-control"><div class="blx-current-head"><label for="blx-v2-current-range">Load current</label><output data-blx-out="current">—</output></div><input id="blx-v2-current-range" class="blx-current-range" data-blx-cursor-input data-blx-cursor-rail type="range" min="0" max="1000" step="1" role="slider" tabindex="0" aria-label="Selected load current"><div class="blx-current-ticks" aria-hidden="true"><span>0</span><span>25%</span><span>50%</span><span>75%</span><span>I<sub>MAX</sub></span></div></div>
    <section class="blx-advanced" aria-label="Advanced assumptions">${ADVANCED_GROUPS.map(advancedMarkup).join("")}</section>`;

  const point = root.querySelector('[data-blx-view-panel="point"]');
  if (point) point.innerHTML = `<div class="blx-primary-result">
      <div><p class="blx-efficiency-value"><span data-blx-out="efficiency">—</span><small data-blx-efficiency-label>efficiency</small></p><p class="blx-current-caption">at <span data-blx-out="current-caption">—</span> · <span data-blx-out="regime">—</span></p></div>
      <div class="blx-summary-metrics"><div class="blx-summary-metric"><strong data-blx-out="pout">—</strong><span>output</span></div><div class="blx-summary-metric"><strong data-blx-out="loss">—</strong><span data-blx-loss-label>modeled loss</span></div><div class="blx-summary-metric"><strong data-blx-out="pin">—</strong><span data-blx-input-label>estimated input</span></div></div>
    </div>
    <div class="blx-v2-badges" data-blx-result-badges></div>
    <section class="blx-section blx-v2-failure" data-blx-model-failure hidden><div class="blx-failure-copy"><h2 data-blx-failure-title>This point cannot regulate</h2><p data-blx-failure-explanation></p><p data-blx-failure-recovery></p></div><p class="blx-failure-equation" data-blx-failure-equation></p><p>Results resume as soon as the operating point is feasible.</p><div class="blx-actions"><button type="button" data-blx-copy>Copy state</button></div></section>
    <section class="blx-section blx-waveform-section" data-blx-valid-only aria-label="Mode intervals"><div class="blx-section-heading"><h2>Conduction intervals</h2><button type="button" class="blx-section-total blx-boundary-button" data-blx-boundary-copy>—</button></div><div data-blx-waveform-diagram></div></section>
    <section class="blx-section" data-blx-valid-only aria-label="Ranked loss budget"><div class="blx-section-heading"><h2>Loss budget · ranked</h2><span class="blx-section-total" data-blx-out="loss-total">—</span></div><ol class="blx-breakdown-list blx-v2-family-list" data-blx-family-list></ol></section>
    <section class="blx-section blx-v2-power-balance" data-blx-valid-only aria-label="Power balance"><div class="blx-section-heading"><h2>Power balance</h2><span class="blx-section-total" data-blx-power-copy>Output + analytical losses</span></div><div class="blx-power-balance" data-blx-power-balance></div><div class="blx-operating-metrics" data-blx-operating-metrics></div></section>
    <section class="blx-section blx-v2-reference" data-blx-valid-only data-blx-reference-card hidden></section>
    <div class="blx-section" data-blx-valid-only><div class="blx-actions"><button type="button" data-blx-reference><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11l-3.5-2-3.5 2z"></path></svg><span>Hold reference</span></button><button type="button" data-blx-copy>Copy state</button><a data-blx-report-mismatch target="_blank" rel="noopener noreferrer">Report a mismatch</a></div><div class="blx-warnings" data-blx-warnings></div><p class="blx-sentence" data-blx-insight></p></div>`;

  const load = root.querySelector('[data-blx-view-panel="load"]');
  if (load) load.innerHTML = `<div class="blx-result-heading"><h2>Performance across load</h2><p>Peak efficiency, the CCM/DCM boundary, and the selected point stay linked.</p></div>
    <div class="blx-chart-block"><p class="blx-chart-title"><span data-blx-efficiency-chart-label>Efficiency</span> <span data-blx-across-efficiency>—</span></p><div class="blx-plot" data-blx-efficiency-plot aria-label="Efficiency versus load current"></div></div>
    <div class="blx-chart-block"><p class="blx-chart-title">Loss families <span data-blx-across-loss>—</span></p><div class="blx-plot" data-blx-loss-plot aria-label="Loss-family power versus load current"></div><div class="blx-v2-series-controls" data-blx-series-controls aria-label="Loss series controls"></div></div>
    <p class="blx-v2-reference-key" data-blx-reference-key hidden></p>
    <section class="blx-loss-character" aria-label="Dominant loss character across load"><h3>Loss character</h3><div class="blx-loss-character-track" data-blx-loss-character></div><p data-blx-causal-insight></p></section>
    <div class="blx-section"><div class="blx-actions"><button type="button" data-blx-reference><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11l-3.5-2-3.5 2z"></path></svg><span>Hold reference</span></button><button type="button" data-blx-copy>Copy state</button><a data-blx-report-mismatch target="_blank" rel="noopener noreferrer">Report a mismatch</a></div></div>`;

  const caveat = root.querySelector(".blx-top-caveat");
  if (caveat) caveat.textContent = "This is an analytical intuition model at a disclosed 25 °C parameter corner, not a part-level signoff tool. Confirm a real design with manufacturer models, SPICE, thermal analysis, and measurement.";
  const equations = root.querySelector(".blx-equations");
  if (equations) equations.innerHTML = `<h2>Equations in the open</h2><p>V2 solves regulated volt-second balance over explicit high-side, dead-time, low-side, and zero-current intervals. Each interval carries exact <code>∫i dt</code> and <code>∫i² dt</code> moments.</p><p>CCM uses two dead-time windows and excludes both from low-side channel conduction. Diode-emulation DCM ends low-side conduction at zero current. Atomic rows disclose the executed formula, whether the source is direct or adapted, and their citation to Gabriel Alfonso Rincón-Mora, <em>Switched Inductor Power IC Design</em>, Chapter 4.</p><p>Input power is reconstructed as <code>POUT + known PLOSS</code>; a subtotal therefore produces a known-loss efficiency ceiling. Efficiency remains undefined at exactly zero load because burst, PFM, and minimum-on-time behavior are controller-dependent and out of scope.</p>`;
  const caveats = root.querySelector(".blx-caveats");
  if (caveats) caveats.innerHTML = `<h2>Scope &amp; caveats</h2><ol><li>Fixed-frequency diode-emulation DCM and forced CCM comparison are modeled; PFM, burst, and minimum-on-time control are not.</li><li>Manufacturer-sourced and teaching templates use disclosed 25 °C values without electrothermal iteration.</li><li>Catalog magnetics use RMS copper plus a characterized residual exactly once in its supported CCM waveform domain. A maximum-DCR selection changes copper only; the residual remains tied to its typical characterization.</li><li>DCM switch-node commutation and continuous-triangle catalog residuals are omitted. Transition timing is derived only from complete gate-path data or entered as an effective-time approximation.</li><li>Bootstrap, snubbers, PCB/package resistance, ringing, and full IC leakage remain outside scope.</li></ol><p>Manufacturer names identify data sources only. This independent educational tool is not affiliated with or endorsed by any named device or magnetics manufacturer.</p>`;
}

function chooserCard(template, preloaded) {
  const metrics = [
    finite(template.values.rdsHigh) ? `${displayNumber(template.values.rdsHigh, 3)} mΩ` : null,
    finite(template.values.qgHigh) ? `${displayNumber(template.values.qgHigh, 3)} nC QG` : null,
    finite(template.values.qrrRef) ? `${displayNumber(template.values.qrrRef, 3)} nC QRR` : null
  ].filter(Boolean).join(" · ");
  const kind = template.catalogKind === "manufacturer"
    ? `${template.manufacturer || "Manufacturer"}-sourced · ${template.cornerLabel || template.cornerId}`
    : "Rounded teaching baseline · not a vendor part";
  return `<button type="button" class="blx-device-choice" data-blx-device-choice="${template.id}"><span><strong>${escapeHtml(template.label)}</strong>${preloaded ? '<em>Preloaded example</em>' : ""}</span><small>${escapeHtml(metrics || "Partial analytical coverage")}</small><span class="blx-device-choice-kind">${escapeHtml(kind)}</span></button>`;
}

function chooserGroup(kind, templates, selectedId) {
  if (!templates.length) return "";
  const label = kind === "manufacturer" ? "Manufacturer-sourced" : "Teaching baselines";
  return `<section class="blx-device-choice-group"><h3>${label}</h3><div class="blx-device-choice-grid">${templates.map((template) => chooserCard(template, template.id === selectedId)).join("")}</div></section>`;
}

export async function requestBuckLossDeviceV2(root, options = {}) {
  let dialog = root.querySelector("[data-blx-device-dialog]");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "blx-device-dialog";
    dialog.dataset.blxDeviceDialog = "";
    dialog.setAttribute("aria-labelledby", "blx-device-dialog-title");
    root.appendChild(dialog);
  }
  const vin = Number(options.vin) || 12;
  const preloaded = options.recommendedId || (vin <= 18 ? "epc2090" : recommendedSiliconTemplateV2(vin));
  const manufacturer = BUCK_LOSS_DEVICE_TEMPLATES_V2.filter((template) => template.catalogKind === "manufacturer");
  const teaching = BUCK_LOSS_DEVICE_TEMPLATES_V2.filter((template) => template.catalogKind !== "manufacturer");
  dialog.innerHTML = `<div class="blx-device-dialog-frame"><div class="blx-device-dialog-head"><p class="blx-eyebrow">Model v${BUCK_LOSS_MODEL_REVISION} · disclosed 25 °C corners</p><h2 id="blx-device-dialog-title">${escapeHtml(options.title || "Choose a switch-pair model")}</h2><p>${escapeHtml(options.message || "Device data changes recovery, transition timing, and switch-node energy. Choose an example explicitly; this is a model input, not a part recommendation.")}</p><p class="blx-device-context">Teaching context · one symmetric switch pair in a synchronous buck; verify voltage margin, gate drive, thermals, and layout for a real design.</p></div>${chooserGroup("manufacturer", manufacturer, preloaded)}${chooserGroup("teaching", teaching, preloaded)}${options.allowCancel ? '<button class="blx-device-dialog-cancel" type="button" data-blx-device-cancel>Cancel</button>' : ""}</div>`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (value) => {
      if (settled) return;
      settled = true;
      await animateDialog(dialog, false);
      dialog.close();
      resolve(value);
    };
    dialog.querySelectorAll("[data-blx-device-choice]").forEach((button) => button.addEventListener("click", () => finish(button.dataset.blxDeviceChoice), { once: true }));
    dialog.querySelector("[data-blx-device-cancel]")?.addEventListener("click", () => finish(null), { once: true });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (options.allowCancel) finish(null);
    }, { once: true });
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
    `Model revision: ${BUCK_LOSS_MODEL_REVISION}`,
    `Device: ${state.deviceId}`,
    `Operating point: ${formatCurrent(displayedCursor(state))}`,
    `Modes: ${point?.waveform?.mode || "unavailable"}; ${state.controlMode}; ${state.timingMode}`,
    `Coverage: ${point?.availability || "unavailable"}`,
    `Coverage gaps / omissions: ${gaps}`
  ].join("\n");
  const query = new URLSearchParams({
    title: `[Buck loss v${BUCK_LOSS_MODEL_REVISION}] Model mismatch`,
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
  const href = canonicalHref(state);
  root.querySelectorAll("[data-blx-copy-url]").forEach((input) => { input.value = href; });
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  clearTimeout(state.urlTimer);
  const commit = () => {
    state.urlTimer = 0;
    window.history.replaceState(null, "", `${window.location.pathname}?${canonicalQuery(state)}${window.location.hash || ""}`);
  };
  if (immediate) commit();
  else state.urlTimer = setTimeout(commit, 260);
}

async function copyCanonicalUrl(root, state, button) {
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
  const timing = root.querySelector("[data-blx-timing-mode]");
  const control = root.querySelector("[data-blx-control-mode]");
  if (timing) timing.value = state.timingMode;
  if (control) control.value = state.controlMode;
  root.querySelectorAll("[data-blx-tech]").forEach((field) => {
    field.hidden = field.dataset.blxTech !== "all" && field.dataset.blxTech !== state.template.technology;
  });
  root.querySelectorAll("[data-blx-timing]").forEach((field) => {
    if (field.dataset.blxTiming !== "all") field.hidden = field.dataset.blxTiming !== state.timingMode;
  });
  root.querySelectorAll("[data-blx-v2-provenance]").forEach((node) => {
    const key = node.dataset.blxV2Provenance;
    const value = state.provenance[key] || "missing";
    node.textContent = PROVENANCE_LABELS[value] || value;
    node.hidden = QUIET_RAIL_PROVENANCE.has(value);
  });
}

function renderValidation(root, state) {
  const invalid = new Set(state.validation.errors.map((key) => key === "vout-lt-vin" ? "vout" : key));
  root.querySelectorAll("[data-blx-v2-message]").forEach((message) => {
    const key = message.dataset.blxV2Message;
    const active = invalid.has(key);
    message.hidden = !active;
    message.textContent = key === "vout" && state.validation.errors.includes("vout-lt-vin")
      ? "VOUT must remain below VIN."
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
    : "teaching baseline";
  const summary = `${template.voltageClass} V ${template.technology === "gan" ? "GaN" : "silicon"} · ${sourceKind} · ${template.cornerLabel || template.cornerId}`;
  setText(root, "[data-blx-device-summary]", summary);
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
      modelMetadata?.version ? `Model ${modelMetadata.version}` : null,
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
  const labels = [
    `Model v${point.modelRevision || BUCK_LOSS_MODEL_REVISION}`,
    point.technology === "gan" ? "GaN" : "Silicon",
    point.valid ? compactMode(point.waveform.mode) : `Out of regulation · ${point.failure?.code || "infeasible"}`,
    template?.cornerLabel || point.parameterCorner || "disclosed-25c",
    point.valid ? (point.availability === "total" ? "Total" : "Subtotal") : "No result"
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

function renderWaveformDiagram(root, point) {
  const holder = root.querySelector("[data-blx-waveform-diagram]");
  if (!holder || !point.valid) return;
  const segments = point.waveform.segments;
  const period = point.waveform.period;
  const width = 720;
  const height = 174;
  const left = 34;
  const right = 12;
  const plotWidth = width - left - right;
  const baseline = 122;
  const maxCurrent = Math.max(1e-9, point.waveform.iPeak, Math.abs(point.waveform.iValley));
  const minCurrent = Math.min(0, point.waveform.iValley);
  const span = Math.max(1e-9, maxCurrent - minCurrent);
  const y = (current) => 107 - ((current - minCurrent) / span) * 70;
  const stateClass = {
    "high-side": "high",
    "low-side": "low",
    "dead-time": "dead",
    "zero-current": "zero"
  };
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${compactMode(point.waveform.mode)} inductor-current waveform and conduction intervals` });
  svg.classList.add("blx-waveform-svg");
  svg.append(svgNode("line", { x1: left, y1: y(0), x2: width - right, y2: y(0), class: "blx-waveform-zero" }));
  let elapsed = 0;
  const points = [];
  for (const segment of segments) {
    const x0 = left + plotWidth * elapsed / period;
    elapsed += segment.duration;
    const x1 = left + plotWidth * elapsed / period;
    const rect = svgNode("rect", { x: x0, y: baseline, width: Math.max(0.8, x1 - x0), height: 14, class: `blx-interval-${stateClass[segment.state]}` });
    svg.append(rect);
    if (segment.state === "dead-time") {
      const marker = svgNode("text", { x: (x0 + x1) / 2, y: baseline - 5, "text-anchor": "middle", class: "blx-waveform-dead-label" });
      marker.textContent = "tD";
      svg.append(marker);
    }
    if (x1 - x0 > 50) {
      const label = svgNode("text", { x: (x0 + x1) / 2, y: 153, "text-anchor": "middle" });
      label.textContent = segment.state.replace("-", " ");
      svg.append(label);
    }
    if (!points.length) points.push([x0, y(segment.iStart)]);
    points.push([x1, y(segment.iEnd)]);
  }
  const path = svgNode("path", { d: `M${points.map((point) => point.join(",")).join(" L")}`, class: "blx-waveform-current" });
  svg.append(path);
  const peak = svgNode("text", { x: left + 4, y: 18 });
  peak.textContent = `IPK ${formatCurrent(point.waveform.iPeak)}`;
  svg.append(peak);
  const average = svgNode("text", { x: width - right, y: 18, "text-anchor": "end" });
  average.textContent = `IL,RMS ${formatCurrent(Math.sqrt(point.waveform.moments.iLrms2))}`;
  svg.append(average);
  holder.replaceChildren(svg);
  const boundary = point.waveform.ccmBoundary;
  const button = root.querySelector("[data-blx-boundary-copy]");
  if (button) {
    button.textContent = finite(boundary) ? `DCM below ${formatCurrent(boundary)}` : "Boundary unavailable";
    button.disabled = !finite(boundary);
    button.dataset.blxBoundaryCurrent = finite(boundary) ? String(boundary) : "";
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
      });
      item.append(details);
    }
    const details = item.querySelector("details");
    const summary = item.querySelector("summary");
    const rank = item.querySelector(".blx-v2-rank");
    const name = item.querySelector(".blx-loss-name b");
    const dot = item.querySelector(".blx-loss-name i");
    const amount = summary.querySelector(":scope > strong");
    const bar = item.querySelector(".blx-v2-family-bar");
    const body = item.querySelector(".blx-v2-atomic-list");
    rank.textContent = String(index + 1).padStart(2, "0");
    name.textContent = family.label;
    dot.style.background = `var(${FAMILY_STYLE[family.id].color})`;
    amount.textContent = available ? formatPower(value) : "—";
    amount.setAttribute("aria-label", available ? formatPower(value) : "Not available");
    item.dataset.blxAvailability = available ? "known" : "unavailable";
    bar.style.setProperty("--blx-family-width", `${available ? 100 * value / maximum : 0}%`);
    bar.style.setProperty("--blx-family-color", `var(${FAMILY_STYLE[family.id].color})`);
    body.replaceChildren();
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
        .map((parameter) => `${BUCK_LOSS_SCHEMA_V2[parameter]?.label || parameter}: ${PROVENANCE_LABELS[state.provenance[parameter]] || state.provenance[parameter]}`);
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
    ["Inductor RMS", formatCurrent(Math.sqrt(point.waveform.moments.iLrms2))],
    ["Coverage", point.availability === "total" ? "All terms modeled" : `${omittedTerms} term${omittedTerms === 1 ? "" : "s"} omitted`]
  ];
  metrics.innerHTML = entries.map(([label, value]) => `<div class="blx-operating-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function renderWarningsAndInsight(root, state, point) {
  const holder = root.querySelector("[data-blx-warnings]");
  const messages = [];
  if (point.waveform.mode === "dcm") messages.push({ copy: "Fixed-frequency diode-emulation DCM: low-side conduction stops at zero current." });
  if (point.waveform.mode === "zero-load-unmodeled") messages.push({ copy: "Efficiency is undefined at zero load; PFM, burst, and minimum-on-time behavior depend on the controller." });
  if (point.availability === "subtotal") {
    const gaps = [...new Set(point.coverageGaps.map((gap) => GAP_COPY[gap.code] || gap.code))];
    messages.push({ copy: `Known-loss subtotal: ${gaps.join("; ")}. Missing terms are not treated as zero.` });
  }
  if (point.warnings.includes("isat")) messages.push({ copy: "Peak current exceeds the selected inductor saturation rating.", strong: true });
  if (state.template.voltageClass < state.rawInputs.vin) messages.push({ copy: `${state.template.label} is below the entered VIN voltage class; choose an appropriate device before design work.`, strong: true });
  if (point.warnings.includes("negative-current-commutation-approximate")) messages.push({ copy: "Approximate commutation: forced CCM has negative valley current. ZVS, signed dead-time paths, QRR, turn-on overlap, and EOSS are only first-order estimates in this reverse-current region.", strong: true });
  else if (state.controlMode === "forced-ccm") messages.push({ copy: "Forced CCM is an expert comparison; watch the valley-current sign at light load." });
  if (state.selectedPart && state.dcrMode === "max") messages.push({ copy: "Maximum DCR changes copper loss only; the catalog AC/core residual remains tied to its typical characterization." });
  if (state.urlNotes.length) messages.push({ copy: "Some URL values were unknown or adjusted to the valid schema." });
  if (holder) holder.innerHTML = messages.map(({ copy, strong }) => `<p class="blx-note${strong ? " blx-note-strong" : ""}">${escapeHtml(copy)}</p>`).join("");
  const advisory = point.insights.fetAreaOptimumScale;
  const insight = finite(advisory)
    ? advisory > 1.08
      ? `The channel-resistance versus gate-charge advisory favors about ${displayNumber(advisory, 2)}× more FET area at this point. EOSS and QRR are deliberately excluded.`
      : advisory < 0.92
        ? `The channel-resistance versus gate-charge advisory favors about ${displayNumber(1 / advisory, 2)}× less FET area at this point. EOSS and QRR are deliberately excluded.`
        : "Channel conduction and gate-drive loss are close to the textbook FET-area balance at this point."
    : "FET-area balance is unavailable until both channel and gate-drive loss are present.";
  setText(root, "[data-blx-insight]", insight);
}

function chartFrame(holder, yMaximum, yTicks, yFormatter) {
  const width = Math.max(360, Math.round(holder.getBoundingClientRect().width || 720));
  const height = 286;
  const margin = { left: 58, right: 18, top: 18, bottom: 38 };
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
    const label = svgNode("text", { x, y: height - 12, "text-anchor": "middle", class: "blx-chart-axis-label" });
    label.textContent = index === 4 ? "IMAX" : `${index * 25}%`;
    svg.append(label);
  }
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
  addVerticalAnnotation(frame, displayedCursor(state) / state.inputs.ioutMax, "Selected", "blx-chart-cursor");
  holder.replaceChildren(frame.svg);
  holder.tabIndex = 0;
  holder.setAttribute("role", "slider");
  holder.setAttribute("aria-valuemin", "0");
  holder.setAttribute("aria-valuemax", String(state.inputs.ioutMax));
  holder.setAttribute("aria-valuenow", String(displayedCursor(state)));
  holder.setAttribute("aria-valuetext", `${formatCurrent(displayedCursor(state))}; ${formatPercent(state.point.efficiency)}`);
  setText(root, "[data-blx-across-efficiency]", `${formatPercent(state.point.efficiency)} at ${formatCurrent(displayedCursor(state))}`);
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
    pin.textContent = slot.pinned ? "Pinned" : "Auto";
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
  });
  addVerticalAnnotation(frame, state.sweep.annotations.ccmBoundary / state.inputs.ioutMax, "Boundary", "blx-chart-boundary");
  addVerticalAnnotation(frame, displayedCursor(state) / state.inputs.ioutMax, "Selected", "blx-chart-cursor");
  holder.replaceChildren(frame.svg);
  holder.tabIndex = 0;
  holder.setAttribute("role", "slider");
  holder.setAttribute("aria-valuemin", "0");
  holder.setAttribute("aria-valuemax", String(state.inputs.ioutMax));
  holder.setAttribute("aria-valuenow", String(displayedCursor(state)));
  holder.setAttribute("aria-valuetext", `${formatCurrent(displayedCursor(state))}; ${formatPower(state.point.pLoss)} known loss`);
  renderSeriesControls(root, state);
  setText(root, "[data-blx-across-loss]", `${formatPower(state.point.pLoss)} at ${formatCurrent(displayedCursor(state))}`);
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
  card.innerHTML = `<div class="blx-section-heading"><h2>Held reference</h2><span class="blx-section-total">${escapeHtml(reference.label)}</span></div><div class="blx-v2-reference-sides"><div><span>Reference</span><strong>${formatPercent(reference.point.efficiency)} · ${formatPower(reference.point.pLoss)}</strong><small>v${reference.modelRevision} · ${reference.technology === "gan" ? "GaN" : "Silicon"} · ${compactMode(reference.mode)} · ${reference.corner} · ${reference.point.availability}</small></div><div><span>Current</span><strong>${formatPercent(state.point.efficiency)} · ${formatPower(state.point.pLoss)}</strong><small>v${BUCK_LOSS_MODEL_REVISION} · ${state.template.technology === "gan" ? "GaN" : "Silicon"} · ${compactMode(state.point.waveform.mode)} · ${state.template.cornerLabel || state.template.cornerId} · ${state.point.availability}</small></div></div><p>${finite(efficiencyDelta) ? `${efficiencyDelta >= 0 ? "+" : ""}${displayNumber(efficiencyDelta * 100, 2)} percentage points` : "Efficiency delta suppressed unless both results have total coverage"} · ${lossDelta >= 0 ? "+" : "−"}${formatPower(Math.abs(lossDelta))} known loss</p>`;
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

function clearResultContent(root) {
  setText(root, '[data-blx-out="efficiency"]', "—");
  setText(root, '[data-blx-out="pout"]', "—");
  setText(root, '[data-blx-out="loss"]', "—");
  setText(root, '[data-blx-out="pin"]', "—");
  setText(root, '[data-blx-out="loss-total"]', "Unavailable");
  setText(root, "[data-blx-loss-label]", "loss");
  setText(root, "[data-blx-input-label]", "input");
  setText(root, "[data-blx-efficiency-label]", "efficiency");
  setText(root, '[data-blx-out="sheet-efficiency"]', "—");
  setText(root, '[data-blx-out="sheet-loss"]', "—");
  root.querySelector("[data-blx-result-badges]")?.replaceChildren();
  const warnings = root.querySelector("[data-blx-warnings]");
  if (warnings) warnings.replaceChildren();
  root.querySelector("[data-blx-family-list]")?.replaceChildren();
  root.querySelector("[data-blx-waveform-diagram]")?.replaceChildren();
  root.querySelector("[data-blx-power-balance]")?.replaceChildren();
  root.querySelector("[data-blx-operating-metrics]")?.replaceChildren();
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
  clearResultContent(root);
  setResultAvailability(root, false);
  root.querySelectorAll("[data-blx-view]").forEach((tab) => {
    const active = tab.dataset.blxView === "point";
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll("[data-blx-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.blxViewPanel !== "point"; });
  state.view = "point";
  const failure = root.querySelector("[data-blx-model-failure]");
  if (failure) failure.hidden = true;
  setText(root, '[data-blx-out="regime"]', "Invalid inputs");
  const warnings = root.querySelector("[data-blx-warnings]");
  if (warnings) warnings.innerHTML = '<p class="blx-note">Correct the highlighted input values to evaluate this operating point.</p>';
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
      equation: `2tDEAD / TSW = ${finite(values.deadFraction) ? displayNumber(2 * values.deadFraction, 4) : "—"}`
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
  clearResultContent(root);
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
  banner.innerHTML = `<div><p class="blx-eyebrow">Imported from legacy v1</p><h2>V2 recalculated this point</h2><p>Legacy v1 remains unchanged and read-only. Compatible inputs were carried over; ${escapeHtml(state.template.label)} supplies the new device-physics fields.</p></div><div class="blx-import-delta-metrics"><span><small>Efficiency delta</small><strong>${finite(efficiencyDelta) ? `${efficiencyDelta >= 0 ? "+" : ""}${displayNumber(efficiencyDelta * 100, 2)} pp` : "—"}</strong></span><span><small>Loss delta</small><strong>${finite(lossDelta) ? `${lossDelta >= 0 ? "+" : "−"}${formatPower(Math.abs(lossDelta))}` : "—"}</strong></span></div>`;
  root.querySelector(".blx-workspace")?.before(banner);
  try { sessionStorage.removeItem(IMPORT_MEMORY_KEY); } catch {}
}

function render(root, state, options = {}) {
  const normalized = normalizeBuckLossInputsV2(state.rawInputs);
  state.inputs = normalized.inputs;
  state.provenance = normalized.provenance;
  state.validation = validateBuckLossInputsV2(state.inputs);
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
  const contextSummary = `${displayNumber(state.rawInputs.vin, 3)} V → ${displayNumber(state.rawInputs.vout, 3)} V · ${formatCurrent(cursor)} · ${displayNumber(state.rawInputs.fsw / 1000, 3)} MHz`;
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
  setText(root, "[data-blx-input-label]", point.availability === "total" ? "estimated input" : "known-input floor");
  setText(root, "[data-blx-efficiency-label]", point.availability === "total" ? "efficiency" : "known-loss ceiling");
  setText(root, "[data-blx-efficiency-chart-label]", point.availability === "total" ? "Efficiency" : "Known-loss efficiency ceiling");
  setText(root, "[data-blx-power-copy]", point.availability === "total" ? "Output + analytical losses" : "Output + known analytical losses");
  setText(root, '[data-blx-out="sheet-efficiency"]', formatPercent(point.efficiency));
  setText(root, '[data-blx-out="sheet-loss"]', formatPower(point.pLoss));
  renderBadges(root, point, state.template);
  renderWaveformDiagram(root, point);
  renderFamilyList(root, state, point);
  renderPowerBalance(root, point);
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
  state.pendingOptions = { ...state.pendingOptions, ...options };
  if (state.renderFrame) return;
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = 0;
    const next = state.pendingOptions || {};
    state.pendingOptions = null;
    render(root, state, next);
  });
}

function inputChanged(root, state, key, value, commit) {
  const config = BUCK_LOSS_SCHEMA_V2[key];
  state.rawInputs[key] = value === "" && config.optional ? null : Number(value);
  state.rawInputs.__provenance = { ...(state.rawInputs.__provenance || {}), [key]: value === "" ? "entered-blank" : "entered" };
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
    state.timingMode = event.currentTarget.value === "derived" ? "derived" : "effective";
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
      scheduleRender(root, state, { updateUrl: false });
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
      render(root, state, { updateUrl: false });
    });
    holder.addEventListener("pointerleave", () => {
      if (state.chartPointerId !== null) return;
      if (!finite(state.previewCursor)) return;
      state.previewCursor = null;
      scheduleRender(root, state, { updateUrl: false });
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
    button.addEventListener("click", () => applyPreset(root, state, preset));
    holder.append(button);
  });
}

function applyPreset(root, state, preset) {
  state.rawInputs = cloneRaw({ ...state.rawInputs, ...preset.rawInputs });
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
    allowCancel: true
  });
  if (!deviceId || deviceId === state.deviceId) return;
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
    if (previous && next && previous !== next) {
      const animated = await animatePanelSwap(root.querySelector("[data-blx-view-panels]"), previous, next, nextIndex >= previousIndex ? 1 : -1);
      if (!animated) panels.forEach((panel) => { panel.hidden = panel !== next; });
    } else panels.forEach((panel) => { panel.hidden = panel !== next; });
    if (view === "load" && state.point) {
      renderEfficiencyChart(root, state);
      renderLossChart(root, state);
      renderLossCharacter(root, state);
      state.referenceReveal = false;
    }
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

function initializeInputSheet(root) {
  const disclosure = root.querySelector(".blx-input-disclosure");
  const desktopSlot = root.querySelector("[data-blx-desktop-input-slot]");
  const mobileSlot = root.querySelector("[data-blx-mobile-input-slot]");
  const dialog = root.querySelector("[data-blx-input-sheet]");
  const openButton = root.querySelector("[data-blx-input-open]");
  const closeButton = root.querySelector("[data-blx-input-close]");
  if (!disclosure || !desktopSlot || !mobileSlot || !dialog) return;
  const media = matchMedia("(max-width: 700px)");
  const close = async () => {
    if (!dialog.open) return;
    await animateDialog(dialog, false);
    dialog.close();
    openButton?.focus();
  };
  openButton?.addEventListener("click", async () => {
    if (!media.matches || dialog.open) return;
    dialog.showModal();
    await animateDialog(dialog, true);
    dialog.querySelector("h2")?.focus();
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
  media.addEventListener?.("change", sync);
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

async function initializeCatalog(root, state) {
  const container = root.querySelector("[data-blx-catalog]");
  if (!container) return;
  container.dataset.catalogState = "loading";
  try {
    const [catalog, lossResult] = await Promise.all([
      loadCoilcraftCatalog(root.dataset.blxCatalogUrl),
      root.dataset.blxInductorAcLossUrl
        ? fetch(root.dataset.blxInductorAcLossUrl).then((response) => response.ok ? response.json() : null).catch(() => null)
        : Promise.resolve(null)
    ]);
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

function initializeActions(root, state) {
  root.querySelector("[data-blx-reset]")?.addEventListener("click", () => {
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
  });
  root.querySelector("[data-blx-change-device]")?.addEventListener("click", () => changeDevice(root, state));
  root.querySelectorAll("[data-blx-reference]").forEach((button) => button.addEventListener("click", () => {
    const holding = !state.reference;
    state.reference = holding ? makeReference(state) : null;
    state.referenceReveal = holding;
    render(root, state);
  }));
  root.querySelectorAll("[data-blx-copy]").forEach((button) => button.addEventListener("click", () => copyCanonicalUrl(root, state, button)));
  root.querySelector("[data-blx-boundary-copy]")?.addEventListener("click", (event) => {
    const boundary = Number(event.currentTarget.dataset.blxBoundaryCurrent);
    if (!finite(boundary)) return;
    state.cursor = quantizeCurrent(boundary, state.rawInputs.ioutMax);
    state.previewCursor = null;
    render(root, state, { immediateUrl: true });
  });
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

export async function initBuckLossExplorerV2(root) {
  if (!root || root.dataset.blxInit === "v2") return;
  root.dataset.blxInit = "v2";
  prepareMarkup(root);
  let parsed = parseBuckLossUrlV2(typeof window === "undefined" ? "" : window.location.search, { rememberedDeviceId: readRememberedDevice() });
  if (parsed.needsDevice) {
    const deviceId = await requestBuckLossDeviceV2(root, { vin: parsed.rawInputs.vin });
    try { localStorage.setItem(DEVICE_MEMORY_KEY, deviceId); } catch {}
    const chosenState = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    chosenState.set("m", "2");
    chosenState.set("device", deviceId);
    parsed = parseBuckLossUrlV2(chosenState.toString(), { rememberedDeviceId: deviceId });
  }
  const template = getBuckLossDeviceTemplateV2(parsed.deviceId);
  if (!template) throw new Error("Buck loss v2 requires an explicit device template.");
  const state = {
    rawInputs: cloneRaw(parsed.rawInputs),
    inputs: null,
    provenance: {},
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
    view: "point",
    importPayload: readImportPayload(),
    importRendered: false
  };
  root.blxV2State = state;
  populatePresets(root, state);
  initializeInputs(root, state);
  initializeChartInteractions(root, state);
  initializeAccordions(root);
  initializeTabs(root, state);
  initializeInputSheet(root);
  initializeActions(root, state);
  render(root, state, { immediateUrl: true });
  await initializeCatalog(root, state);
  root.dataset.blxStatus = "ready";
  root.setAttribute("aria-busy", "false");
  if (typeof ResizeObserver !== "undefined") {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (state.point?.valid && state.view === "load") {
          renderEfficiencyChart(root, state);
          renderLossChart(root, state);
          renderLossCharacter(root, state);
        }
      });
    });
    root.querySelectorAll(".blx-plot").forEach((plot) => observer.observe(plot));
    root.blxResizeObserver = observer;
  }
  window.addEventListener("popstate", () => window.location.reload());
}
