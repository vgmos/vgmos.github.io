import { classifyRegime, computeLossPoint, normalizeInputs, validateInputs } from "./buck-loss-model.js";
import { BUCK_LOSS_PRESETS, getBuckLossPreset } from "./buck-loss-presets.js";
import { parseBuckLossUrl, serializeBuckLossUrl } from "./buck-loss-url.js";

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
  diodeVf: { min: 0.2, max: 1.2, log: false, digits: 2, label: "Diode path forward voltage", unit: "V" },
  dcr: { min: 0, max: 500, log: false, digits: 2, label: "Inductor DCR", unit: "mohm" },
  esr: { min: 0, max: 500, log: false, digits: 2, label: "Output capacitor ESR", unit: "mohm" },
  inductorIsat: { min: 0.1, max: 200, log: true, digits: 2, optional: true, label: "Inductor saturation current", unit: "A" },
  vDrive: { min: 2.5, max: 12, log: false, digits: 2, label: "Gate drive voltage", unit: "V" },
  iq: { min: 0, max: 20, log: false, digits: 2, label: "Quiescent current", unit: "mA" },
  vBias: { min: 1, max: 100, log: true, digits: 2, optional: true, label: "Bias voltage", unit: "V" },
  eossTotal: { min: 0, max: 1000, log: false, digits: 1, label: "Total EOSS", unit: "nJ" },
  qrr: { min: 0, max: 500, log: false, digits: 1, label: "Reverse recovery charge", unit: "nC" }
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

const REGIME_COLOR_CLASS = {
  floor: "gateDrive",
  gateDrive: "gateDrive",
  bias: "bias",
  fetConduction: "fetConduction",
  conduction: "fetConduction",
  inductorDcr: "inductorDcr",
  dcr: "inductorDcr",
  switchingOverlap: "switchingOverlap",
  switching: "switchingOverlap",
  frequency: "switchingOverlap",
  deadTime: "deadTime",
  rippleOther: "rippleOther",
  balanced: "fetConduction"
};

const SVG_NS = "http://www.w3.org/2000/svg";

const WARNING_COPY = {
  "forced-ccm": "The cursor is in forced CCM: the inductor current reverses before the next cycle.",
  "high-ripple": "Inductor ripple exceeds 60% of the selected maximum load current.",
  isat: "The estimated peak inductor current is above the entered saturation current.",
  "high-loss": "Estimated loss exceeds delivered output power at this point.",
  "extreme-duty": "The ideal duty cycle is near an edge of the useful buck range."
};

