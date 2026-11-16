"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { subsolarPoint } from "@/lib/geo";
import { colorOf, tileUrl, type Layer } from "@/lib/layers";
import type { EonetEvent, Neo } from "@/lib/types";
import GroundLayer, { type Waypoint } from "./GroundLayer";

const ACCENT = "#FFB238";
const DAY = 86_400_000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

// Near-Earth space is drawn as a schematic: distance on a log scale so 0.1 and 20 lunar distances fit one view.
export const ldToAltitude = (ld: number) => 0.5 + 1.2 * Math.log10(1 + ld);

// The close-approach API gives distance, not direction, so each object gets a stable made-up bearing.
function bearing(des: string) {
  let h = 2166136261;
  for (const ch of des) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { lat: (h % 61) - 30, lng: ((h >>> 8) % 360) - 180 };
}

const moonOrbit = {
  track: Array.from({ length: 73 }, (_, i) => [0, i * 5 - 180, ldToAltitude(1)]),
  color: "rgba(232,236,247,0.45)",
  flow: false,
};

// Sun shading shared by the base sphere and the imagery tiles: ambient plus one directional term.
const AMBIENT = 0.34, SUNLIGHT = 0.72;
// Both shaders find their texture coordinate from the surface normal, so no mesh UVs or rotations are involved.
const EQUIRECT = "vec2 uv = vec2(atan(n.x, n.z) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);";
const VERTEX = "varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

function texture(url: string) {
  const t = new THREE.TextureLoader().load(url);
  t.minFilter = THREE.LinearFilter; // no mipmaps, so the wrap at 180° leaves no seam
  t.generateMipmaps = false;
  return t;
}

// Cloud-free Blue Marble for the sphere the globe library keeps just under its imagery tiles (black by default).
// It shows through orbit gaps, covers the poles (web-mercator tiles stop at 85°) and stands in while tiles load.
function baseMaterial(day: THREE.Texture, uniforms: Record<string, THREE.IUniform>) {
  return (
    new THREE.ShaderMaterial({
      polygonOffset: true, // same settings the library gives this sphere
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 3,
      uniforms: { day: { value: day }, ...uniforms },
      vertexShader: VERTEX,
      fragmentShader: `
        uniform sampler2D day; uniform vec3 sun; uniform float lit; varying vec3 vN;
        void main(){
          vec3 n = normalize(vN);
          ${EQUIRECT}
          float shade = mix(1.0, ${AMBIENT} + ${SUNLIGHT} * max(dot(n, sun), 0.0), lit);
          // Lifted a little, so cloud-free ocean sits closer to the hazier satellite imagery around it.
          gl_FragColor = vec4((texture2D(day, uv).rgb * 1.35 + vec3(0.03, 0.05, 0.08)) * shade, 1.0);
        }`,
    })
  );
}

// A shell just above the surface carrying everything atmospheric: city lights on the night side,
// the sun's glint on open water, and a rim glow at the limb.
function skyShell(day: THREE.Texture, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(100.35, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { lights: { value: texture("/night.jpg") }, day: { value: day }, ...uniforms },
      vertexShader: VERTEX,
      fragmentShader: `
        uniform sampler2D lights; uniform sampler2D day; uniform vec3 sun; uniform float lit;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 n = normalize(vN);
          vec3 v = normalize(cameraPosition - vW);
          float d = dot(n, sun);
          ${EQUIRECT}

          float nightA = smoothstep(0.12, -0.2, d) * 0.94 * lit;
          vec3 nightCol = vec3(0.02, 0.035, 0.09) + texture2D(lights, uv).rgb * vec3(1.7, 1.35, 0.95);

          vec3 land = texture2D(day, uv).rgb;
          float ocean = smoothstep(0.02, 0.12, land.b - land.r);
          float glint = pow(max(dot(n, normalize(sun + v)), 0.0), 70.0) * 0.5 * ocean * smoothstep(0.0, 0.25, d) * lit;

          float rim = pow(1.0 - max(dot(n, v), 0.0), 3.2) * mix(0.55, 0.2 + 0.65 * smoothstep(-0.35, 0.4, d), lit);

          float a = clamp(nightA + glint + rim, 0.0, 1.0);
          vec3 col = (nightCol * nightA + vec3(1.0, 0.96, 0.86) * glint + vec3(0.38, 0.68, 1.0) * rim) / max(a, 0.0001);
          gl_FragColor = vec4(col, a);
        }`,
    }),
  );
}

