import { classifyRegime, computeLossPoint, normalizeInputs, validateInputs } from "./buck-loss-model.js";
import { BUCK_LOSS_PRESETS, DEFAULT_PRESET_ID, getBuckLossPreset } from "./buck-loss-presets.js";

const PARAMS = {
  vin: { min: 1, max: 100, log: true, digits: 2 },
  vout: { min: 0.3, max: 95, log: true, digits: 2 },
  ioutMax: { min: 0.05, max: 60, log: true, digits: 2 },
  fsw: { min: 50, max: 6000, log: true, digits: 0 },
  inductance: { min: 0.1, max: 470, log: true, digits: 2 },
  rdsHigh: { min: 0.1, max: 500, log: true, digits: 2 },
  rdsLow: { min: 0.1, max: 500, log: true, digits: 2 },
  qgHigh: { min: 0, max: 100, log: false, digits: 1 },
  qgLow: { min: 0, max: 100, log: false, digits: 1 },
  tOverlap: { min: 0, max: 200, log: false, digits: 1 },
  deadTime: { min: 0, max: 200, log: false, digits: 1 },
  diodeVf: { min: 0.2, max: 1.2, log: false, digits: 2 },
  dcr: { min: 0, max: 500, log: false, digits: 2 },
  esr: { min: 0, max: 500, log: false, digits: 2 },
  inductorIsat: { min: 0.1, max: 200, log: true, digits: 2, optional: true },
  vDrive: { min: 2.5, max: 12, log: false, digits: 2 },
  iq: { min: 0, max: 20, log: false, digits: 2 },
  vBias: { min: 1, max: 100, log: true, digits: 2, optional: true },
  eossTotal: { min: 0, max: 1000, log: false, digits: 1 },
  qrr: { min: 0, max: 500, log: false, digits: 1 }
};

const TICKS = {
  vin: [[5, "5"], [12, "12"], [24, "24"], [48, "48"]],
  vout: [[0.8, "0.8"], [1.8, "1.8"], [3.3, "3.3"], [5, "5"], [12, "12"]],
  ioutMax: [[0.1, "0.1"], [0.5, "0.5"], [3, "3"], [10, "10"], [30, "30"]],
  fsw: [[100, "100"], [300, "300"], [1000, "1M"], [3000, "3M"]],
  inductance: [[0.47, "0.47"], [1, "1"], [2.2, "2.2"], [4.7, "4.7"], [10, "10"], [47, "47"]]
};

const GROUPS = [
  ["fetConduction", "FET conduction", "--blx-cond"],
  ["inductorDcr", "Inductor DCR", "--blx-dcr"],
  ["switchingOverlap", "Switching overlap", "--blx-sw"],
  ["deadTime", "Dead time", "--blx-dead"],
  ["gateDrive", "Gate drive", "--blx-gate"],
  ["bias", "Bias", "--blx-bias"],
  ["rippleOther", "ESR, EOSS, Qrr", "--blx-other"]
];