const URL_NOTE_COPY = {
  "unknown-preset": "Unknown preset in the URL; loaded the default example instead.",
  clamped: "Some URL values were outside the allowed range and were clamped."
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

function clampStaticParam(key, value) {
  const param = PARAMS[key];
  if (param.optional && (value === "" || value === null || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return param.optional ? null : param.min;
  return clamp(number, param.min, param.max);
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
  const fixed = Number(value).toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function readFinite(text) {
  const parsed = Number.parseFloat(String(text).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function eng(value, unit = "") {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.001) return `${(value * 1000000).toPrecision(3)} u${unit}`;
  if (abs > 0 && abs < 1) return `${(value * 1000).toPrecision(3)} m${unit}`;
  return `${value.toPrecision(3)} ${unit}`.trim();
}

function formatCurrent(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${(value * 1000).toPrecision(3)} mA`;
  return `${value.toPrecision(3)} A`;
}

function percent(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(1)} %` : "—";
}

function ariaPower(value) {
  if (!Number.isFinite(value)) return "unknown loss";
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.001) return `${Number((value * 1000000).toPrecision(3))} microwatts`;
  if (abs > 0 && abs < 1) return `${Number((value * 1000).toPrecision(3))} milliwatts`;
  return `${Number(value.toPrecision(3))} watts`;
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

function groupCssClass(key) {
  return `blx-band-${key}`;
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

function svgEl(name, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

function svgPath(points) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function areaPath(points, key, y0Key, xScale, yScale) {
  const top = points.map((point) => [xScale(point.iout), yScale(point.stackTop[key])]);
  const bottom = [...points].reverse().map((point) => [xScale(point.iout), yScale(point.stackBottom[y0Key])]);
  return `${svgPath(top)} L${bottom.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L")} Z`;
}

function engineeringTick(value, unit = "") {
  if (value >= 1000000) return `${Number((value / 1000000).toPrecision(3))}M${unit}`;
  if (value >= 1000) return `${Number((value / 1000).toPrecision(3))}k${unit}`;
  if (value < 1) return `${Number(value.toPrecision(2))}${unit}`;
  return `${Number(value.toPrecision(3))}${unit}`;
}

function currentTickLabel(value) {
  if (value < 1) return `${Number((value * 1000).toPrecision(3))} mA`;
  return engineeringTick(value, " A");
}

function sliderThumbSize(root) {
  const raw = window.getComputedStyle(root).getPropertyValue("--blx-thumb-size");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 15;
}

function glideNow() {
  return window.performance?.now ? window.performance.now() : Date.now();
}

function easeThumbGlide(t) {
  return 1 - Math.pow(1 - t, 3);
}

function cancelRangeThumbGlide(range, finalValue) {
  if (!range) return;
  if (range.blxThumbGlideFrame) {
    cancelAnimationFrame(range.blxThumbGlideFrame);
    range.blxThumbGlideFrame = 0;
  }
  if (Number.isFinite(finalValue)) range.value = finalValue;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function canGlideRangeThumb() {
  return !prefersReducedMotion();
}

function glideRangeThumb(range, fromValue, toValue) {
  if (!range) return;
  const from = Number.parseFloat(fromValue);
  const to = Number.parseFloat(toValue);
  cancelRangeThumbGlide(range);
  if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) < 0.5 || !canGlideRangeThumb()) {
    if (Number.isFinite(to)) range.value = to;
    return;
  }

  const duration = 180;
  let startedAt = 0;
  range.value = from;

  function step(now) {
    if (!startedAt) startedAt = now || glideNow();
    const t = clamp(((now || glideNow()) - startedAt) / duration, 0, 1);
    range.value = from + (to - from) * easeThumbGlide(t);
    if (t < 1) {
      range.blxThumbGlideFrame = requestAnimationFrame(step);
    } else {
      range.blxThumbGlideFrame = 0;
      range.value = to;
    }
  }

  range.blxThumbGlideFrame = requestAnimationFrame(step);
}

function cssTimeToMs(value, fallback = 250) {
  const raw = String(value || "").trim();
  const number = Number.parseFloat(raw);
  if (!Number.isFinite(number)) return fallback;
  return raw.endsWith("ms") ? number : number * 1000;
}

function accordionDuration(detail) {
  const raw = window.getComputedStyle(detail).getPropertyValue("--blx-acc-collapse");
  return cssTimeToMs(raw, 250);
}

function setAccordionOpen(detail, open, options = {}) {
  const summary = detail.querySelector("summary");
  const panel = detail.querySelector(".blx-detail-panel");
  clearTimeout(detail.blxAccordionTimer);

  if (open) {
    detail.open = true;
    if (summary) summary.setAttribute("aria-expanded", "true");
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

  if (summary) summary.setAttribute("aria-expanded", "false");
  detail.dataset.open = "false";
  if (options.immediate || prefersReducedMotion() || !panel) {
    detail.open = false;
    return;
  }

  const finish = () => {
    panel.removeEventListener("transitionend", onTransitionEnd);
    clearTimeout(detail.blxAccordionTimer);
    if (detail.dataset.open !== "true") detail.open = false;
  };
  const onTransitionEnd = (event) => {
    if (event.target === panel && event.propertyName === "grid-template-rows") finish();
  };

  panel.addEventListener("transitionend", onTransitionEnd);
  detail.blxAccordionTimer = setTimeout(finish, accordionDuration(detail) + 80);
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
    const toggle = () => setAccordionOpen(detail, detail.dataset.open !== "true");
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      summary.blxSkipAccordionClick = true;
      clearTimeout(summary.blxSkipAccordionClickTimer);
      summary.blxSkipAccordionClickTimer = setTimeout(() => {
        summary.blxSkipAccordionClick = false;
      }, 220);
      toggle();
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (summary.blxSkipAccordionClick) {
        summary.blxSkipAccordionClick = false;
        clearTimeout(summary.blxSkipAccordionClickTimer);
        return;
      }
      toggle();
    });
  });
}

function lossTickLabel(value) {
  if (value === 0) return "0";
  if (value < 1) return `${Number((value * 1000).toPrecision(2))} mW`;
  return `${Number(value.toPrecision(2))} W`;
}

function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const ratio = value / base;
  const nice = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
  return nice * base;
}

function linearSweep(inputs, { points = 200, iMin = 0, iMax = inputs.ioutMax } = {}) {
  const count = Math.max(2, Math.floor(points));
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    return computeLossPoint(inputs, iMin + (iMax - iMin) * t);
  });
}

function linearTicks(min, max, targetCount = 5) {
  const ticks = [];
  if (!(max > min)) return [{ value: min, major: true }];
  const step = niceCeil((max - min) / targetCount);
  const epsilon = step / 1000;
  let value = Math.ceil(min / step) * step;

  if (Math.abs(value - min) < epsilon) value = min;
  for (; value <= max + epsilon; value += step) {
    const rounded = Number(value.toPrecision(12));
    ticks.push({ value: clamp(rounded, min, max), major: true });
  }
  const last = ticks[ticks.length - 1]?.value;
  if (last === undefined || Math.abs(last - max) > epsilon) ticks.push({ value: max, major: true });
  return ticks;
}

function scaleFromPlot(plot) {
  const span = plot.xMax - plot.xMin || 1;
  return {
    xScale(iout) {
      return plot.left + clamp((iout - plot.xMin) / span, 0, 1) * plot.plotWidth;
    },
    lossY(loss) {
      return plot.bottom - (loss / plot.maxLoss) * plot.plotHeight;
    },
    effY(efficiency) {
      return plot.bottom - efficiency * plot.plotHeight;
    },
    currentFromX(x) {
      const f = clamp((x - plot.left) / plot.plotWidth, 0, 1);
      return plot.xMin + span * f;
    },
    currentStep(multiplier = 1) {
      return (span / 60) * multiplier;
    }
  };
}

function clientXToSvgX(svg, clientX) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = 0;
  return point.matrixTransform(svg.getScreenCTM().inverse()).x;
}

function ariaCursorText(result, current) {
  if (!result.valid) return `${formatCurrent(current)}, invalid inputs`;
  return `${formatCurrent(current)}, ${(100 * result.efficiency).toFixed(1)} percent efficiency, ${ariaPower(result.pLoss)} loss`;
}

function announce(root, result, state) {
  const live = root.querySelector("[data-blx-live]");
  if (!live || !result.valid) return;
  live.textContent = ariaCursorText(result, state.cursor);
}

