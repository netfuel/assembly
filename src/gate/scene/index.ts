import * as THREE from "three";
import gsap from "gsap";
import { BRAND_COLORS } from "../../../shared/brandGeometry";
import { makeGrid } from "./grid";
import { Pins } from "./pins";
import { Lines } from "./lines";
import { Post } from "./post";
import { Tiles } from "./tiles";

/**
 * The gate's background: the Memphis map at night, seen from above, with the preloader's lines still in
 * flight. Three layers, seven draw calls (grid, blocks, tiles, pins, lines, A, post), one renderer. Mounted by Gate.tsx when
 * WebGL is there; the SVG A in the DOM is the fallback. See "Assembly launch gate plan", section 3.
 *
 * Budget: DPR capped at 2, 30 fps when the device looks modest, paused when the tab is hidden, stopped
 * after three idle minutes and resumed on touch. Reduced motion: one static frame, lines parked in
 * formation with the A faint, no drift, no post pass.
 */
export interface SceneHandle {
  /** The field has focus: drift slows, the grid dims. */
  setFocus(on: boolean): void;
  /** A key was typed: lines speed up briefly. */
  typed(): void;
  /** The formation beat, now: on submit and on the Google tap. */
  beat(): Promise<void>;
  /** A pin pulse from a point on screen (the form), like the splash's ring. */
  ring(clientX: number, clientY: number): void;
  destroy(): void;
}

const IDLE_STOP_MS = 180_000;
const CAM = { pos: new THREE.Vector3(0, 15.5, 8.5), look: new THREE.Vector3(0, 0, -0.8) };

