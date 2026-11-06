/** Geometry and release decisions shared by touch, mouse and keyboard controls. */
export const SHEET_SNAPS = ['peek', 'half', 'full'];
export const clampSheetHeight = (height, heights) => Math.max(heights.peek, Math.min(heights.full, height));

export function sheetHeights(viewportHeight, peekHeight, safeTop = 0) {
  const viewport = Math.max(1, Number(viewportHeight) || 1);
  const full = Math.max(1, Math.min(Math.round(viewport * .92), viewport - safeTop - 8));
  const peek = Math.min(full, Math.max(104, Math.ceil(peekHeight) || 104));
  const half = Math.min(full, Math.max(Math.round(viewport * .5), peek + 64));
  return { peek, half, full };
}

export function stepSheetSnap(snap, direction) {
  const index = Math.max(0, SHEET_SNAPS.indexOf(snap));
  return SHEET_SNAPS[Math.max(0, Math.min(SHEET_SNAPS.length - 1, index + direction))];
}

/** A short intentional swipe moves one stop; long drags can cross two stops. */
export function releaseSheetSnap({ snap, startHeight, height, velocity = 0, heights }) {
  const distance = height - startHeight;
  if (Math.abs(distance) < 8) return snap;
  const projected = clampSheetHeight(height + Math.max(-1.5, Math.min(1.5, velocity)) * 120, heights);
  let nearest = SHEET_SNAPS.reduce((best, candidate) =>
    Math.abs(heights[candidate] - projected) < Math.abs(heights[best] - projected) ? candidate : best, snap);
  if (nearest === snap && (Math.abs(distance) >= 32 || Math.abs(velocity) >= .45)) {
    nearest = stepSheetSnap(snap, distance > 0 ? 1 : -1);
  }
  return nearest;
}
