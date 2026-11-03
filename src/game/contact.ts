/**
 * Visual road-contact fit.
 *
 * Horizontal driving does not read this. It turns four wheel-surface heights
 * into a chassis plane (pitch, roll, height at the origin) plus the residual
 * each wheel still has to travel to sit on its own patch. A single plane cannot
 * absorb a crest between the axles or one wheel on a kerb; those leftovers are
 * the wheel residuals, not a new tire model.
 *
 * Pitch is nose-up positive. Roll is driver's-left-up positive. Car-local +X is
 * left, +Z is the nose, and the origin is the tire-contact point under the body
 * — not the axle midpoint, so the axle stations are not symmetric about z = 0.
 */

/** Shared vertical datum for the wheel mesh and the rendered asphalt deck. */
export const WHEEL_CONTACT_Y = 0.032;
export const ROAD_DECK_Y = 0.03;
/** Small offset that keeps the translucent wheel marks above the asphalt. */
export const DECAL_CLEARANCE = 0.004;

export type GradeLayout = {
  /** Positive half-track of the left front / rear wheel (m). */
  frontX: number;
  rearX: number;
  frontZ: number;
  rearZ: number;
};

export type GradeFit = {
  pitch: number;
  roll: number;
  /** Height of the fitted plane at the car origin. */
  center: number;
  sinPitch: number;
  sinRoll: number;
};

const MAX_SIN = 0.98;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/**
 * Fit a plane through the four wheel patches.
 * Heights are world-up metres in order FL, FR, RL, RR.
 */
export function fitRoadGrade(
  heights: readonly [number, number, number, number],
  layout: GradeLayout,
): GradeFit {
  const [fl, fr, rl, rr] = heights;
  const front = (fl + fr) * 0.5;
  const rear = (rl + rr) * 0.5;
  const wb = layout.frontZ - layout.rearZ || 1;
  const sinPitch = clamp((front - rear) / wb, -MAX_SIN, MAX_SIN);
  // Remove the longitudinal slope, then fit roll across the track.
  const fl2 = fl - sinPitch * layout.frontZ;
  const fr2 = fr - sinPitch * layout.frontZ;
  const rl2 = rl - sinPitch * layout.rearZ;
  const rr2 = rr - sinPitch * layout.rearZ;
  const left = (fl2 + rl2) * 0.5;
  const right = (fr2 + rr2) * 0.5;
  const span = layout.frontX + layout.rearX || 1;
  const sinRoll = clamp((left - right) / span, -MAX_SIN, MAX_SIN);
  const center = (fl2 + fr2 + rl2 + rr2) * 0.25;
  return {
    pitch: Math.asin(sinPitch),
    roll: Math.asin(sinRoll),
    center,
    sinPitch,
    sinRoll,
  };
}

/** Height of the fitted plane at a car-local wheel (x left-positive, z nose-positive). */
export function planeHeight(fit: GradeFit, x: number, z: number): number {
  return fit.center + fit.sinPitch * z + fit.sinRoll * x;
}
