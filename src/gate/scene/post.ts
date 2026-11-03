import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Layer 3: one post pass. Film grain, a one-pixel offset of the magenta channel (the splash's off-register
 * echo), and a vignette so the panel in the middle is the brightest thing. Fog is in the scene itself.
 */
const SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uOffset: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uDim: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uOffset, uDim;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime) * 43758.5453); }
    void main() {
      vec2 px = uOffset / uRes;
      vec4 c = texture2D(tDiffuse, vUv);
      // The accent prints a pixel off to the right: its red and blue, not its green.
      vec4 o = texture2D(tDiffuse, vUv + vec2(px.x, 0.0));
      c.r = mix(c.r, o.r, 0.5);
      c.b = mix(c.b, o.b, 0.5);
      float g = (hash(floor(vUv * uRes * 0.5)) - 0.5) * uGrain;
      vec2 q = vUv - 0.5;
      float vig = 1.0 - smoothstep(0.35, 0.95, length(q) * 1.4);
      c.rgb = (c.rgb + g) * mix(0.82, 1.0, vig) * (1.0 - uDim * 0.15);
      gl_FragColor = c;
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  private readonly pass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(SHADER);
    this.composer.addPass(this.pass);
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pixelRatio);
    this.pass.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  render(time: number, dim: number) {
    this.pass.uniforms.uTime.value = time;
    this.pass.uniforms.uDim.value = dim;
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
