"use client";

import { Button } from "@/components/ui/button";
import type { Neo } from "@/lib/types";
import NeoChart, { size } from "./NeoChart";

const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

type Props = { neos: Neo[]; selected?: string; onSelect: (des: string) => void; space: boolean; onSpace: (on: boolean) => void };

export default function NeoPanel({ neos, selected, onSelect, space, onSpace }: Props) {
  const closest = neos.reduce<Neo | undefined>((a, n) => (!a || n.distLd < a.distLd ? n : a), undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {neos.length} asteroids pass within 20 lunar distances of Earth in the next 30 days.
        {closest && ` The closest, ${closest.des}, comes within ${closest.distLd.toFixed(1)}.`}
      </p>

      <figure>
        <NeoChart neos={neos} selected={selected} onSelect={onSelect} />
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
              <span className="text-xs text-[#ff9a94]">{n.hazardous ? "Potentially hazardous" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