function renderSentence(root, classification) {
  const node = root.querySelector('[data-blx-out="sentence"]');
  if (!node) return;
  if (!classification || classification.regime === "invalid") {
    node.textContent = "Adjust VIN, VOUT, fSW, L, and the current limit to return to a valid buck operating point.";
    return;
  }
  const chipKey = REGIME_COLOR_CLASS[classification.regime] || "fetConduction";
  node.replaceChildren();
  const chip = document.createElement("span");
  chip.className = "blx-regime-chip";
  const dot = document.createElement("i");
  dot.style.setProperty("--chip-color", `var(--blx-${chipKey === "fetConduction" ? "cond" : chipKey === "inductorDcr" ? "dcr" : chipKey === "switchingOverlap" ? "sw" : chipKey === "deadTime" ? "dead" : chipKey === "gateDrive" ? "gate" : chipKey === "bias" ? "bias" : "other"})`);
  dot.setAttribute("aria-hidden", "true");
  chip.append(dot, document.createTextNode(regimeLabel(classification.regime)));
  node.append(chip, document.createTextNode(classification.sentence));
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
  if (state.urlTimer) clearTimeout(state.urlTimer);
  state.urlTimer = setTimeout(() => {
    state.urlTimer = 0;
    const query = canonicalQuery(state);
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(null, "", nextUrl);
  }, 400);
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
    }, 1500);
  }
}

function updateCursorSvg(root, state, result) {
  const svg = root.querySelector("[data-blx-plot] svg");
  if (!svg || !state.plot || !result.valid) return;
  const scales = scaleFromPlot(state.plot);
  const x = scales.xScale(state.cursor);
  const y = scales.effY(result.efficiency);
  const line = svg.querySelector("[data-blx-cursor-line]");
  const dot = svg.querySelector("[data-blx-eff-dot]");
  const rail = svg.querySelector("[data-blx-cursor-rail]");
  const label = svg.querySelector("[data-blx-cursor-label]");
  const labelBg = svg.querySelector("[data-blx-cursor-label-bg]");
  const labelText = `${formatCurrent(state.cursor)} · ${(100 * result.efficiency).toFixed(1)}%`;

  if (line) {
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("y1", state.plot.top);
    line.setAttribute("y2", state.plot.bottom);
  }
  if (dot) {
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
  }
  if (label && labelBg) {
    const labelWidth = Math.max(82, labelText.length * 6.4 + 14);
    const labelHeight = 20;
    const yAbove = clamp(y - 28, state.plot.top + 4, state.plot.bottom - 24);
    const yBelow = clamp(y + 12, state.plot.top + 4, state.plot.bottom - 24);
    const rightX = clamp(x + 8, state.plot.left, state.plot.left + state.plot.plotWidth - labelWidth);
    const leftX = clamp(x - labelWidth - 8, state.plot.left, state.plot.left + state.plot.plotWidth - labelWidth);
    const baseYs = y < state.plot.top + 34 ? [yBelow, yBelow + 24, yBelow + 48, yAbove] : [yAbove, yBelow, yBelow + 24];
    const candidates = [];
    baseYs.forEach((candidateY) => {
      const clampedY = clamp(candidateY, state.plot.top + 4, state.plot.bottom - 24);
      candidates.push({ x: rightX, y: clampedY }, { x: leftX, y: clampedY });
    });
    const overlapsExisting = (candidate) => (state.plot.labels || []).some((box) => (
      candidate.x < box.x + box.width + 4 &&
      candidate.x + labelWidth + 4 > box.x &&
      candidate.y < box.y + box.height + 4 &&
      candidate.y + labelHeight + 4 > box.y
    ));
    const placement = candidates.find((candidate) => !overlapsExisting(candidate)) || candidates[0];
    const labelX = placement.x;
    const labelY = placement.y;
    label.textContent = labelText;
    label.setAttribute("x", labelX + 7);
    label.setAttribute("y", labelY + 15);
    labelBg.setAttribute("x", labelX);
    labelBg.setAttribute("y", labelY);
    labelBg.setAttribute("width", labelWidth);
  }
  if (rail) {
    rail.setAttribute("x", x - 22);
    rail.setAttribute("y", state.plot.top);
    rail.setAttribute("height", state.plot.plotHeight);
    rail.setAttribute("aria-valuemin", state.plot.xMin);
    rail.setAttribute("aria-valuemax", state.plot.xMax);
    rail.setAttribute("aria-valuenow", state.cursor);
    rail.setAttribute("aria-valuetext", ariaCursorText(result, state.cursor));
  }
}

function updateCursorReadouts(root, state, options = {}) {
  const validation = state.validation ?? validateInputs(state.inputs);
  const result = computeLossPoint(state.inputs, state.cursor);
  const classification = classifyRegime(result, state.inputs);

  root.classList.toggle("blx-invalid", !validation.valid || !result.valid);
  if (!validation.valid || !result.valid) {
    ["current", "efficiency", "loss", "pout"].forEach((key) => setText(root, key, "—"));
    setText(root, "regime", "Invalid");
    renderSentence(root, null);
    renderBreakdown(root, result);
    renderWarnings(root, result, validation, state);
    updateCopyUrl(root, state);
    return result;
  }

  setText(root, "current", formatCurrent(state.cursor));
  setText(root, "efficiency", percent(result.efficiency));
  setText(root, "loss", eng(result.pLoss, "W"));
  setText(root, "pout", eng(result.pOut, "W"));
  setText(root, "regime", regimeLabel(classification.regime));
  renderSentence(root, classification);
  renderBreakdown(root, result);
  renderWarnings(root, result, validation, state);
  updateCursorSvg(root, state, result);
  updateCopyUrl(root, state);
  if (options.announce) announce(root, result, state);
  return result;
}

