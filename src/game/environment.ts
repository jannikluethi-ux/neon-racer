import * as THREE from "three";
import type { TrackTheme } from "./track-def";

/**
 * Themed reflection environment.
 *
 * The stock RoomEnvironment is a white studio: under it every metallic paint
 * reads silver and carbon reads chrome, which is exactly the washed-out look
 * this milestone is removing. This builds a small equirectangular sky from the
 * circuit theme — dark zenith, bright horizon band, a couple of soft light
 * sources — and PMREM-converts it, so reflections carry the night instead of
 * bleaching it.
 */
export type BuiltEnvironment = {
  texture: THREE.Texture;
  dispose: () => void;
};

function hex(color: THREE.Color): string {
  return `#${color.getHexString()}`;
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, theme: TrackTheme): BuiltEnvironment {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  const zenith = new THREE.Color(theme.sky).multiplyScalar(1.35);
  const horizon = new THREE.Color(theme.fog);
  const band = theme.kind === "yard" ? new THREE.Color(0xff9a4a) : theme.kind === "core" ? new THREE.Color(0xff5f6d) : theme.kind === "coast" ? new THREE.Color(0x9fd8ff) : new THREE.Color(0x7fe6ff);
  const ground = new THREE.Color(theme.hemiGround).multiplyScalar(0.5);
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, hex(zenith));
    grad.addColorStop(0.36, hex(horizon.clone().multiplyScalar(1.05)));
    grad.addColorStop(0.49, hex(band.clone().lerp(horizon, 0.45)));
    grad.addColorStop(0.53, hex(horizon.clone().multiplyScalar(0.5)));
    grad.addColorStop(1, hex(ground));
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    // Soft light sources: these are what a clearcoat actually mirrors.
    const lights: Array<[number, number, number, string]> =
      theme.kind === "city"
        ? [[80, 96, 46, "#dff3ff"], [250, 78, 34, "#ffe6c0"], [400, 104, 52, "#bfe9ff"], [170, 140, 60, "#9fd0ff"]]
        : theme.kind === "yard"
          ? [[110, 90, 52, "#ffd9a8"], [330, 84, 44, "#ffc98a"], [452, 120, 36, "#ffe2bc"]]
          : theme.kind === "core"
            ? [[140, 88, 48, "#ffb0b8"], [360, 96, 56, "#ff9aa6"], [60, 132, 40, "#ffd3b0"]]
            : [[120, 74, 60, "#eaf6ff"], [300, 88, 44, "#cfe8ff"], [470, 118, 38, "#ffe9c4"]];
    for (const [x, y, r, color] of lights) {
      const shade = g.createRadialGradient(x, y, r * 0.1, x, y, r);
      shade.addColorStop(0, color);
      shade.addColorStop(0.45, `${color}88`);
      shade.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = shade;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Horizon haze keeps the reflection band continuous around the car.
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(0, 118, 512, 8);
  }
  const source = new THREE.CanvasTexture(canvas);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromEquirectangular(source).texture;
  source.dispose();
  pmrem.dispose();
  return {
    texture,
    dispose: () => texture.dispose(),
  };
}
