// Compatibility exports for the legacy viewer. Ordinary UI changes are immediate.
export function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function animateFlip() { return []; }
export async function animateDialog() {}

export async function animatePanelSwap(container, fromPanel, toPanel) {
  if (!fromPanel || !toPanel || fromPanel === toPanel) return false;
  fromPanel.hidden = true;
  toPanel.hidden = false;
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

export function animatePointSeries({ toPoints, draw }) {
  draw(toPoints);
  return null;
}
