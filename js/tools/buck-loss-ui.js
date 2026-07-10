const moduleVersion = new URL(import.meta.url).searchParams.get("v");

function versionedModuleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (moduleVersion) url.searchParams.set("v", moduleVersion);
  return url.href;
}

const [
  { classifyRegime, computeLossPoint, normalizeInputs, validateInputs },
  { BUCK_LOSS_PRESETS, DEFAULT_PRESET_ID, getBuckLossPreset },
  { parseBuckLossUrl, serializeBuckLossUrl }
] = await Promise.all([
  import(versionedModuleUrl("./buck-loss-model.js")),
  import(versionedModuleUrl("./buck-loss-presets.js")),
  import(versionedModuleUrl("./buck-loss-url.js"))
]);

const PARAMS = {
  vin: { min: 1, max: 100, log: true, digits: 2, label: "Input voltage", unit: "V" },
  vout: { min: 0.3, max: 95, log: true, digits: 2, label: "Output voltage", unit: "V" },
  ioutMax: { min: 0.05, max: 60, log: true, digits: 2, label: "Maximum load current", unit: "A" },
  fsw: { min: 50, max: 6000, log: true, digits: 0, label: "Switching frequency", unit: "kHz" },
  inductance: { min: 0.1, max: 470, log: true, digits: 2, label: "Inductance", unit: "uH" },
  rdsHigh: { min: 0.1, max: 500, log: true, digits: 2, label: "High-side RDS(on)", unit: "mohm" },
  rdsLow: { min: 0.1, max: 500, log: true, digits: 2, label: "Low-side RDS(on)", unit: "mohm" },
  qgHigh: { min: 0, max: 100, log: false, digits: 1, label: "High-side gate charge", unit: "nC" },
  qgLow: { min: 0, max: 100, log: false, digits: 1, label: "Low-side gate charge", unit: "nC" },
  tOverlap: { min: 0, max: 200, log: false, digits: 1, label: "Switching overlap time", unit: "ns" },
  deadTime: { min: 0, max: 200, log: false, digits: 1, label: "Dead time per edge", unit: "ns" },
  diodeVf: { min: 0.2, max: 2.5, log: false, digits: 2, label: "Reverse path voltage", unit: "V" },
  dcr: { min: 0, max: 500, log: false, digits: 2, label: "Inductor DCR", unit: "mohm" },
  esr: { min: 0, max: 500, log: false, digits: 2, label: "Output capacitor ESR", unit: "mohm" },
  inductorIsat: { min: 0.1, max: 200, log: true, digits: 2, optional: true, label: "Inductor saturation current", unit: "A" },
  vDrive: { min: 2.5, max: 6, log: false, digits: 2, label: "Gate drive voltage", unit: "V" },
  iq: { min: 0, max: 20, log: false, digits: 2, label: "Quiescent current", unit: "mA" },
  vBias: { min: 1, max: 100, log: true, digits: 2, optional: true, label: "Bias voltage", unit: "V" },
  eossTotal: { min: 0, max: 5000, log: false, digits: 1, label: "Pair EOSS", unit: "nJ" },
  qrr: { min: 0, max: 500, log: false, digits: 1, label: "Reverse recovery charge", unit: "nC" }
};

const GROUPS = [
  ["fetConduction", "FET conduction", "--blx-cond"],
  ["inductorDcr", "Inductor DCR", "--blx-dcr"],
  ["switchingOverlap", "Switching overlap", "--blx-sw"],
  ["deadTime", "Dead time", "--blx-dead"],
  ["gateDrive", "Gate drive", "--blx-gate"],
  ["bias", "Controller bias", "--blx-bias"],
  ["rippleOther", "Capacitive + ESR", "--blx-other"]
];

const POINT_LOSSES = [
  ["condHigh", "High-side conduction", "--blx-cond", "fetConduction", (result) => result.losses.condHigh],
  ["condLow", "Low-side conduction", "--blx-cond", "fetConduction", (result) => result.losses.condLow],
  ["dcr", "Inductor copper (DCR)", "--blx-dcr", "inductorDcr", (result) => result.losses.dcr],
  ["switching", "Switching overlap", "--blx-sw", "switchingOverlap", (result) => result.losses.switching],
  ["deadTime", "Dead time", "--blx-dead", "deadTime", (result) => result.losses.deadTime],
  ["gate", "Gate drive", "--blx-gate", "gateDrive", (result) => result.losses.gate],
  ["bias", "Controller bias", "--blx-bias", "bias", (result) => result.losses.bias],
  ["rippleOther", "COSS, ESR & recovery", "--blx-other", "rippleOther", (result) => result.losses.esr + result.losses.eoss + result.losses.qrr]
];

const REGIME_COLOR_CLASS = {
  floor: "gate",
  gateDrive: "gate",
  bias: "bias",
  fetConduction: "cond",
  conduction: "cond",
  inductorDcr: "dcr",
  dcr: "dcr",
  switchingOverlap: "sw",
  switching: "sw",
  frequency: "sw",
  deadTime: "dead",
  rippleOther: "other",
  balanced: "cond"
};

const WARNING_COPY = {
  "forced-ccm": "The selected current is in forced CCM: inductor current reverses before the next cycle.",
  "high-ripple": "Inductor ripple exceeds 60% of the maximum load current.",
  isat: "Estimated peak inductor current exceeds the entered saturation current.",
  "high-loss": "Estimated loss exceeds delivered output power at this point.",
  "extreme-duty": "The ideal duty cycle is near the edge of the useful buck range."
};

const URL_NOTE_COPY = {
  "unknown-preset": "Unknown preset in the URL; the default EPC2090 example was loaded instead.",
  clamped: "Some URL values were outside the allowed range and were limited."
};

const SVG_NS = "http://www.w3.org/2000/svg";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cloneRaw(rawInputs) {
  return { ...rawInputs };
}

