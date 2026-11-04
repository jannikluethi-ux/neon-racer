import * as THREE from "three";
import { bodyWidthAt, buildCarGeometry, type CarRole } from "./car-model";
import type { VehicleDefinition } from "./vehicle-def";
import { vehicleRaceNumber } from "./vehicle-def";
import { finishPaint } from "./vehicle-paint";

type ScreenPoint = { x: number; y: number; depth: number };
type Triangle = { points: [ScreenPoint, ScreenPoint, ScreenPoint]; depth: number; color: string };

const camera = new THREE.PerspectiveCamera(42, 360 / 220, 0.1, 80);
const lightDirection = new THREE.Vector3(-0.38, 0.86, 0.42).normalize();
const edgeAB = new THREE.Vector3();
const edgeAC = new THREE.Vector3();
const normal = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const projected = new THREE.Vector3();
const viewPoint = new THREE.Vector3();
const triangles: Triangle[] = [];

function project(x: number, y: number, z: number, viewMatrix: THREE.Matrix4, width: number, height: number): ScreenPoint {
  projected.set(x, y, z);
  viewPoint.copy(projected).applyMatrix4(viewMatrix);
  projected.project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    depth: -viewPoint.z,
  };
}

function shadedColor(color: number, intensity: number): string {
  return `#${new THREE.Color(color).multiplyScalar(intensity).getHexString()}`;
}

function roleColor(role: CarRole, def: VehicleDefinition): number {
  switch (role) {
    case "paint":
      return finishPaint(def.body.paint).getHex();
    case "carbon":
      return 0x191c22;
    case "glass":
      return finishPaint(def.body.paint).lerp(new THREE.Color(0x04060a), 0.86).getHex();
    case "dark":
      return 0x0b0d11;
    case "well":
      return 0x06070a;
    case "accent":
      return def.body.accent;
    case "lamp":
      return 0xf2f8ff;
    case "tail":
      return 0x9a142b;
    case "chrome":
      return 0x9aa4ae;
  }
}

function pushGeometry(
  geometry: THREE.BufferGeometry,
  color: number,
  offset: THREE.Vector3,
  viewMatrix: THREE.Matrix4,
  width: number,
  height: number,
): void {
  const positions = geometry.getAttribute("position");
  if (!positions) return;
  const index = geometry.getIndex();
  const count = index?.count ?? positions.count;
  const vertex = (i: number) => (index ? index.getX(i) : i);

  for (let i = 0; i + 2 < count; i += 3) {
    const ia = vertex(i);
    const ib = vertex(i + 1);
    const ic = vertex(i + 2);
    const ax = positions.getX(ia) + offset.x;
    const ay = positions.getY(ia) + offset.y;
    const az = positions.getZ(ia) + offset.z;
    const bx = positions.getX(ib) + offset.x;
    const by = positions.getY(ib) + offset.y;
    const bz = positions.getZ(ib) + offset.z;
    const cx = positions.getX(ic) + offset.x;
    const cy = positions.getY(ic) + offset.y;
    const cz = positions.getZ(ic) + offset.z;

    edgeAB.set(bx - ax, by - ay, bz - az);
    edgeAC.set(cx - ax, cy - ay, cz - az);
    normal.crossVectors(edgeAB, edgeAC).normalize();
    const centerX = (ax + bx + cx) / 3;
    const centerY = (ay + by + cy) / 3;
    const centerZ = (az + bz + cz) / 3;
    toCamera.set(camera.position.x - centerX, camera.position.y - centerY, camera.position.z - centerZ);
    if (normal.dot(toCamera) <= 0) continue;

    const points: [ScreenPoint, ScreenPoint, ScreenPoint] = [
      project(ax, ay, az, viewMatrix, width, height),
      project(bx, by, bz, viewMatrix, width, height),
      project(cx, cy, cz, viewMatrix, width, height),
    ];
    if (points.every((point) => point.depth <= camera.near) || points.every((point) => point.depth >= camera.far)) continue;
    const brightness = 0.58 + Math.max(0, normal.dot(lightDirection)) * 0.55;
    triangles.push({ points, depth: (points[0].depth + points[1].depth + points[2].depth) / 3, color: shadedColor(color, brightness) });
  }
}