function attachCursorEvents(root, state, rail, surface) {
  let dragging = false;
  let pointerId = null;
  let pendingCurrent = null;
  let frame = 0;

  function applyPending() {
    frame = 0;
    if (pendingCurrent === null) return;
    state.cursor = clamp(pendingCurrent, state.plot.xMin, state.plot.xMax);
    pendingCurrent = null;
    updateCursorReadouts(root, state);
  }

  function queueCurrent(current) {
    pendingCurrent = current;
    if (!frame) frame = requestAnimationFrame(applyPending);
  }

  function currentFromEvent(event, target) {
    const svg = target.ownerSVGElement;
    const x = clientXToSvgX(svg, event.clientX);
    return scaleFromPlot(state.plot).currentFromX(x);
  }

  function startDrag(event, target) {
    if (!state.plot) return;
    event.preventDefault();
    dragging = true;
    pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    queueCurrent(currentFromEvent(event, target));
  }

  function moveDrag(event, target) {
    if (!dragging || event.pointerId !== pointerId) return;
    queueCurrent(currentFromEvent(event, target));
  }

  function finishDrag(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    if (frame) {
      cancelAnimationFrame(frame);
      applyPending();
    }
    updateCursorReadouts(root, state, { announce: true });
    scheduleUrlReplace(root, state);
  }

  [surface, rail].filter(Boolean).forEach((target) => {
    target.addEventListener("pointerdown", (event) => startDrag(event, target));
    target.addEventListener("pointermove", (event) => moveDrag(event, target));
    target.addEventListener("pointerup", finishDrag);
    target.addEventListener("pointercancel", finishDrag);
  });

  rail.addEventListener("keydown", (event) => {
    const keyMap = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -10,
      PageUp: 10
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      state.cursor = event.key === "Home" ? state.plot.xMin : state.plot.xMax;
      updateCursorReadouts(root, state, { announce: true });
      scheduleUrlReplace(root, state);
      return;
    }
    if (!(event.key in keyMap)) return;
    event.preventDefault();
    const direction = Math.sign(keyMap[event.key]);
    const step = scaleFromPlot(state.plot).currentStep(Math.abs(keyMap[event.key]) * (event.shiftKey ? 10 : 1));
    state.cursor = clamp(state.cursor + direction * step, state.plot.xMin, state.plot.xMax);
    updateCursorReadouts(root, state, { announce: true });
    scheduleUrlReplace(root, state);
  });
}

function isCompactPlot() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches;
}

function renderLegend(root) {
  const legend = root.querySelector("[data-blx-legend]");
  if (!legend) return;
  legend.replaceChildren();
  GROUPS.forEach(([key, label, token]) => {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.setProperty("--legend-color", `var(${token})`);
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(label));
    legend.appendChild(item);
  });
  const eff = document.createElement("span");
  eff.className = "blx-eff-key";
  const line = document.createElement("i");
  line.setAttribute("aria-hidden", "true");
  eff.append(line, document.createTextNode("Efficiency"));
  legend.appendChild(eff);
}