function readFinite(text) {
  const parsed = Number.parseFloat(String(text).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function dynamicMax(key, rawInputs) {
  if (key === "vout") return Math.max(PARAMS.vout.min, 0.95 * rawInputs.vin);
  return PARAMS[key].max;
}

function clampParam(key, value, rawInputs) {
  const param = PARAMS[key];
  if (param.optional && (value === "" || value === null || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return param.optional ? null : param.min;
  return clamp(number, param.min, dynamicMax(key, rawInputs));
}

function clampStaticParam(key, value) {
  const param = PARAMS[key];
  if (param.optional && (value === "" || value === null || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return param.optional ? null : param.min;
  return clamp(number, param.min, param.max);
}

function enforceBuck(rawInputs, editedKey) {
  const cap = 0.95 * rawInputs.vin;
  if (rawInputs.vout <= cap) return false;
  if (editedKey === "vout") {
    rawInputs.vin = clamp(rawInputs.vout / 0.95, PARAMS.vin.min, PARAMS.vin.max);
    rawInputs.vout = Math.min(rawInputs.vout, 0.95 * rawInputs.vin);
  } else {
    rawInputs.vout = cap;
  }
  return true;
}

function displayNumber(value, digits) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const fixed = Number(value).toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function eng(value, unit = "") {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.001) return `${Number((value * 1e6).toPrecision(3))} µ${unit}`;
  if (abs > 0 && abs < 1) return `${Number((value * 1e3).toPrecision(3))} m${unit}`;
  return `${Number(value.toPrecision(3))} ${unit}`.trim();
}

function formatCurrent(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${Number((value * 1000).toPrecision(3))} mA`;
  return `${Number(value.toPrecision(3))} A`;
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : "—";
}

function signed(value, digits = 1, suffix = "") {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}${suffix}`;
}

function ariaPower(value) {
  if (!Number.isFinite(value)) return "unknown loss";
  if (value > 0 && value < 0.001) return `${Number((value * 1e6).toPrecision(3))} microwatts`;
  if (value > 0 && value < 1) return `${Number((value * 1e3).toPrecision(3))} milliwatts`;
  return `${Number(value.toPrecision(3))} watts`;
}

function regimeLabel(regime) {
  const labels = {
    invalid: "Invalid",
    floor: "Fixed-loss floor",
    fetConduction: "FET conduction",
    inductorDcr: "Inductor DCR",
    switchingOverlap: "Switching",
    deadTime: "Dead time",
    gateDrive: "Gate drive",
    bias: "Controller bias",
    rippleOther: "Capacitive terms",
    conduction: "Conduction limited",
    frequency: "Frequency limited",
    balanced: "Balanced"
  };
  return labels[regime] ?? "Balanced";
}

function setText(root, key, value) {
  root.querySelectorAll(`[data-blx-out="${key}"]`).forEach((node) => {
    const changed = node.textContent !== value;
    node.textContent = value;
    if (!changed || root.dataset.blxStatus !== "ready" || root.dataset.blxAnimateValues !== "true" || prefersReducedMotion()) return;
    node.classList.remove("blx-value-swap");
    void node.offsetWidth;
    node.classList.add("blx-value-swap");
  });
}

function makeControlMap(root, attr) {
  const map = new Map();
  root.querySelectorAll(`[${attr}]`).forEach((node) => {
    const key = node.getAttribute(attr);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  });
  return map;
}

function svgEl(name, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

function svgPath(points) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const ratio = value / base;
  const nice = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
  return nice * base;
}

function lossTickLabel(value) {
  if (value === 0) return "0";
  if (value < 1) return `${Number((value * 1000).toPrecision(2))} mW`;
  return `${Number(value.toPrecision(2))} W`;
}

function currentTickLabel(value) {
  if (value < 1) return `${Number((value * 1000).toPrecision(2))}m`;
  return `${Number(value.toPrecision(3))}`;
}

function isCompact() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function linearSweep(inputs, { points = 180, iMin = 0, iMax = inputs.ioutMax } = {}) {
  const count = Math.max(2, Math.floor(points));
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return computeLossPoint(inputs, iMin + (iMax - iMin) * t);
  });
}

function canonicalQuery(state) {
  return serializeBuckLossUrl({
    rawInputs: state.rawInputs,
    cursor: state.cursor,
    activePresetId: state.activePresetId,
    explicitOptional: state.explicitOptional
  });
}

function canonicalHref(state) {
  const query = canonicalQuery(state);
  if (typeof window === "undefined") return query ? `?${query}` : "";
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
}

function updateCopyUrl(root, state) {
  const input = root.querySelector("[data-blx-copy-url]");
  if (input) input.value = canonicalHref(state);
}

function scheduleUrlReplace(root, state) {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  updateCopyUrl(root, state);
  clearTimeout(state.urlTimer);
  state.urlTimer = setTimeout(() => {
    state.urlTimer = 0;
    const query = canonicalQuery(state);
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(null, "", nextUrl);
  }, 320);
}

async function copyCanonicalUrl(root, state, triggerButton = null) {
  const input = root.querySelector("[data-blx-copy-url]");
  const href = canonicalHref(state);
  if (input) input.value = href;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(href);
    } else if (input) {
      input.focus();
      input.select();
      document.execCommand("copy");
    }
  } catch {
    if (input) {
      input.focus();
      input.select();
      document.execCommand("copy");
    }
  }
  if (triggerButton) {
    const original = triggerButton.textContent;
    triggerButton.textContent = "Copied";
    clearTimeout(triggerButton.blxCopyTimer);
    triggerButton.blxCopyTimer = setTimeout(() => {
      triggerButton.textContent = original;
    }, 1400);
  }
}

function accordionDuration(detail) {
  const raw = window.getComputedStyle(detail).getPropertyValue("--blx-motion");
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 240;
  return String(raw).trim().endsWith("ms") ? parsed : parsed * 1000;
}

function setAccordionOpen(detail, open, options = {}) {
  const summary = detail.querySelector("summary");
  const panel = detail.querySelector(".blx-detail-panel");
  clearTimeout(detail.blxAccordionTimer);
  if (open) {
    detail.open = true;
    summary?.setAttribute("aria-expanded", "true");
    if (options.immediate || prefersReducedMotion()) {
      detail.dataset.open = "true";
    } else {
      detail.dataset.open = "false";
      requestAnimationFrame(() => {
        if (detail.open) detail.dataset.open = "true";
      });
    }
    return;
  }
  summary?.setAttribute("aria-expanded", "false");
  detail.dataset.open = "false";
  if (options.immediate || prefersReducedMotion() || !panel) {
    detail.open = false;
    return;
  }
  detail.blxAccordionTimer = setTimeout(() => {
    if (detail.dataset.open !== "true") detail.open = false;
  }, accordionDuration(detail) + 70);
}

function initAdvancedAccordions(root) {
  root.querySelectorAll(".blx-advanced details").forEach((detail, index) => {
    if (detail.dataset.blxAccInit === "true") return;
    const summary = detail.querySelector("summary");
    const panel = detail.querySelector(".blx-detail-panel");
    if (!summary || !panel) return;
    detail.dataset.blxAccInit = "true";
    if (!panel.id) panel.id = `${root.id || "buck-loss-explorer"}-advanced-${index}`;
    summary.setAttribute("aria-controls", panel.id);
    setAccordionOpen(detail, detail.open, { immediate: true });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      setAccordionOpen(detail, detail.dataset.open !== "true");
    });
  });
}

