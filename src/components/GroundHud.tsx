"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { localSolarTime, sunElevation } from "@/lib/geo";
import { colorOf } from "@/lib/layers";
import type { EonetEvent } from "@/lib/types";
import { compassPoint } from "./GroundLayer";

const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
const hm = (hours: number) => `${String(Math.floor(hours)).padStart(2, "0")}:${String(Math.floor((hours % 1) * 60)).padStart(2, "0")}`;
const coord = (lat: number, lng: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;

type Props = {
  event: EonetEvent;
  position: number;
  total: number;
  nearby: number;
  onExit: () => void;
  onStep: (direction: 1 | -1) => void;
};

// Everything here is either from NASA's feed or worked out from the event's position and the clock.
export default function GroundHud({ event, position, total, nearby, onExit, onStep }: Props) {
  const exit = useRef<HTMLButtonElement>(null);
  useEffect(() => exit.current?.focus(), []);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const sun = sunElevation(event.lat, event.lng, now);
  const up = sun.elevation >= 0;

  return (
    <>
      <p role="status" className="sr-only">Ground view of {event.title}, event {position} of {total}.</p>

      <div className="pointer-events-none absolute inset-x-3 top-[5.25rem] flex items-start justify-between gap-2 lg:inset-x-4 lg:top-4">
        <Button ref={exit} variant="outline" onClick={onExit} className="hud pointer-events-auto h-11 px-4 lg:h-10">
          Exit ground view
        </Button>
        <div role="group" aria-label="Move between events" className="hud pointer-events-auto flex items-center gap-1 rounded-lg p-1">
          <Button variant="ghost" onClick={() => onStep(-1)} disabled={total < 2} className="h-9 px-3 max-lg:h-11" aria-label="Previous event">Previous</Button>
          <span className="whitespace-nowrap px-1 text-sm tabular-nums text-muted-foreground">{position} of {total}</span>
          <Button variant="ghost" onClick={() => onStep(1)} disabled={total < 2} className="h-9 px-3 max-lg:h-11" aria-label="Next event">Next</Button>
        </div>
      </div>

      <section aria-label="Event details" className="hud absolute inset-x-3 bottom-3 max-h-[42svh] overflow-y-auto rounded-xl p-4 lg:bottom-4 lg:left-4 lg:right-auto lg:max-h-none lg:w-[380px]">
        <p className="flex items-center gap-2 text-sm">
          <span className="size-2.5 rounded-full" style={{ background: colorOf(event.category) }} />
          {event.categoryTitle}
        </p>
        <h2 data-testid="ground-title" className="mt-1 font-heading text-xl font-semibold leading-tight tracking-[-0.02em]">{event.title}</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Location</dt>
          <dd className="tabular-nums">{coord(event.lat, event.lng)}</dd>
          <dt className="text-muted-foreground">Local solar time</dt>
          <dd data-testid="ground-solar" className="tabular-nums">{hm(localSolarTime(event.lng, now))}</dd>
          <dt className="text-muted-foreground">Sun</dt>
          <dd data-testid="ground-sun">
            {Math.abs(sun.elevation).toFixed(0)}° {up ? "above" : "below"} the horizon{up ? `, to the ${compassPoint(sun.azimuth)}` : ""}
          </dd>
          <dt className="text-muted-foreground">First reported</dt>
          <dd className="tabular-nums">{when.format(new Date(event.started))} UTC</dd>
          <dt className="text-muted-foreground">Latest report</dt>
          <dd className="tabular-nums">{when.format(new Date(event.date))} UTC</dd>
          {event.magnitude && (
            <>
              <dt className="text-muted-foreground">Magnitude</dt>
              <dd>{event.magnitude}</dd>
            </>
          )}
          {event.track && (
            <>
              <dt className="text-muted-foreground">Track</dt>
              <dd>{event.track.length} reported positions, drawn on the ground</dd>
            </>
          )}
          <dt className="text-muted-foreground">Nearby</dt>
          <dd>{nearby ? `${nearby} open event${nearby === 1 ? "" : "s"} within 1000 km, marked on the horizon` : "No other open events within 1000 km"}</dd>
        </dl>
        {event.source && (
          <a href={event.source} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2 lg:min-h-0">
            Source report
          </a>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Satellite imagery at about 250 m per pixel. This is a perspective view, not street level.</p>
        <p className="mt-1 hidden text-xs text-muted-foreground lg:block">Drag or use the arrow keys to look around. [ and ] move between events. Esc exits.</p>
      </section>
    </>
  );
}
