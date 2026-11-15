"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { colorOf, tileUrl, type Layer } from "@/lib/layers";
import type { EonetEvent, Neo } from "@/lib/types";

const ACCENT = "#FFB238";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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

type Props = {
  layer: Layer;
  date: string;
  events: EonetEvent[];
  selected?: EonetEvent;
  neos: Neo[];
  selectedNeo?: string;
  space: boolean;
  onSelect: (id: string) => void;
  onSelectNeo: (des: string) => void;
};

export default function GlobeView({ layer, date, events, selected, neos, selectedNeo, space, onSelect, onSelectNeo }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const calm = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(() => tileUrl(layer, date), [layer, date]);

  const paths = useMemo(() => {
    const tracks = events.filter((e) => e.track).map((e) => ({ track: e.track!.map(([lat, lng]) => [lat, lng, 0.006]), color: colorOf(e.category) }));
    return space ? [...tracks, moonOrbit] : tracks;
  }, [events, space]);

  const rocks = useMemo(
    () => (space ? neos.map((n) => ({ ...n, ...bearing(n.des), alt: ldToAltitude(n.distLd) })) : []),
    [neos, space],
  );

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
    g.pointOfView({ lat: 25, lng: -60, altitude: calm ? 2.1 : 5 }, 0);
    if (!calm) g.pointOfView({ lat: 18, lng: -30, altitude: 2.1 }, 3000);
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
          atmosphereColor="#7FB6FF"
          atmosphereAltitude={0.17}
          pointsData={events}
          pointLat="lat"
          pointLng="lng"
          pointColor={(e) => ((e as EonetEvent).id === selected?.id ? ACCENT : colorOf((e as EonetEvent).category))}
          pointAltitude={(e) => ((e as EonetEvent).id === selected?.id ? 0.07 : 0.012)}
          pointRadius={(e) => ((e as EonetEvent).id === selected?.id ? 0.45 : 0.28)}
          pointsMerge={false}
          pointsTransitionDuration={0}
          pointLabel={(e) => {
            const ev = e as EonetEvent;
            return `<div class="globe-tip"><strong>${esc(ev.title)}</strong><br>${esc(ev.categoryTitle)}</div>`;
          }}
          onPointClick={(e) => onSelect((e as EonetEvent).id)}
          ringsData={selected && !space ? [selected] : []}
          ringLat="lat"
          ringLng="lng"
          ringColor={() => (t: number) => `rgba(255,178,56,${1 - t})`}
          ringMaxRadius={4}
          ringPropagationSpeed={calm ? 0 : 2}
          ringRepeatPeriod={900}
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
            const color = n.des === selectedNeo ? ACCENT : n.hazardous ? "#FF5A4D" : "#C9D4F2";
            return new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshLambertMaterial({ color, flatShading: true }));
          }}
        />
      )}
    </div>
  );
}