function renderPrompt(root, state) {
  const prompt = root.querySelector("[data-blx-prompt]");
  if (!prompt) return;
  const preset = state.activePresetId ? getBuckLossPreset(state.activePresetId) : null;
  prompt.textContent = preset ? preset.prompt : "Custom operating point. Change one assumption at a time to see what moves.";
}

function renderTryChips(root, state) {
  const holder = root.querySelector("[data-blx-try]");
  if (!holder) return;
  holder.replaceChildren();
  const label = document.createElement("span");
  label.textContent = "Quick changes";
  holder.appendChild(label);
  [
    ["half-fsw", "½ fSW"],
    ["lower-rds", "½ RDS(on)"],
    ["add-eoss", "2× EOSS"]
  ].forEach(([id, text]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.blxTry = id;
    button.textContent = text;
    holder.appendChild(button);
  });
  if (state.undoTry) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.dataset.blxTryUndo = "true";
    undo.textContent = "Undo";
    holder.appendChild(undo);
  }
}

function renderSentence(root, classification) {
  const node = root.querySelector('[data-blx-out="sentence"]');
  if (!node) return;
  if (!classification || classification.regime === "invalid") {
    node.textContent = "Adjust VIN, VOUT, switching frequency, inductance, and the current limit to return to a valid operating point.";
    return;
  }
  const chipKey = REGIME_COLOR_CLASS[classification.regime] || "cond";
  node.replaceChildren();
  const chip = document.createElement("span");
  chip.className = "blx-regime-chip";
  const dot = document.createElement("i");
  dot.style.setProperty("--chip-color", `var(--blx-${chipKey})`);
  dot.setAttribute("aria-hidden", "true");
  chip.append(dot, document.createTextNode(regimeLabel(classification.regime)));
  node.append(chip, document.createTextNode(classification.sentence));
}

function renderWarnings(root, result, validation, state) {
  const box = root.querySelector("[data-blx-warnings]");
  if (!box) return;
  const notes = (state.urlNotes || []).map((entry) => URL_NOTE_COPY[entry.code] || entry.message || entry.code);
  if (state.inputNote) notes.push(state.inputNote);
  if (!validation.valid) {
    notes.push("Check the inputs: VIN must exceed VOUT, and frequency, inductance, and the current limit must be positive.");
  } else if (result?.valid) {
    result.warnings.forEach((code) => notes.push(WARNING_COPY[code] || code));
  }
  const shown = [...new Set(notes)];
  const key = shown.join("\n");
  if (box.dataset.blxWarningsCache === key) return;
  box.dataset.blxWarningsCache = key;
  box.replaceChildren();
  shown.forEach((text) => {
    const note = document.createElement("p");
    note.className = "blx-note";
    note.textContent = text;
    box.appendChild(note);
  });
}

function referenceResult(state) {
  if (!state.reference) return null;
  const inputs = normalizeInputs(state.reference.rawInputs);
  const result = computeLossPoint(inputs, state.reference.cursor);
  return result.valid ? result : null;
}

function renderBreakdown(root, result, state) {
  const list = root.querySelector("[data-blx-breakdown-list]");
  if (!list) return;
  list.replaceChildren();
  if (!result?.valid || !(result.pLoss > 0)) return;

  const held = referenceResult(state);
  const items = POINT_LOSSES.map(([key, label, token, groupKey, read]) => ({
    key,
    label,
    token,
    groupKey,
    value: read(result),
    referenceValue: held ? read(held) : null
  })).sort((a, b) => b.value - a.value);
  const maxValue = Math.max(0.000001, ...items.flatMap((item) => [item.value, item.referenceValue || 0]));

  items.forEach((item) => {
    const row = document.createElement("li");
    row.className = "blx-loss-row";
    row.tabIndex = 0;
    row.dataset.blxLossKey = item.groupKey;
    row.dataset.active = root.dataset.blxHighlight === item.groupKey ? "true" : "false";
    row.setAttribute("aria-label", `${item.label}: ${ariaPower(item.value)}, ${(100 * item.value / result.pLoss).toFixed(1)} percent of loss`);
    row.style.setProperty("--blx-loss-color", `var(${item.token})`);

    const label = document.createElement("span");
    label.className = "blx-loss-label";
    const dot = document.createElement("i");
    dot.setAttribute("aria-hidden", "true");
    label.append(dot, document.createTextNode(item.label));

    const track = document.createElement("span");
    track.className = "blx-loss-track";
    const bar = document.createElement("span");
    bar.className = "blx-loss-bar";
    bar.style.setProperty("--blx-loss-width", `${Math.max(0.4, 100 * item.value / maxValue)}%`);
    track.appendChild(bar);
    if (item.referenceValue !== null) {
      const marker = document.createElement("span");
      marker.className = "blx-reference-marker";
      marker.style.setProperty("--blx-reference-left", `${clamp(100 * item.referenceValue / maxValue, 0, 100)}%`);
      marker.title = `Held reference: ${eng(item.referenceValue, "W")}`;
      track.appendChild(marker);
    }

    const value = document.createElement("span");
    value.className = "blx-loss-value";
    value.append(document.createTextNode(eng(item.value, "W")));
    const share = document.createElement("small");
    share.textContent = `${(100 * item.value / result.pLoss).toFixed(1)}%`;
    value.appendChild(share);
    row.append(label, track, value);
    list.appendChild(row);
  });
}

function renderPowerBalance(root, result) {
  const holder = root.querySelector("[data-blx-power-balance]");
  if (!holder) return;
  holder.replaceChildren();
  if (!result?.valid || !(result.pInEstimated > 0)) return;
  const outputShare = clamp(result.pOut / result.pInEstimated, 0, 1);
  const output = document.createElement("div");
  output.className = "blx-power-output";
  output.style.setProperty("--blx-output-width", `${Math.max(18, 100 * outputShare)}%`);
  output.innerHTML = `<span>Output power</span><strong>${eng(result.pOut, "W")}</strong>`;
  const loss = document.createElement("div");
  loss.className = "blx-power-loss";
  loss.innerHTML = `<span>Losses</span><strong>${eng(result.pLoss, "W")}</strong>`;
  holder.append(output, loss);
}

