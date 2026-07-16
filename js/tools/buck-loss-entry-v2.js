const moduleVersion = new URL(import.meta.url).searchParams.get("v");

function versionedModuleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (moduleVersion) url.searchParams.set("v", moduleVersion);
  return url.href;
}

const [
  {
    BUCK_LOSS_SCHEMA_V2,
    normalizeBuckLossInputsV2,
    rawDefaultsV2,
    validateBuckLossInputsV2
  },
  {
    BUCK_LOSS_DEVICE_TEMPLATES_V2,
    applyBuckLossDeviceTemplateV2,
    getBuckLossDeviceTemplateV2
  },
  { resolveBuckLossConditionsV2 },
  {
    BUCK_LOSS_PRESETS_V2,
    DEFAULT_BUCK_LOSS_PRESET_V2,
    getBuckLossPresetV2
  },
  { detectBuckLossUrlVersion, parseBuckLossUrlV2, serializeBuckLossUrlV2 },
  { runAnimation },
  { dcrForMode, groupPartsBySeries, loadCoilcraftCatalog, selectIsat }
] = await Promise.all([
  import(versionedModuleUrl("./buck-loss-schema-v2.js")),
  import(versionedModuleUrl("./buck-loss-device-templates-v2.js")),
  import(versionedModuleUrl("./buck-loss-condition-resolver-v2.js")),
  import(versionedModuleUrl("./buck-loss-presets-v2.js")),
  import(versionedModuleUrl("./buck-loss-url-v2.js")),
  import(versionedModuleUrl("./buck-loss-motion.js")),
  import(versionedModuleUrl("./coilcraft-catalog.js"))
]);

export const BUCK_LOSS_LAST_SETUP_KEY = "buck-loss-v2-last-setup";
const DEVICE_MEMORY_KEY = "buck-loss-v2-device";
const DEFAULT_DEVICE_ID = "epc2090";
const CONDITIONED_DEVICE_KEYS = new Set([
  "rdsHigh", "rdsLow", "qgHigh", "qgLow", "qgs2High", "qgdHigh", "plateauHigh",
  "effectiveTurnOn", "effectiveTurnOff"
]);

const STEPS = Object.freeze([
  Object.freeze({ id: "conditions", label: "Conditions", action: "Continue to switch pair" }),
  Object.freeze({ id: "switch", label: "Switch pair", action: "Continue to gate drive" }),
  Object.freeze({ id: "gate", label: "Gate drive", action: "Continue to timing" }),
  Object.freeze({ id: "timing", label: "Timing", action: "Continue to magnetics" }),
  Object.freeze({ id: "magnetics", label: "Magnetics", action: "Continue to capacitors & control" }),
  Object.freeze({ id: "control", label: "Capacitors & control", action: "Review assumptions" }),
  Object.freeze({ id: "review", label: "Review", action: "Open loss explorer" })
]);

const STEP_KEYS = Object.freeze({
  conditions: Object.freeze(["vin", "vout", "ioutMax", "fsw"]),
  gate: Object.freeze([
    "vDrive", "rdsHigh", "rdsLow", "qgHigh", "qgLow", "qgs2High", "qgdHigh",
    "plateauHigh", "gateResistanceOnHigh", "gateResistanceOffHigh",
    "effectiveTurnOn", "effectiveTurnOff"
  ]),
  timing: Object.freeze([
    "deadTime", "deadTimeHighToLow", "deadTimeLowToHigh", "diodeVf",
    "reversePathResistance", "qrrRef", "qrrRefCurrent"
  ]),
  magnetics: Object.freeze(["inductance", "dcr", "rac", "inductorAcManual", "inductorIsat"]),
  control: Object.freeze(["inputEsr", "esr", "iq", "vBias"])
});

const FIELD_STEP = new Map(Object.entries(STEP_KEYS).flatMap(([step, keys]) => keys.map((key) => [key, step])));
const PRESET_ACKNOWLEDGEMENT_KEYS = Object.freeze([...STEP_KEYS.conditions, "cursor"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayNumber(value, digits = 3) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: digits }).format(number);
}

function finiteInput(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function cloneRaw(rawInputs = {}) {
  return {
    ...rawInputs,
    __provenance: { ...(rawInputs.__provenance || {}) }
  };
}

export function updateBuckLossLinkedDraftInputV2(rawInputs, key, value) {
  const config = BUCK_LOSS_SCHEMA_V2[key];
  const next = cloneRaw(rawInputs);
  if (!config) return next;
  const blank = value === "";
  const racWasLinked = key === "dcr" && next.__provenance.rac === "inferred-rac-equals-rdc";
  if (key === "rac" && blank) {
    next.rac = Number(next.dcr);
    next.__provenance.rac = "inferred-rac-equals-rdc";
  } else {
    next[key] = blank && config.optional ? null : Number(value);
    next.__provenance[key] = blank ? "entered-blank" : "entered";
  }
  if (racWasLinked) {
    next.rac = next.dcr;
    next.__provenance.rac = "inferred-rac-equals-rdc";
  }
  return next;
}

function applyConditioningToDraft(state) {
  const template = getBuckLossDeviceTemplateV2(state.deviceId);
  if (!template) return null;
  const result = resolveBuckLossConditionsV2(state.rawInputs, template, {
    currentA: Number(state.rawInputs.ioutMax) || Number(state.cursor) || 0
  });
  state.rawInputs = cloneRaw(result.rawInputs);
  state.conditioning = result;
  return result;
}

function resetConditionedDraftField(state, key) {
  const template = getBuckLossDeviceTemplateV2(state.deviceId);
  if (!template || !(key in template.values)) return;
  state.rawInputs[key] = template.values[key];
  state.rawInputs.__provenance = {
    ...(state.rawInputs.__provenance || {}),
    [key]: template.provenance[key] || (template.values[key] === null ? "missing" : template.source.kind)
  };
  applyConditioningToDraft(state);
}

function stateForSerialization(state) {
  return {
    presetId: state.presetId,
    deviceId: state.deviceId,
    controlMode: state.controlMode,
    timingMode: state.timingMode,
    selectedInductorPart: state.selectedPart,
    inductorDcrMode: state.dcrMode,
    rawInputs: state.rawInputs,
    cursor: state.cursor
  };
}

function navigateWithinSite(href) {
  if (typeof window.vgmosNavigation?.navigate === "function") {
    window.vgmosNavigation.navigate(href);
    return;
  }
  window.location.assign(href);
}

export function seedBuckLossSetupV2() {
  const preset = getBuckLossPresetV2(DEFAULT_BUCK_LOSS_PRESET_V2);
  const applied = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...preset.rawInputs }, DEFAULT_DEVICE_ID);
  const state = {
    presetId: preset.id,
    deviceId: applied.template.id,
    controlMode: "auto-dcm",
    timingMode: applied.template.timingMode,
    selectedPart: preset.inductorPart,
    dcrMode: preset.dcrMode,
    rawInputs: cloneRaw(applied.rawInputs),
    cursor: preset.cursor,
    conditioning: null
  };
  applyConditioningToDraft(state);
  return state;
}

