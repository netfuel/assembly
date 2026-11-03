import * as THREE from "three";
import { GRID } from "./grid";

/**
 * Flyer tiles: a few glowing squares on the map, the generated pixel-liquid art the promo video scatters
 * over the city. A cheap procedural pattern in the app's magenta and cyan, one InstancedMesh, one draw call.
 */
const COUNT = 4;

const VERT = /* glsl */ `
  attribute float seed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv; vSeed = seed;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 13.17) * 43758.5453); }
  void main() {
    // Coarse pixels, slowly drifting bands: a still from the liquid art, not the full shader.
    vec2 g = floor(vUv * 14.0);
    float band = sin((vUv.y + vSeed) * 9.0 + uTime * 0.25 + hash(g) * 1.2) * 0.5 + 0.5;
    float grain = hash(g + floor(uTime * 0.5));
    vec3 magenta = vec3(1.0, 0.24, 0.95);
    vec3 cyan = vec3(0.3, 0.9, 0.95);
    vec3 col = mix(magenta, cyan, step(0.78, band * 0.7 + grain * 0.5)) * (0.55 + 0.45 * band);
    // Soft edge so the tile reads as printed, not cut.
    vec2 e = smoothstep(0.0, 0.08, vUv) * smoothstep(0.0, 0.08, 1.0 - vUv);
    gl_FragColor = vec4(col * 0.62, e.x * e.y * 0.9);
  }`;

export class Tiles {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const seeds = new Float32Array(COUNT);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 } } });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, COUNT);
    let s = 23;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < COUNT; i++) {
      let x = 0;
      let z = 0;
      do {
        x = Math.round((rand() * 2 - 1) * 9) * GRID.street + GRID.street / 2;
        z = Math.round((rand() * 2 - 1) * 6) * GRID.street + GRID.street / 2;
      } while ((Math.abs(x) < 5 && Math.abs(z) < 4.5) || x < GRID.riverX + 2);
      const size = 0.6 + rand() * 0.35;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.3);
      m.compose(new THREE.Vector3(x, 0.03, z), q, new THREE.Vector3(size, 1, size));
      this.mesh.setMatrixAt(i, m);
      seeds[i] = rand() * 10;
    }
    geo.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 1));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(time: number) {
    this.mat.uniforms.uTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