function strokeTriangle(ctx: CanvasRenderingContext2D, triangle: Triangle): void {
  ctx.beginPath();
  ctx.moveTo(triangle.points[0].x, triangle.points[0].y);
  ctx.lineTo(triangle.points[1].x, triangle.points[1].y);
  ctx.lineTo(triangle.points[2].x, triangle.points[2].y);
  ctx.closePath();
  ctx.fillStyle = triangle.color;
  ctx.fill();
  ctx.strokeStyle = "rgb(214 245 255 / 0.11)";
  ctx.lineWidth = 0.45;
  ctx.stroke();
}

function drawNumberPlate(
  ctx: CanvasRenderingContext2D,
  def: VehicleDefinition,
  dims: ReturnType<typeof buildCarGeometry>["dims"],
  viewMatrix: THREE.Matrix4,
  width: number,
  height: number,
): void {
  const plateHeight = 0.39 * dims.numberScale * 0.86;
  const plateWidth = 0.39 * dims.numberScale * 1.5;
  const plateX = bodyWidthAt(def.id, -0.3) * 0.955;
  const plateY = dims.beltY - 0.14;
  const plateZ = -0.34;
  const tl = project(plateX, plateY + plateHeight / 2, plateZ + plateWidth / 2, viewMatrix, width, height);
  const tr = project(plateX, plateY + plateHeight / 2, plateZ - plateWidth / 2, viewMatrix, width, height);
  const br = project(plateX, plateY - plateHeight / 2, plateZ - plateWidth / 2, viewMatrix, width, height);
  const bl = project(plateX, plateY - plateHeight / 2, plateZ + plateWidth / 2, viewMatrix, width, height);
  const centerX = (tl.x + tr.x + br.x + bl.x) / 4;
  const centerY = (tl.y + tr.y + br.y + bl.y) / 4;
  const platePixelHeight = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x);

  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.fillStyle = "rgb(5 8 13 / 0.9)";
  ctx.fill();
  ctx.strokeStyle = `#${def.body.accent.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.fillStyle = "#f8fbff";
  ctx.font = `900 ${Math.max(8, platePixelHeight * 0.72)}px Arial Narrow, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(vehicleRaceNumber(def.id), 0, 0);
  ctx.restore();
}

/** Draws the actual authored body and wheel meshes as a small 2D garage render. */
export function drawCarModelPreview(canvas: HTMLCanvasElement, def: VehicleDefinition): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || 360);
  const height = Math.max(1, rect.height || 220);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const glow = ctx.createRadialGradient(width * 0.53, height * 0.81, 2, width * 0.53, height * 0.81, width * 0.48);
  glow.addColorStop(0, `#${def.body.accent.toString(16).padStart(6, "0")}38`);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgb(1 4 8 / 0.7)";
  ctx.beginPath();
  ctx.ellipse(width * 0.52, height * 0.84, width * 0.3, height * 0.065, -0.04, 0, Math.PI * 2);
  ctx.fill();

  camera.aspect = width / height;
  camera.position.set(3.3, 2.45, 5.4);
  camera.lookAt(0, 0.57, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const viewMatrix = camera.matrixWorldInverse;
  const built = buildCarGeometry(def.id);
  triangles.length = 0;
  const origin = new THREE.Vector3();

  for (const [role, geometry] of Object.entries(built.parts) as [CarRole, THREE.BufferGeometry][]) {
    if (!geometry) continue;
    pushGeometry(geometry, roleColor(role, def), origin, viewMatrix, width, height);
  }
  for (const wheel of built.wheels) {
    const offset = new THREE.Vector3(wheel.x, wheel.y, wheel.z);
    pushGeometry(wheel.tire, 0x17191e, offset, viewMatrix, width, height);
    pushGeometry(wheel.rim, 0xc4d3dc, offset, viewMatrix, width, height);
    pushGeometry(wheel.disc, 0x737f8a, offset, viewMatrix, width, height);
    pushGeometry(wheel.caliper, 0xff3dce, offset, viewMatrix, width, height);
  }
  triangles.sort((a, b) => b.depth - a.depth);
  for (const triangle of triangles) strokeTriangle(ctx, triangle);
  drawNumberPlate(ctx, def, built.dims, viewMatrix, width, height);

  const disposed = new Set<THREE.BufferGeometry>();
  for (const geometry of Object.values(built.parts)) {
    if (geometry && !disposed.has(geometry)) {
      disposed.add(geometry);
      geometry.dispose();
    }
  }
  for (const wheel of built.wheels) {
    for (const geometry of [wheel.tire, wheel.rim, wheel.disc, wheel.caliper]) {
      if (!disposed.has(geometry)) {
        disposed.add(geometry);
        geometry.dispose();
      }
    }
  }
}