const WARNING_COPY = {
  "forced-ccm": "The cursor is in forced CCM: the inductor current reverses before the next cycle.",
  "high-ripple": "Inductor ripple exceeds 60% of the selected maximum load current.",
  isat: "The estimated peak inductor current is above the entered saturation current.",
  "high-loss": "Estimated loss exceeds delivered output power at this point.",
  "extreme-duty": "The ideal duty cycle is near an edge of the useful buck range."
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cloneRaw(rawInputs) {
  return { ...rawInputs };
}

function toSlider(key, value) {
  const param = PARAMS[key];
  const safeValue = param.optional && value === null ? param.min : clamp(value, param.min, dynamicMax(key));
  if (param.log) {
    return Math.round(1000 * Math.log(safeValue / param.min) / Math.log(dynamicMax(key) / param.min));
  }
  return Math.round(1000 * (safeValue - param.min) / (dynamicMax(key) - param.min));
}

function fromSlider(key, sliderValue) {
  const param = PARAMS[key];
  const f = Number(sliderValue) / 1000;
  const max = dynamicMax(key);
  return param.log ? param.min * Math.pow(max / param.min, f) : param.min + f * (max - param.min);
}

let activeRawInputsForRanges = null;

function dynamicMax(key) {
  if (key === "vout" && activeRawInputsForRanges) return Math.max(PARAMS.vout.min, 0.95 * activeRawInputsForRanges.vin);
  return PARAMS[key].max;
}

function clampParam(key, value) {
  const param = PARAMS[key];
  if (param.optional && (value === "" || value === null || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return param.optional ? null : param.min;
  return clamp(number, param.min, dynamicMax(key));
}

function enforceBuck(rawInputs, editedKey) {
  const cap = 0.95 * rawInputs.vin;
  if (rawInputs.vout <= cap) return;
  if (editedKey === "vout") {
    rawInputs.vin = clamp(rawInputs.vout / 0.95, PARAMS.vin.min, PARAMS.vin.max);
    rawInputs.vout = Math.min(rawInputs.vout, 0.95 * rawInputs.vin);
  } else {
    rawInputs.vout = cap;
  }
}

function displayNumber(value, digits) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

function eng(value, unit = "") {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs > 0 && abs < 1) return `${(value * 1000).toPrecision(3)} m${unit}`;
  return `${value.toPrecision(3)} ${unit}`.trim();
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)} %` : "—";
}

function regimeLabel(regime) {
  const labels = {
    invalid: "Invalid",
    floor: "Floor",
    fetConduction: "FET conduction",
    inductorDcr: "DCR",
    switchingOverlap: "Switching",
    deadTime: "Dead time",
    gateDrive: "Gate drive",
    bias: "Bias",
    rippleOther: "Ripple terms",
    conduction: "Conduction",
    frequency: "Frequency",
    balanced: "Balanced"
  };
  return labels[regime] ?? "Balanced";
}

function getColor(root, token, fallback) {
  const styles = getComputedStyle(root);
  return styles.getPropertyValue(token).trim() || fallback;
}

function colorFor(root, token) {
  const fallback = {
    "--blx-cond": "#276f86",
    "--blx-dcr": "#4f7d5d",
    "--blx-sw": "#a2653c",
    "--blx-dead": "#9b7c3a",
    "--blx-gate": "#7a6a9e",
    "--blx-bias": "#66707a",
    "--blx-other": "#b0b7bd",
    "--blx-eff": "#1f2328"
  }[token];
  return getColor(root, token, fallback);
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

function setText(root, key, value) {
  const node = root.querySelector(`[data-blx-out="${key}"]`);
  if (node) node.textContent = value;
}

function updatePresetButtons(root, activePresetId) {
  root.querySelectorAll("[data-blx-preset]").forEach((button) => {
    const active = button.getAttribute("data-blx-preset") === activePresetId;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function syncControls(state, numberControls, rangeControls) {
  activeRawInputsForRanges = state.rawInputs;
  Object.keys(PARAMS).forEach((key) => {
    const param = PARAMS[key];
    const value = state.rawInputs[key];
    (numberControls.get(key) || []).forEach((input) => {
      input.value = param.optional && value === null ? "" : displayNumber(value, param.digits);
    });
    (rangeControls.get(key) || []).forEach((input) => {
      input.value = toSlider(key, value);
    });
  });
}

function renderBreakdown(root, result) {
  const list = root.querySelector("[data-blx-breakdown-list]");
  const bar = root.querySelector("[data-blx-breakdown-bar]");
  if (!list || !bar) return;

  if (!result.valid || !(result.pLoss > 0)) {
    list.innerHTML = GROUPS.map(([, label]) => `<li><span>${label}</span><span>—</span><span>—</span></li>`).join("");
    bar.innerHTML = "";
    return;
  }

  bar.innerHTML = "";
  GROUPS.forEach(([key, label, token]) => {
    const value = result.groupedLosses[key];
    const share = result.pLoss > 0 ? value / result.pLoss : 0;
    const part = document.createElement("span");
    part.style.width = `${Math.max(0, 100 * share)}%`;
    part.style.background = colorFor(root, token);
    part.title = `${label}: ${eng(value, "W")}`;
    bar.appendChild(part);
  });

  list.innerHTML = GROUPS.map(([key, label]) => {
    const value = result.groupedLosses[key];
    const share = result.pLoss > 0 ? value / result.pLoss : 0;
    return `<li><span>${label}</span><span>${eng(value, "W")}</span><span>${(100 * share).toFixed(1)}%</span></li>`;
  }).join("");
}

function renderWarnings(root, result, validation) {
  const box = root.querySelector("[data-blx-warnings]");
  if (!box) return;
  const notes = [];
  if (!validation.valid) {
    notes.push("Check the input values: VIN must be above VOUT, and positive frequency, inductance, and current limits are required.");
  } else {
    result.warnings.forEach((code) => notes.push(WARNING_COPY[code] || code));
  }
  box.innerHTML = notes.map((text) => `<p class="blx-note blx-note-show">${text}</p>`).join("");
}

function renderPrompt(root, state) {
  const prompt = root.querySelector("[data-blx-prompt]");
  if (!prompt) return;
  const preset = state.activePresetId ? getBuckLossPreset(state.activePresetId) : null;
  prompt.textContent = preset ? preset.prompt : "Custom values. Use the knobs to see which loss family moves first.";
}

function render(root, state) {
  activeRawInputsForRanges = state.rawInputs;
  const inputs = normalizeInputs(state.rawInputs);
  const validation = validateInputs(inputs);
  const result = validation.valid ? computeLossPoint(inputs, state.cursor) : computeLossPoint(inputs, state.cursor);
  const classification = classifyRegime(result, inputs);

  root.classList.toggle("blx-invalid", !validation.valid || !result.valid);
  updatePresetButtons(root, state.activePresetId);
  renderPrompt(root, state);

  if (!validation.valid || !result.valid) {
    ["current", "efficiency", "loss", "pout"].forEach((key) => setText(root, key, "—"));
    setText(root, "regime", "Invalid");
    setText(root, "sentence", "Adjust VIN, VOUT, fSW, L, and the current limit to return to a valid buck operating point.");
    renderBreakdown(root, result);
    renderWarnings(root, result, validation);
    return;
  }

  setText(root, "current", eng(state.cursor, "A"));
  setText(root, "efficiency", percent(result.efficiency));
  setText(root, "loss", eng(result.pLoss, "W"));
  setText(root, "pout", eng(result.pOut, "W"));
  setText(root, "regime", regimeLabel(classification.regime));
  setText(root, "sentence", classification.sentence);
  renderBreakdown(root, result);
  renderWarnings(root, result, validation);
}

function buildTicks(root, state) {
  activeRawInputsForRanges = state.rawInputs;
  root.querySelectorAll("[data-blx-ticks]").forEach((row) => {
    const key = row.getAttribute("data-blx-ticks");
    row.innerHTML = "";
    (TICKS[key] || []).forEach(([value, label]) => {
      const max = key === "vout" ? 0.95 * state.rawInputs.vin : PARAMS[key].max;
      if (value < PARAMS[key].min || value > max) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "blx-tick";
      button.tabIndex = -1;
      button.textContent = label;
      button.style.left = `${toSlider(key, value) / 10}%`;
      button.setAttribute("aria-label", `Set ${key} to ${label}`);
      button.addEventListener("click", () => {
        state.rawInputs[key] = clampParam(key, value);
        state.activePresetId = null;
        enforceBuck(state.rawInputs, key);
        state.cursor = clamp(state.cursor, Math.max(state.rawInputs.ioutMax / 1000, 1e-3), state.rawInputs.ioutMax);
        syncControls(state, root.blxNumberControls, root.blxRangeControls);
        buildTicks(root, state);
        render(root, state);
      });
      row.appendChild(button);
    });
  });
}

export function initBuckLossExplorer(root) {
  if (!root || root.dataset.blxInit === "true") return;
  root.dataset.blxInit = "true";

  const defaultPreset = getBuckLossPreset(DEFAULT_PRESET_ID);
  const state = {
    rawInputs: cloneRaw(defaultPreset.rawInputs),
    cursor: defaultPreset.cursor,
    activePresetId: defaultPreset.id
  };

  const numberControls = makeControlMap(root, "data-blx-number");
  const rangeControls = makeControlMap(root, "data-blx-range");
  root.blxNumberControls = numberControls;
  root.blxRangeControls = rangeControls;

  root.querySelectorAll("[data-blx-presets]").forEach((holder) => {
    holder.innerHTML = '<span>Presets:</span>';
    BUCK_LOSS_PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-blx-preset", preset.id);
      button.setAttribute("aria-pressed", preset.id === state.activePresetId ? "true" : "false");
      button.textContent = preset.name;
      button.addEventListener("click", () => {
        state.rawInputs = cloneRaw(preset.rawInputs);
        state.cursor = preset.cursor;
        state.activePresetId = preset.id;
        syncControls(state, numberControls, rangeControls);
        buildTicks(root, state);
        render(root, state);
      });
      holder.appendChild(button);
    });
  });

  Object.keys(PARAMS).forEach((key) => {
    (rangeControls.get(key) || []).forEach((range) => {
      range.addEventListener("input", () => {
        activeRawInputsForRanges = state.rawInputs;
        state.rawInputs[key] = clampParam(key, fromSlider(key, range.value));
        state.activePresetId = null;
        enforceBuck(state.rawInputs, key);
        state.cursor = clamp(state.cursor, Math.max(state.rawInputs.ioutMax / 1000, 1e-3), state.rawInputs.ioutMax);
        syncControls(state, numberControls, rangeControls);
        buildTicks(root, state);
        render(root, state);
      });
    });

    (numberControls.get(key) || []).forEach((input) => {
      input.addEventListener("input", () => {
        activeRawInputsForRanges = state.rawInputs;
        if (PARAMS[key].optional && input.value.trim() === "") {
          state.rawInputs[key] = null;
        } else {
          state.rawInputs[key] = clampParam(key, input.value);
        }
        state.activePresetId = null;
        enforceBuck(state.rawInputs, key);
        state.cursor = clamp(state.cursor, Math.max(state.rawInputs.ioutMax / 1000, 1e-3), state.rawInputs.ioutMax);
        syncControls(state, numberControls, rangeControls);
        buildTicks(root, state);
        render(root, state);
      });
    });
  });

  buildTicks(root, state);
  syncControls(state, numberControls, rangeControls);
  render(root, state);
}
