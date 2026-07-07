import { classifyRegime, computeLossPoint, computeLossSweep, normalizeInputs, validateInputs } from "./buck-loss-model.js";
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

const SVG_NS = "http://www.w3.org/2000/svg";

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

function formatCurrent(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${(value * 1000).toPrecision(3)} mA`;
  return `${value.toPrecision(3)} A`;
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

function siteColors(root) {
  return {
    ink: getColor(root, "--ink", "#1f2328"),
    inkSoft: getColor(root, "--ink-soft", "#3f4448"),
    muted: getColor(root, "--muted", "#6b7078"),
    soft: getColor(root, "--soft", "#f6f7f8"),
    line: getColor(root, "--line", "#d9dee3"),
    accent: getColor(root, "--accent", "#276f86")
  };
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

function svgEl(name, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
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

function logTicks(min, max) {
  const ticks = [];
  const start = Math.floor(Math.log10(min));
  const end = Math.ceil(Math.log10(max));
  for (let decade = start; decade <= end; decade += 1) {
    const base = 10 ** decade;
    [1, 2, 5].forEach((multiplier) => {
      const value = base * multiplier;
      if (value < min || value > max) return;
      ticks.push({ value, major: multiplier === 1 });
    });
  }
  return ticks;
}

function scaleFromPlot(plot) {
  const logMin = Math.log(plot.xMin);
  const logMax = Math.log(plot.xMax);
  return {
    xScale(iout) {
      return plot.left + ((Math.log(iout) - logMin) / (logMax - logMin)) * plot.plotWidth;
    },
    lossY(loss) {
      return plot.bottom - (loss / plot.maxLoss) * plot.plotHeight;
    },
    effY(efficiency) {
      return plot.bottom - efficiency * plot.plotHeight;
    },
    currentFromX(x) {
      const f = clamp((x - plot.left) / plot.plotWidth, 0, 1);
      return Math.exp(logMin + (logMax - logMin) * f);
    },
    logStep(multiplier = 1) {
      return ((logMax - logMin) / 60) * multiplier;
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
  if (!result.valid) return `${formatCurrent(current)} — invalid inputs`;
  return `${Number(current).toFixed(2)} A — efficiency ${(100 * result.efficiency).toFixed(1)}%, total loss ${eng(result.pLoss, "W")}`;
}

function announce(root, result, state) {
  const live = root.querySelector("[data-blx-live]");
  if (!live || !result.valid) return;
  live.textContent = ariaCursorText(result, state.cursor);
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
  const result = validation.valid ? computeLossPoint(state.inputs, state.cursor) : computeLossPoint(state.inputs, state.cursor);
  const classification = classifyRegime(result, state.inputs);

  root.classList.toggle("blx-invalid", !validation.valid || !result.valid);
  if (!validation.valid || !result.valid) {
    ["current", "efficiency", "loss", "pout"].forEach((key) => setText(root, key, "—"));
    setText(root, "regime", "Invalid");
    setText(root, "sentence", "Adjust VIN, VOUT, fSW, L, and the current limit to return to a valid buck operating point.");
    renderBreakdown(root, result);
    renderWarnings(root, result, validation);
    return result;
  }

  setText(root, "current", formatCurrent(state.cursor));
  setText(root, "efficiency", percent(result.efficiency));
  setText(root, "loss", eng(result.pLoss, "W"));
  setText(root, "pout", eng(result.pOut, "W"));
  setText(root, "regime", regimeLabel(classification.regime));
  setText(root, "sentence", classification.sentence);
  renderBreakdown(root, result);
  renderWarnings(root, result, validation);
  updateCursorSvg(root, state, result);
  if (options.announce) announce(root, result, state);
  return result;
}

function attachCursorEvents(root, state, rail) {
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

  function currentFromEvent(event) {
    const svg = rail.ownerSVGElement;
    const x = clientXToSvgX(svg, event.clientX);
    return scaleFromPlot(state.plot).currentFromX(x);
  }

  rail.addEventListener("pointerdown", (event) => {
    if (!state.plot) return;
    event.preventDefault();
    dragging = true;
    pointerId = event.pointerId;
    rail.setPointerCapture(pointerId);
    queueCurrent(currentFromEvent(event));
  });

  rail.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    queueCurrent(currentFromEvent(event));
  });

  function finishDrag(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    if (frame) {
      cancelAnimationFrame(frame);
      applyPending();
    }
    updateCursorReadouts(root, state, { announce: true });
  }

  rail.addEventListener("pointerup", finishDrag);
  rail.addEventListener("pointercancel", finishDrag);

  rail.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = scaleFromPlot(state.plot).logStep(event.shiftKey ? 10 : 1);
    state.cursor = clamp(Math.exp(Math.log(state.cursor) + direction * step), state.plot.xMin, state.plot.xMax);
    updateCursorReadouts(root, state, { announce: true });
  });
}

function renderPlot(root, inputs, result, state) {
  const holder = root.querySelector("[data-blx-plot]");
  if (!holder) return;
  if (!result.valid) {
    holder.replaceChildren();
    return;
  }

  const width = 680;
  const height = 360;
  const left = 58;
  const right = 80;
  const top = 26;
  const plotWidth = width - left - right;
  const plotHeight = 242;
  const bottom = top + plotHeight;
  const legendTop = 300;
  const colors = siteColors(root);
  const groupColors = Object.fromEntries(GROUPS.map(([key, , token]) => [key, colorFor(root, token)]));
  const xMin = Math.max(inputs.ioutMax / 1000, 1e-3);
  const xMax = inputs.ioutMax;
  const sweep = state.sweep && state.sweep.length ? state.sweep : computeLossSweep(inputs, { points: 200, iMin: xMin, iMax: xMax }).filter((point) => point.valid);
  const maxLoss = state.plot?.maxLoss ?? niceCeil(1.1 * Math.max(...sweep.map((point) => point.pLoss), result.pLoss, 0.001));
  state.plot = { left, top, plotWidth, plotHeight, bottom, xMin, xMax, maxLoss };
  const { xScale, lossY, effY } = scaleFromPlot(state.plot);
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "Stacked buck converter loss versus load current with efficiency overlay"
  });

  svg.append(
    svgEl("rect", { x: left, y: top, width: plotWidth, height: plotHeight, fill: "#fff" }),
    svgEl("line", { x1: left, y1: bottom, x2: left + plotWidth, y2: bottom, stroke: colors.line, "stroke-width": 1.2 }),
    svgEl("line", { x1: left, y1: top, x2: left, y2: bottom, stroke: colors.line, "stroke-width": 1.2 }),
    svgEl("line", { x1: left + plotWidth, y1: top, x2: left + plotWidth, y2: bottom, stroke: colors.line, "stroke-width": 1.2 })
  );

  const forcedBoundary = inputs.coreBoundary ?? computeLossPoint(inputs, xMax).core.deltaIL / 2;
  if (forcedBoundary > xMin) {
    const boundaryX = xScale(Math.min(forcedBoundary, xMax));
    const shadeWidth = clamp(boundaryX - left, 0, plotWidth);
    svg.append(
      svgEl("rect", { x: left, y: top, width: shadeWidth, height: plotHeight, fill: colors.accent, opacity: "0.075" }),
      svgEl("line", { x1: boundaryX, y1: top, x2: boundaryX, y2: bottom, stroke: colors.accent, "stroke-width": 1, "stroke-dasharray": "4 5", opacity: "0.72" }),
      svgEl("text", { x: Math.min(boundaryX + 6, left + plotWidth - 74), y: top + 15, fill: colors.accent, "font-size": 11, "font-weight": 600 }, "forced CCM")
    );
  }

  for (let i = 0; i <= 4; i += 1) {
    const value = (maxLoss / 4) * i;
    const y = lossY(value);
    svg.append(
      svgEl("line", { x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: colors.line, "stroke-width": 1, opacity: i === 0 ? "1" : "0.7" }),
      svgEl("text", { x: left - 8, y: y + 4, fill: colors.muted, "font-size": 11, "text-anchor": "end" }, lossTickLabel(value))
    );
  }

  [0, 0.25, 0.5, 0.75, 1].forEach((efficiency) => {
    const y = effY(efficiency);
    svg.append(
      svgEl("line", { x1: left + plotWidth, y1: y, x2: left + plotWidth + 5, y2: y, stroke: colors.line, "stroke-width": 1 }),
      svgEl("text", { x: left + plotWidth + 10, y: y + 4, fill: colors.muted, "font-size": 11 }, `${Math.round(100 * efficiency)}%`)
    );
  });

  logTicks(xMin, xMax).forEach((tick) => {
    const x = xScale(tick.value);
    svg.append(svgEl("line", {
      x1: x,
      y1: bottom,
      x2: x,
      y2: tick.major ? top : bottom - 5,
      stroke: colors.line,
      "stroke-width": tick.major ? 1 : 0.8,
      opacity: tick.major ? "0.8" : "0.65"
    }));
    if (tick.major) {
      svg.append(svgEl("text", { x, y: bottom + 18, fill: colors.muted, "font-size": 11, "text-anchor": "middle" }, engineeringTick(tick.value, "A")));
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
      fill: groupColors[key],
      "fill-opacity": "0.8",
      stroke: "#fff",
      "stroke-width": "1",
      "stroke-linejoin": "round"
    });
    svg.append(path);
  });

  const effLine = svgEl("path", {
    d: svgPath(sweep.map((point) => [xScale(point.iout), effY(point.efficiency)])),
    fill: "none",
    stroke: colorFor(root, "--blx-eff"),
    "stroke-width": 2.2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
  svg.append(effLine);

  const cursorLine = svgEl("line", {
    "data-blx-cursor-line": "true",
    x1: left,
    y1: top,
    x2: left,
    y2: bottom,
    stroke: colors.ink,
    "stroke-width": 1.2,
    opacity: "0.56",
    "pointer-events": "none"
  });
  const effDot = svgEl("circle", {
    "data-blx-eff-dot": "true",
    cx: left,
    cy: bottom,
    r: 4.6,
    fill: "#fff",
    stroke: colorFor(root, "--blx-eff"),
    "stroke-width": 2,
    "pointer-events": "none"
  });
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
  svg.append(cursorLine, effDot, rail);

  svg.append(
    svgEl("text", { x: left, y: top - 8, fill: colors.muted, "font-size": 11 }, "loss"),
    svgEl("text", { x: left + plotWidth + 14, y: top - 8, fill: colors.muted, "font-size": 11 }, "efficiency"),
    svgEl("text", { x: left + plotWidth / 2, y: bottom + 38, fill: colors.muted, "font-size": 11, "text-anchor": "middle" }, "load current")
  );

  let legendX = left;
  let legendY = legendTop;
  GROUPS.forEach(([key, label]) => {
    const itemWidth = label.length * 6 + 24;
    if (legendX + itemWidth > left + plotWidth) {
      legendX = left;
      legendY += 18;
    }
    svg.append(
      svgEl("rect", { x: legendX, y: legendY - 9, width: 10, height: 10, rx: 2, fill: groupColors[key], opacity: "0.8" }),
      svgEl("text", { x: legendX + 15, y: legendY, fill: colors.inkSoft, "font-size": 10.5 }, label)
    );
    legendX += itemWidth;
  });
  svg.append(
    svgEl("line", { x1: left + plotWidth - 84, y1: legendTop + 25, x2: left + plotWidth - 58, y2: legendTop + 25, stroke: colorFor(root, "--blx-eff"), "stroke-width": 2 }),
    svgEl("text", { x: left + plotWidth - 52, y: legendTop + 29, fill: colors.inkSoft, "font-size": 10.5 }, "Efficiency")
  );

  holder.replaceChildren(svg);
  attachCursorEvents(root, state, rail);
  updateCursorSvg(root, state, result);
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

function render(root, state, options = {}) {
  activeRawInputsForRanges = state.rawInputs;
  state.inputs = normalizeInputs(state.rawInputs);
  state.validation = validateInputs(state.inputs);
  state.cursor = clamp(state.cursor, Math.max(state.rawInputs.ioutMax / 1000, 1e-3), state.rawInputs.ioutMax);

  const result = state.validation.valid ? computeLossPoint(state.inputs, state.cursor) : computeLossPoint(state.inputs, state.cursor);
  const xMin = Math.max(state.inputs.ioutMax / 1000, 1e-3);
  const xMax = state.inputs.ioutMax;
  state.sweep = state.validation.valid ? computeLossSweep(state.inputs, { points: 200, iMin: xMin, iMax: xMax }).filter((point) => point.valid) : [];
  state.plot = state.validation.valid
    ? { ...(state.plot || {}), xMin, xMax, maxLoss: niceCeil(1.1 * Math.max(...state.sweep.map((point) => point.pLoss), result.pLoss, 0.001)) }
    : null;

  updatePresetButtons(root, state.activePresetId);
  renderPrompt(root, state);
  renderPlot(root, state.inputs, result, state);
  updateCursorReadouts(root, state, { announce: options.announce });
}

function scheduleRender(root, state, options = {}) {
  if (state.renderTimer) clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => {
    state.renderTimer = 0;
    render(root, state, options);
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
        scheduleRender(root, state);
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
    activePresetId: defaultPreset.id,
    renderTimer: 0,
    inputs: normalizeInputs(defaultPreset.rawInputs),
    validation: { valid: true, errors: [] },
    sweep: [],
    plot: null
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
        render(root, state, { announce: true });
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
        scheduleRender(root, state, { announce: true });
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
        scheduleRender(root, state, { announce: true });
      });
    });
  });

  buildTicks(root, state);
  syncControls(state, numberControls, rangeControls);
  render(root, state);
}