function renderOperatingMetrics(root, result) {
  const holder = root.querySelector("[data-blx-operating-metrics]");
  if (!holder) return;
  holder.replaceChildren();
  if (!result?.valid) return;
  [
    ["Duty cycle", `${(100 * result.core.D).toFixed(1)}%`],
    ["Ripple (pk–pk)", formatCurrent(result.core.deltaIL)],
    ["Inductor peak", formatCurrent(result.core.iPeak)],
    ["Inductor RMS", formatCurrent(Math.sqrt(result.core.iLrms2))]
  ].forEach(([label, value]) => {
    const metric = document.createElement("div");
    metric.className = "blx-operating-metric";
    metric.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    holder.appendChild(metric);
  });
}

function renderReferenceState(root, result, state) {
  const held = referenceResult(state);
  root.querySelectorAll("[data-blx-reference]").forEach((button) => {
    button.dataset.active = held ? "true" : "false";
    button.querySelector("span").textContent = held ? "Clear reference" : "Hold reference";
    button.setAttribute("aria-pressed", held ? "true" : "false");
  });
  const summary = root.querySelector("[data-blx-reference-summary]");
  if (!summary) return;
  if (!held || !result?.valid) {
    summary.textContent = "";
    return;
  }
  const efficiencyDelta = 100 * (result.efficiency - held.efficiency);
  const lossDelta = result.pLoss - held.pLoss;
  summary.textContent = `Held: ${percent(held.efficiency)} at ${formatCurrent(state.reference.cursor)} · ${signed(efficiencyDelta, 1, " pp")} efficiency · ${signed(lossDelta * 1000, 1, " mW")} loss`;
}

function chartGeometry(kind) {
  const compact = isCompact();
  const width = compact ? 360 : 780;
  const height = kind === "efficiency" ? (compact ? 190 : 218) : (compact ? 215 : 246);
  const left = compact ? 42 : 54;
  const right = compact ? 12 : 18;
  const top = kind === "efficiency" ? 16 : 24;
  const bottom = height - (compact ? 34 : 39);
  return { compact, width, height, left, right, top, bottom, plotWidth: width - left - right, plotHeight: bottom - top };
}

function appendAxes(svg, geometry, yTicks, xMax, yScale, yFormatter) {
  const { left, top, bottom, plotWidth, plotHeight, compact } = geometry;
  yTicks.forEach((value) => {
    const y = yScale(value);
    svg.append(
      svgEl("line", { class: "blx-svg-grid", x1: left, y1: y, x2: left + plotWidth, y2: y, "stroke-width": 1, opacity: value === 0 ? 0.8 : 0.45 }),
      svgEl("text", { class: "blx-svg-label", x: left - 8, y: y + 3.5, "font-size": compact ? 9 : 10.5, "text-anchor": "end" }, yFormatter(value))
    );
  });
  [0, 0.25, 0.5, 0.75, 1].forEach((fraction) => {
    const x = left + fraction * plotWidth;
    svg.append(
      svgEl("line", { class: "blx-svg-grid", x1: x, y1: top, x2: x, y2: bottom, "stroke-width": 1, opacity: fraction === 0 ? 0.7 : 0.25 }),
      svgEl("text", { class: "blx-svg-label", x, y: bottom + (compact ? 17 : 20), "font-size": compact ? 9 : 10.5, "text-anchor": "middle" }, currentTickLabel(xMax * fraction))
    );
  });
  svg.append(svgEl("text", { class: "blx-svg-label", x: left + plotWidth, y: bottom + (compact ? 29 : 33), "font-size": compact ? 8.5 : 9.5, "text-anchor": "end" }, "load current (A)"));
}

function appendCursor(svg, geometry, state, plot, labelText) {
  const { left, top, bottom, plotWidth, plotHeight, compact } = geometry;
  const x = plot.xScale(state.cursor);
  const y = plot.yScale(plot.valueAt(state.cursor));
  const labelWidth = compact ? 61 : 68;
  const labelX = clamp(x + 7, left + 2, left + plotWidth - labelWidth - 2);
  const labelY = top + 6;
  const cursor = svgEl("line", { "data-blx-chart-cursor": plot.kind, class: "blx-svg-cursor", x1: x, y1: top, x2: x, y2: bottom, "stroke-width": 1.2, "pointer-events": "none" });
  const dot = svgEl("circle", { "data-blx-chart-dot": plot.kind, class: "blx-svg-dot", cx: x, cy: y, r: compact ? 3.6 : 4.2, "stroke-width": 1.8, "pointer-events": "none" });
  const labelBg = svgEl("rect", { "data-blx-chart-label-bg": plot.kind, class: "blx-svg-cursor-label-bg", x: labelX, y: labelY, width: labelWidth, height: 19, rx: 5, "stroke-width": 1, "pointer-events": "none" });
  const label = svgEl("text", { "data-blx-chart-label": plot.kind, class: "blx-svg-cursor-label", x: labelX + 6, y: labelY + 13, "font-size": compact ? 9 : 10, "pointer-events": "none" }, labelText);
  const surface = svgEl("rect", { "data-blx-across-surface": plot.kind, x: left, y: top, width: plotWidth, height: plotHeight, fill: "transparent", "pointer-events": "all" });
  surface.style.cursor = "ew-resize";
  surface.style.touchAction = "pan-y";
  svg.append(surface, cursor, dot, labelBg, label);
  return surface;
}

function clientXToSvgX(svg, clientX) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = 0;
  return point.matrixTransform(svg.getScreenCTM().inverse()).x;
}

function attachAcrossPointer(root, state, surface, plot) {
  let dragging = false;
  let pointerId = null;
  const currentFromEvent = (event) => {
    const x = clientXToSvgX(surface.ownerSVGElement, event.clientX);
    const fraction = clamp((x - plot.geometry.left) / plot.geometry.plotWidth, 0, 1);
    return fraction * state.inputs.ioutMax;
  };
  const update = (event, announce = false) => {
    state.cursor = currentFromEvent(event);
    updateCursorReadouts(root, state, { announce });
  };
  surface.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    pointerId = event.pointerId;
    surface.setPointerCapture(pointerId);
    update(event);
  });
  surface.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    update(event);
  });
  const finish = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    update(event, true);
    scheduleUrlReplace(root, state);
  };
  surface.addEventListener("pointerup", finish);
  surface.addEventListener("pointercancel", finish);
}

