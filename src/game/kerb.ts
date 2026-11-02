import type { Sample } from "./track";

/**
 * Kerb profile shared by the road builder and the vehicle.
 *
 * The road module extrudes the kerb from these numbers; the simulator lifts
 * the car by exactly the same surface so a tire that drives onto a kerb rides
 * on top of it instead of sinking into it. Pure maths — no Three.js, so the
 * physics side can import it without pulling rendering code in.
 */

/** Band width measured inboard of the road edge. */
export const KERB_W = 0.72;
/** How far the kerb overhangs the road edge. */
export const KERB_OUT = 0.1;
/** Lip height where the kerb meets the tarmac (a real kerb starts nearly flush). */
export const KERB_FLOOR = 0.018;
/** Height at the inner edge — small, so cars ramp onto it instead of climbing a wall. */
export const KERB_FRONT = 0.026;
/** Height at the outer edge. Kept under the cars' floor height. */
export const KERB_CROWN = 0.1;
/** Curvature below/above which a kerb fades in. */
export const KERB_ON = 0.0068;
export const KERB_OFF = 0.004;
/** Runs shorter than this are dropped so a wiggle can never become dashes. */
export const KERB_MIN_ARC = 7;
/** Half-track used when the simulator asks how far out the outer tire sits. */
export const KERB_WHEEL_LAT = 1.0;

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** 0..1 kerb presence for one sample's curvature. */
export function kerbWeightOf(curv: number): number {
  const c = Math.abs(curv);
  if (c <= KERB_OFF) return 0;
  if (c >= KERB_ON) return 1;
  return smooth01((c - KERB_OFF) / (KERB_ON - KERB_OFF));
}

/**
 * Kerb presence per sample, with short runs dropped so the table matches the
 * extruded geometry exactly. Cached per samples array (tracks are rebuilt only
 * when the circuit changes).
 */
export function kerbWeightProfile(samples: readonly Sample[]): Float32Array {
  const cached = profileCache.get(samples);
  if (cached) return cached;
  const n = samples.length;
  const weights = new Float32Array(n);
  for (let i = 0; i < n; i++) weights[i] = kerbWeightOf(samples[i]!.curv);
  // Runs are computed on a copy because "shortest run in the loop" can wrap
  // through index 0, and zeroing as we scanned would corrupt that pass.
  const runs = collectRuns(samples, weights);
  const kept = new Float32Array(n);
  for (const run of runs) for (const i of run) kept[i] = weights[i]!;
  profileCache.set(samples, kept);
  return kept;
}

const profileCache = new WeakMap<readonly Sample[], Float32Array>();

/** Adjacent samples with a kerb, with runs shorter than KERB_MIN_ARC dropped. */
function collectRuns(samples: readonly Sample[], weights: Float32Array): number[][] {
  const n = samples.length;
  let start = 0;
  while (start < n && weights[start]! > 0) start++;
  const runs: number[][] = [];
  let current: number[] = [];
  let arc = 0;
  const flush = () => {
    if (current.length >= 2 && arc >= KERB_MIN_ARC) runs.push(current);
    current = [];
    arc = 0;
  };
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (weights[i]! > 0) {
      current.push(i);
      arc += samples[i]!.segLen;
    } else {
      flush();
    }
  }
  flush();
  return runs;
}

/**
 * Height above the tarmac of the kerb surface at a lateral offset, for a given
 * presence weight. `lat` is metres from the centreline, signed either way.
 */
export function kerbSurfaceAt(lat: number, roadHalf: number, weight: number): number {
  if (weight <= 0) return 0;
  const inner = roadHalf - KERB_W;
  const t = (Math.abs(lat) - inner) / (KERB_W + KERB_OUT);
  if (t <= 0) return 0;
  const front = KERB_FLOOR + weight * (KERB_FRONT - KERB_FLOOR);
  const crown = KERB_FLOOR + weight * (KERB_CROWN - KERB_FLOOR);
  const clamped = t > 1 ? 1 : t;
  return front + (crown - front) * clamped;
}
