"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { colorOf, tileUrl, type Layer } from "@/lib/layers";
import type { EonetEvent, Neo } from "@/lib/types";

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
};

// Where the sun is overhead right now. Accurate to about a degree, which is plenty for a terminator line.
export function subsolarPoint(now: Date) {
  const n = (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / DAY;
  const b = (2 * Math.PI * (n - 81)) / 364;
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
  return {
    lat: -23.44 * Math.cos((2 * Math.PI * (n + 10)) / 365),
    lng: ((((12 - hours - equationOfTime / 60) * 15 + 540) % 360) + 360) % 360 - 180,
  };
}

// A shell just above the surface: clear by day, Black Marble city lights by night.
function nightShell() {
  const lights = new THREE.TextureLoader().load("/night.jpg");
  lights.minFilter = THREE.LinearFilter; // no mipmaps, so the wrap at 180° leaves no seam
  lights.generateMipmaps = false;
  return new THREE.Mesh(
    new THREE.SphereGeometry(100.35, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { lights: { value: lights }, sun: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        uniform sampler2D lights; uniform vec3 sun; varying vec3 vN;
        void main(){
          vec3 n = normalize(vN);
          float night = smoothstep(0.12, -0.2, dot(n, sun));
          vec2 uv = vec2(atan(n.x, n.z) / 6.2831853 + 0.5, asin(n.y) / 3.1415927 + 0.5);
          vec3 city = texture2D(lights, uv).rgb;
          gl_FragColor = vec4(vec3(0.02, 0.035, 0.09) + city * vec3(1.7, 1.35, 0.95), night * 0.94);
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
};

export default function GlobeView({ layer, date, events, selected, neos, selectedNeo, space, night, density, onSelect, onSelectNeo }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const shell = useRef<THREE.Mesh | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [now] = useState(Date.now);
  const calm = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(() => tileUrl(layer, date), [layer, date]);
  const age = (e: EonetEvent) => (now - new Date(e.date).getTime()) / DAY;

  const paths = useMemo(() => {
    const tracks = events.filter((e) => e.track).map((e) => ({ track: e.track!.map(([lat, lng]) => [lat, lng, 0.006]), color: rgba(colorOf(e.category), 0.8) }));
    return space ? [...tracks, moonOrbit] : tracks;
  }, [events, space]);

  // A soft pulse marks what is new: events reported in the last 48 hours, plus the selected one.
  const rings = useMemo(() => {
    if (space) return [];
    const fresh = calm ? [] : events.filter((e) => (now - new Date(e.date).getTime()) / DAY <= 2 && e.id !== selected?.id);
    return selected ? [...fresh, selected] : fresh;
  }, [events, selected, space, calm, now]);

  const rocks = useMemo(
    () => (space ? neos.map((n) => ({ ...n, ...bearing(n.des), alt: ldToAltitude(n.distLd) })) : []),
    [neos, space],
  );

  // Scene dressing: stars, and the night shell that follows the real sun.
  useEffect(() => {
    const g = globe.current;
    if (!ready || !g) return;
    const stars = starField();
    const mesh = nightShell();
    shell.current = mesh;
    g.scene().add(stars, mesh);
    const aim = () => {
      const s = subsolarPoint(new Date());
      const p = g.getCoords(s.lat, s.lng, 0);
      (mesh.material as THREE.ShaderMaterial).uniforms.sun.value.set(p.x, p.y, p.z).normalize();
    };
    aim();
    const timer = setInterval(aim, 60_000);
    return () => {
      clearInterval(timer);
      g.scene().remove(stars, mesh);
      for (const o of [stars, mesh]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    };
  }, [ready]);

  useEffect(() => {
    if (shell.current) shell.current.visible = night;
  }, [night, ready]);

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
    // Open on the daylit side.
    const sun = subsolarPoint(new Date());
    g.pointOfView({ lat: 25, lng: sun.lng - 30, altitude: calm ? 2.1 : 5 }, 0);
    if (!calm) g.pointOfView({ lat: 18, lng: sun.lng, altitude: 2.1 }, 3000);
    return () => controls.removeEventListener("start", stop);
  }, [ready, calm]);

  useEffect(() => {
    const g = globe.current;
    if (!ready || !g || !selected || space) return;
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

  return (
    <div ref={box} className="h-full w-full" role="img" aria-label="3D globe of Earth with NASA satellite imagery and event markers. The lists beside it hold the same information.">
      {size.w > 0 && (
        <Globe
          ref={globe}
          width={size.w}
          height={size.h}
          onGlobeReady={() => setReady(true)}
          backgroundColor="rgba(0,0,0,0)"
          globeTileEngineUrl={tiles}
          showGraticules
          atmosphereColor="#4DA3FF"
          atmosphereAltitude={0.24}
          pointsData={events}
          pointLat="lat"
          pointLng="lng"
          pointColor={(e) => ((e as EonetEvent).id === selected?.id ? ACCENT : colorOf((e as EonetEvent).category))}
          pointAltitude={(e) => ((e as EonetEvent).id === selected?.id ? 0.07 : 0.014)}
          // Newer reports draw larger.
          pointRadius={(e) => ((e as EonetEvent).id === selected?.id ? 0.5 : 0.2 + 0.24 * Math.max(0, 1 - age(e as EonetEvent) / 30))}
          pointsMerge={false}
          pointsTransitionDuration={0}
          pointLabel={(e) => {
            const ev = e as EonetEvent;
            return `<div class="globe-tip"><strong>${esc(ev.title)}</strong><br>${esc(ev.categoryTitle)}</div>`;
          }}
          onPointClick={(e) => onSelect((e as EonetEvent).id)}
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
          hexBinPointsData={density && !space ? events : []}
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
          pathStroke={1.4}
          pathTransitionDuration={0}
          objectsData={rocks}
          objectLat="lat"
          objectLng="lng"
          objectAltitude="alt"
          objectLabel={(o) => {
            const n = o as Neo;
            return `<div class="globe-tip"><strong>${esc(n.des)}</strong><br>${n.distLd.toFixed(1)} lunar distances</div>`;
          }}
          onObjectClick={(o) => onSelectNeo((o as Neo).des)}
          objectThreeObject={(o) => {
            const n = o as Neo;
            const r = Math.min(7, Math.max(1.8, 1.2 + Math.log10(Math.max(n.diameterM, 1)) * 1.6));
            const color = n.des === selectedNeo ? ACCENT : n.hazardous ? "#e66767" : "#C9D4F2";
            return new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshLambertMaterial({ color, flatShading: true }));
          }}
        />
      )}
    </div>
  );
}