function referenceSweep(state) {
  if (!state.reference) return [];
  const inputs = normalizeInputs(state.reference.rawInputs);
  if (!validateInputs(inputs).valid) return [];
  return linearSweep(inputs, { points: state.sweep.length || 180, iMin: 0, iMax: state.inputs.ioutMax }).filter((point) => point.valid);
}

function renderEfficiencyChart(root, state) {
  const holder = root.querySelector("[data-blx-efficiency-plot]");
  if (!holder) return;
  holder.replaceChildren();
  if (!state.validation.valid || !state.sweep.length) return;
  const geometry = chartGeometry("efficiency");
  const { width, height, left, plotWidth, bottom, top } = geometry;
  const xScale = (current) => left + clamp(current / state.inputs.ioutMax, 0, 1) * plotWidth;
  const yScale = (efficiency) => bottom - clamp(efficiency, 0, 1) * geometry.plotHeight;
  const valueAt = (current) => computeLossPoint(state.inputs, current).efficiency;
  const plot = { kind: "efficiency", geometry, xScale, yScale, valueAt };
  state.acrossPlots.efficiency = plot;
  const titleId = `${state.instanceId}-efficiency-title`;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-labelledby": titleId });
  svg.append(svgEl("title", { id: titleId }, "Efficiency versus load current"));
  appendAxes(svg, geometry, [0, 0.25, 0.5, 0.75, 1], state.inputs.ioutMax, yScale, (value) => `${Math.round(value * 100)}%`);
  const heldSweep = referenceSweep(state);
  if (heldSweep.length) {
    svg.append(svgEl("path", { d: svgPath(heldSweep.map((point) => [xScale(point.iout), yScale(point.efficiency)])), class: "blx-svg-line blx-svg-reference", fill: "none", "stroke-width": 1.4 }));
  }
  svg.append(svgEl("path", { d: svgPath(state.sweep.map((point) => [xScale(point.iout), yScale(point.efficiency)])), class: "blx-svg-line blx-svg-efficiency", fill: "none", "stroke-width": 2.2 }));
  const surface = appendCursor(svg, geometry, state, plot, formatCurrent(state.cursor));
  holder.appendChild(svg);
  attachAcrossPointer(root, state, surface, plot);
}

function renderLossChart(root, state) {
  const holder = root.querySelector("[data-blx-loss-plot]");
  if (!holder) return;
  holder.replaceChildren();
  if (!state.validation.valid || !state.sweep.length) return;
  const geometry = chartGeometry("loss");
  const { width, height, left, plotWidth, bottom } = geometry;
  const maxLoss = niceCeil(1.08 * Math.max(...state.sweep.map((point) => point.pLoss), 0.001));
  const xScale = (current) => left + clamp(current / state.inputs.ioutMax, 0, 1) * plotWidth;
  const yScale = (loss) => bottom - clamp(loss / maxLoss, 0, 1) * geometry.plotHeight;
  const valueAt = (current) => computeLossPoint(state.inputs, current).pLoss;
  const plot = { kind: "loss", geometry, xScale, yScale, valueAt, maxLoss };
  state.acrossPlots.loss = plot;
  const rankedGroups = GROUPS.map((group) => ({
    group,
    peak: Math.max(...state.sweep.map((point) => point.groupedLosses[group[0]]))
  })).sort((a, b) => b.peak - a.peak);
  const topGroups = rankedGroups.slice(0, 3).map((entry) => entry.group);
  state.topGroups = topGroups;
  const titleId = `${state.instanceId}-loss-title`;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-labelledby": titleId });
  svg.append(svgEl("title", { id: titleId }, "Total loss and largest contributors versus load current"));
  appendAxes(svg, geometry, [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * maxLoss), state.inputs.ioutMax, yScale, lossTickLabel);
  const heldSweep = referenceSweep(state);
  if (heldSweep.length) {
    svg.append(svgEl("path", { d: svgPath(heldSweep.map((point) => [xScale(point.iout), yScale(point.pLoss)])), class: "blx-svg-line blx-svg-reference", fill: "none", "stroke-width": 1.4 }));
  }
  topGroups.forEach(([key, , token]) => {
    const path = svgEl("path", {
      d: svgPath(state.sweep.map((point) => [xScale(point.iout), yScale(point.groupedLosses[key])])),
      class: "blx-svg-line blx-svg-contributor",
      "data-blx-series": key,
      fill: "none",
      stroke: `var(${token})`,
      "stroke-width": 1.55
    });
    svg.appendChild(path);
  });
  svg.append(svgEl("path", { d: svgPath(state.sweep.map((point) => [xScale(point.iout), yScale(point.pLoss)])), class: "blx-svg-line blx-svg-total", fill: "none", "stroke-width": 2.25 }));
  const surface = appendCursor(svg, geometry, state, plot, formatCurrent(state.cursor));
  holder.appendChild(svg);
  attachAcrossPointer(root, state, surface, plot);
  renderLegend(root, topGroups);
}

function renderLegend(root, topGroups = []) {
  const holder = root.querySelector("[data-blx-legend]");
  if (!holder) return;
  holder.replaceChildren();
  const total = document.createElement("span");
  total.className = "blx-chart-key blx-total-key";
  total.innerHTML = "<i aria-hidden=\"true\"></i>Total loss";
  holder.appendChild(total);
  topGroups.forEach(([key, label, token]) => {
    const item = document.createElement("span");
    item.className = "blx-chart-key";
    item.dataset.blxLossKey = key;
    item.style.setProperty("--blx-loss-color", `var(${token})`);
    item.innerHTML = `<i aria-hidden="true"></i>${label}`;
    holder.appendChild(item);
  });
}

