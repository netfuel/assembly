import * as THREE from "three";
import { GRID } from "./grid";

/**
 * Layer 1, continued: event pins on the grid. One Points object with a shader that draws a soft dot and a
 * pulse ring, like the app's live pin. How many are lit follows the clock: a few cold UV pins in the
 * afternoon, more and warmer after dark. The centre of the ground is kept clear for the form.
 */
const ACCENT = new THREE.Color("#ff3df2");
const UV = new THREE.Color("#7b5cf0");
const LIVE = new THREE.Color("#3f8a00");
export const PIN_COUNT = 40;

const VERT = /* glsl */ `
  attribute vec3 tint;
  attribute float phase;
  attribute float lit;
  uniform float uTime, uPixelRatio, uNear;
  varying vec3 vTint;
  varying float vPulse, vLit, vNear;
  void main() {
    vTint = tint; vLit = lit;
    vPulse = fract(uTime * 0.35 + phase);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNear = uNear;
    float size = (18.0 + 10.0 * uNear) * uPixelRatio;
    gl_PointSize = size * (16.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  varying vec3 vTint;
  varying float vPulse, vLit, vNear;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float dot = smoothstep(0.42, 0.16, d);
    float glow = smoothstep(1.0, 0.3, d) * 0.22;
    float ring = smoothstep(0.07, 0.0, abs(d - vPulse * 0.95)) * (1.0 - vPulse) * 0.7;
    float a = (dot + glow + ring) * vLit;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint * (1.0 + vNear * 0.6), a);
  }`;

export class Pins {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly lit: Float32Array;
  private readonly mat: THREE.ShaderMaterial;
  private target = new Float32Array(PIN_COUNT);

  constructor(pixelRatio: number) {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(PIN_COUNT * 3);
    const tint = new Float32Array(PIN_COUNT * 3);
    const phase = new Float32Array(PIN_COUNT);
    this.lit = new Float32Array(PIN_COUNT);
    let s = 7;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < PIN_COUNT; i++) {
      // On a street corner, never within the middle 5 units where the form sits.
      let x = 0;
      let z = 0;
      do {
        x = Math.round((rand() * 2 - 1) * 10) * GRID.street;
        z = Math.round((rand() * 2 - 1) * 7) * GRID.street;
      } while ((Math.abs(x) < 4.5 && Math.abs(z) < 4) || x < GRID.riverX + 2);
      this.positions.set([x, 0.06, z], i * 3);
      const c = i % 7 === 0 ? LIVE : i % 3 === 0 ? UV : ACCENT;
      tint.set([c.r, c.g, c.b], i * 3);
      phase[i] = rand();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
    geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("lit", new THREE.BufferAttribute(this.lit, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uNear: { value: 0 } },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.setHour(new Date().getHours());
  }

  /** How many pins are lit for this hour: tonight's map fills in after dark. */
  setHour(hour: number) {
    const share = hour >= 21 || hour < 3 ? 1 : hour >= 18 ? 0.7 : hour >= 15 ? 0.4 : 0.22;
    const n = Math.round(PIN_COUNT * share);
    for (let i = 0; i < PIN_COUNT; i++) this.target[i] = i < n ? 1 : 0;
  }

  /** Pins near the pointer (world x, z) brighten. */
  update(time: number, near: { x: number; z: number } | null, dim: number) {
    this.mat.uniforms.uTime.value = time;
    let nearest = 0;
    for (let i = 0; i < PIN_COUNT; i++) {
      let want = this.target[i] * (1 - dim * 0.5);
      if (near && want > 0) {
        const dx = this.positions[i * 3] - near.x;
        const dz = this.positions[i * 3 + 2] - near.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.4) {
          want = Math.min(1.4, want + (1 - d / 2.4));
          nearest = Math.max(nearest, 1 - d / 2.4);
        }
      }
      this.lit[i] += (want - this.lit[i]) * 0.08;
    }
    this.mat.uniforms.uNear.value = nearest;
    (this.points.geometry.getAttribute("lit") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