export function seedBuckLossQueryV2() {
  return serializeBuckLossUrlV2(stateForSerialization(seedBuckLossSetupV2()));
}

function canonicalStoredQuery(input) {
  const query = String(input ?? "").replace(/^[?#]/, "");
  if (detectBuckLossUrlVersion(query).route !== "v2") return null;
  const parsed = parseBuckLossUrlV2(query);
  if (parsed.needsDevice || !getBuckLossDeviceTemplateV2(parsed.deviceId)) return null;
  if (parsed.notes.some((note) => ["unknown-device", "invalid-parameter"].includes(note.code))) return null;
  const validation = validateBuckLossInputsV2(normalizeBuckLossInputsV2(parsed.rawInputs).inputs);
  if (!validation.valid) return null;
  return serializeBuckLossUrlV2({
    presetId: parsed.presetId,
    deviceId: parsed.deviceId,
    controlMode: parsed.controlMode,
    timingMode: parsed.timingMode,
    selectedInductorPart: parsed.selectedInductorPart,
    inductorDcrMode: parsed.inductorDcrMode,
    rawInputs: parsed.rawInputs,
    cursor: parsed.cursor
  });
}

export function readLastBuckLossQueryV2(storage = globalThis.localStorage) {
  try {
    return canonicalStoredQuery(storage?.getItem(BUCK_LOSS_LAST_SETUP_KEY));
  } catch {
    return null;
  }
}

export function rememberBuckLossQueryV2(query, storage = globalThis.localStorage) {
  const canonical = canonicalStoredQuery(query);
  if (!canonical) return false;
  try {
    storage?.setItem(BUCK_LOSS_LAST_SETUP_KEY, canonical);
    return true;
  } catch {
    return false;
  }
}

function draftFromQuery(query) {
  const parsed = parseBuckLossUrlV2(query);
  const state = {
    step: 0,
    presetId: parsed.presetId,
    deviceId: parsed.deviceId,
    controlMode: parsed.controlMode,
    timingMode: parsed.timingMode,
    selectedPart: parsed.selectedInductorPart,
    dcrMode: parsed.inductorDcrMode,
    rawInputs: cloneRaw(parsed.rawInputs),
    cursor: parsed.cursor,
    customConditions: false,
    errors: {},
    catalog: null,
    catalogStatus: "loading",
    catalogError: "",
    conditioning: null
  };
  applyConditioningToDraft(state);
  return state;
}

function gatewayMarkup(lastQuery) {
  const last = lastQuery ? parseBuckLossUrlV2(lastQuery) : parseBuckLossUrlV2(seedBuckLossQueryV2());
  const template = getBuckLossDeviceTemplateV2(last.deviceId);
  const summary = `${displayNumber(last.rawInputs.vin)} V → ${displayNumber(last.rawInputs.vout)} V · ${template?.partNumber || template?.label || "EPC2090"} · ${last.selectedInductorPart || "manual inductor"}`;
  const resume = Boolean(lastQuery);
  return `<div class="blx-entry-gateway" data-blx-entry-panel>
    <header class="blx-entry-gateway-head">
      <h1>Buck Converter Loss Explorer</h1>
      <p>Choose how you want to set up the model.</p>
    </header>
    <div class="blx-entry-paths">
      <section class="blx-entry-path blx-entry-path-primary" aria-labelledby="blx-entry-guided-title">
        <h2 id="blx-entry-guided-title">Guided setup</h2>
        <p>Configure circuit conditions, switch pair, magnetics, timing, capacitors, and controller assumptions step by step.</p>
        <button type="button" class="blx-entry-primary-action" data-blx-entry-start>Start guided setup</button>
        <small>About 5–7 minutes · Every value stays editable</small>
      </section>
      <section class="blx-entry-path" aria-labelledby="blx-entry-workspace-title">
        <h2 id="blx-entry-workspace-title">Open workspace</h2>
        <p class="blx-entry-path-label">${resume ? "Resume your last setup" : "Start from a complete example"}</p>
        <p class="blx-entry-resume-summary">${escapeHtml(summary)}</p>
        <button type="button" class="blx-entry-secondary-action" data-blx-entry-open>${resume ? "Open previous setup" : "Open seeded example"}</button>
        <small>${resume ? "New here? The seeded example opens automatically." : "Tune every value directly in the workspace."}</small>
      </section>
    </div>
    <p class="blx-entry-shared-note">Shared calculation links open their saved state directly.</p>
  </div>`;
}

function progressMarkup(stepIndex) {
  return `<ol class="blx-entry-progress" aria-label="Guided setup progress">${STEPS.map((step, index) => `<li${index === stepIndex ? ' aria-current="step"' : ""}${index < stepIndex ? ' data-complete="true"' : ""}>
    <span class="blx-entry-progress-label">${escapeHtml(step.label)}</span>
    <span class="blx-entry-progress-number">${index < stepIndex ? "✓" : index + 1}</span>
  </li>`).join("")}</ol>`;
}

function automaticPlaceholder(state, key) {
  if (key === "vBias" && state.rawInputs.vBias === null) return `auto: ${displayNumber(state.rawInputs.vin)} V`;
  if (key === "rac" && state.rawInputs.rac === null) return `auto: ${displayNumber(state.rawInputs.dcr)} mΩ`;
  if (["deadTimeHighToLow", "deadTimeLowToHigh"].includes(key) && state.rawInputs[key] === null) {
    return `auto: ${displayNumber(state.rawInputs.deadTime)} ns`;
  }
  return "blank";
}

function conditioningHelp(state, key) {
  const provenance = state.rawInputs.__provenance?.[key] || "";
  if (CONDITIONED_DEVICE_KEYS.has(key)
    && state.conditioning?.errors?.some(({ code }) => code === "drive-outside-condition-domain")) {
    return "Not resolved at this drive; the shown value is not applied until the condition is supported.";
  }
  if (provenance.startsWith("calculated-")) {
    return `Auto-calculated for ${displayNumber(state.rawInputs.ioutMax)} A maximum load. Edit to override.`;
  }
  if (CONDITIONED_DEVICE_KEYS.has(key) && ["entered", "url-entered"].includes(provenance)) {
    return "Manual override. Reset to resume condition tracking.";
  }
  return "";
}

function fieldMarkup(state, key, help = "") {
  const config = BUCK_LOSS_SCHEMA_V2[key];
  const id = `blx-entry-${key}`;
  const error = state.errors[key] || "";
  const dynamicHelp = conditioningHelp(state, key);
  const fieldHelp = help || dynamicHelp;
  const hasConditioningHelp = CONDITIONED_DEVICE_KEYS.has(key);
  const showsHelp = Boolean(fieldHelp || hasConditioningHelp);
  const describedBy = [showsHelp ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const value = state.rawInputs[key];
  const provenance = state.rawInputs.__provenance?.[key] || "";
  const canReset = CONDITIONED_DEVICE_KEYS.has(key) && ["entered", "url-entered"].includes(provenance);
  const step = ["fsw"].includes(key) ? "10" : ["deadTime", "deadTimeHighToLow", "deadTimeLowToHigh", "effectiveTurnOn", "effectiveTurnOff"].includes(key) ? "0.1" : "any";
  return `<div class="blx-entry-field" data-blx-entry-field="${key}">
    <label for="${id}">${escapeHtml(config.label)}</label>
    <span class="blx-entry-input-wrap"><input id="${id}" data-blx-entry-input="${key}" type="number" inputmode="decimal" min="${config.min}" max="${config.max}" step="${step}" value="${value ?? ""}"${config.optional ? ` placeholder="${escapeHtml(automaticPlaceholder(state, key))}"` : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""}${error ? ' aria-invalid="true"' : ""}><span>${escapeHtml(config.unit)}</span></span>
    ${showsHelp ? `<small id="${id}-help">${hasConditioningHelp ? `<span data-blx-entry-condition-help-text="${key}">${escapeHtml(fieldHelp)}</span> <button type="button" class="blx-entry-auto-reset" data-blx-entry-condition-reset="${key}"${canReset ? "" : " hidden"}>Reset to auto</button>` : escapeHtml(fieldHelp)}</small>` : ""}
    ${error ? `<small class="blx-entry-error" id="${id}-error">${escapeHtml(error)}</small>` : ""}
  </div>`;
}

function conditionsMarkup(state) {
  const contextError = state.errors.conditions || "";
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">1 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Set circuit conditions</h1><p>Start with an application preset or enter the operating point directly.</p></header>
    <fieldset class="blx-entry-presets"><legend>Application starting point</legend>${BUCK_LOSS_PRESETS_V2.map((preset) => `<button type="button" data-blx-entry-preset="${preset.id}" aria-pressed="${!state.customConditions && state.presetId === preset.id}"><strong>${escapeHtml(preset.name)}</strong><span>${escapeHtml(preset.prompt)}</span></button>`).join("")}</fieldset>
    ${contextError ? `<p class="blx-entry-form-error" role="alert">${escapeHtml(contextError)}</p>` : ""}
    <div class="blx-entry-field-grid">${STEP_KEYS.conditions.map((key) => fieldMarkup(state, key)).join("")}
      <div class="blx-entry-field" data-blx-entry-field="cursor"><label for="blx-entry-cursor">Analysis current</label><span class="blx-entry-input-wrap"><input id="blx-entry-cursor" data-blx-entry-cursor type="number" inputmode="decimal" min="0" max="${state.rawInputs.ioutMax}" step="any" value="${state.cursor}"${state.errors.cursor ? ' aria-invalid="true" aria-describedby="blx-entry-cursor-error"' : ""}><span>A</span></span><small>Sets the operating point shown when the workspace opens.</small>${state.errors.cursor ? `<small class="blx-entry-error" id="blx-entry-cursor-error">${escapeHtml(state.errors.cursor)}</small>` : ""}</div>
    </div>`;
}

function deviceMetrics(template) {
  const values = [
    `${template.voltageClass} V`,
    template.technology === "gan" ? "GaN" : "silicon",
    Number.isFinite(template.values.rdsHigh) ? `${displayNumber(template.values.rdsHigh)} mΩ` : null,
    Number.isFinite(template.values.qgHigh) ? `${displayNumber(template.values.qgHigh)} nC QG` : null
  ].filter(Boolean);
  return values.join(" · ");
}

function deviceChoiceMarkup(state, template) {
  const selected = template.id === state.deviceId;
  const seeded = template.id === DEFAULT_DEVICE_ID;
  return `<label class="blx-entry-device-choice" data-selected="${selected}">
    <input type="radio" name="blx-entry-device" value="${template.id}" data-blx-entry-device${selected ? " checked" : ""}>
    <span><strong>${escapeHtml(template.label)}</strong><small>${escapeHtml(deviceMetrics(template))}</small>${seeded ? "<em>Broad voltage headroom; complete seeded example.</em>" : ""}</span>
  </label>`;
}

function switchMarkup(state) {
  const eligible = BUCK_LOSS_DEVICE_TEMPLATES_V2.filter((template) => template.voltageClass >= Number(state.rawInputs.vin));
  const manufacturer = eligible.filter((template) => template.catalogKind === "manufacturer");
  const examples = eligible.filter((template) => template.catalogKind !== "manufacturer");
  const error = state.errors.device || "";
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">2 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Choose a switch pair</h1><p>Only devices rated for the ${displayNumber(state.rawInputs.vin)} V input are shown. Template values stay editable in later steps.</p><span class="blx-entry-context">${displayNumber(state.rawInputs.vin)} V → ${displayNumber(state.rawInputs.vout)} V · ${displayNumber(state.rawInputs.ioutMax)} A max · ${displayNumber(state.rawInputs.fsw / 1000)} MHz</span></header>
    ${error ? `<p class="blx-entry-form-error" role="alert">${escapeHtml(error)}</p>` : ""}
    <fieldset class="blx-entry-choice-group"><legend>Manufacturer-sourced</legend><div class="blx-entry-device-grid">${manufacturer.map((template) => deviceChoiceMarkup(state, template)).join("")}</div></fieldset>
    <fieldset class="blx-entry-choice-group"><legend>Example FETs</legend><div class="blx-entry-device-grid blx-entry-device-grid-compact">${examples.map((template) => deviceChoiceMarkup(state, template)).join("")}</div></fieldset>
    <aside class="blx-entry-explainer"><strong>What changes with this choice</strong><p>Selecting a switch pair preloads device-specific loss models, gate-charge and gate-resistance assumptions, reverse-recovery or ZVS behavior, and source notes. You can override any of these later.</p></aside>`;
}

function gateConditionMarkup(state) {
  const diagnostics = state.conditioning?.diagnostics || {};
  const qgdConditionCopy = state.template?.conditionModel?.gateCharge?.qgdVoltage?.method
    ? "VIN changes QGD through the loaded CRSS curve"
    : "QGD stays at its source anchor unless you enter an override";
  const highLane = diagnostics.lanes?.high || {};
  const issues = [...(state.conditioning?.errors || []), ...(state.conditioning?.warnings || [])];
  const driveOutsideDomain = issues.some(({ code }) => code === "drive-outside-condition-domain");
  const plateauV = Number(highLane.plateauV);
  const driveHeadroomV = Number(state.rawInputs.vDrive) - plateauV;
  const transitionMetric = (edge) => {
    if (driveOutsideDomain) return "outside fitted domain";
    const effectiveValue = diagnostics[edge === "on" ? "effectiveTurnOnNs" : "effectiveTurnOffNs"];
    if (state.timingMode !== "derived" && Number.isFinite(effectiveValue)) {
      return `${displayNumber(effectiveValue)} ns`;
    }
    if (state.timingMode === "effective") return "unavailable";
    const gateResistanceKey = edge === "on" ? "gateResistanceOnHigh" : "gateResistanceOffHigh";
    const completeGatePath = ["qgs2High", "qgdHigh", "plateauHigh", gateResistanceKey]
      .every((key) => finiteInput(state.rawInputs[key]));
    return completeGatePath && driveHeadroomV > 0 ? "gate-charge path" : "unavailable";
  };
  const metrics = [
    ["RDS(on)", `${displayNumber(highLane.rdsOnMohm)} mΩ`],
    ["Total QG", `${displayNumber(highLane.totalGateChargeNc)} nC`],
    ["Miller plateau", `${displayNumber(plateauV)} V`],
    ["Drive headroom", `${displayNumber(driveHeadroomV)} V`],
    ["Turn-on overlap", transitionMetric("on")],
    ["Turn-off overlap", transitionMetric("off")]
  ];
  return `<aside class="blx-entry-condition-preview" data-blx-entry-condition-preview data-supported="${diagnostics.supported === true}">
    <div><strong>Resolved device model</strong><span>At I<sub>MAX</sub> = ${displayNumber(state.rawInputs.ioutMax)} A and V<sub>DRIVE</sub> = ${displayNumber(state.rawInputs.vDrive)} V</span></div>
    <dl>${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    <p>This preview uses I<sub>MAX</sub>; the live result resolves E<sub>ON</sub>/E<sub>OFF</sub> again at valley/peak current. ${escapeHtml(qgdConditionCopy)}, while the drive rail changes headroom, RDS(on), QG, and edge time. Auto values track those controls until you override them.</p>
    ${issues.length ? `<ul>${issues.map(({ message }) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>` : ""}
  </aside>`;
}

function gateMarkup(state) {
  const template = getBuckLossDeviceTemplateV2(state.deviceId);
  const error = state.errors.gate || "";
  const derived = ["qgs2High", "qgdHigh", "plateauHigh", "gateResistanceOnHigh", "gateResistanceOffHigh"];
  const effective = ["effectiveTurnOn", "effectiveTurnOff"];
  const advanced = state.timingMode === "derived" ? derived : state.timingMode === "effective" ? effective : [...derived, ...effective];
  const advancedHasError = advanced.some((key) => state.errors[key]);
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">3 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Review gate drive & switching</h1><p>${escapeHtml(template.label)} supplies the starting values. Keep the defaults or replace them with condition-matched data.</p></header>
    ${error ? `<p class="blx-entry-form-error" role="alert">${escapeHtml(error)}</p>` : ""}
    <div class="blx-entry-mode-row"><label for="blx-entry-timing-mode">Transition method</label><select id="blx-entry-timing-mode" data-blx-entry-timing-mode><option value="auto"${state.timingMode === "auto" ? " selected" : ""}>Automatic evidence hierarchy</option><option value="derived"${state.timingMode === "derived" ? " selected" : ""}>Force gate-charge derivation</option><option value="effective"${state.timingMode === "effective" ? " selected" : ""}>Force effective-time override</option></select><small>Automatic uses the best supported evidence and discloses any fallback in the results.</small></div>
    ${gateConditionMarkup(state)}
    <section class="blx-entry-subsection"><h2>Drive-coupled channel & charge</h2><div class="blx-entry-field-grid">${["vDrive", "rdsHigh", "rdsLow", "qgHigh", "qgLow"].map((key) => fieldMarkup(state, key)).join("")}</div></section>
    <details class="blx-entry-advanced"${advancedHasError ? " open" : ""}><summary>Review ${state.timingMode === "effective" ? "effective-time" : state.timingMode === "derived" ? "gate-charge" : "advanced transition"} values</summary><p>Only fields used by the selected evidence path are shown. Blank optional fields remain explicitly unavailable; they are never treated as zero.</p><div class="blx-entry-field-grid">${advanced.map((key) => fieldMarkup(state, key)).join("")}</div></details>`;
}

function timingMarkup(state) {
  const template = getBuckLossDeviceTemplateV2(state.deviceId);
  const reverseKeys = template.technology === "silicon" ? ["qrrRef", "qrrRefCurrent"] : [];
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">4 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Review timing & reverse conduction</h1><p>Confirm the dead-time and reverse-path assumptions that shape low-current and commutation loss.</p></header>
    <div class="blx-entry-field-grid">${["deadTime", "diodeVf", "reversePathResistance"].map((key) => fieldMarkup(state, key)).join("")}</div>
    <details class="blx-entry-advanced" open><summary>Edge-specific timing${template.technology === "silicon" ? " & recovery" : ""}</summary><p>${template.technology === "gan" ? "GaN uses third-quadrant reverse conduction and no reverse-recovery charge." : "Silicon recovery values use the selected template's disclosed reference conditions."}</p><div class="blx-entry-field-grid">${["deadTimeHighToLow", "deadTimeLowToHigh", ...reverseKeys].map((key) => fieldMarkup(state, key)).join("")}</div></details>`;
}

function catalogOptions(state) {
  if (!state.catalog) return "";
  return groupPartsBySeries(state.catalog.parts).map(({ series, parts }) => `<optgroup label="${escapeHtml(series)}">${parts.map((part) => `<option value="${part.base_part_number}"${state.selectedPart === part.base_part_number ? " selected" : ""}>${part.base_part_number} · ${displayNumber(part.inductance_uh)} µH</option>`).join("")}</optgroup>`).join("");
}

function selectedCatalogPart(state) {
  return state.catalog?.parts?.find((part) => part.base_part_number === state.selectedPart) || null;
}

function catalogMeta(state) {
  const part = selectedCatalogPart(state);
  if (!part) return state.catalogStatus === "error" ? state.catalogError : "Choose a characterized part or keep the manual values below.";
  const isat = selectIsat(part);
  return `${part.base_part_number} · ${displayNumber(part.inductance_uh)} µH · ${state.dcrMode} DCR ${displayNumber(dcrForMode(part, state.dcrMode))} mΩ${isat ? ` · ISAT ${displayNumber(isat.value)} A (${isat.dropPct}% drop)` : ""}`;
}

function magneticsMarkup(state) {
  const disabled = state.catalogStatus !== "ready";
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">5 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Choose magnetics</h1><p>Select a characterized Coilcraft inductor or keep a fully manual set of magnetic assumptions.</p></header>
    <div class="blx-entry-catalog" data-catalog-state="${state.catalogStatus}"><div><label for="blx-entry-part">Inductor source</label><select id="blx-entry-part" data-blx-entry-part${disabled ? " disabled" : ""}><option value="">Generic / manual</option>${catalogOptions(state)}</select></div><div><label for="blx-entry-dcr-mode">DCR corner</label><select id="blx-entry-dcr-mode" data-blx-entry-dcr-mode${!state.selectedPart ? " disabled" : ""}><option value="typ"${state.dcrMode === "typ" ? " selected" : ""}>Typical</option><option value="max"${state.dcrMode === "max" ? " selected" : ""}>Maximum</option></select></div><p>${escapeHtml(state.catalogStatus === "loading" ? "Loading manufacturer data…" : catalogMeta(state))}</p></div>
    <div class="blx-entry-field-grid">${STEP_KEYS.magnetics.map((key) => fieldMarkup(state, key, key === "inductorAcManual" ? "Added at every load point; blank leaves the residual unavailable." : "")).join("")}</div>`;
}

function controlMarkup(state) {
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">6 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Set capacitors & control</h1><p>Finish the fixed-loss and ripple-current assumptions before reviewing the model setup.</p></header>
    <div class="blx-entry-mode-row"><label for="blx-entry-control-mode">Low-current comparison</label><select id="blx-entry-control-mode" data-blx-entry-control-mode><option value="auto-dcm"${state.controlMode === "auto-dcm" ? " selected" : ""}>Automatic diode-emulation DCM</option><option value="forced-ccm"${state.controlMode === "forced-ccm" ? " selected" : ""}>Forced CCM comparison</option></select><small>Automatic mode stops low-side conduction at zero current; burst, PFM, and minimum-on-time behavior remain out of scope.</small></div>
    <section class="blx-entry-subsection"><h2>Capacitor ESR</h2><div class="blx-entry-field-grid">${["inputEsr", "esr"].map((key) => fieldMarkup(state, key)).join("")}</div></section>
    <section class="blx-entry-subsection"><h2>Controller bias</h2><div class="blx-entry-field-grid">${["iq", "vBias"].map((key) => fieldMarkup(state, key, key === "vBias" ? "Blank uses the input voltage." : "")).join("")}</div></section>`;
}

function reviewSummary(state) {
  const template = getBuckLossDeviceTemplateV2(state.deviceId);
  const highLane = state.conditioning?.diagnostics?.lanes?.high || {};
  return [
    ["Operating point", `${displayNumber(state.rawInputs.vin)} V → ${displayNumber(state.rawInputs.vout)} V · ${displayNumber(state.rawInputs.ioutMax)} A max · ${displayNumber(state.rawInputs.fsw / 1000)} MHz`, 0],
    ["Switch pair", `${template.label} · ${template.cornerLabel || template.cornerId}`, 1],
    ["Gate drive & timing", `${displayNumber(state.rawInputs.vDrive)} V drive · ${displayNumber(highLane.plateauV)} V plateau · ${displayNumber(highLane.rdsOnMohm)} mΩ RDS(on) · ${state.timingMode === "auto" ? "automatic evidence hierarchy" : state.timingMode}`, 2],
    ["Magnetics", state.selectedPart ? `${state.selectedPart} · ${displayNumber(state.rawInputs.inductance)} µH · ${state.dcrMode === "max" ? "maximum" : "typical"} DCR` : `Manual · ${displayNumber(state.rawInputs.inductance)} µH · ${displayNumber(state.rawInputs.dcr)} mΩ RDC`, 4],
    ["Capacitors & control", `${displayNumber(state.rawInputs.inputEsr)} mΩ input ESR · ${displayNumber(state.rawInputs.esr)} mΩ output ESR · ${state.controlMode === "auto-dcm" ? "automatic diode-emulation DCM" : "forced CCM"}`, 5]
  ];
}

function reviewMarkup(state) {
  const template = getBuckLossDeviceTemplateV2(state.deviceId);
  const qgdConditionCopy = template.conditionModel?.gateCharge?.qgdVoltage?.method
    ? "VIN changes QGD through the loaded CRSS curve"
    : "QGD stays at its source anchor unless you enter an override";
  const notices = [
    `Auto-calculated setup values are previewed at maximum load; live EON/EOFF re-resolve at valley/peak edge current. ${qgdConditionCopy}, while drive voltage changes gate headroom, RDS(on), total gate charge, and supported edge timing.`,
    "Transition loss may use a disclosed EPC AN030 phase-charge-scaled fallback when no condition-matched energy surface is available.",
    "This is a 25 °C analytical intuition model, not a part-level signoff tool."
  ];
  if (template.catalogKind !== "manufacturer") notices.unshift("The selected switch pair is a deterministic teaching fixture, not a vendor part recommendation.");
  return `<header class="blx-entry-step-head"><p class="blx-entry-step-count">7 of 7</p><h1 id="blx-entry-step-title" tabindex="-1">Review assumptions</h1><p>Check what the model will use before opening the loss explorer.</p></header>
    <div class="blx-entry-review-rows">${reviewSummary(state).map(([label, value, step]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span><button type="button" data-blx-entry-edit="${step}">Edit</button></div>`).join("")}</div>
    <aside class="blx-entry-coverage"><h2>Model coverage</h2><div>${notices.map((notice) => `<p>${escapeHtml(notice)}</p>`).join("")}</div></aside>`;
}

function stepMarkup(state) {
  return [conditionsMarkup, switchMarkup, gateMarkup, timingMarkup, magneticsMarkup, controlMarkup, reviewMarkup][state.step](state);
}

function wizardMarkup(state) {
  const current = STEPS[state.step];
  return `<div class="blx-entry-wizard" data-blx-entry-panel>
    ${progressMarkup(state.step)}
    <form class="blx-entry-form" data-blx-entry-form novalidate>
      <div class="blx-entry-step">${stepMarkup(state)}</div>
      <footer class="blx-entry-actions">
        <div>${state.step > 0 ? '<button type="button" class="blx-entry-back" data-blx-entry-back>Back</button>' : ""}</div>
        <div><button type="button" class="blx-entry-exit" data-blx-entry-exit>Exit setup</button><button type="submit" class="blx-entry-primary-action">${escapeHtml(current.action)}</button></div>
        ${state.step === STEPS.length - 1 ? '<small>All values remain editable in the workspace.</small>' : ""}
      </footer>
    </form>
  </div>`;
}

function fieldError(key, rawInputs) {
  const config = BUCK_LOSS_SCHEMA_V2[key];
  const value = rawInputs[key];
  if (value === null || value === undefined || value === "") return config.optional ? "" : "Enter a value.";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Enter a valid number.";
  if (number < config.min || number > config.max) return `Use ${config.min}–${config.max} ${config.unit}.`;
  return "";
}

function validateStep(state) {
  const step = STEPS[state.step].id;
  const errors = {};
  for (const key of STEP_KEYS[step] || []) {
    const error = fieldError(key, state.rawInputs);
    if (error) errors[key] = error;
  }
  if (step === "conditions") {
    if (Number(state.rawInputs.vout) >= Number(state.rawInputs.vin)) errors.conditions = "Output voltage must be below input voltage.";
    if (!Number.isFinite(Number(state.cursor)) || Number(state.cursor) < 0 || Number(state.cursor) > Number(state.rawInputs.ioutMax)) errors.cursor = "Keep analysis current between 0 A and maximum load.";
  }
  if (step === "switch") {
    const template = getBuckLossDeviceTemplateV2(state.deviceId);
    if (!template || template.voltageClass < Number(state.rawInputs.vin)) errors.device = "Choose a switch pair rated for this input voltage.";
  }
  if (step === "gate") {
    applyConditioningToDraft(state);
    const conditionErrors = state.conditioning?.errors || [];
    if (conditionErrors.length) {
      errors.gate = conditionErrors.map(({ message }) => message).join(" ");
      for (const conditionError of conditionErrors) {
        if (STEP_KEYS.gate.includes(conditionError.field)) errors[conditionError.field] = conditionError.message;
      }
    }
  }
  state.errors = errors;
  return Object.keys(errors).length === 0;
}

function firstInvalidStep(state) {
  applyConditioningToDraft(state);
  if (state.conditioning?.errors?.length) return STEPS.findIndex((step) => step.id === "gate");
  const validation = validateBuckLossInputsV2(normalizeBuckLossInputsV2(state.rawInputs).inputs);
  if (validation.valid) return null;
  const first = validation.errors[0];
  if (first === "vout-lt-vin") return 0;
  const stepId = FIELD_STEP.get(first) || "conditions";
  return STEPS.findIndex((step) => step.id === stepId);
}

function applyPresetToDraft(state, presetId) {
  const preset = getBuckLossPresetV2(presetId);
  if (!preset) return;
  const template = getBuckLossDeviceTemplateV2(state.deviceId) || getBuckLossDeviceTemplateV2(DEFAULT_DEVICE_ID);
  const applied = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...preset.rawInputs }, template.id);
  state.presetId = preset.id;
  state.rawInputs = cloneRaw(applied.rawInputs);
  state.cursor = preset.cursor;
  state.selectedPart = preset.inductorPart;
  state.dcrMode = preset.dcrMode;
  state.timingMode = applied.template.timingMode;
  state.customConditions = false;
  state.errors = {};
  applyConditioningToDraft(state);
}

function applyDeviceToDraft(state, deviceId) {
  const applied = applyBuckLossDeviceTemplateV2(state.rawInputs, deviceId);
  if (!applied.template) return;
  state.rawInputs = cloneRaw(applied.rawInputs);
  state.deviceId = applied.template.id;
  state.timingMode = applied.template.timingMode;
  state.errors = {};
  applyConditioningToDraft(state);
}

function applyCatalogPartToDraft(state, partNumber) {
  const part = state.catalog?.parts?.find((item) => item.base_part_number === partNumber) || null;
  if (!part) {
    state.selectedPart = null;
    return;
  }
  const dcr = dcrForMode(part, state.dcrMode);
  const isat = selectIsat(part);
  state.selectedPart = part.base_part_number;
  state.rawInputs.inductance = part.inductance_uh;
  if (Number.isFinite(dcr)) {
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
}

function setDraftInput(state, key, value) {
  state.rawInputs = updateBuckLossLinkedDraftInputV2(state.rawInputs, key, value);
  if (STEP_KEYS.conditions.includes(key)) state.customConditions = true;
  if (STEP_KEYS.magnetics.includes(key) && state.selectedPart) state.selectedPart = null;
  if (key === "ioutMax") state.cursor = Math.min(Number(state.cursor) || 0, Number(value) || 0);
  applyConditioningToDraft(state);
  delete state.errors[key];
}

function persistAndOpen(state) {
  const invalidStep = firstInvalidStep(state);
  if (invalidStep !== null) {
    state.step = invalidStep;
    if (invalidStep === STEPS.findIndex((step) => step.id === "gate")) {
      state.errors = { gate: state.conditioning.errors.map(({ message }) => message).join(" ") };
      for (const conditionError of state.conditioning.errors) {
        if (STEP_KEYS.gate.includes(conditionError.field)) state.errors[conditionError.field] = conditionError.message;
      }
    } else {
      state.errors = { conditions: "Review the highlighted values before opening the workspace." };
    }
    return false;
  }
  const query = serializeBuckLossUrlV2(stateForSerialization(state));
  rememberBuckLossQueryV2(query);
  try { localStorage.setItem(DEVICE_MEMORY_KEY, state.deviceId); } catch {}
  navigateWithinSite(`${window.location.pathname}?${query}`);
  return true;
}

function setupEntryController(root, options = {}) {
  let state = null;
  let catalogPromise = null;
  let catalogCache = null;
  let catalogFailed = false;
  let focusFrame = 0;
  let disposed = false;
  const animations = new Set();
  const presetFieldAnimations = new Set();
  const signal = options.signal;
  const trackAnimation = (animation) => {
    if (!animation) return animation;
    animations.add(animation);
    animation.finished?.catch(() => {}).finally(() => animations.delete(animation));
    return animation;
  };
  const cancelPresetFieldAnimations = () => {
    presetFieldAnimations.forEach((animation) => animation.cancel?.());
    presetFieldAnimations.clear();
  };
  const animatePresetFields = (fieldKeys = []) => {
    cancelPresetFieldAnimations();
    fieldKeys.forEach((key, index) => {
      const field = root.querySelector(`[data-blx-entry-field="${key}"]`);
      const animation = runAnimation(field, [
        { opacity: 0.72, transform: "translateY(2px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], {
        duration: 160,
        delay: index * 30,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)"
      });
      if (!animation) return;
      presetFieldAnimations.add(animation);
      trackAnimation(animation);
      animation.finished?.catch(() => {}).finally(() => {
        presetFieldAnimations.delete(animation);
        animation.cancel?.();
      });
    });
  };

  const beginCatalogLoad = () => {
    if (disposed || signal?.aborted) return Promise.resolve(null);
    if (catalogCache) {
      state.catalog = catalogCache;
      state.catalogStatus = "ready";
      if (state.selectedPart) applyCatalogPartToDraft(state, state.selectedPart);
      return Promise.resolve(catalogCache);
    }
    if (catalogFailed) {
      state.catalogStatus = "error";
      state.catalogError = "The catalog is unavailable; manual magnetic inputs remain editable.";
      return Promise.resolve(null);
    }
    if (catalogPromise) return catalogPromise;
    catalogPromise = loadCoilcraftCatalog(root.dataset.blxCatalogUrl, { signal })
      .then((catalog) => {
        if (disposed || signal?.aborted) return null;
        catalogCache = catalog;
        if (!state) return catalog;
        state.catalog = catalog;
        state.catalogStatus = "ready";
        if (state.selectedPart) applyCatalogPartToDraft(state, state.selectedPart);
        if (state.step === 4) renderWizard({ animate: false, focusHeading: false });
        return catalog;
      })
      .catch((error) => {
        if (disposed || signal?.aborted || error?.name === "AbortError") return null;
        catalogFailed = true;
        if (state) {
          state.catalogStatus = "error";
          state.catalogError = "The catalog is unavailable; manual magnetic inputs remain editable.";
          if (state.step === 4) renderWizard({ animate: false, focusHeading: false });
        }
        console.warn("Buck-loss setup catalog unavailable", error);
        return null;
      });
    return catalogPromise;
  };

  const renderGateway = ({ focus = false } = {}) => {
    if (disposed || signal?.aborted) return;
    cancelPresetFieldAnimations();
    state = null;
    root.dataset.blxEntry = "gateway";
    root.dataset.blxStatus = "ready";
    root.setAttribute("aria-busy", "false");
    const lastQuery = readLastBuckLossQueryV2();
    root.innerHTML = gatewayMarkup(lastQuery);
    const panel = root.querySelector("[data-blx-entry-panel]");
    trackAnimation(runAnimation(panel, [{ transform: "translateY(8px)" }, { transform: "translateY(0)" }], { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }));
    root.querySelector("[data-blx-entry-start]")?.addEventListener("click", () => {
      state = draftFromQuery(seedBuckLossQueryV2());
      beginCatalogLoad();
      renderWizard({ direction: 1 });
    });
    root.querySelector("[data-blx-entry-open]")?.addEventListener("click", () => {
      const query = readLastBuckLossQueryV2() || seedBuckLossQueryV2();
      rememberBuckLossQueryV2(query);
      try {
        const deviceId = parseBuckLossUrlV2(query).deviceId;
        if (deviceId) localStorage.setItem(DEVICE_MEMORY_KEY, deviceId);
      } catch {}
      navigateWithinSite(`${window.location.pathname}?${query}`);
    });
    if (focus) root.querySelector("[data-blx-entry-start]")?.focus();
  };

  const renderWizard = ({ direction = 0, animate = true, focusHeading = true, focusSelector = "", acknowledgeFields = [] } = {}) => {
    if (disposed || signal?.aborted || !state) return;
    cancelPresetFieldAnimations();
    root.dataset.blxEntry = "wizard";
    root.innerHTML = wizardMarkup(state);
    const panel = root.querySelector(".blx-entry-step");
    if (animate && direction) trackAnimation(runAnimation(panel, [{ transform: `translateX(${8 * direction}px)` }, { transform: "translateX(0)" }], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }));
    animatePresetFields(acknowledgeFields);

    const refreshConditioningUi = () => {
      const preview = root.querySelector("[data-blx-entry-condition-preview]");
      if (preview) preview.outerHTML = gateConditionMarkup(state);
      for (const key of CONDITIONED_DEVICE_KEYS) {
        const input = root.querySelector(`[data-blx-entry-input="${key}"]`);
        if (input && input !== document.activeElement) input.value = state.rawInputs[key] ?? "";
        const help = root.querySelector(`#blx-entry-${key}-help`);
        if (!help) continue;
        const helpText = conditioningHelp(state, key);
        const helpTextNode = help.querySelector(`[data-blx-entry-condition-help-text="${key}"]`);
        if (helpTextNode) helpTextNode.textContent = helpText;
        const provenance = state.rawInputs.__provenance?.[key] || "";
        const reset = help.querySelector(`[data-blx-entry-condition-reset="${key}"]`);
        if (reset) reset.hidden = !["entered", "url-entered"].includes(provenance);
      }
      if (!state.conditioning?.errors?.length && state.errors.gate) {
        delete state.errors.gate;
        root.querySelector(".blx-entry-form-error")?.remove();
      }
      for (const key of ["vBias", "rac", "deadTimeHighToLow", "deadTimeLowToHigh"]) {
        const linkedInput = root.querySelector(`[data-blx-entry-input="${key}"]`);
        if (!linkedInput || linkedInput === document.activeElement) continue;
        linkedInput.placeholder = automaticPlaceholder(state, key);
        if (key === "rac" && state.rawInputs.__provenance?.rac === "inferred-rac-equals-rdc") {
          linkedInput.value = state.rawInputs.rac ?? "";
        }
      }
    };

    root.querySelector("[data-blx-entry-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.step === STEPS.length - 1) {
        if (!persistAndOpen(state)) renderWizard({ direction: -1 });
        return;
      }
      if (!validateStep(state)) {
        renderWizard({ animate: false, focusHeading: false });
        root.querySelector('[aria-invalid="true"], [role="alert"]')?.focus?.();
        return;
      }
      state.step += 1;
      state.errors = {};
      renderWizard({ direction: 1 });
    });
    root.querySelector("[data-blx-entry-back]")?.addEventListener("click", () => {
      state.step = Math.max(0, state.step - 1);
      state.errors = {};
      renderWizard({ direction: -1 });
    });
    root.querySelector("[data-blx-entry-exit]")?.addEventListener("click", () => renderGateway({ focus: true }));
    root.querySelectorAll("[data-blx-entry-edit]").forEach((button) => button.addEventListener("click", () => {
      state.step = Number(button.dataset.blxEntryEdit);
      state.errors = {};
      renderWizard({ direction: -1 });
    }));
    root.querySelectorAll("[data-blx-entry-preset]").forEach((button) => button.addEventListener("click", () => {
      const previousValues = new Map(PRESET_ACKNOWLEDGEMENT_KEYS.map((key) => [
        key,
        key === "cursor" ? state.cursor : state.rawInputs[key]
      ]));
      applyPresetToDraft(state, button.dataset.blxEntryPreset);
      const changedFields = PRESET_ACKNOWLEDGEMENT_KEYS.filter((key) => !Object.is(
        previousValues.get(key),
        key === "cursor" ? state.cursor : state.rawInputs[key]
      ));
      renderWizard({
        animate: false,
        focusHeading: false,
        focusSelector: `[data-blx-entry-preset="${button.dataset.blxEntryPreset}"]`,
        acknowledgeFields: changedFields
      });
    }));
    root.querySelectorAll("[data-blx-entry-device]").forEach((input) => input.addEventListener("change", () => {
      applyDeviceToDraft(state, input.value);
      renderWizard({ animate: false, focusHeading: false, focusSelector: `[data-blx-entry-device][value="${input.value}"]` });
    }));
    root.querySelectorAll("[data-blx-entry-input]").forEach((input) => {
      const syncInput = () => {
        const key = input.dataset.blxEntryInput;
        setDraftInput(state, key, input.value);
        refreshConditioningUi();
        if (fieldError(key, state.rawInputs)) return;
        input.removeAttribute("aria-invalid");
        const errorId = `${input.id}-error`;
        const describedBy = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== errorId);
        if (describedBy.length) input.setAttribute("aria-describedby", describedBy.join(" "));
        else input.removeAttribute("aria-describedby");
        input.closest("[data-blx-entry-field]")?.querySelector(`#${errorId}`)?.remove();
        const conditionsValid = STEP_KEYS.conditions.every((conditionKey) => !fieldError(conditionKey, state.rawInputs))
          && Number(state.rawInputs.vout) < Number(state.rawInputs.vin);
        if (conditionsValid && state.errors.conditions) {
          delete state.errors.conditions;
          root.querySelector(".blx-entry-form-error")?.remove();
        }
      };
      input.addEventListener("input", syncInput);
      input.addEventListener("change", syncInput);
    });
    root.querySelector("[data-blx-entry-form]")?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-blx-entry-condition-reset]");
      if (!button) return;
      const key = button.dataset.blxEntryConditionReset;
      resetConditionedDraftField(state, key);
      delete state.errors.gate;
      delete state.errors[key];
      refreshConditioningUi();
      const input = root.querySelector(`[data-blx-entry-input="${key}"]`);
      if (input) {
        input.value = state.rawInputs[key] ?? "";
        input.removeAttribute("aria-invalid");
        const errorId = `${input.id}-error`;
        const describedBy = (input.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter((id) => id && id !== errorId);
        if (describedBy.length) input.setAttribute("aria-describedby", describedBy.join(" "));
        else input.removeAttribute("aria-describedby");
        input.closest("[data-blx-entry-field]")?.querySelector(`#${errorId}`)?.remove();
      }
      if (!state.conditioning?.errors?.length) root.querySelector(".blx-entry-form-error")?.remove();
      input?.focus();
    });
    const cursorInput = root.querySelector("[data-blx-entry-cursor]");
    if (cursorInput) {
      const syncCursor = (event) => {
        state.cursor = Number(event.currentTarget.value);
        delete state.errors.cursor;
        if (Number.isFinite(state.cursor) && state.cursor >= 0 && state.cursor <= Number(state.rawInputs.ioutMax)) {
          const input = event.currentTarget;
          input.removeAttribute("aria-invalid");
          const errorId = `${input.id}-error`;
          const describedBy = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== errorId);
          if (describedBy.length) input.setAttribute("aria-describedby", describedBy.join(" "));
          else input.removeAttribute("aria-describedby");
          input.closest("[data-blx-entry-field]")?.querySelector(`#${errorId}`)?.remove();
        }
      };
      cursorInput.addEventListener("input", syncCursor);
      cursorInput.addEventListener("change", syncCursor);
    }
    root.querySelector("[data-blx-entry-timing-mode]")?.addEventListener("change", (event) => {
      state.timingMode = event.currentTarget.value;
      renderWizard({ animate: false, focusHeading: false, focusSelector: "[data-blx-entry-timing-mode]" });
    });
    root.querySelector("[data-blx-entry-control-mode]")?.addEventListener("change", (event) => { state.controlMode = event.currentTarget.value; });
    root.querySelector("[data-blx-entry-part]")?.addEventListener("change", (event) => {
      applyCatalogPartToDraft(state, event.currentTarget.value);
      renderWizard({ animate: false, focusHeading: false, focusSelector: "[data-blx-entry-part]" });
    });
    root.querySelector("[data-blx-entry-dcr-mode]")?.addEventListener("change", (event) => {
      state.dcrMode = event.currentTarget.value === "max" ? "max" : "typ";
      applyCatalogPartToDraft(state, state.selectedPart);
      renderWizard({ animate: false, focusHeading: false, focusSelector: "[data-blx-entry-dcr-mode]" });
    });

    cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      if (disposed || signal?.aborted) return;
      if (focusSelector) root.querySelector(focusSelector)?.focus();
      else if (focusHeading) root.querySelector("#blx-entry-step-title")?.focus();
    });
  };

  return {
    renderGateway,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(focusFrame);
      cancelPresetFieldAnimations();
      animations.forEach((animation) => animation.cancel?.());
      animations.clear();
      try { root.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel()); } catch {}
    }
  };
}

export async function initBuckLossEntryV2(root, options = {}) {
  if (!root || root.dataset.blxInit === "entry-v2" || options.signal?.aborted) return;
  root.dataset.blxInit = "entry-v2";
  const lifecycle = new AbortController();
  const controller = setupEntryController(root, { signal: lifecycle.signal });
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    options.signal?.removeEventListener?.("abort", destroy);
    lifecycle.abort();
    controller.destroy();
  };
  root.blxDestroy = destroy;
  options.signal?.addEventListener("abort", destroy, { once: true });
  controller.renderGateway();
  window.addEventListener("pageshow", () => {
    if (!window.location.search) controller.renderGateway();
  }, { signal: lifecycle.signal });
}
