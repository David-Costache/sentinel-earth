"use client";

import { useState } from "react";
import type { Neo } from "@/lib/types";

const W = 340, H = 170, L = 34, R = 8, T = 10, B = 24;
const TICKS = [1, 5, 20];
export const size = (n: Neo) => `${n.diameterEstimated ? "about " : ""}${n.diameterM < 1000 ? `${Math.round(n.diameterM)} m` : `${(n.diameterM / 1000).toFixed(1)} km`}`;

// Miss distance against date for each pass. The caller shows the same data as a list or table.
export default function NeoChart({ neos, selected, onSelect }: { neos: Neo[]; selected?: string; onSelect: (des: string) => void }) {
  const [t0] = useState(Date.now); // fixed at mount so the chart does not shift between renders
  const x = (iso: string) => L + ((new Date(iso).getTime() - t0) / (30 * 86_400_000)) * (W - L - R);
  // Log scale: a 1 LD pass and a 20 LD pass both stay readable.
  const y = (ld: number) => T + (1 - (Math.log10(Math.max(ld, 0.4)) + 0.4) / (Math.log10(20) + 0.4)) * (H - T - B);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Chart of miss distance against date for each asteroid. The list or table beside it has the same data.">
      {TICKS.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 1 ? "rgba(255,178,56,0.55)" : "rgba(255,255,255,0.1)"} strokeDasharray={t === 1 ? "4 3" : undefined} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#9aa6c8">{t}</text>
        </g>
      ))}
      <text x={W - R} y={y(1) - 4} textAnchor="end" fontSize="10" fill="#FFB238">Moon&apos;s distance</text>
      {[0, 10, 20, 30].map((d) => (
        <text key={d} x={L + (d / 30) * (W - L - R)} y={H - 6} textAnchor={d === 30 ? "end" : d === 0 ? "start" : "middle"} fontSize="10" fill="#9aa6c8">
          {d === 0 ? "today" : `+${d} days`}
        </text>
      ))}
      {neos.map((n) => (
        <circle
          key={n.des + n.date}
          cx={x(n.date)}
          cy={y(n.distLd)}
          r={Math.min(9, Math.max(3, Math.log10(Math.max(n.diameterM, 1)) * 2.4))}
          fill={n.des === selected ? "#FFB238" : n.hazardous ? "#e66767" : "#9FB4E8"}
          fillOpacity={n.des === selected ? 1 : 0.75}
          stroke="#101b3a"
          strokeWidth={2}
          className="cursor-pointer"
          onClick={() => onSelect(n.des)}
        >
          <title>{`${n.des}: ${n.distLd.toFixed(1)} lunar distances, ${size(n)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