function updateAcrossCursor(root, state, result) {
  Object.values(state.acrossPlots || {}).forEach((plot) => {
    const holder = root.querySelector(`[data-blx-${plot.kind === "efficiency" ? "efficiency" : "loss"}-plot]`);
    const svg = holder?.querySelector("svg");
    if (!svg) return;
    const x = plot.xScale(state.cursor);
    const y = plot.yScale(plot.valueAt(state.cursor));
    const line = svg.querySelector(`[data-blx-chart-cursor="${plot.kind}"]`);
    const dot = svg.querySelector(`[data-blx-chart-dot="${plot.kind}"]`);
    const label = svg.querySelector(`[data-blx-chart-label="${plot.kind}"]`);
    const labelBg = svg.querySelector(`[data-blx-chart-label-bg="${plot.kind}"]`);
    const width = plot.geometry.compact ? 61 : 68;
    const labelX = clamp(x + 7, plot.geometry.left + 2, plot.geometry.left + plot.geometry.plotWidth - width - 2);
    if (line) {
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
    }
    if (dot) {
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
    }
    if (label && labelBg) {
      label.textContent = formatCurrent(state.cursor);
      label.setAttribute("x", labelX + 6);
      labelBg.setAttribute("x", labelX);
    }
  });
  const efficiency = root.querySelector("[data-blx-across-efficiency]");
  const loss = root.querySelector("[data-blx-across-loss]");
  if (efficiency) efficiency.textContent = `${percent(result.efficiency)} at ${formatCurrent(state.cursor)}`;
  if (loss) loss.textContent = `${eng(result.pLoss, "W")} at ${formatCurrent(state.cursor)}`;
}

function syncCursorControl(root, state, result = null) {
  const input = root.querySelector("[data-blx-cursor-input]");
  if (!input) return;
  const max = Math.max(0.001, state.rawInputs.ioutMax);
  input.min = "0";
  input.max = String(max);
  input.step = String(max / 1000);
  input.value = String(clamp(state.cursor, 0, max));
  input.setAttribute("aria-valuemin", "0");
  input.setAttribute("aria-valuemax", String(max));
  input.setAttribute("aria-valuenow", String(state.cursor));
  input.setAttribute("aria-valuetext", result?.valid ? `${formatCurrent(state.cursor)}, ${percent(result.efficiency)} efficiency, ${ariaPower(result.pLoss)} loss` : formatCurrent(state.cursor));
}

function announce(root, result, state) {
  const live = root.querySelector("[data-blx-live]");
  if (!live || !result?.valid) return;
  live.textContent = `${formatCurrent(state.cursor)}, ${(100 * result.efficiency).toFixed(1)} percent efficiency, ${ariaPower(result.pLoss)} loss`;
}

function updateCursorReadouts(root, state, options = {}) {
  root.dataset.blxAnimateValues = options.animate ? "true" : "false";
  const result = computeLossPoint(state.inputs, state.cursor);
  const valid = state.validation.valid && result.valid;
  root.classList.toggle("blx-invalid", !valid);
  syncCursorControl(root, state, result);
  updateCopyUrl(root, state);
  if (!valid) {
    ["current", "current-caption", "efficiency", "loss", "pout", "pin", "loss-total"].forEach((key) => setText(root, key, "—"));
    setText(root, "regime", "Invalid");
    renderBreakdown(root, null, state);
    renderPowerBalance(root, null);
    renderOperatingMetrics(root, null);
    renderReferenceState(root, null, state);
    renderSentence(root, null);
    renderWarnings(root, result, state.validation, state);
    return result;
  }
  const classification = classifyRegime(result, state.inputs);
  setText(root, "current", formatCurrent(state.cursor));
  setText(root, "current-caption", formatCurrent(state.cursor));
  setText(root, "efficiency", percent(result.efficiency));
  setText(root, "loss", eng(result.pLoss, "W"));
  setText(root, "loss-total", `Total ${eng(result.pLoss, "W")}`);
  setText(root, "pout", eng(result.pOut, "W"));
  setText(root, "pin", eng(result.pInEstimated, "W"));
  setText(root, "regime", regimeLabel(classification.regime));
  renderBreakdown(root, result, state);
  renderPowerBalance(root, result);
  renderOperatingMetrics(root, result);
  renderReferenceState(root, result, state);
  renderSentence(root, classification);
  renderWarnings(root, result, state.validation, state);
  updateAcrossCursor(root, state, result);
  if (options.announce) announce(root, result, state);
  return result;
}

function updatePresetButtons(root, activePresetId) {
  root.querySelectorAll("[data-blx-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.blxPreset === activePresetId ? "true" : "false");
  });
}

function controlValueText(key, value) {
  const param = PARAMS[key];
  if (param.optional && value === null) return `${param.label}: none`;
  return `${param.label}: ${displayNumber(value, param.digits)} ${param.unit}`;
}

function toSlider(key, value, rawInputs) {
  const param = PARAMS[key];
  const max = dynamicMax(key, rawInputs);
  const safe = param.optional && value === null ? param.min : clamp(value, param.min, max);
  if (param.log) return Math.round(1000 * Math.log(safe / param.min) / Math.log(max / param.min));
  return Math.round(1000 * (safe - param.min) / (max - param.min));
}

function fromSlider(key, sliderValue, rawInputs) {
  const param = PARAMS[key];
  const fraction = Number(sliderValue) / 1000;
  const max = dynamicMax(key, rawInputs);
  return param.log ? param.min * Math.pow(max / param.min, fraction) : param.min + fraction * (max - param.min);
}

function syncControls(state, numberControls, rangeControls, options = {}) {
  Object.keys(PARAMS).forEach((key) => {
    const param = PARAMS[key];
    const value = state.rawInputs[key];
    (numberControls.get(key) || []).forEach((input) => {
      input.min = String(param.min);
      input.max = String(dynamicMax(key, state.rawInputs));
      if (!options.force && document.activeElement === input) return;
      input.value = param.optional && value === null ? "" : displayNumber(value, param.digits);
    });
    (rangeControls.get(key) || []).forEach((input) => {
      if (!options.force && document.activeElement === input) return;
      input.value = String(toSlider(key, value, state.rawInputs));
      input.setAttribute("aria-valuetext", controlValueText(key, value));
    });
  });
}

function markCustom(state) {
  state.activePresetId = null;
  state.urlNotes = [];
  state.inputNote = null;
}

function clampCursorToRange(state) {
  state.cursor = clamp(state.cursor, 0, state.rawInputs.ioutMax);
}

function render(root, state, options = {}) {
  state.inputs = normalizeInputs(state.rawInputs);
  state.validation = validateInputs(state.inputs);
  clampCursorToRange(state);
  state.sweep = state.validation.valid
    ? linearSweep(state.inputs, { points: 180, iMin: 0, iMax: state.inputs.ioutMax }).filter((point) => point.valid)
    : [];
  state.acrossPlots = {};
  updatePresetButtons(root, state.activePresetId);
  renderPrompt(root, state);
  renderTryChips(root, state);
  renderEfficiencyChart(root, state);
  renderLossChart(root, state);
  updateCursorReadouts(root, state, { announce: options.announce, animate: options.animate !== false });
}

