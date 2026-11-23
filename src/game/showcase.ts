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
  /**
   * Screen area (CSS px) covered by the picker's info panel, measured by the
   * picker. The showroom keeps the cars in the uncovered part of the screen.
   */
  cover: { left: 0, right: 0, top: 0, bottom: 0 },
};

export type StageCover = { left: number; right: number; top: number; bottom: number };

export type StageFraming = {
  /** Image shift in CSS px; positive moves the cars right / down. */
  offsetX: number;
  offsetY: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Multiplier on the garage camera distance. */
  distScale: number;
};

const BASE_FOV = 36;
/** Horizontal half-extent the garage was framed for (16:9-ish, about 1.75 aspect). */
const DESIGN_ASPECT = 1.75;
const MAX_FOV = 52;
const FIRST_PULL = 1.25;
const MAX_PULL = 1.6;

/**
 * Framing for the garage camera when part of the screen is covered by the info
 * panel (a side panel in short landscape, a bottom sheet in portrait). With no
 * cover and a wide screen it returns the default framing, so the desktop view
 * is unchanged. Pure, so the layout maths are unit-tested.
 */
export function stageFraming(width: number, height: number, cover: StageCover): StageFraming {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const left = Math.max(0, Math.min(cover.left, w * 0.7));
  const right = Math.max(0, Math.min(cover.right, w * 0.7));
  const top = Math.max(0, Math.min(cover.top, h * 0.7));
  const bottom = Math.max(0, Math.min(cover.bottom, h * 0.7));
  const freeW = Math.max(w * 0.3, w - left - right);
  const freeH = Math.max(h * 0.3, h - top - bottom);
  const baseTan = Math.tan(((BASE_FOV / 2) * Math.PI) / 180);
  // tan(vfov/2) needed so the free width shows what a DESIGN_ASPECT screen shows,
  // and the free height still shows ~90 % of the default vertical framing.
  const needW = (baseTan * DESIGN_ASPECT * h) / freeW;
  const needH = (baseTan * 0.9 * h) / freeH;
  const need = Math.max(baseTan, needW, needH);
  // Pull the camera back first (keeps the lens look), then widen the lens a
  // little, then pull back further.
  let distScale = Math.min(FIRST_PULL, need / baseTan);
  const maxTan = Math.tan(((MAX_FOV / 2) * Math.PI) / 180);
  const fovTan = Math.min(maxTan, Math.max(baseTan, need / distScale));
  distScale = Math.min(MAX_PULL, Math.max(distScale, need / fovTan));
  const fov = (2 * Math.atan(fovTan) * 180) / Math.PI;
  return {
    offsetX: (left - right) / 2,
    offsetY: (top - bottom) / 2,
    fov: Math.round(fov * 100) / 100,
    distScale: Math.round(distScale * 1000) / 1000,
  };
}

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
