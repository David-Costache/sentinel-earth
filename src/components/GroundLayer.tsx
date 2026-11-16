"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { subsolarPoint, sunElevation } from "@/lib/geo";
import { colorOf } from "@/lib/layers";
import type { EonetEvent } from "@/lib/types";

// The globe is drawn with radius 100, so one unit is 63.7 km. Eye height 0.03 is about 1.9 km:
// low enough to read as standing at the place, high enough that the 250 m imagery is not a blur.
const R = 100;
export const EYE = 0.03;
const NEAR = 0.004; // the library's 0.05 would clip the ground within 3 km of the eye
const PX_PER_DEG = 4;
const PITCH = { min: -25, max: 35, start: -4 };
const RAD = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compassPoint = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export type Waypoint = EonetEvent & { bearing: number; km: number };

// Compass tape ticks every 5°: three copies of 0-360° so it can scroll past north either way.
const TICKS = Array.from({ length: 72 * 3 }, (_, i) => i * 5 - 360);

// Sky colours by sun elevation (degrees): night, astronomical and civil twilight, golden hour, day.
const SKY: [number, string, string][] = [
  [-18, "#040814", "#0b1533"],
  [-9, "#0a1430", "#1d2a58"],
  [-3, "#17255a", "#a75a48"],
  [2, "#2a4b8a", "#eb9b58"],
  [10, "#2765b3", "#a9cdea"],
  [35, "#1b5bb0", "#8cc1ee"],
];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(",")})`;
export function skyColours(elevation: number) {
  const i = SKY.findIndex(([e]) => elevation < e);
  if (i === 0) return { top: SKY[0][1], horizon: SKY[0][2] };
  if (i === -1) return { top: SKY.at(-1)![1], horizon: SKY.at(-1)![2] };
  const [[e0, t0, h0], [e1, t1, h1]] = [SKY[i - 1], SKY[i]];
  const t = (elevation - e0) / (e1 - e0);
  return { top: mix(t0, t1, t), horizon: mix(h0, h1, t) };
}

// Unit vectors for the surface at a direction from the globe's centre: up, east, north.
function frame(n: THREE.Vector3) {
  const east = new THREE.Vector3().crossVectors(Y, n);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0); // at a pole every way is south (or north)
  east.normalize();
  return { n, east, north: new THREE.Vector3().crossVectors(n, east) };
}
const look = (f: ReturnType<typeof frame>, headingDeg: number, pitchDeg: number) => {
  const h = headingDeg * RAD, p = pitchDeg * RAD;
  return f.north.clone().multiplyScalar(Math.cos(h)).addScaledVector(f.east, Math.sin(h)).multiplyScalar(Math.cos(p)).addScaledVector(f.n, Math.sin(p));
};
const ease = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const horizonDist = (alt: number) => Math.sqrt((R + alt) ** 2 - R ** 2);

type Saved = { pov: { lat: number; lng: number; altitude: number }; near: number; far: number; minDistance: number; autoRotate: boolean };
type Flight = { t0: number; dur: number; dir: THREE.Vector3; alt: number; lookDir: THREE.Vector3; up: THREE.Vector3; hop: number };

type Props = {
  globe: RefObject<GlobeMethods | undefined>;
  ready: boolean;
  event: EonetEvent;
  waypoints: Waypoint[];
  calm: boolean;
  onPick: (id: string) => void;
};

export default function GroundLayer({ globe, ready, event, waypoints, calm, onPick }: Props) {
  const tape = useRef<HTMLDivElement>(null);
  const headingText = useRef<HTMLSpanElement>(null);
  const sunDot = useRef<HTMLDivElement>(null);
  const haze = useRef<HTMLDivElement>(null);
  const marks = useRef<(HTMLButtonElement | null)[]>([]);
  const overlay = useRef<HTMLDivElement>(null);
  const st = useRef({ heading: 0, pitch: PITCH.start, goal: null as null | { lat: number; lng: number }, flight: null as Flight | null, lastTiles: 0, dirty: true });
  const wp = useRef(waypoints);
  useEffect(() => {
    wp.current = waypoints;
  }, [waypoints]);

  const [minute, setMinute] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setMinute(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const sun = sunElevation(event.lat, event.lng, minute);
  const sky = skyColours(sun.elevation);
  const stars = Math.min(1, Math.max(0, (-sun.elevation - 4) / 10));

  // Take over the camera while the ground view is open, and hand it back exactly as it was.
  useEffect(() => {
    const g = globe.current;
    if (!ready || !g) return;
    const camera = g.camera() as THREE.PerspectiveCamera;
    const controls = g.controls();
    const scene = g.scene();
    const saved: Saved = { pov: g.pointOfView(), near: camera.near, far: camera.far, minDistance: controls.minDistance, autoRotate: controls.autoRotate };
    // Recorded on the globe container, which outlives this layer, so a check can compare before and after.
    const host = overlay.current!.parentElement!;
    host.dataset.povBefore = JSON.stringify(saved.pov);
    delete host.dataset.povAfter;
    controls.enabled = false;
    controls.autoRotate = false;

    const v = new THREE.Vector3();
    const toScreen = (p: THREE.Vector3, w: number, h: number) => {
      v.copy(p).project(camera);
      return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, front: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
    };

    // Runs inside the renderer after the library's own camera tweens, so this camera always wins.
    const apply = () => {
      const s = st.current;
      if (!s.goal) return;
      const goal = g.getCoords(s.goal.lat, s.goal.lng, 0);
      const gn = new THREE.Vector3(goal.x, goal.y, goal.z).normalize();
      const f = s.flight;
      const k = f ? Math.min(1, (performance.now() - f.t0) / f.dur) : 1;
      const e = ease(k);

      const dir = f ? f.dir.clone().applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(f.dir, gn), e)) : gn;
      const alt = f ? Math.exp(Math.log(f.alt) + (Math.log(EYE) - Math.log(f.alt)) * e) + f.hop * Math.sin(Math.PI * k) : EYE;
      const fr = frame(dir);
      const want = look(fr, s.heading, s.pitch);
      // Keep looking at the Earth for the first part of the descent, then lift to the horizon.
      const lift = f ? Math.min(1, Math.max(0, (k - 0.35) / 0.65)) : 1;
      const lookDir = f ? f.lookDir.clone().lerp(want, ease(lift)).normalize() : want;
      const pos = dir.clone().multiplyScalar(R + alt);

      camera.position.copy(pos);
      camera.up.copy(f ? f.up.clone().lerp(fr.n, e).normalize() : fr.n);
      camera.lookAt(pos.clone().add(lookDir));
      const near = alt < 2 ? NEAR : saved.near;
      const far = horizonDist(alt) + 4;
      if (camera.near !== near || camera.far !== far) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      if (f && k >= 1) s.flight = null;

      // Tell the tile engine where we are, after this frame is drawn (it adds meshes to the scene).
      // Also every 400 ms regardless: a camera tween still running from the globe view reports its own
      // position to the tile engine, which would otherwise leave the ground at a blurry zoom level.
      const now = performance.now();
      if (((f || s.dirty) && now - s.lastTiles > 120) || now - s.lastTiles > 400) {
        s.lastTiles = now;
        s.dirty = false;
        queueMicrotask(() => controls.dispatchEvent({ type: "change" }));
      }

      const box = overlay.current;
      if (!box) return;
      const landed = !s.flight;
      box.dataset.landed = String(landed);
      if (!landed) return;
      const w = box.clientWidth, h = box.clientHeight;

      const heading = ((s.heading % 360) + 360) % 360;
      if (tape.current) tape.current.style.transform = `translateX(${-(heading + 360) * PX_PER_DEG}px)`;
      if (headingText.current) headingText.current.textContent = `${Math.round(heading)}° ${compassPoint(heading)}`;

      const flat = look(fr, s.heading, 0);
      const dip = Math.acos(R / (R + alt));
      const hz = toScreen(pos.clone().add(flat.clone().multiplyScalar(Math.cos(dip)).addScaledVector(fr.n, -Math.sin(dip)).multiplyScalar(horizonDist(alt))), w, h);
      if (haze.current) haze.current.style.transform = `translateY(${hz.y}px)`;

      const sp = subsolarPoint(new Date());
      const sc = g.getCoords(sp.lat, sp.lng, 0);
      const sunDir = new THREE.Vector3(sc.x, sc.y, sc.z).normalize();
      if (sunDot.current) {
        const p = toScreen(pos.clone().addScaledVector(sunDir, 3), w, h);
        const show = p.front && sunDir.dot(lookDir) > 0 && sunDir.dot(fr.n) > -0.02;
        sunDot.current.style.visibility = show ? "visible" : "hidden";
        sunDot.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }

      // Each nearby event floats above the horizon at its true compass bearing; nearer ones sit lower.
      wp.current.forEach((pt, i) => {
        const el = marks.current[i];
        if (!el) return;
        const d = fr.north.clone().multiplyScalar(Math.cos(pt.bearing * RAD)).addScaledVector(fr.east, Math.sin(pt.bearing * RAD));
        const p = toScreen(pos.clone().addScaledVector(d, 2.5), w, h);
        const show = p.front && d.dot(flat) > 0.2;
        el.style.visibility = show ? "visible" : "hidden";
        el.style.transform = `translate(${p.x}px, ${p.y - 34 - (i % 3) * 30}px) translateX(-50%)`;
      });
    };

    const prevHook = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      prevHook.apply(scene, args);
      apply();
    };
    const s = st.current;

    return () => {
      scene.onBeforeRender = prevHook;
      camera.up.set(0, 1, 0);
      camera.near = saved.near;
      camera.far = saved.far;
      camera.updateProjectionMatrix();
      controls.minDistance = saved.minDistance;
      controls.autoRotate = saved.autoRotate;
      controls.enabled = true;
      s.goal = null;
      s.flight = null;
      const dur = calm ? 0 : 1200;
      g.pointOfView(saved.pov, dur);
      setTimeout(() => {
        host.dataset.povAfter = JSON.stringify(g.pointOfView());
        controls.dispatchEvent({ type: "change" });
      }, dur + 150);
    };
  }, [ready, globe, calm]);

  // Fly to each new event. Face the sun when it is up, otherwise north.
  useEffect(() => {
    const g = globe.current;
    if (!ready || !g) return;
    const s = st.current;
    const camera = g.camera();
    const pos = camera.position.clone();
    const dir = pos.clone().normalize();
    const lookDir = new THREE.Vector3();
    camera.getWorldDirection(lookDir);
    const gc = g.getCoords(event.lat, event.lng, 0);
    const angle = dir.angleTo(new THREE.Vector3(gc.x, gc.y, gc.z).normalize());
    const fromGround = s.goal !== null;
    s.flight = calm ? null : { t0: performance.now(), dur: 1800, dir, alt: Math.max(EYE, pos.length() - R), lookDir, up: camera.up.clone(), hop: fromGround ? Math.min(150, angle * R * 0.5) : 0 };
    const sunNow = sunElevation(event.lat, event.lng, new Date());
    s.heading = sunNow.elevation > -3 ? sunNow.azimuth : 0;
    s.pitch = PITCH.start;
    s.goal = { lat: event.lat, lng: event.lng };
    s.dirty = true;
  }, [ready, globe, calm, event.lat, event.lng]);

  // Look around: drag with pointer or finger, or use the arrow keys.
  useEffect(() => {
    const el = overlay.current!;
    let last: { x: number; y: number } | null = null;
    const turn = (dh: number, dp: number) => {
      const s = st.current;
      s.heading += dh;
      s.pitch = Math.min(PITCH.max, Math.max(PITCH.min, s.pitch + dp));
      s.dirty = true;
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      turn(-(e.clientX - last.x) * 0.2, (e.clientY - last.y) * 0.15);
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => (last = null);
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const steps: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 3], ArrowDown: [0, -3] };
      const step = steps[e.key];
      if (!step) return;
      e.preventDefault();
      turn(...step);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <>
      {/* Sky behind the transparent canvas: the Earth covers it below the horizon. */}
      <div aria-hidden className="absolute inset-0 -z-10 transition-[background] duration-1000" style={{ background: `linear-gradient(to bottom, ${sky.top} 0%, ${sky.horizon} 62%, ${sky.horizon} 100%)` }}>
        <div className="ground-stars absolute inset-0" style={{ opacity: stars }} />
      </div>

      <div ref={overlay} data-landed="false" className="ground-overlay absolute inset-0 touch-none cursor-grab overflow-hidden select-none active:cursor-grabbing">
        <div ref={haze} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 -translate-y-1/2" style={{ background: `linear-gradient(to bottom, transparent, ${sky.horizon}66 45%, transparent)` }} />
        <div ref={sunDot} aria-hidden className="ground-sun pointer-events-none absolute left-0 top-0" />

        <div className="absolute inset-x-0 top-3 mx-auto w-[min(560px,calc(100%-2rem))] lg:top-4">
          <div className="hud relative h-12 overflow-hidden rounded-xl" aria-hidden>
            <div ref={tape} className="absolute left-1/2 top-0 h-full">
              {TICKS.map((d) => {
                const deg = ((d % 360) + 360) % 360;
                const major = deg % 45 === 0;
                return (
                  <div key={d} className="absolute top-0 flex h-full flex-col items-center" style={{ left: (d + 360) * PX_PER_DEG }}>
                    <span className={major ? "h-3 w-px bg-foreground" : deg % 15 === 0 ? "h-2 w-px bg-foreground/60" : "h-1.5 w-px bg-foreground/30"} />
                    {major ? <span className="mt-0.5 -translate-x-1/2 text-xs font-semibold">{POINTS[deg / 45]}</span>
                      : deg % 15 === 0 ? <span className="mt-0.5 -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground">{deg}</span> : null}
                  </div>
                );
              })}
              {[-360, 0, 360].flatMap((o) =>
                waypoints.map((p) => (
                  <span key={`${o}-${p.id}`} className="absolute bottom-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ left: (p.bearing + o + 360) * PX_PER_DEG, background: colorOf(p.category) }} />
                )),
              )}
            </div>
            <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-primary" />
          </div>
          <p className="mt-1 text-center text-sm font-medium tabular-nums [text-shadow:0_1px_6px_#0a1128]">
            Facing <span ref={headingText}>0° N</span>
          </p>
        </div>

        {waypoints.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => { marks.current[i] = el; }}
            onClick={() => onPick(p.id)}
            style={{ visibility: "hidden" }}
            aria-label={`Go to ${p.title}, ${Math.round(p.km)} km ${compassPoint(p.bearing)}`}
            className="hud absolute left-0 top-0 flex min-h-11 max-w-56 items-center gap-2 rounded-full px-3 py-1.5 text-left text-xs hover:border-white/40 lg:min-h-9"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(p.category) }} />
            <span className="truncate">{p.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(p.km)} km</span>
          </button>
        ))}
      </div>
    </>
  );
}