function scheduleRender(root, state, options = {}) {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => {
    state.renderTimer = 0;
    render(root, state, options);
    if (options.updateUrl) scheduleUrlReplace(root, state);
  }, options.immediate ? 0 : 90);
}

function commitNumberInput(root, state, key, input) {
  const text = input.value.trim();
  let inputNote = "";
  if (PARAMS[key].optional && text === "") {
    state.rawInputs[key] = null;
    state.explicitOptional[key] = false;
  } else {
    const parsed = readFinite(text);
    if (parsed === null) {
      syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
      return;
    }
    const clamped = clampStaticParam(key, parsed);
    state.rawInputs[key] = clamped;
    if (clamped !== parsed) inputNote = `${PARAMS[key].label} was limited to ${displayNumber(clamped, PARAMS[key].digits)} ${PARAMS[key].unit}.`;
    if (PARAMS[key].optional) state.explicitOptional[key] = true;
  }
  markCustom(state);
  if (enforceBuck(state.rawInputs, key) && !inputNote) {
    inputNote = key === "vout" ? "Input voltage was adjusted to preserve buck headroom." : "Output voltage was adjusted to preserve buck headroom.";
  }
  state.inputNote = inputNote || null;
  clampCursorToRange(state);
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  scheduleRender(root, state, { updateUrl: true, announce: true });
}

function liveNumberInput(root, state, key, input) {
  const text = input.value.trim();
  if (PARAMS[key].optional && text === "") {
    state.rawInputs[key] = null;
    state.explicitOptional[key] = false;
  } else {
    const parsed = readFinite(text);
    if (parsed === null) return;
    state.rawInputs[key] = clampStaticParam(key, parsed);
    if (PARAMS[key].optional) state.explicitOptional[key] = true;
  }
  markCustom(state);
  clampCursorToRange(state);
  syncControls(state, root.blxNumberControls, root.blxRangeControls);
  scheduleRender(root, state, { updateUrl: true, announce: true });
}

function applyPreset(root, state, preset, options = {}) {
  state.rawInputs = cloneRaw(preset.rawInputs);
  state.cursor = preset.cursor;
  state.activePresetId = preset.id;
  state.explicitOptional = { vBias: false, inductorIsat: false };
  state.urlNotes = [];
  state.inputNote = null;
  state.undoTry = null;
  if (options.clearReference) state.reference = null;
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  render(root, state, { announce: true });
  scheduleUrlReplace(root, state);
}

function applyTryChip(root, state, actionId) {
  state.undoTry = {
    rawInputs: cloneRaw(state.rawInputs),
    cursor: state.cursor,
    activePresetId: state.activePresetId,
    explicitOptional: { ...state.explicitOptional }
  };
  markCustom(state);
  if (actionId === "half-fsw") {
    state.rawInputs.fsw = clampStaticParam("fsw", state.rawInputs.fsw / 2);
  } else if (actionId === "lower-rds") {
    state.rawInputs.rdsHigh = clampStaticParam("rdsHigh", state.rawInputs.rdsHigh / 2);
    state.rawInputs.rdsLow = clampStaticParam("rdsLow", state.rawInputs.rdsLow / 2);
  } else if (actionId === "add-eoss") {
    state.rawInputs.eossTotal = state.rawInputs.eossTotal > 0 ? clampStaticParam("eossTotal", state.rawInputs.eossTotal * 2) : 50;
  }
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  render(root, state, { announce: true });
  scheduleUrlReplace(root, state);
}

function undoTryChip(root, state) {
  if (!state.undoTry) return;
  state.rawInputs = cloneRaw(state.undoTry.rawInputs);
  state.cursor = state.undoTry.cursor;
  state.activePresetId = state.undoTry.activePresetId;
  state.explicitOptional = { ...state.undoTry.explicitOptional };
  state.urlNotes = [];
  state.inputNote = null;
  state.undoTry = null;
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  render(root, state, { announce: true });
  scheduleUrlReplace(root, state);
}

function setView(root, state, view, options = {}) {
  if (view !== "point" && view !== "load") return;
  state.view = view;
  root.querySelector(".blx-view-tabs")?.setAttribute("data-active-view", view);
  root.querySelectorAll("[data-blx-view]").forEach((tab) => {
    const active = tab.dataset.blxView === view;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll("[data-blx-view-panel]").forEach((panel) => {
    const active = panel.dataset.blxViewPanel === view;
    panel.hidden = !active;
    panel.classList.remove("blx-panel-enter");
    if (active && !options.immediate && !prefersReducedMotion()) {
      requestAnimationFrame(() => panel.classList.add("blx-panel-enter"));
    }
  });
  if (options.focus) root.querySelector(`[data-blx-view="${view}"]`)?.focus();
}

function initViewTabs(root, state) {
  const tabs = [...root.querySelectorAll("[data-blx-view]")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(root, state, tab.dataset.blxView));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      setView(root, state, next.dataset.blxView, { focus: true });
    });
  });
  setView(root, state, state.view, { immediate: true });
}

function initInputDisclosure(root) {
  const disclosure = root.querySelector(".blx-input-disclosure");
  if (!disclosure || typeof window === "undefined") return;
  const mobile = window.matchMedia("(max-width: 700px)");
  disclosure.open = !mobile.matches;
  const sync = (event) => {
    disclosure.open = !event.matches;
  };
  mobile.addEventListener?.("change", sync);
}

function initLossHighlighting(root, state) {
  const setHighlight = (key) => {
    if (key) root.dataset.blxHighlight = key;
    else delete root.dataset.blxHighlight;
    root.querySelectorAll("[data-blx-loss-key]").forEach((node) => {
      if (node.classList.contains("blx-loss-row")) node.dataset.active = key && node.dataset.blxLossKey === key ? "true" : "false";
    });
  };
  root.addEventListener("pointerover", (event) => {
    const target = event.target.closest("[data-blx-loss-key]");
    if (target) setHighlight(target.dataset.blxLossKey);
  });
  root.addEventListener("pointerout", (event) => {
    const target = event.target.closest("[data-blx-loss-key]");
    if (!target || target.contains(event.relatedTarget)) return;
    setHighlight(state.pinnedHighlight);
  });
  root.addEventListener("focusin", (event) => {
    const target = event.target.closest("[data-blx-loss-key]");
    if (target) setHighlight(target.dataset.blxLossKey);
  });
  root.addEventListener("focusout", (event) => {
    const target = event.target.closest("[data-blx-loss-key]");
    if (!target || target.contains(event.relatedTarget)) return;
    setHighlight(state.pinnedHighlight);
  });
}

