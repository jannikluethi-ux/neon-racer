import * as THREE from "three";

/**
 * Strip winding helpers.
 *
 * A ribbon authored left-edge then right-edge, walking forward, faces up with
 * the index order (left0, left1, right0). Vertical strips with the same order
 * face one lateral direction only — that is why one side of a wall used to
 * vanish under back-face culling. `faceToward` flips a whole geometry when its
 * triangles point away from the side the camera actually sees, then recomputes
 * normals. It does not paper over a bad winding with DoubleSide.
 */

export function triangleNormal(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): [number, number, number] {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Area-weighted average geometric normal of indexed triangles. */
export function averageNormal(geo: THREE.BufferGeometry): THREE.Vector3 {
  const index = geo.getIndex();
  const pos = geo.getAttribute("position");
  const n = new THREE.Vector3();
  if (!index || !pos) return n;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  for (let i = 0; i + 2 < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1));
    c.fromBufferAttribute(pos, index.getX(i + 2));
    cross.subVectors(b, a).cross(c.clone().sub(a));
    n.add(cross);
  }
  if (n.lengthSq() > 1e-18) n.normalize();
  else n.set(0, 0, 0);
  return n;
}

/** First non-degenerate triangle normal; unlike an average it survives a closed loop. */
export function firstTriangleNormal(geo: THREE.BufferGeometry): THREE.Vector3 {
  const index = geo.getIndex();
  const pos = geo.getAttribute("position");
  const normal = new THREE.Vector3();
  if (!index || !pos) return normal;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i + 2 < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1));
    c.fromBufferAttribute(pos, index.getX(i + 2));
    normal.subVectors(b, a).cross(c.sub(a));
    if (normal.lengthSq() > 1e-18) return normal.normalize();
  }
  return normal.set(0, 0, 0);
}

/**
 * Flip triangle order so the first local face points with `dir`. Closed wall
 * strips have opposing outward normals around their loop, so averaging them
 * can cancel to zero even when every triangle has consistent winding.
 * Returns true when a flip was required.
 */
export function faceToward(geo: THREE.BufferGeometry, dir: THREE.Vector3): boolean {
  const index = geo.getIndex();
  if (!index || index.count < 3) {
    geo.computeVertexNormals();
    return false;
  }
  const normal = firstTriangleNormal(geo);
  const flip = normal.dot(dir) < 0;
  if (flip) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      index.setX(i + 1, c);
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return flip;
}
