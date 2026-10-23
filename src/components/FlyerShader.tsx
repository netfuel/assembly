import { useEffect, useRef } from "react";
import * as THREE from "three";
import { prefersReducedMotion } from "../lib/motion";

/**
 * A generated flyer for events without uploaded art: a slow, domain-warped noise field
 * printed through a 4x4 ordered dither, like a photocopied rave flyer.
 * Two inks per event, seeded from the event id so each one looks different but stable.
 * Renders one still frame when the viewer prefers reduced motion, and pauses offscreen.
 */

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSeed;
  uniform vec2 uRes;
  uniform vec3 uInk;
  uniform vec3 uPaper;
  uniform vec3 uHot;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float bayer(vec2 p) {
    // 4x4 ordered dither threshold
    int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
    int i = x + y * 4;
    float m[16];
    m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
    m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
    for (int k = 0; k < 16; k++) { if (k == i) return (m[k] + 0.5) / 16.0; }
    return 0.5;
  }
  void main() {
    vec2 uv = vUv * vec2(uRes.x / uRes.y, 1.0) * 2.2;
    float t = uTime * 0.06;
    vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3) - t));
    vec2 r = vec2(fbm(uv + 3.0 * q + vec2(1.7, 9.2) + t * 1.4), fbm(uv + 3.0 * q + vec2(8.3, 2.8)));
    float f = fbm(uv + 3.5 * r);
    // contour bands give the terrain-map look
    float bands = smoothstep(0.42, 0.5, fract(f * 6.0));
    float tone = clamp(f * 1.35 - 0.12 + bands * 0.18, 0.0, 1.0);
    // dither at a chunky 3 px cell so it reads as print
    vec2 cell = floor(gl_FragCoord.xy / 3.0);
    float d = bayer(cell);
    vec3 col = tone > d ? uPaper : uInk;
    // a third ink in the brightest ridges
    if (tone > 0.86 && fract(f * 6.0) > 0.5) col = uHot;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function seedFrom(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 10;
}

export function FlyerShader({ id, queer }: { id: string; queer: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
    } catch {
      el.dataset.fallback = "true"; // CSS halftone takes over
      return;
    }
    renderer.setPixelRatio(1); // the dither is meant to be chunky
    el.appendChild(renderer.domElement);

    const paper = queer ? "#a98bff" : "#ff9a3c";
    const uniforms = {
      uTime: { value: 0 },
      uSeed: { value: seedFrom(id) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uInk: { value: new THREE.Color("#0a0a0b") },
      uPaper: { value: new THREE.Color(paper) },
      uHot: { value: new THREE.Color("#ff3df2") },
    };
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      uniforms.uRes.value.set(Math.max(1, width), Math.max(1, height));
      renderer.render(scene, camera);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const still = prefersReducedMotion();
    let visible = true;
    let raf = 0;
    const start = performance.now();
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);
    const loop = (now: number) => {
      if (visible) {
        uniforms.uTime.value = (now - start) / 1000;
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(loop);
    };
    if (!still) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [id, queer]);

  return <div ref={host} className="flyer-shader" aria-hidden="true" />;
}

export default FlyerShader;
