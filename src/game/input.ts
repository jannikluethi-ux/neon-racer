import { clamp } from "./math";
import type { InputCommand } from "./types";

const keys = new Set<string>();
let override: Set<string> | null = null;

export const touch = {
  left: false,
  right: false,
  throttle: false,
  brake: false,
  drift: false,
  boost: false,
};

function down(code: string): boolean {
  if (override) return override.has(code);
  return keys.has(code);
}

export function setTestKeys(codes: string[]): void {
  override = new Set(codes);
}

export function attachInput(): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    keys.add(e.code);
  };
  const onUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  const clear = () => keys.clear();
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
  return () => {
    window.removeEventListener("keydown", onDown);
    window.removeEventListener("keyup", onUp);
    window.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", clear);
    keys.clear();
  };
}

function gamepadBits(): { steer: number; throttle: number; brake: number; drift: boolean; boost: boolean } {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    const ax = pad.axes[0] ?? 0;
    const steer = Math.abs(ax) > 0.12 ? -ax : 0;
    const btn = (i: number) => pad.buttons[i]?.value ?? 0;
    return {
      steer,
      throttle: Math.max(btn(7), btn(5)),
      brake: Math.max(btn(6), btn(4)),
      drift: false,
      boost: btn(1) > 0.5 || btn(0) > 0.5,
    };
  }
  return { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
}

/** Edge-triggered gamepad pause button (standard button 9 = Start/Options).
 * Returns true only on the frame the button is newly pressed, so holding it
 * toggles once. Polled once per frame from the engine loop. */
let gamepadPausePrev = false;
export function gamepadPausePressed(): boolean {
  const pads = navigator.getGamepads?.() ?? [];
  let pressed = false;
  for (const pad of pads) {
    if (pad && (pad.buttons[9]?.value ?? 0) > 0.5) {
      pressed = true;
      break;
    }
  }
  const edge = pressed && !gamepadPausePrev;
  gamepadPausePrev = pressed;
  return edge;
}

/** Shared command for keyboard, touch, and gamepad. */
export function readCommand(): InputCommand {
  let steer = 0;
  if (down("KeyA") || down("ArrowLeft")) steer += 1;
  if (down("KeyD") || down("ArrowRight")) steer -= 1;
  let throttle = down("KeyW") || down("ArrowUp") ? 1 : 0;
  let brake = down("KeyS") || down("ArrowDown") ? 1 : 0;
  let boost = down("Space") || down("ShiftLeft") || down("ShiftRight");

  if (!override) {
    if (touch.left) steer += 1;
    if (touch.right) steer -= 1;
    if (touch.throttle) throttle = 1;
    if (touch.brake) brake = 1;
    if (touch.boost) boost = true;
    const pad = gamepadBits();
    steer += pad.steer;
    throttle = Math.max(throttle, pad.throttle);
    brake = Math.max(brake, pad.brake);
    boost = boost || pad.boost;
  }

  if (brake > 0.2) throttle = 0;

  return {
    throttle,
    brake,
    steer: clamp(steer, -1, 1),
    drift: false,
    boost,
  };
}
