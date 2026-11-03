import * as THREE from "three";

/**
 * Layer 1: an abstract Memphis street grid on the ground plane. Avenues every 4 units, streets every 1,
 * one diagonal (Poplar) and a river edge along the west as a dark void. All of it is one InstancedMesh of
 * flat strips, so it costs one draw call (the block fills are a second). Colours are the app map's road palette on its land colour.
 */
export const GRID = { extent: 42, avenue: 4, street: 1, riverX: -17 } as const;

const ROAD_MINOR = new THREE.Color("#33333b");
const ROAD_MAJOR = new THREE.Color("#45454f");
const ROAD_HIGHWAY = new THREE.Color("#585866");

/** Seeded so the grid is the same every visit: a map doesn't reshuffle itself. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function makeGrid(): THREE.Group {
  const group = new THREE.Group();
  const rand = rng(901);
  const strips: { x: number; z: number; len: number; w: number; rot: number; color: THREE.Color }[] = [];
  const E = GRID.extent;

  // North-south and east-west streets, broken into blocks with a few gaps so it reads as a city, not graph paper.
  for (let x = -E; x <= E; x += GRID.street) {
    if (x < GRID.riverX) continue; // the river
    const major = x % GRID.avenue === 0;
    for (let z = -E; z < E; z += 3) {
      if (!major && rand() < 0.18) continue;
      const len = 3 - (major ? 0 : 0.3);
      strips.push({ x, z: z + len / 2, len, w: major ? 0.09 : 0.04, rot: 0, color: major ? ROAD_MAJOR : ROAD_MINOR });
    }
  }
  for (let z = -E; z <= E; z += GRID.street) {
    const major = z % GRID.avenue === 0;
    for (let x = GRID.riverX; x < E; x += 3) {
      if (!major && rand() < 0.18) continue;
      const len = 3 - (major ? 0 : 0.3);
      strips.push({ x: x + len / 2, z, len, w: major ? 0.09 : 0.04, rot: Math.PI / 2, color: major ? ROAD_MAJOR : ROAD_MINOR });
    }
  }
  // Poplar: one long diagonal avenue, slightly brighter, and a second one crossing it (Union).
  strips.push({ x: 6, z: -4, len: E * 2.2, w: 0.2, rot: Math.PI / 2 - 0.42, color: ROAD_HIGHWAY });
  strips.push({ x: -2, z: 9, len: E * 1.6, w: 0.16, rot: Math.PI / 2 + 0.2, color: ROAD_HIGHWAY });
  // The riverbank: a thin bright edge where the land stops.
  strips.push({ x: GRID.riverX - 0.3, z: 0, len: E * 2, w: 0.12, rot: 0, color: ROAD_MINOR });

  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // lie flat
  const mat = new THREE.MeshBasicMaterial({ fog: true }); // per-instance colours come from instanceColor
  const mesh = new THREE.InstancedMesh(geo, mat, strips.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  strips.forEach((s, i) => {
    q.setFromAxisAngle(up, s.rot);
    m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(s.w, 1, s.len));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, s.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);

  // Blocks: the land between streets reads as a city when most blocks are filled a shade lighter than the
  // ground, the way the app's map draws building footprints. One more InstancedMesh.
  const blocks: { x: number; z: number; w: number; d: number }[] = [];
  for (let x = GRID.riverX; x < E; x += GRID.street) {
    for (let z = -E; z < E; z += GRID.street) {
      if (rand() < 0.3) continue;
      const inset = 0.12 + rand() * 0.1;
      blocks.push({ x: x + GRID.street / 2, z: z + GRID.street / 2, w: GRID.street - inset * 2, d: GRID.street - inset * 2 });
    }
  }
  const blockGeo = new THREE.PlaneGeometry(1, 1);
  blockGeo.rotateX(-Math.PI / 2);
  const blockMesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshBasicMaterial({ color: "#131316", fog: true }), blocks.length);
  blocks.forEach((b, i) => {
    m.compose(new THREE.Vector3(b.x, -0.005, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, 1, b.d));
    blockMesh.setMatrixAt(i, m);
  });
  blockMesh.instanceMatrix.needsUpdate = true;
  group.add(blockMesh);

  // Water: a flat darker slab west of the bank, under everything.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(E, E * 2.4), new THREE.MeshBasicMaterial({ color: "#08090c", fog: true }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(GRID.riverX - E / 2 - 0.3, -0.01, 0);
  group.add(water);
  return group;
}