function starField() {
  const pos = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) new THREE.Vector3().randomDirection().multiplyScalar(5000).toArray(pos, i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: "#d6e2ff", size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.75 }));
}

// A tapered column of light standing on the selected event.
function lightBeam() {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.7, 22, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.visible = false;
  return mesh;
}

let glowTexture: THREE.Texture | undefined;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (glowTexture = new THREE.CanvasTexture(c));
}

// An event marker: a bright core inside a soft halo of its type's colour.
function beacon(color: string, scale: number) {
  const sprite = (size: number, opacity: number, tint: string) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: tint, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size * scale);
    return s;
  };
  return new THREE.Group().add(sprite(5.2, 0.7, color), sprite(1.9, 1, color), sprite(0.9, 0.9, "#ffffff"));
}

// Imagery tiles are created inside the globe library, so each new one is patched as it appears.
// Where a pixel has no data (the gaps between orbits), it takes the previous day's pass instead,
// because the gaps fall in different places each day. If that is empty too, the pixel is dropped
// and the Blue Marble sphere underneath shows through.
function patchTiles(engine: THREE.Object3D, fill: THREE.IUniform) {
  for (const tile of engine.children as THREE.Mesh[]) {
    const m = tile.material as THREE.MeshLambertMaterial & { userData: { fills?: boolean } };
    if (!m?.isMeshLambertMaterial || !m.map || m.userData.fills) continue;
    m.userData.fills = true;

    const before = { value: null as THREE.Texture | null }, hasBefore = { value: 0 };
    const src: string = (m.map.image as HTMLImageElement | undefined)?.src ?? "";
    const day = src.match(/\/default\/(\d{4}-\d\d-\d\d)\//)?.[1];
    if (fill.value && day) {
      const previous = new Date(Date.parse(day) - DAY).toISOString().slice(0, 10);
      new THREE.TextureLoader().load(src.replace(day, previous), (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        before.value = t;
        hasBefore.value = 1;
        tile.addEventListener("removed", () => t.dispose());
      });
    }

    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { fillGaps: fill, before, hasBefore });
      shader.fragmentShader = "uniform float fillGaps; uniform float hasBefore; uniform sampler2D before;\n" + shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (fillGaps > 0.5 && (diffuseColor.a < 0.5 || dot(diffuseColor.rgb, vec3(0.3333)) < 0.02)) {
          vec4 older = hasBefore > 0.5 ? texture2D(before, vMapUv) : vec4(0.0);
          if (older.a < 0.5 || dot(older.rgb, vec3(0.3333)) < 0.02) discard;
          diffuseColor = vec4(older.rgb, 1.0);
        }`,
      );
    };
    m.customProgramCacheKey = () => "fill-gaps";
    m.needsUpdate = true;
  }
}

type Props = {
  layer: Layer;
  date: string;
  events: EonetEvent[];
  selected?: EonetEvent;
  neos: Neo[];
  selectedNeo?: string;
  space: boolean;
  night: boolean;
  density: boolean;
  onSelect: (id: string) => void;
  onSelectNeo: (des: string) => void;
  ground?: EonetEvent; // when set, the camera stands at this event
  waypoints?: Waypoint[];
  onGroundPick?: (id: string) => void;
};

type Rig = { lit: THREE.IUniform; fill: THREE.IUniform; sun: THREE.Vector3; beam: THREE.Mesh; shell: THREE.Object3D; relight: () => void };

export default function GlobeView({ layer, date, events, selected, neos, selectedNeo, space, night, density, onSelect, onSelectNeo, ground, waypoints = [], onGroundPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const rig = useRef<Rig | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [now] = useState(Date.now);
  const calm = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const groundRef = useRef(ground);
  useEffect(() => {
    groundRef.current = ground;
  }, [ground]);
  // NASA serves each layer to a fixed zoom level; asking for more would only fetch errors.
  const maxLevel = Number(layer.matrix.match(/Level(\d+)$/)?.[1] ?? 7);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(() => tileUrl(layer, date), [layer, date]);
  const age = (e: EonetEvent) => (now - new Date(e.date).getTime()) / DAY;

  const paths = useMemo(() => {
    // From the ground, only the event's own track, laid on the surface (globe tracks float 38 km up).
    if (ground) return ground.track ? [{ track: ground.track.map(([lat, lng]) => [lat, lng, 0.00008]), color: rgba(colorOf(ground.category), 1), flow: true }] : [];
    const tracks = events.filter((e) => e.track).map((e) => ({ track: e.track!.map(([lat, lng]) => [lat, lng, 0.006]), color: rgba(colorOf(e.category), 0.9), flow: true }));
    return space ? [...tracks, moonOrbit] : tracks;
  }, [events, space, ground]);

  // A soft pulse marks what is new: events reported in the last 48 hours, plus the selected one.
  const rings = useMemo(() => {
    if (space || ground) return [];
    const fresh = calm ? [] : events.filter((e) => (now - new Date(e.date).getTime()) / DAY <= 2 && e.id !== selected?.id);
    return selected ? [...fresh, selected] : fresh;
  }, [events, selected, space, calm, now, ground]);

  // One object layer: event beacons on Earth, or asteroids in the near-Earth view.
  const things = useMemo(
    () => (space ? neos.map((n) => ({ ...n, ...bearing(n.des), alt: ldToAltitude(n.distLd) })) : ground ? [] : events.map((e) => ({ ...e, alt: 0.012 }))),
    [neos, events, space, ground],
  );

  // Scene dressing: stars, Blue Marble base, the sky shell, the beam, and lights that follow the real sun.
  useEffect(() => {
    const g = globe.current;
    if (!ready || !g) return;
    const sun = new THREE.Vector3(1, 0, 0);
    const lit = { value: 1 }, fill = { value: 1 };
    const shared = { sun: { value: sun }, lit };
    const day = texture("/day.jpg");
    day.colorSpace = THREE.SRGBColorSpace;
    const parts = [starField(), skyShell(day, shared)];
    const beam = lightBeam();
    g.scene().add(...parts, beam);

    const ambient = new THREE.AmbientLight(0xffffff, Math.PI);
    const sunlight = new THREE.DirectionalLight(0xffffff, 0);
    g.lights([ambient, sunlight]);
    const relight = () => {
      const s = subsolarPoint(new Date());
      const p = g.getCoords(s.lat, s.lng, 0);
      sun.set(p.x, p.y, p.z).normalize();
      sunlight.position.copy(sun).multiplyScalar(1000);
      // Lambert divides by pi, so these give the same ambient and sun terms as the base sphere's shader.
      ambient.intensity = Math.PI * (lit.value ? AMBIENT : 1);
      sunlight.intensity = Math.PI * (lit.value ? SUNLIGHT : 0);
    };
    relight();
    rig.current = { lit, fill, sun, beam, shell: parts[1], relight };
    const clock = setInterval(relight, 60_000);

    let engine: THREE.Object3D | undefined;
    g.scene().traverse((o) => { if ("tileUrl" in o && "maxLevel" in o) engine = o; });
    const back = (engine?.children as THREE.Mesh[] | undefined)?.find((c) => (c.material as THREE.Material).type === "MeshBasicMaterial");
    const black = back?.material;
    const base = baseMaterial(day, shared);
    if (back) back.material = base;
    let frame = 0;
    const tick = (t: number) => {
      if (engine) patchTiles(engine, fill);
      if (!calm) (beam.material as THREE.MeshBasicMaterial).opacity = 0.42 + 0.16 * Math.sin(t / 420);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(clock);
      rig.current = null;
      if (back && black) back.material = black;
      base.dispose();
      g.scene().remove(...parts, beam);
      for (const o of [...parts, beam]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      day.dispose();
    };
  }, [ready, calm]);

  useEffect(() => {
    const r = rig.current;
    if (!r) return;
    r.lit.value = night ? 1 : 0;
    r.fill.value = layer.fill ? 1 : 0;
    r.relight();
  }, [night, layer, ready]);

  // The city-lights shell sits 22 km up; flying down through it would smear the lights across the view.
  useEffect(() => {
    if (rig.current) rig.current.shell.visible = !ground;
  }, [ground, ready]);

  // Stand the beam on the selected event.
  useEffect(() => {
    const g = globe.current, r = rig.current;
    if (!ready || !g || !r) return;
    r.beam.visible = !!selected && !space && !ground;
    if (!selected) return;
    const p = g.getCoords(selected.lat, selected.lng, 0);
    const up = new THREE.Vector3(p.x, p.y, p.z).normalize();
    r.beam.position.copy(up).multiplyScalar(100 + 11.5);
    r.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), up); // narrow end on the ground
  }, [ready, selected, space, ground]);

  // One orchestrated moment: fall in from deep space on load.
  useEffect(() => {
    const g = globe.current;
    if (!ready || !g) return;
    const controls = g.controls();
    controls.minDistance = 125; // stay inside the zoom levels GIBS serves
    controls.maxDistance = 900;
    controls.autoRotate = !calm;
    controls.autoRotateSpeed = 0.3;
    const stop = () => (controls.autoRotate = false);
    controls.addEventListener("start", stop);
    // Open with the day/night line in view.
    const sun = subsolarPoint(new Date());
    g.pointOfView({ lat: 25, lng: sun.lng - 85, altitude: calm ? 2.1 : 5 }, 0);
    if (!calm) g.pointOfView({ lat: 18, lng: sun.lng - 55, altitude: 2.1 }, 3000);
    return () => controls.removeEventListener("start", stop);
  }, [ready, calm]);

  useEffect(() => {
    const g = globe.current;
    if (!ready || !g || !selected || space || groundRef.current) return; // the ground view flies itself
    g.controls().autoRotate = false;
    g.pointOfView({ lat: selected.lat, lng: selected.lng, altitude: 0.9 }, calm ? 0 : 1600);
  }, [ready, selected, space, calm]);

  const wasSpace = useRef(false);
  useEffect(() => {
    const g = globe.current;
    if (!ready || !g || space === wasSpace.current) return;
    wasSpace.current = space;
    g.pointOfView(space ? { lat: 28, altitude: 7.5 } : { altitude: 2.1 }, calm ? 0 : 1800);
  }, [ready, space, calm]);

  // Written straight to the DOM: a state update per mouse move would re-run every globe layer.
  const track = (e: React.MouseEvent) => {
    const el = readout.current, g = globe.current;
    if (!el || !g) return;
    const r = box.current!.getBoundingClientRect();
    const c = g.toGlobeCoords(e.clientX - r.left, e.clientY - r.top);
    el.textContent = c ? `${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? "N" : "S"}  ${Math.abs(c.lng).toFixed(2)}°${c.lng >= 0 ? "E" : "W"}` : "";
  };

  return (
    <div
      ref={box}
      className="relative isolate h-full w-full"
      role="img"
      aria-label="3D globe of Earth with NASA satellite imagery and event markers. The lists beside it hold the same information."
      onMouseMove={track}
      onMouseLeave={() => { if (readout.current) readout.current.textContent = ""; }}
    >
      {size.w > 0 && (
        <Globe
          ref={globe}
          width={size.w}
          height={size.h}
          onGlobeReady={() => setReady(true)}
          backgroundColor="rgba(0,0,0,0)"
          globeTileEngineUrl={tiles}
          // A real globe.gl prop that react-globe.gl's types leave out.
          {...({ globeTileEngineMaxLevel: maxLevel } as object)}
          showGraticules={!ground}
          atmosphereColor="#4DA3FF"
          atmosphereAltitude={0.26}
          ringsData={rings}
          ringLat="lat"
          ringLng="lng"
          ringColor={(e: object) => {
            const ev = e as EonetEvent;
            const hex = ev.id === selected?.id ? ACCENT : colorOf(ev.category);
            return (t: number) => rgba(hex, 1 - t);
          }}
          ringMaxRadius={(e: object) => ((e as EonetEvent).id === selected?.id ? 4 : 2.4)}
          ringPropagationSpeed={calm ? 0 : 1.6}
          ringRepeatPeriod={1300}
          hexBinPointsData={density && !space && !ground ? events : []}
          hexBinPointLat="lat"
          hexBinPointLng="lng"
          hexBinResolution={3}
          hexMargin={0.25}
          hexAltitude={(d) => 0.02 + d.sumWeight * 0.03}
          hexTopColor={() => "rgba(255,178,56,0.85)"}
          hexSideColor={() => "rgba(255,178,56,0.3)"}
          hexLabel={(d) => `<div class="globe-tip">${d.sumWeight} event${d.sumWeight === 1 ? "" : "s"} in this cell</div>`}
          hexTransitionDuration={0}
          pathsData={paths}
          pathPoints="track"
          pathPointLat={(p) => (p as number[])[0]}
          pathPointLng={(p) => (p as number[])[1]}
          pathPointAlt={(p) => (p as number[])[2]}
          pathColor={(p: object) => (p as { color: string }).color}
          pathStroke={1.5}
          // Dashes run from a track's first position to its latest. Still when motion is reduced.
          pathDashLength={(p: object) => ((p as { flow: boolean }).flow ? 0.12 : 1)}
          pathDashGap={(p: object) => ((p as { flow: boolean }).flow ? 0.04 : 0)}
          pathDashAnimateTime={(p: object) => ((p as { flow: boolean }).flow && !calm ? 14_000 : 0)}
          pathTransitionDuration={0}
          objectsData={things}
          objectLat="lat"
          objectLng="lng"
          objectAltitude="alt"
          objectLabel={(o) => {
            if ("des" in o) {
              const n = o as Neo;
              return `<div class="globe-tip"><strong>${esc(n.des)}</strong><br>${n.distLd.toFixed(1)} lunar distances</div>`;
            }
            const ev = o as EonetEvent;
            return `<div class="globe-tip"><strong>${esc(ev.title)}</strong><br>${esc(ev.categoryTitle)}</div>`;
          }}
          onObjectClick={(o) => ("des" in o ? onSelectNeo((o as Neo).des) : onSelect((o as EonetEvent).id))}
          objectThreeObject={(o) => {
            if ("des" in o) {
              const n = o as Neo;
              const r = Math.min(7, Math.max(1.8, 1.2 + Math.log10(Math.max(n.diameterM, 1)) * 1.6));
              const color = n.des === selectedNeo ? ACCENT : n.hazardous ? "#e66767" : "#C9D4F2";
              return new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshLambertMaterial({ color, flatShading: true }));
            }
            const ev = o as EonetEvent;
            // Newer reports glow larger.
            return ev.id === selected?.id ? beacon(ACCENT, 1.5) : beacon(colorOf(ev.category), 0.6 + 0.5 * Math.max(0, 1 - age(ev) / 30));
          }}
        />
      )}
      {ground && onGroundPick && <GroundLayer globe={globe} ready={ready} event={ground} waypoints={waypoints} calm={calm} onPick={onGroundPick} />}
      <p ref={readout} aria-hidden hidden={!!ground} className="pointer-events-none absolute bottom-24 left-1/2 hidden -translate-x-1/2 whitespace-pre text-xs tabular-nums text-muted-foreground [text-shadow:0_1px_4px_#0a1128] lg:block" />
    </div>
  );
}
