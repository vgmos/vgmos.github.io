const figure = document.getElementById("fig-rc-step");

if (figure) {
  const styles = getComputedStyle(document.documentElement);
  const color = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const ink = color("--ink", "#20201f");
  const muted = color("--muted", "#69645e");
  const line = color("--line", "#e6e0d7");
  const accent = color("--accent", "#2f6f64");
  const warm = color("--accent-warm", "#8a5a30");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  figure.innerHTML = `
    <div class="fig-interactive__plot" aria-live="polite"></div>
    <div class="fig-interactive__controls">
      <label>
        Resistance: <span data-rc-value="r"></span>
        <input data-rc-control="r" type="range" min="1" max="100" value="22" step="1">
      </label>
      <label>
        Capacitance: <span data-rc-value="c"></span>
        <input data-rc-control="c" type="range" min="1" max="220" value="47" step="1">
      </label>
    </div>
    <figcaption class="quiet-note">First-order capacitor charging after a voltage step.</figcaption>
  `;

  const plot = figure.querySelector(".fig-interactive__plot");
  const rInput = figure.querySelector('[data-rc-control="r"]');
  const cInput = figure.querySelector('[data-rc-control="c"]');
  const rValue = figure.querySelector('[data-rc-value="r"]');
  const cValue = figure.querySelector('[data-rc-value="c"]');
  let animationFrame = 0;

  const svgNS = "http://www.w3.org/2000/svg";

  function el(name, attrs = {}, text = "") {
    const node = document.createElementNS(svgNS, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function point(t, tau, left, top, width, height) {
    const x = left + (t / (5 * tau)) * width;
    const yValue = 1 - Math.exp(-t / tau);
    const y = top + height - yValue * height;
    return [x, y];
  }

  function pathData(tau, left, top, width, height) {
    const points = [];
    for (let i = 0; i <= 96; i += 1) {
      points.push(point((i / 96) * 5 * tau, tau, left, top, width, height));
    }
    return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  }

  function render(animate = true) {
    cancelAnimationFrame(animationFrame);

    const r = Number(rInput.value);
    const c = Number(cInput.value);
    const tau = r * c;
    rValue.textContent = `${r} kOhm`;
    cValue.textContent = `${c} uF`;

    const width = 640;
    const height = 360;
    const left = 64;
    const top = 34;
    const plotWidth = 528;
    const plotHeight = 246;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `RC step response with time constant ${tau} milliseconds`
    });

    svg.append(
      el("line", { x1: left, y1: top + plotHeight, x2: left + plotWidth, y2: top + plotHeight, stroke: line, "stroke-width": 2 }),
      el("line", { x1: left, y1: top, x2: left, y2: top + plotHeight, stroke: line, "stroke-width": 2 }),
      el("line", { x1: left, y1: top, x2: left + plotWidth, y2: top, stroke: line, "stroke-dasharray": "6 8" }),
      el("text", { x: left, y: top - 10, fill: muted, "font-size": 16 }, "Vfinal"),
      el("text", { x: left + plotWidth - 92, y: top + plotHeight + 34, fill: muted, "font-size": 16 }, "time"),
      el("text", { x: left + 8, y: top + plotHeight - 10, fill: muted, "font-size": 16 }, "0"),
      el("text", { x: left + 16, y: top + 30, fill: warm, "font-size": 16 }, `tau = ${tau} ms`)
    );

    for (let i = 1; i <= 5; i += 1) {
      const x = left + (i / 5) * plotWidth;
      svg.append(
        el("line", { x1: x, y1: top, x2: x, y2: top + plotHeight, stroke: line, "stroke-width": 1 }),
        el("text", { x: x - 10, y: top + plotHeight + 24, fill: muted, "font-size": 13 }, `${i}t`)
      );
    }

    const curve = el("path", {
      d: pathData(tau, left, top, plotWidth, plotHeight),
      fill: "none",
      stroke: accent,
      "stroke-width": 4,
      "stroke-linecap": "round"
    });
    svg.append(curve);
    plot.replaceChildren(svg);

    if (animate && !reducedMotion) {
      const length = curve.getTotalLength();
      curve.style.strokeDasharray = length;
      curve.style.strokeDashoffset = length;
      const start = performance.now();
      const duration = 900;

      function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        curve.style.strokeDashoffset = String(length * (1 - progress));
        if (progress < 1) animationFrame = requestAnimationFrame(step);
      }

      animationFrame = requestAnimationFrame(step);
    }
  }

  rInput.addEventListener("input", () => render());
  cInput.addEventListener("input", () => render());
  render(true);
}
