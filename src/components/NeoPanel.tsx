"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Neo } from "@/lib/types";

const W = 340, H = 170, L = 34, R = 8, T = 10, B = 24;
const TICKS = [1, 5, 20];
const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
export const size = (n: Neo) => `${n.diameterEstimated ? "about " : ""}${n.diameterM < 1000 ? `${Math.round(n.diameterM)} m` : `${(n.diameterM / 1000).toFixed(1)} km`}`;

type Props = { neos: Neo[]; selected?: string; onSelect: (des: string) => void; space: boolean; onSpace: (on: boolean) => void };

export default function NeoPanel({ neos, selected, onSelect, space, onSpace }: Props) {
  const [t0] = useState(Date.now); // fixed at mount so the chart does not shift between renders
  const x = (iso: string) => L + ((new Date(iso).getTime() - t0) / (30 * 86_400_000)) * (W - L - R);
  // Log scale: a 1 LD pass and a 20 LD pass both stay readable.
  const y = (ld: number) => T + (1 - (Math.log10(Math.max(ld, 0.4)) + 0.4) / (Math.log10(20) + 0.4)) * (H - T - B);
  const closest = neos.reduce<Neo | undefined>((a, n) => (!a || n.distLd < a.distLd ? n : a), undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {neos.length} asteroids pass within 20 lunar distances of Earth in the next 30 days.
        {closest && ` The closest, ${closest.des}, comes within ${closest.distLd.toFixed(1)}.`}
      </p>

      <figure>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Chart of miss distance against date for each asteroid. The list below has the same data.">
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 1 ? "rgba(255,178,56,0.55)" : "rgba(255,255,255,0.1)"} strokeDasharray={t === 1 ? "4 3" : undefined} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#8A96B8">{t}</text>
            </g>
          ))}
          <text x={W - R} y={y(1) - 4} textAnchor="end" fontSize="10" fill="#FFB238">Moon&apos;s distance</text>
          {[0, 10, 20, 30].map((d) => (
            <text key={d} x={L + (d / 30) * (W - L - R)} y={H - 6} textAnchor={d === 30 ? "end" : d === 0 ? "start" : "middle"} fontSize="10" fill="#8A96B8">
              {d === 0 ? "today" : `+${d} days`}
            </text>
          ))}
          {neos.map((n) => (
            <circle
              key={n.des + n.date}
              cx={x(n.date)}
              cy={y(n.distLd)}
              r={Math.min(9, Math.max(2.5, Math.log10(Math.max(n.diameterM, 1)) * 2.4))}
              fill={n.des === selected ? "#FFB238" : n.hazardous ? "#FF5A4D" : "#9FB4E8"}
              fillOpacity={n.des === selected ? 1 : 0.7}
              stroke="#0A1128"
              className="cursor-pointer"
              onClick={() => onSelect(n.des)}
            >
              <title>{`${n.des}: ${n.distLd.toFixed(1)} lunar distances, ${size(n)}`}</title>
            </circle>
          ))}
        </svg>
        <figcaption className="text-xs text-muted-foreground">Miss distance in lunar distances, log scale. Bigger dots are bigger rocks.</figcaption>
      </figure>

      <Button variant="outline" size="sm" className="self-start" aria-pressed={space} onClick={() => onSpace(!space)}>
        {space ? "Back to Earth view" : "Show them around Earth"}
      </Button>
      {space && (
        <p className="text-xs text-muted-foreground">
          Schematic view. Distances are to log scale and the ring marks the Moon&apos;s distance. Directions are placeholders, because the close-approach feed gives distance only.
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
        {neos.map((n) => (
          <li key={n.des + n.date}>
            <button
              onClick={() => onSelect(n.des)}
              aria-current={n.des === selected}
              className="grid w-full grid-cols-[1fr_auto] gap-x-3 rounded-md border-l-2 border-transparent px-2 py-2 text-left hover:bg-white/5 aria-[current=true]:border-primary aria-[current=true]:bg-white/5"
            >
              <span className="font-medium">{n.des}</span>
              <span className="tabular-nums">{n.distLd.toFixed(1)} LD</span>
              <span className="text-xs text-muted-foreground">
                {when.format(new Date(n.date))} UTC, {size(n)}, {n.vKms.toFixed(1)} km/s
              </span>
              <span className="text-xs text-[#FF8A80]">{n.hazardous ? "Potentially hazardous" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
