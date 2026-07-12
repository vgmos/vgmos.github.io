export function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function canAnimate(element) {
  return Boolean(element?.animate) && !prefersReducedMotion();
}

export function runAnimation(element, keyframes, options) {
  if (!canAnimate(element)) return null;
  element.getAnimations().forEach((animation) => animation.cancel());
  return element.animate(keyframes, { fill: "both", ...options });
}

export function animateFlip(elements, beforeRects, options = {}) {
  if (prefersReducedMotion()) return [];
  const animations = [];
  elements.forEach((element) => {
    const before = beforeRects.get(element);
    if (!before) return;
    const after = element.getBoundingClientRect();
    const deltaY = before.top - after.top;
    if (Math.abs(deltaY) < 0.5) return;
    const animation = runAnimation(element, [
      { transform: `translateY(${deltaY}px)` },
      { transform: "translateY(0)" }
    ], {
      duration: options.duration ?? 220,
      easing: options.easing ?? "cubic-bezier(0.16, 1, 0.3, 1)"
    });
    if (animation) animations.push(animation);
  });
  return animations;
}

export async function animateDialog(dialog, opening) {
  if (!canAnimate(dialog)) return;
  const frame = dialog.querySelector(".blx-input-sheet-frame") || dialog;
  const animation = runAnimation(frame, opening ? [
    { opacity: 0, transform: "translateY(24px) scale(.985)" },
    { opacity: 1, transform: "translateY(0) scale(1)" }
  ] : [
    { opacity: 1, transform: "translateY(0) scale(1)" },
    { opacity: 0, transform: "translateY(18px) scale(.992)" }
  ], {
    duration: opening ? 320 : 220,
    easing: opening
      ? "cubic-bezier(0.22, 1.08, 0.36, 1)"
      : "cubic-bezier(0.65, 0, 0.35, 1)"
  });
  if (animation) await animation.finished.catch(() => {});
}

export async function animatePanelSwap(container, fromPanel, toPanel, direction = 1) {
  if (!fromPanel || !toPanel || fromPanel === toPanel || !canAnimate(container)) return false;
  if (globalThis.matchMedia?.("(max-width: 700px)").matches) return false;
  const fromHeight = fromPanel.getBoundingClientRect().height;
  toPanel.hidden = false;
  toPanel.style.position = "absolute";
  toPanel.style.inset = "0 0 auto";
  toPanel.style.width = "100%";
  const toHeight = toPanel.getBoundingClientRect().height;
  container.style.height = `${fromHeight}px`;
  container.style.overflow = "hidden";

  const outgoing = runAnimation(fromPanel, [
    { opacity: 1, transform: "translateX(0)" },
    { opacity: 0, transform: `translateX(${-8 * direction}px)` }
  ], { duration: 180, easing: "cubic-bezier(0.65, 0, 0.35, 1)" });
  const incoming = runAnimation(toPanel, [
    { opacity: 0, transform: `translateX(${8 * direction}px)` },
    { opacity: 1, transform: "translateX(0)" }
  ], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  const resize = runAnimation(container, [
    { height: `${fromHeight}px` },
    { height: `${toHeight}px` }
  ], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });

  await Promise.all([outgoing, incoming, resize].filter(Boolean).map((animation) => animation.finished.catch(() => {})));
  fromPanel.hidden = true;
  toPanel.style.position = "";
  toPanel.style.inset = "";
  toPanel.style.width = "";
  container.style.height = "";
  container.style.overflow = "";
  return true;
}

export function interpolatePoints(fromPoints, toPoints, progress) {
  if (!Array.isArray(toPoints) || !toPoints.length) return [];
  if (!Array.isArray(fromPoints) || fromPoints.length !== toPoints.length) return toPoints;
  return toPoints.map((point, index) => {
    const from = fromPoints[index];
    return [
      from[0] + (point[0] - from[0]) * progress,
      from[1] + (point[1] - from[1]) * progress
    ];
  });
}

export function animatePointSeries({ fromPoints, toPoints, duration = 220, draw }) {
  if (prefersReducedMotion() || !Array.isArray(fromPoints) || fromPoints.length !== toPoints.length) {
    draw(toPoints);
    return null;
  }
  let cancelled = false;
  const start = performance.now();
  const tick = (now) => {
    if (cancelled) return;
    const raw = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - raw, 4);
    draw(interpolatePoints(fromPoints, toPoints, eased));
    if (raw < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { cancel: () => { cancelled = true; } };
}

export function animateWaveformDomain({ from, to, duration = 150, draw }) {
  if (prefersReducedMotion() || !from || !to) {
    draw(to);
    return null;
  }
  let cancelled = false;
  const start = performance.now();
  const tick = (now) => {
    if (cancelled) return;
    const raw = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - raw, 3);
    draw({
      ...to,
      startPhase: from.startPhase + (to.startPhase - from.startPhase) * eased,
      endPhase: from.endPhase + (to.endPhase - from.endPhase) * eased
    });
    if (raw < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { cancel: () => { cancelled = true; } };
}
