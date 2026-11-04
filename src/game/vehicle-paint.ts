import * as THREE from "three";

/** Shared player-car paint grading for the race renderer and garage previews. */
export function finishPaint(hex: number): THREE.Color {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, Math.min(0.7, Math.max(0.4, hsl.s + 0.12)), Math.min(0.42, Math.max(0.2, hsl.l + 0.08)));
  return color;
}
