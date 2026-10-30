export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function wrapAngle(d: number): number {
  return Math.atan2(Math.sin(d), Math.cos(d));
}

export function hypot2(x: number, z: number): number {
  return Math.hypot(x, z);
}

export function formatRaceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—:—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const whole = Math.floor(s);
  const frac = Math.floor((s - whole) * 1000);
  return `${m}:${whole.toString().padStart(2, "0")}.${frac.toString().padStart(3, "0")}`;
}