export function initBuckLossExplorer(root) {
  if (!root || root.dataset.blxInit === "true") return;
  root.dataset.blxInit = "true";
  const parsed = parseBuckLossUrl(typeof window === "undefined" ? "" : window.location.search);
  const state = {
    rawInputs: cloneRaw(parsed.rawInputs),
    cursor: parsed.cursor,
    activePresetId: parsed.activePresetId,
    explicitOptional: { ...parsed.explicitOptional },
    urlNotes: parsed.notes,
    inputNote: null,
    undoTry: null,
    reference: null,
    view: "point",
    showAllLosses: false,
    pinnedHighlight: null,
    instanceId: `blx-${Math.random().toString(36).slice(2)}`,
    renderTimer: 0,
    urlTimer: 0,
    inputs: normalizeInputs(parsed.rawInputs),
    validation: { valid: true, errors: [] },
    sweep: [],
    acrossPlots: {},
    topGroups: []
  };

  const numberControls = makeControlMap(root, "data-blx-number");
  const rangeControls = makeControlMap(root, "data-blx-range");
  root.blxNumberControls = numberControls;
  root.blxRangeControls = rangeControls;
  initAdvancedAccordions(root);
  initInputDisclosure(root);
  initViewTabs(root, state);
  initLossHighlighting(root, state);

  root.querySelectorAll("[data-blx-presets]").forEach((holder) => {
    holder.innerHTML = "<span>Presets:</span>";
    BUCK_LOSS_PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.blxPreset = preset.id;
      button.setAttribute("aria-pressed", preset.id === state.activePresetId ? "true" : "false");
      button.textContent = preset.name;
      button.addEventListener("click", () => applyPreset(root, state, preset));
      holder.appendChild(button);
    });
  });

  Object.keys(PARAMS).forEach((key) => {
    (rangeControls.get(key) || []).forEach((range) => {
      range.addEventListener("input", () => {
        state.rawInputs[key] = clampParam(key, fromSlider(key, range.value, state.rawInputs), state.rawInputs);
        if (PARAMS[key].optional) state.explicitOptional[key] = true;
        markCustom(state);
        state.undoTry = null;
        enforceBuck(state.rawInputs, key);
        clampCursorToRange(state);
        range.setAttribute("aria-valuetext", controlValueText(key, state.rawInputs[key]));
        syncControls(state, numberControls, rangeControls);
        scheduleRender(root, state, { updateUrl: true, announce: true });
      });
    });
    (numberControls.get(key) || []).forEach((input) => {
      input.addEventListener("input", () => {
        state.undoTry = null;
        liveNumberInput(root, state, key, input);
      });
      input.addEventListener("change", () => commitNumberInput(root, state, key, input));
      input.addEventListener("blur", () => commitNumberInput(root, state, key, input));
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitNumberInput(root, state, key, input);
      });
    });
  });

  const cursorInput = root.querySelector("[data-blx-cursor-input]");
  cursorInput?.addEventListener("keydown", (event) => {
    const directionByKey = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -10,
      PageUp: 10
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      state.cursor = event.key === "Home" ? 0 : state.rawInputs.ioutMax;
    } else if (event.key in directionByKey) {
      event.preventDefault();
      const multiplier = directionByKey[event.key] * (event.shiftKey ? 10 : 1);
      state.cursor = clamp(state.cursor + (state.rawInputs.ioutMax / 100) * multiplier, 0, state.rawInputs.ioutMax);
    } else {
      return;
    }
    updateCursorReadouts(root, state, { announce: true });
    scheduleUrlReplace(root, state);
  });
  cursorInput?.addEventListener("input", () => {
    state.cursor = clamp(Number(cursorInput.value), 0, state.rawInputs.ioutMax);
    updateCursorReadouts(root, state);
    scheduleUrlReplace(root, state);
  });
  cursorInput?.addEventListener("change", () => updateCursorReadouts(root, state, { announce: true }));

  root.querySelector("[data-blx-try]")?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.blxTryUndo) undoTryChip(root, state);
    else if (button.dataset.blxTry) applyTryChip(root, state, button.dataset.blxTry);
  });

  root.querySelector("[data-blx-reset]")?.addEventListener("click", () => {
    const preset = getBuckLossPreset(DEFAULT_PRESET_ID);
    if (preset) applyPreset(root, state, preset, { clearReference: true });
  });

  root.querySelector("[data-blx-show-all]")?.addEventListener("click", (event) => {
    state.showAllLosses = !state.showAllLosses;
    root.classList.toggle("blx-show-all-losses", state.showAllLosses);
    event.currentTarget.setAttribute("aria-expanded", state.showAllLosses ? "true" : "false");
    event.currentTarget.textContent = state.showAllLosses ? "Show fewer losses" : "Show all losses";
  });

  root.querySelectorAll("[data-blx-reference]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.reference) {
        state.reference = null;
      } else {
        state.reference = { rawInputs: cloneRaw(state.rawInputs), cursor: state.cursor };
      }
      render(root, state, { announce: true });
    });
  });

  root.querySelectorAll("[data-blx-copy]").forEach((button) => {
    button.addEventListener("click", () => copyCanonicalUrl(root, state, button));
  });

  if (typeof window !== "undefined") {
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render(root, state), 120);
    });
    window.addEventListener("popstate", () => {
      const next = parseBuckLossUrl(window.location.search);
      state.rawInputs = cloneRaw(next.rawInputs);
      state.cursor = next.cursor;
      state.activePresetId = next.activePresetId;
      state.explicitOptional = { ...next.explicitOptional };
      state.urlNotes = next.notes;
      state.inputNote = null;
      state.undoTry = null;
      syncControls(state, numberControls, rangeControls, { force: true });
      render(root, state, { announce: true });
    });
  }

  syncControls(state, numberControls, rangeControls);
  render(root, state, { animate: false });
  root.dataset.blxStatus = "ready";
  root.setAttribute("aria-busy", "false");
}
