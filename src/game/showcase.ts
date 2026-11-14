/** Transient selection-presentation state. Not saved, and never read by physics. */

export type ShowcaseView = "front" | "side" | "rear";

export const showcase = {
  /** Continuous carousel positions. Integers are snapped cars / tracks. */
  car: 0,
  carTarget: 0,
  track: 0,
  trackTarget: 0,
  dragging: null as null | "car" | "track",
  view: "front" as ShowcaseView,
  /** 1 is the default framing. Lower moves the camera closer. */
  zoom: 1,
  /** Added to the garage camera height. Drag up / down to inspect. */
  pitch: 0,
  /** 0 = garage, 1 = track pit. Animated by the showroom. */
  venue: 0,
};

export function wrapIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  const m = Math.round(value) % count;
  return m < 0 ? m + count : m;
}

/** Shortest step that lands the continuous carousel on `index`. */
export function retarget(current: number, index: number, count: number): number {
  const base = Math.round(current);
  const from = wrapIndex(base, count);
  let delta = index - from;
  if (delta > count / 2) delta -= count;
  if (delta < -count / 2) delta += count;
  return base + delta;
}

export function clampZoom(zoom: number): number {
  return Math.min(1.38, Math.max(0.82, zoom));
}

export function clampPitch(pitch: number): number {
  return Math.min(0.55, Math.max(-0.28, pitch));
}