function renderPlot(root, inputs, result, state) {
  const holder = root.querySelector("[data-blx-plot]");
  if (!holder) return;
  if (!result.valid) {
    holder.replaceChildren();
    renderLegend(root);
    return;
  }

  const compact = isCompactPlot();
  const width = compact ? 360 : 680;
  const height = compact ? 260 : 360;
  const left = compact ? 44 : 58;
  const right = compact ? 44 : 80;
  const top = compact ? 32 : 30;
  const plotWidth = width - left - right;
  const plotHeight = compact ? 150 : 222;
  const bottom = top + plotHeight;
  const xMin = 0;
  const xMax = inputs.ioutMax;
  const sweep = state.sweep && state.sweep.length ? state.sweep : linearSweep(inputs, { points: 200, iMin: xMin, iMax: xMax }).filter((point) => point.valid);
  const maxLoss = state.plot?.maxLoss ?? niceCeil(1.1 * Math.max(...sweep.map((point) => point.pLoss), result.pLoss, 0.001));
  state.plot = { left, top, plotWidth, plotHeight, bottom, xMin, xMax, maxLoss, width, height, labels: [] };
  const { xScale, lossY, effY } = scaleFromPlot(state.plot);
  const titleId = `${state.instanceId}-plot-title`;
  const descId = `${state.instanceId}-plot-desc`;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-labelledby": `${titleId} ${descId}`
  });

  svg.append(
    svgEl("title", { id: titleId }, "Buck loss and efficiency versus load current"),
    svgEl("desc", { id: descId }, "Stacked loss bands show FET conduction, inductor DCR, switching overlap, dead time, gate drive, bias, and ripple-related loss. A line overlays efficiency and a draggable vertical cursor selects the load current.")
  );

  svg.append(
    svgEl("rect", { class: "blx-svg-bg", x: left, y: top, width: plotWidth, height: plotHeight }),
    svgEl("line", { class: "blx-svg-axis", x1: left, y1: bottom, x2: left + plotWidth, y2: bottom, "stroke-width": 1.2, opacity: "0.9" }),
    svgEl("line", { class: "blx-svg-axis", x1: left, y1: top, x2: left, y2: bottom, "stroke-width": 1.2, opacity: "0.9" }),
    svgEl("line", { class: "blx-svg-axis", x1: left + plotWidth, y1: top, x2: left + plotWidth, y2: bottom, "stroke-width": 1.2, opacity: "0.9" })
  );

  const forcedBoundary = inputs.coreBoundary ?? computeLossPoint(inputs, xMax).core.deltaIL / 2;
  if (forcedBoundary > xMin) {
    const boundaryX = xScale(Math.min(forcedBoundary, xMax));
    const shadeWidth = clamp(boundaryX - left, 0, plotWidth);
    const forcedLabel = "forced CCM / reverse current";
    const forcedWidth = compact ? 145 : 162;
    const forcedX = clamp(left + 10, left + 4, left + plotWidth - forcedWidth - 4);
    const forcedY = top + 8;
    state.plot.labels.push({ x: forcedX, y: forcedY, width: forcedWidth, height: 18 });
    svg.append(
      svgEl("rect", { class: "blx-forced-shade", x: left, y: top, width: shadeWidth, height: plotHeight }),
      svgEl("line", { class: "blx-forced-line", x1: boundaryX, y1: top, x2: boundaryX, y2: bottom, "stroke-width": 1, "stroke-dasharray": "4 5" }),
      svgEl("rect", { class: "blx-forced-pill", x: forcedX, y: forcedY, width: forcedWidth, height: 18, rx: 9 }),
      svgEl("text", { class: "blx-forced-text", x: forcedX + 8, y: forcedY + 12.5, "font-size": compact ? 9.2 : 10.5 }, forcedLabel)
    );
  }

  for (let i = 0; i <= 4; i += 1) {
    const value = (maxLoss / 4) * i;
    const y = lossY(value);
    svg.append(
      svgEl("line", { class: "blx-svg-grid", x1: left, y1: y, x2: left + plotWidth, y2: y, "stroke-width": 1, opacity: i === 0 ? "0.85" : "0.34" }),
      svgEl("text", { class: "blx-svg-label", x: left - 8, y: y + 4, "font-size": compact ? 9.6 : 11, "text-anchor": "end" }, lossTickLabel(value))
    );
  }

  [0, 0.25, 0.5, 0.75, 1].forEach((efficiency) => {
    const y = effY(efficiency);
    svg.append(
      svgEl("line", { class: "blx-svg-eff-tick", x1: left + plotWidth, y1: y, x2: left + plotWidth + 5, y2: y, "stroke-width": 1 }),
      svgEl("text", { class: "blx-svg-label", x: left + plotWidth + 8, y: y + 4, "font-size": compact ? 9.4 : 11 }, `${Math.round(100 * efficiency)}%`)
    );
  });

  linearTicks(xMin, xMax, compact ? 4 : 5).forEach((tick) => {
    const x = xScale(tick.value);
    svg.append(svgEl("line", {
      class: "blx-svg-grid",
      x1: x,
      y1: bottom,
      x2: x,
      y2: tick.major ? top : bottom - 5,
      "stroke-width": tick.major ? 1 : 0.8,
      opacity: tick.major ? "0.28" : "0.22"
    }));
    if (tick.major) {
      svg.append(svgEl("text", { class: "blx-svg-label", x, y: bottom + (compact ? 15 : 18), "font-size": compact ? 9.4 : 11, "text-anchor": "middle" }, currentTickLabel(tick.value)));
    }
  });

  const stacked = sweep.map((point) => {
    let acc = 0;
    const stackBottom = { zero: 0 };
    const stackTop = {};
    GROUPS.forEach(([key]) => {
      stackBottom[key] = acc;
      acc += point.groupedLosses[key];
      stackTop[key] = acc;
    });
    return { ...point, stackBottom, stackTop };
  });

  GROUPS.forEach(([key]) => {
    const path = svgEl("path", {
      d: areaPath(stacked, key, key, xScale, lossY),
      class: `blx-band ${groupCssClass(key)}`
    });
    svg.append(path);
  });

  const effLine = svgEl("path", {
    d: svgPath(sweep.map((point) => [xScale(point.iout), effY(point.efficiency)])),
    class: "blx-eff-line",
    fill: "none",
    "stroke-width": 2.2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
  svg.append(effLine);

  const peak = sweep.reduce((best, point) => (point.efficiency > best.efficiency ? point : best), sweep[0]);
  if (peak) {
    const peakX = xScale(peak.iout);
    const peakY = effY(peak.efficiency);
    const text = `peak ${(100 * peak.efficiency).toFixed(1)}%`;
    const labelWidth = text.length * 5.8 + 14;
    const cursorX = xScale(state.cursor);
    const cursorY = effY(result.efficiency);
    const candidateTop = clamp(peakY - 25, top + 4, bottom - 20);
    const candidateRight = clamp(peakX + 7, left + 3, left + plotWidth - labelWidth - 3);
    const nearCursor = Math.abs(peakX - cursorX) < 128 && Math.abs(peakY - cursorY) < 48;
    const nearForced = state.plot.labels.some((box) => (
      candidateRight < box.x + box.width + 6 &&
      candidateRight + labelWidth + 6 > box.x &&
      candidateTop < box.y + box.height + 6 &&
      candidateTop + 17 + 6 > box.y
    ));
    const labelX = nearCursor || nearForced
      ? clamp(peakX - labelWidth - 10, left + 3, left + plotWidth - labelWidth - 3)
      : clamp(peakX + 7, left + 3, left + plotWidth - labelWidth - 3);
    const labelY = nearCursor || nearForced
      ? clamp(peakY + 11, top + 4, bottom - 20)
      : candidateTop;
    state.plot.labels.push({ x: labelX, y: labelY, width: labelWidth, height: 17 });
    svg.append(
      svgEl("circle", { class: "blx-eff-dot blx-eff-peak", cx: peakX, cy: peakY, r: compact ? 3.2 : 3.8, "stroke-width": 1.5, "pointer-events": "none" }),
      svgEl("rect", { class: "blx-label-pill", x: labelX, y: labelY, width: labelWidth, height: 17, rx: 8.5, "pointer-events": "none" }),
      svgEl("text", { class: "blx-svg-soft-label", x: labelX + 7, y: labelY + 12, "font-size": compact ? 8.8 : 10, "pointer-events": "none" }, text)
    );
  }

  const cursorLine = svgEl("line", {
    "data-blx-cursor-line": "true",
    class: "blx-cursor-line",
    x1: left,
    y1: top,
    x2: left,
    y2: bottom,
    "stroke-width": 1.2,
    opacity: "0.56",
    "pointer-events": "none"
  });
  const effDot = svgEl("circle", {
    "data-blx-eff-dot": "true",
    class: "blx-eff-dot",
    cx: left,
    cy: bottom,
    r: 4.6,
    "stroke-width": 2,
    "pointer-events": "none"
  });
  const cursorLabelBg = svgEl("rect", {
    "data-blx-cursor-label-bg": "true",
    class: "blx-label-pill",
    x: left,
    y: top,
    width: 90,
    height: 20,
    rx: 10,
    "pointer-events": "none"
  });
  const cursorLabel = svgEl("text", {
    "data-blx-cursor-label": "true",
    class: "blx-label-text",
    x: left + 7,
    y: top + 15,
    "font-size": compact ? 10 : 11,
    "font-weight": 650,
    "pointer-events": "none"
  });
  const surface = svgEl("rect", {
    "data-blx-cursor-surface": "true",
    x: left,
    y: top,
    width: plotWidth,
    height: plotHeight,
    fill: "transparent",
    "pointer-events": "all"
  });
  surface.style.touchAction = "pan-y";
  surface.style.cursor = "ew-resize";
  const rail = svgEl("rect", {
    "data-blx-cursor-rail": "true",
    class: "blx-cursor-rail",
    x: left - 22,
    y: top,
    width: 44,
    height: plotHeight,
    fill: "transparent",
    "pointer-events": "all",
    role: "slider",
    tabindex: "0",
    "aria-label": "Selected load current"
  });
  rail.style.touchAction = "none";
  rail.style.cursor = "ew-resize";
  svg.append(surface, cursorLine, effDot, cursorLabelBg, cursorLabel, rail);

  svg.append(
    svgEl("text", { class: "blx-svg-label", x: left, y: top - 10, "font-size": compact ? 9.6 : 11 }, "loss"),
    svgEl("text", { class: "blx-svg-label", x: left + plotWidth + (compact ? 6 : 14), y: top - 10, "font-size": compact ? 9.6 : 11 }, "eff."),
    svgEl("text", { class: "blx-svg-label", x: left + plotWidth / 2, y: height - 18, "font-size": compact ? 9.8 : 11, "text-anchor": "middle" }, "load current")
  );

  holder.replaceChildren(svg);
  renderLegend(root);
  attachCursorEvents(root, state, rail, surface);
  updateCursorSvg(root, state, result);
}

function updatePresetButtons(root, activePresetId) {
  root.querySelectorAll("[data-blx-preset]").forEach((button) => {
    const active = button.getAttribute("data-blx-preset") === activePresetId;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function controlValueText(key, value) {
  const param = PARAMS[key];
  if (param.optional && value === null) return `${param.label}: none`;
  return `${param.label}: ${displayNumber(value, param.digits)} ${param.unit}`;
}

function syncControls(state, numberControls, rangeControls, options = {}) {
  activeRawInputsForRanges = state.rawInputs;
  Object.keys(PARAMS).forEach((key) => {
    const param = PARAMS[key];
    const value = state.rawInputs[key];
    (numberControls.get(key) || []).forEach((input) => {
      if (!options.force && document.activeElement === input) return;
      input.value = param.optional && value === null ? "" : displayNumber(value, param.digits);
    });
    (rangeControls.get(key) || []).forEach((input) => {
      if (!options.force && document.activeElement === input) return;
      input.value = toSlider(key, value);
      input.setAttribute("aria-valuetext", controlValueText(key, value));
    });
  });
}

function renderBreakdown(root, result) {
  const list = root.querySelector("[data-blx-breakdown-list]");
  const bar = root.querySelector("[data-blx-breakdown-bar]");
  if (!list || !bar) return;

  if (!result.valid || !(result.pLoss > 0)) {
    bar.replaceChildren();
    list.replaceChildren();
    GROUPS.forEach(([, label]) => {
      const item = document.createElement("li");
      item.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
      item.children[0].textContent = label;
      item.children[1].textContent = "—";
      item.children[2].textContent = "—";
      list.appendChild(item);
    });
    return;
  }

  bar.replaceChildren();
  GROUPS.forEach(([key, label, token]) => {
    const value = result.groupedLosses[key];
    const share = result.pLoss > 0 ? value / result.pLoss : 0;
    const part = document.createElement("span");
    part.style.width = `${Math.max(0, 100 * share)}%`;
    part.style.background = `var(${token})`;
    part.title = `${label}: ${eng(value, "W")}`;
    bar.appendChild(part);
  });

  list.replaceChildren();
  GROUPS.forEach(([key, label]) => {
    const value = result.groupedLosses[key];
    const share = result.pLoss > 0 ? value / result.pLoss : 0;
    const item = document.createElement("li");
    const labelEl = document.createElement("span");
    const valueEl = document.createElement("span");
    const shareEl = document.createElement("span");
    labelEl.textContent = label;
    valueEl.textContent = eng(value, "W");
    shareEl.textContent = `${(100 * share).toFixed(1)}%`;
    item.append(labelEl, valueEl, shareEl);
    list.appendChild(item);
  });
}

function renderWarnings(root, result, validation, state = {}) {
  const box = root.querySelector("[data-blx-warnings]");
  if (!box) return;
  const notes = (state.urlNotes || []).map((entry) => URL_NOTE_COPY[entry.code] || entry.message || entry.code);
  if (!validation.valid) {
    notes.push("Check the input values: VIN must be above VOUT, and positive frequency, inductance, and current limits are required.");
  } else {
    result.warnings.forEach((code) => notes.push(WARNING_COPY[code] || code));
  }
  const shown = notes.slice(0, 2);
  const cacheKey = shown.join("\n");
  if (box.dataset.blxWarningsCache === cacheKey) return;
  box.dataset.blxWarningsCache = cacheKey;
  box.replaceChildren();
  shown.forEach((text) => {
    const noteEl = document.createElement("p");
    noteEl.className = "blx-note blx-note-show";
    noteEl.textContent = text;
    box.appendChild(noteEl);
  });
}

function renderPrompt(root, state) {
  const prompt = root.querySelector("[data-blx-prompt]");
  if (!prompt) return;
  const preset = state.activePresetId ? getBuckLossPreset(state.activePresetId) : null;
  prompt.textContent = preset ? preset.prompt : "Custom values. Use the knobs to see which loss family moves first.";
}

function renderTryChips(root, state) {
  const holder = root.querySelector("[data-blx-try]");
  if (!holder) return;
  holder.replaceChildren();
  const label = document.createElement("span");
  label.textContent = "Try:";
  holder.appendChild(label);
  [
    ["half-fsw", "Halve fSW"],
    ["lower-rds", "Halve RDS(on)"],
    ["add-eoss", "Add EOSS"]
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

function render(root, state, options = {}) {
  activeRawInputsForRanges = state.rawInputs;
  state.inputs = normalizeInputs(state.rawInputs);
  state.validation = validateInputs(state.inputs);
  state.cursor = clamp(state.cursor, 0, state.rawInputs.ioutMax);

  const result = computeLossPoint(state.inputs, state.cursor);
  const xMin = 0;
  const xMax = state.inputs.ioutMax;
  state.sweep = state.validation.valid ? linearSweep(state.inputs, { points: 200, iMin: xMin, iMax: xMax }).filter((point) => point.valid) : [];
  state.plot = state.validation.valid
    ? { ...(state.plot || {}), xMin, xMax, maxLoss: niceCeil(1.1 * Math.max(...state.sweep.map((point) => point.pLoss), result.pLoss, 0.001)) }
    : null;

  updatePresetButtons(root, state.activePresetId);
  renderPrompt(root, state);
  renderTryChips(root, state);
  renderPlot(root, state.inputs, result, state);
  updateCursorReadouts(root, state, { announce: options.announce });
}

function scheduleRender(root, state, options = {}) {
  if (state.renderTimer) clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => {
    state.renderTimer = 0;
    render(root, state, options);
    if (options.updateUrl) scheduleUrlReplace(root, state);
  }, options.immediate ? 0 : 150);
}

function buildTicks(root, state) {
  activeRawInputsForRanges = state.rawInputs;
  root.querySelectorAll("[data-blx-ticks]").forEach((row) => {
    const key = row.getAttribute("data-blx-ticks");
    row.innerHTML = "";
    (TICKS[key] || []).forEach(([value, label]) => {
      const max = key === "vout" ? 0.95 * state.rawInputs.vin : PARAMS[key].max;
      if (value < PARAMS[key].min || value > max) return;
      const f = toSlider(key, value) / 1000;
      const thumb = sliderThumbSize(root);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "blx-tick";
      button.tabIndex = -1;
      button.textContent = label;
      button.style.left = `calc(${(100 * f).toFixed(2)}% + ${(thumb / 2 - thumb * f).toFixed(1)}px)`;
      button.setAttribute("aria-label", `Set ${key} to ${label}`);
      button.addEventListener("click", () => {
        const glideTargets = (root.blxRangeControls?.get(key) || []).map((range) => ({
          range,
          from: Number.parseFloat(range.value)
        }));
        state.rawInputs[key] = clampParam(key, value);
        markCustom(state);
        state.undoTry = null;
        enforceBuck(state.rawInputs, key);
        clampCursorToRange(state);
        syncControls(state, root.blxNumberControls, root.blxRangeControls);
        glideTargets.forEach(({ range, from }) => {
          glideRangeThumb(range, from, Number.parseFloat(range.value));
        });
        buildTicks(root, state);
        scheduleRender(root, state, { updateUrl: true, announce: true });
      });
      row.appendChild(button);
    });
  });
}

function clampCursorToRange(state) {
  state.cursor = clamp(state.cursor, 0, state.rawInputs.ioutMax);
}

function markCustom(state) {
  state.activePresetId = null;
  state.urlNotes = [];
}

function commitNumberInput(root, state, key, input) {
  activeRawInputsForRanges = state.rawInputs;
  const text = input.value.trim();
  if (PARAMS[key].optional && text === "") {
    state.rawInputs[key] = null;
    state.explicitOptional[key] = false;
  } else {
    const parsed = readFinite(text);
    if (parsed === null) {
      syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
      return;
    }
    state.rawInputs[key] = clampStaticParam(key, parsed);
    if (PARAMS[key].optional) state.explicitOptional[key] = true;
  }
  markCustom(state);
  enforceBuck(state.rawInputs, key);
  clampCursorToRange(state);
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  buildTicks(root, state);
  scheduleRender(root, state, { updateUrl: true, announce: true });
}

function liveNumberInput(root, state, key, input) {
  activeRawInputsForRanges = state.rawInputs;
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
  buildTicks(root, state);
  scheduleRender(root, state, { updateUrl: true, announce: true });
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
  clampCursorToRange(state);
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  buildTicks(root, state);
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
  state.undoTry = null;
  syncControls(state, root.blxNumberControls, root.blxRangeControls, { force: true });
  buildTicks(root, state);
  render(root, state, { announce: true });
  scheduleUrlReplace(root, state);
}

export function initBuckLossExplorer(root) {
  if (!root || root.dataset.blxInit === "true") return;
  root.dataset.blxInit = "true";

  const parsedState = parseBuckLossUrl(typeof window === "undefined" ? "" : window.location.search);
  const state = {
    rawInputs: cloneRaw(parsedState.rawInputs),
    cursor: parsedState.cursor,
    activePresetId: parsedState.activePresetId,
    explicitOptional: { ...parsedState.explicitOptional },
    urlNotes: parsedState.notes,
    undoTry: null,
    instanceId: `blx-${Math.random().toString(36).slice(2)}`,
    renderTimer: 0,
    urlTimer: 0,
    inputs: normalizeInputs(parsedState.rawInputs),
    validation: { valid: true, errors: [] },
    sweep: [],
    plot: null
  };

  const numberControls = makeControlMap(root, "data-blx-number");
  const rangeControls = makeControlMap(root, "data-blx-range");
  root.blxNumberControls = numberControls;
  root.blxRangeControls = rangeControls;
  initAdvancedAccordions(root);

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
        state.explicitOptional = { vBias: false, inductorIsat: false };
        state.urlNotes = [];
        state.undoTry = null;
        syncControls(state, numberControls, rangeControls);
        buildTicks(root, state);
        render(root, state, { announce: true });
        scheduleUrlReplace(root, state);
      });
      holder.appendChild(button);
    });
  });

  Object.keys(PARAMS).forEach((key) => {
    (rangeControls.get(key) || []).forEach((range) => {
      range.addEventListener("input", () => {
        cancelRangeThumbGlide(range);
        activeRawInputsForRanges = state.rawInputs;
        state.rawInputs[key] = clampParam(key, fromSlider(key, range.value));
        if (PARAMS[key].optional) state.explicitOptional[key] = true;
        markCustom(state);
        state.undoTry = null;
        enforceBuck(state.rawInputs, key);
        clampCursorToRange(state);
        range.setAttribute("aria-valuetext", controlValueText(key, state.rawInputs[key]));
        syncControls(state, numberControls, rangeControls);
        buildTicks(root, state);
        scheduleRender(root, state, { updateUrl: true, announce: true });
      });
    });

    (numberControls.get(key) || []).forEach((input) => {
      input.addEventListener("input", () => {
        state.undoTry = null;
        liveNumberInput(root, state, key, input);
      });
      input.addEventListener("change", () => {
        commitNumberInput(root, state, key, input);
      });
      input.addEventListener("blur", () => {
        commitNumberInput(root, state, key, input);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitNumberInput(root, state, key, input);
      });
    });
  });

  const tryHolder = root.querySelector("[data-blx-try]");
  if (tryHolder) {
    tryHolder.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.blxTryUndo) {
        undoTryChip(root, state);
      } else if (button.dataset.blxTry) {
        applyTryChip(root, state, button.dataset.blxTry);
      }
    });
  }

  root.querySelectorAll("[data-blx-copy]").forEach((copyButton) => {
    copyButton.addEventListener("click", () => {
      copyCanonicalUrl(root, state, copyButton);
    });
  });

  if (typeof window !== "undefined") {
    const compactQuery = window.matchMedia("(max-width: 700px)");
    const schedulePlotRefresh = () => scheduleRender(root, state, { immediate: true });
    if (compactQuery.addEventListener) {
      compactQuery.addEventListener("change", schedulePlotRefresh);
    }
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(schedulePlotRefresh, 120);
    });
    window.addEventListener("popstate", () => {
      const next = parseBuckLossUrl(window.location.search);
      state.rawInputs = cloneRaw(next.rawInputs);
      state.cursor = next.cursor;
      state.activePresetId = next.activePresetId;
      state.explicitOptional = { ...next.explicitOptional };
      state.urlNotes = next.notes;
      state.undoTry = null;
      syncControls(state, numberControls, rangeControls, { force: true });
      buildTicks(root, state);
      render(root, state, { announce: true });
    });
  }

  buildTicks(root, state);
  syncControls(state, numberControls, rangeControls);
  render(root, state);
}