export function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function mountScene(container: HTMLElement, opts: { reducedMotion: boolean }): SceneHandle {
  const reduced = opts.reducedMotion;
  const modest = (navigator.hardwareConcurrency ?? 8) <= 4 || /Android/.test(navigator.userAgent);
  const frameMs = modest ? 1000 / 30 : 0;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: !modest, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(BRAND_COLORS.ground, 1);
  renderer.domElement.className = "gate-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BRAND_COLORS.ground);
  scene.fog = new THREE.Fog(BRAND_COLORS.ground, 18, 46);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.copy(CAM.pos);
  camera.lookAt(CAM.look);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: "#0c0c0e", fog: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  scene.add(makeGrid());
  const pins = new Pins(pixelRatio);
  scene.add(pins.points);
  const tiles = new Tiles();
  scene.add(tiles.mesh);
  const lines = new Lines(1, 1, pixelRatio);
  scene.add(lines.group);
  const post = reduced ? null : new Post(renderer, scene, camera);

  // Rings: a few reusable, additive, expanding circles for the pulse on submit.
  const ringGeo = new THREE.RingGeometry(0.9, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: BRAND_COLORS.accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.visible = false;
    scene.add(m);
    return m;
  });

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    // Phones: back the camera off so the A still fits between the panel's edges.
    camera.position.copy(CAM.pos).multiplyScalar(w < h ? 1.35 : 1);
    camera.lookAt(CAM.look);
    camera.updateProjectionMatrix();
    lines.setSize(w, h, pixelRatio);
    post?.setSize(w, h, pixelRatio);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Pointer and tilt ease the camera's target a few degrees; the nearest pins brighten.
  const sway = { x: 0, y: 0 };
  const want = { x: 0, y: 0 };
  let near: { x: number; z: number } | null = null;
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const onMove = (e: PointerEvent) => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    want.x = (e.clientX / w - 0.5) * 2;
    want.y = (e.clientY / h - 0.5) * 2;
    ray.setFromCamera(new THREE.Vector2(want.x, -want.y), camera);
    near = ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
    wake();
  };
  const onTilt = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    want.x = THREE.MathUtils.clamp(e.gamma / 30, -1, 1);
    want.y = THREE.MathUtils.clamp((e.beta - 45) / 30, -1, 1);
  };
  if (!reduced) {
    window.addEventListener("pointermove", onMove, { passive: true });
    // iOS needs a gesture before it reports orientation; the first touch asks.
    const askTilt = () => {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      const go = () => window.addEventListener("deviceorientation", onTilt, { passive: true });
      if (typeof DOE.requestPermission === "function") DOE.requestPermission().then((s) => s === "granted" && go()).catch(() => undefined);
      else go();
    };
    window.addEventListener("touchend", askTilt, { once: true, passive: true });
  }

  // State the form drives.
  let focus = 0; // 0..1, eased
  let focusWant = 0;
  let speedBoost = 0;

  // The frame loop, with its budget.
  const t0 = performance.now();
  let raf = 0;
  let last = 0;
  let stopped = false;
  let hidden = document.visibilityState === "hidden";
  let lastInput = performance.now();
  function frame(now: number) {
    raf = 0;
    if (stopped || hidden) return;
    if (frameMs && now - last < frameMs) return void (raf = requestAnimationFrame(frame));
    last = now;
    const t = (now - t0) / 1000;
    if (!reduced) {
      sway.x += (want.x - sway.x) * 0.04;
      sway.y += (want.y - sway.y) * 0.04;
      focus += (focusWant - focus) * 0.08;
      speedBoost *= 0.96;
      // Drift plus the pointer's pull: the look target moves a little, the camera stays put. Focus calms the drift.
      const calm = 1 - focus * 0.7;
      const yaw = sway.x * 0.5 + Math.sin(t * 0.11) * 0.18 * calm;
      const pitch = -sway.y * 0.35 + Math.sin(t * 0.07) * 0.12 * calm;
      camera.lookAt(CAM.look.x + yaw, CAM.look.y + pitch * 0.4, CAM.look.z + pitch);
      lines.setSpeed(1 - focus * 0.4 + speedBoost);
      lines.write();
      pins.update(t, near, focus);
      tiles.update(t);
      post!.render(t, focus);
      if (now - lastInput > IDLE_STOP_MS) {
        stopped = true; // Three idle minutes: stop until something happens.
        return;
      }
    } else {
      lines.write();
      pins.update(t, null, 0);
      tiles.update(t);
      renderer.render(scene, camera);
      return; // one frame
    }
    raf = requestAnimationFrame(frame);
  }
  function wake() {
    lastInput = performance.now();
    if (stopped) {
      stopped = false;
      lines.startIdle(false);
    }
    if (!raf && !hidden) raf = requestAnimationFrame(frame);
  }
  const onVis = () => {
    hidden = document.visibilityState === "hidden";
    if (hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      gsap.globalTimeline.pause();
    } else {
      gsap.globalTimeline.resume();
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVis);
  const onTouch = () => wake();
  window.addEventListener("pointerdown", onTouch, { passive: true });
  window.addEventListener("keydown", onTouch, { passive: true });

  lines.startIdle(reduced);
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) (window as unknown as { __scene?: unknown }).__scene = { pins, lines, renderer, camera };

  function ring(clientX: number, clientY: number) {
    if (reduced) return;
    const r = rings.find((m) => !m.visible) ?? rings[0];
    const w = container.clientWidth;
    const h = container.clientHeight;
    ray.setFromCamera(new THREE.Vector2((clientX / w) * 2 - 1, -((clientY / h) * 2 - 1)), camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    r.position.set(hit.x, 0.05, hit.z);
    r.scale.setScalar(0.2);
    r.visible = true;
    const mat = r.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.9;
    gsap.to(r.scale, { x: 6, y: 6, z: 6, duration: 0.9, ease: "power2.out" });
    gsap.to(mat, { opacity: 0, duration: 0.9, ease: "power2.out", onComplete: () => (r.visible = false) });
  }

  return {
    setFocus(on) {
      focusWant = on ? 1 : 0;
      wake();
    },
    typed() {
      speedBoost = Math.min(0.6, speedBoost + 0.15);
      wake();
    },
    beat() {
      wake();
      return reduced ? Promise.resolve() : lines.beat();
    },
    ring,
    destroy() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      window.removeEventListener("pointerdown", onTouch);
      window.removeEventListener("keydown", onTouch);
      document.removeEventListener("visibilitychange", onVis);
      lines.dispose();
      pins.dispose();
      tiles.dispose();
      post?.dispose();
      ringGeo.dispose();
      for (const r of rings) (r.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
