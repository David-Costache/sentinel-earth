"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventsToCsv, eventsToGeoJson } from "@/lib/geo";
import { colorOf, LAYERS } from "@/lib/layers";
import type { EonetEvent, EpicImage, Feed, Neo, SpaceEvent } from "@/lib/types";
import About from "./About";
import Analyst from "./Analyst";
import Dashboard from "./Dashboard";
import GlobeView from "./GlobeView";
import NeoPanel from "./NeoPanel";
import SpacePanel from "./SpacePanel";

// The last 30 full UTC days. Today is left out because its imagery is still arriving.
const DATES = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (30 - i) * 86_400_000).toISOString().slice(0, 10));
const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const LIST_CAP = 120;

function download(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function useFeed<T>(url: string) {
  const [state, setState] = useState<{ feed?: Feed<T>; error?: string }>({});
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((feed) => live && setState({ feed }))
      .catch(() => live && setState({ error: "Could not reach the server." }));
    return () => { live = false; };
  }, [url, tries]);
  return { ...state, retry: () => { setState({}); setTries((n) => n + 1); } };
}

const desktopQuery = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia(desktopQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

function FeedState({ error, loading, stale, retry, what }: { error?: string; loading: boolean; stale?: Feed<unknown>; retry: () => void; what: string }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading {what}…</p>;
  if (error) return (
    <p role="alert" className="text-sm">
      {error} <button onClick={retry} className="text-primary underline underline-offset-2">Try again</button>
    </p>
  );
  if (stale?.stale) return (
    <p className="rounded-md border border-primary/40 px-2 py-1 text-xs">
      NASA&apos;s live feed did not respond. Showing saved {what}{stale.fetchedAt ? ` from ${dayFmt.format(new Date(stale.fetchedAt))}` : ""}.
    </p>
  );
  return null;
}

export default function Sentinel() {
  const start = useMemo(() => new URLSearchParams(window.location.search), []);
  const [layerId, setLayerId] = useState(() => (LAYERS.some((l) => l.id === start.get("layer")) ? start.get("layer")! : "truecolor"));
  const [date, setDate] = useState(() => (DATES.includes(start.get("date") ?? "") ? start.get("date")! : DATES[DATES.length - 1]));
  const [eventId, setEventId] = useState(start.get("event") ?? "");
  const [neoDes, setNeoDes] = useState("");
  const [space, setSpace] = useState(start.get("view") === "space");
  const [view, setView] = useState<"globe" | "dashboard">(start.get("view") === "dashboard" ? "dashboard" : "globe");
  const [tab, setTab] = useState(start.get("view") === "space" ? "incoming" : "events");
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [night, setNight] = useState(true);
  const [density, setDensity] = useState(false);
  const [copied, setCopied] = useState(false);
  const [seed, setSeed] = useState({ q: "", n: 0 });
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches);

  const events = useFeed<EonetEvent>("/api/events");
  const neos = useFeed<Neo>("/api/neos");
  const weather = useFeed<SpaceEvent>("/api/space-weather");
  const epic = useFeed<EpicImage>("/api/epic");
  const layer = LAYERS.find((l) => l.id === layerId)!;

  const all = useMemo(() => events.feed?.items ?? [], [events.feed]);
  const categories = useMemo(() => {
    const m = new Map<string, { title: string; n: number }>();
    for (const e of all) m.set(e.category, { title: e.categoryTitle, n: (m.get(e.category)?.n ?? 0) + 1 });
    return [...m].sort((a, b) => b[1].n - a[1].n);
  }, [all]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => !hidden.includes(e.category) && (!q || e.title.toLowerCase().includes(q)));
  }, [all, hidden, query]);
  const selected = all.find((e) => e.id === eventId);

  // Shareable link: the address always describes the current view.
  useEffect(() => {
    const p = new URLSearchParams({ layer: layerId, date });
    if (eventId) p.set("event", eventId);
    if (view === "dashboard") p.set("view", "dashboard");
    else if (space) p.set("view", "space");
    window.history.replaceState(null, "", `?${p}`);
  }, [layerId, date, eventId, space, view]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setDate((d) => DATES[(DATES.indexOf(d) + 1) % DATES.length]), 1800);
    return () => clearInterval(t);
  }, [playing]);

  const selectEvent = useCallback((id: string) => { setEventId(id); setSpace(false); setView("globe"); }, []);
  const showNeo = useCallback((des: string) => { setNeoDes(des); setSpace(true); setTab("incoming"); setView("globe"); }, []);
  const selectNeo = useCallback((des: string) => setNeoDes(des), []);
  const cite = useCallback((ref: string) => {
    if (ref.startsWith("NEO:")) { setNeoDes(ref.slice(4)); setSpace(true); }
    else selectEvent(ref);
  }, [selectEvent]);
  const citeLabel = useCallback(
    (ref: string) =>
      ref.startsWith("NEO:")
        ? neos.feed?.items.find((n) => n.des === ref.slice(4))?.des
        : all.find((e) => e.id === ref)?.title,
    [all, neos.feed],
  );

  const eventsPanel = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <FeedState what="events" loading={!events.feed && !events.error} error={events.error} stale={events.feed} retry={events.retry} />
      {events.feed && all.length === 0 && <p className="text-sm text-muted-foreground">NASA lists no open events right now.</p>}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show or hide event types">
          {categories.map(([id, c]) => {
            const on = !hidden.includes(id);
            return (
              <button
                key={id}
                aria-pressed={on}
                onClick={() => setHidden(on ? [...hidden, id] : hidden.filter((h) => h !== id))}
                className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs aria-[pressed=false]:opacity-45"
              >
                <span className="size-2 rounded-full" style={{ background: colorOf(id) }} />
                {c.title} <span className="tabular-nums text-muted-foreground">{c.n}</span>
              </button>
            );
          })}
        </div>
      )}
      {all.length > 0 && (
        <div className="flex gap-2">
          <label htmlFor="find" className="sr-only">Search events by name</label>
          <input id="find" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" className="min-w-0 flex-1 rounded-md border border-input bg-black/20 px-3 py-1.5 text-sm placeholder:text-muted-foreground" />
          <Button size="sm" variant="outline" disabled={!visible.length} onClick={() => download("sentinel-earth-events.csv", "text/csv", eventsToCsv(visible))}>CSV</Button>
          <Button size="sm" variant="outline" disabled={!visible.length} onClick={() => download("sentinel-earth-events.geojson", "application/geo+json", JSON.stringify(eventsToGeoJson(visible)))}>GeoJSON</Button>
        </div>
      )}
      {all.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground">No events match. Clear the search or turn a type back on.</p>}
      {visible.length > 0 && visible.length < all.length && <p className="text-xs text-muted-foreground" aria-live="polite">Showing {visible.length} of {all.length}. Exports include only these.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
        {(showAll ? visible : visible.slice(0, LIST_CAP)).map((e) => {
          const open = e.id === eventId;
          return (
            <li key={e.id} className={open ? "rounded-md border-l-2 border-primary bg-white/5" : "border-l-2 border-transparent"}>
              <button onClick={() => selectEvent(e.id)} aria-expanded={open} className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5">
                <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: colorOf(e.category) }} />
                <span className="min-w-0 flex-1">{e.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dayFmt.format(new Date(e.date)).replace(/, \d+$/, "")}</span>
              </button>
              {open && (
                <div className="space-y-2 px-2 pb-2 pl-6 text-xs text-muted-foreground">
                  <p className="tabular-nums">
                    {e.categoryTitle}, {Math.abs(e.lat).toFixed(2)}°{e.lat >= 0 ? "N" : "S"} {Math.abs(e.lng).toFixed(2)}°{e.lng >= 0 ? "E" : "W"}
                    {e.magnitude && `, ${e.magnitude}`}
                    {e.track && `, ${e.track.length} tracked positions`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" variant="outline" onClick={() => { setDate(DATES.includes(e.date.slice(0, 10)) ? e.date.slice(0, 10) : date); setLayerId(e.category === "wildfires" ? "burn" : e.category === "severeStorms" ? "truecolor" : layerId); }}>
                      See that day&apos;s imagery
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => { setTab("analyst"); setSeed((s) => ({ q: `Tell me about ${e.title} [${e.id}] and anything else happening within 500 km of it.`, n: s.n + 1 })); }}>
                      Ask the analyst
                    </Button>
                    {e.source && <a href={e.source} target="_blank" rel="noreferrer" className="self-center text-primary underline underline-offset-2">Source report</a>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!showAll && visible.length > LIST_CAP && (
        <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>Show all {visible.length} events</Button>
      )}
    </div>
  );

  const brand = (
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-[12rem] flex-1">
      <h1 className="font-heading text-xl font-bold leading-tight">Sentinel Earth</h1>
      <p className="text-sm text-muted-foreground">
        {all.length ? `${all.length} natural events open in the last 30 days, from NASA.` : "Live NASA data on fires, storms and passing asteroids."}
      </p>
      </div>
      <div role="group" aria-label="View" className="pointer-events-auto inline-flex shrink-0 rounded-lg border border-border bg-card/70 p-0.5">
        {(["globe", "dashboard"] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className="min-h-9 rounded-md px-3 text-sm capitalize transition-colors hover:bg-white/10 active:translate-y-px aria-pressed:bg-primary aria-pressed:font-medium aria-pressed:text-primary-foreground">
            {v}
          </button>
        ))}
      </div>
    </header>
  );

  const shownTab = desktop && tab === "events" ? "incoming" : tab;

  return (
    <main className="relative h-svh overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[46svh] lg:h-full">
        <GlobeView
          layer={layer}
          date={date}
          events={space ? [] : visible}
          selected={selected}
          neos={neos.feed?.items ?? []}
          selectedNeo={neoDes}
          space={space}
          night={night}
          density={density}
          onSelect={selectEvent}
          onSelectNeo={selectNeo}
        />
      </div>

      {view === "dashboard" && (
        <Dashboard header={brand} events={events.feed} neos={neos.feed} weather={weather.feed} epic={epic.feed} selectedNeo={neoDes} onEvent={selectEvent} onNeo={showNeo} />
      )}

      {/* Hidden, not unmounted, so the analyst conversation survives a visit to the dashboard. */}
      <div className={view === "dashboard" ? "hidden" : "contents"}>
      {desktop ? (
        <aside className="hud absolute bottom-4 left-4 top-4 flex w-[340px] flex-col gap-4 rounded-xl p-4">
          {brand}
          {eventsPanel}
        </aside>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-background/90 to-transparent p-3 pb-8">{brand}</div>
      )}

      <section aria-label="Imagery" className="hud absolute inset-x-2 top-[calc(46svh-10.25rem)] rounded-xl px-3 py-2 lg:inset-x-auto lg:bottom-4 lg:left-[372px] lg:right-[412px] lg:top-auto">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="layer" className="sr-only">Imagery layer</label>
          <select id="layer" value={layerId} onChange={(e) => setLayerId(e.target.value)} className="min-w-0 basis-full rounded-md border border-input bg-card px-2 py-1.5 text-sm lg:basis-auto">
            {LAYERS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!!layer.fixedDate} aria-pressed={playing} onClick={() => setPlaying(!playing)}>
            {playing ? "Pause" : "Play"}
          </Button>
          <label htmlFor="date" className="sr-only">Imagery date</label>
          <input
            id="date"
            type="range"
            min={0}
            max={DATES.length - 1}
            value={DATES.indexOf(date)}
            disabled={!!layer.fixedDate}
            onChange={(e) => { setPlaying(false); setDate(DATES[+e.target.value]); }}
            aria-valuetext={dayFmt.format(new Date(date))}
            className="order-last min-w-0 basis-full disabled:opacity-40 lg:order-none lg:flex-1 lg:basis-0"
          />
          <Button size="sm" variant="outline" aria-pressed={night} onClick={() => setNight(!night)} className="aria-pressed:border-primary aria-pressed:text-primary">Night side</Button>
          <Button size="sm" variant="outline" aria-pressed={density} onClick={() => setDensity(!density)} className="aria-pressed:border-primary aria-pressed:text-primary">Density</Button>
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
            {copied ? "Link copied" : "Copy link"}
          </Button>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          <span className="tabular-nums text-foreground">{layer.fixedDate ? "Fixed composite" : dayFmt.format(new Date(date))}</span>. {layer.note}
        </p>
      </section>

      <Tabs
        value={shownTab}
        onValueChange={(v) => setTab(String(v))}
        className="hud absolute inset-x-0 bottom-0 top-[46svh] gap-3 rounded-t-xl p-3 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:w-[380px] lg:rounded-xl lg:p-4"
      >
        <TabsList className="w-full">
          {!desktop && <TabsTrigger value="events">Events</TabsTrigger>}
          <TabsTrigger value="incoming">Asteroids</TabsTrigger>
          <TabsTrigger value="sun">Sun</TabsTrigger>
          <TabsTrigger value="analyst">Analyst</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>
        {!desktop && <TabsContent value="events" className="flex min-h-0 flex-col">{eventsPanel}</TabsContent>}
        <TabsContent value="incoming" className="flex min-h-0 flex-col gap-3">
          <FeedState what="asteroid passes" loading={!neos.feed && !neos.error} error={neos.error} stale={neos.feed} retry={neos.retry} />
          {neos.feed && (neos.feed.items.length
            ? <NeoPanel neos={neos.feed.items} selected={neoDes} onSelect={selectNeo} space={space} onSpace={setSpace} />
            : <p className="text-sm text-muted-foreground">No asteroid passes within 20 lunar distances in the next 30 days.</p>)}
        </TabsContent>
        <TabsContent value="sun" className="flex min-h-0 flex-col gap-3">
          <FeedState what="space weather" loading={!weather.feed && !weather.error} error={weather.error} stale={weather.feed} retry={weather.retry} />
          {weather.feed && (weather.feed.items.length
            ? <SpacePanel items={weather.feed.items} />
            : <p className="text-sm text-muted-foreground">NASA lists no space weather events in the last 30 days.</p>)}
        </TabsContent>
        <TabsContent value="analyst" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
          <Analyst seed={seed} label={citeLabel} onCite={cite} />
        </TabsContent>
        <TabsContent value="about" className="flex min-h-0 flex-col"><About /></TabsContent>
      </Tabs>
      </div>
    </main>
  );
}
