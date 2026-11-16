"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bearingAndDistance, eventsToCsv, eventsToGeoJson } from "@/lib/geo";
import { colorOf, LAYERS } from "@/lib/layers";
import type { EonetEvent, EpicImage, Feed, Neo, SpaceEvent } from "@/lib/types";
import About from "./About";
import Analyst from "./Analyst";
import Clock from "./Clock";
import Dashboard from "./Dashboard";
import GroundHud from "./GroundHud";
import Intro from "./Intro";
import type { Waypoint } from "./GroundLayer";
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

const TABS = [["events", "Events"], ["incoming", "Asteroids"], ["sun", "Sun"], ["analyst", "Analyst"], ["about", "About"]] as const;

function FeedState({ error, loading, stale, retry, what }: { error?: string; loading: boolean; stale?: Feed<unknown>; retry: () => void; what: string }) {
  if (loading) return (
    <div role="status" className="space-y-2.5">
      <span className="sr-only">Loading {what}</span>
      {[92, 78, 85, 64, 80, 70].map((w, i) => <div key={i} className="skeleton h-4" style={{ width: `${w}%` }} />)}
    </div>
  );
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
  const [view, setView] = useState<"globe" | "dashboard" | "ground">(() => {
    const v = start.get("view");
    return v === "dashboard" || v === "ground" ? v : "globe";
  });
  const [notice, setNotice] = useState("");
  const returnFocus = useRef<Element | null>(null);
  const [tab, setTab] = useState(start.get("view") === "space" ? "incoming" : "events");
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [night, setNight] = useState(true);
  const [density, setDensity] = useState(false);
  const [copied, setCopied] = useState(false);
  // Phone layout: the bottom panel is compact (globe visible) or tall (more list); the imagery tools fold away.
  const [sheetTall, setSheetTall] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [seed, setSeed] = useState({ q: "", n: 0 });
  // First-visit hint. Storage can be blocked (private windows), so the app works without it.
  const [hint, setHint] = useState(() => {
    try { return localStorage.getItem("sentinel-hint") !== "seen"; } catch { return true; }
  });
  // First-screen intro: once per browser, and never when the link already names a view.
  const [intro, setIntro] = useState(() => {
    if (["layer", "date", "event", "view"].some((k) => start.has(k))) return false;
    try { return localStorage.getItem("sentinel-intro") !== "seen"; } catch { return true; }
  });
  const openConsole = useCallback(() => {
    setIntro(false);
    try { localStorage.setItem("sentinel-intro", "seen"); } catch { /* it shows again next visit */ }
    requestAnimationFrame(() => document.querySelector<HTMLElement>("header h1")?.focus({ preventScroll: true }));
  }, []);
  const dismissHint = () => {
    if (!hint) return;
    setHint(false);
    try { localStorage.setItem("sentinel-hint", "seen"); } catch { /* the hint just shows again next visit */ }
  };
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
    if (view === "dashboard" || view === "ground") p.set("view", view);
    else if (space) p.set("view", "space");
    window.history.replaceState(null, "", `?${p}`);
  }, [layerId, date, eventId, space, view]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setDate((d) => DATES[(DATES.indexOf(d) + 1) % DATES.length]), 1800);
    return () => clearInterval(t);
  }, [playing]);

  const selectEvent = useCallback((id: string) => { setEventId(id); setSpace(false); setView("globe"); }, []);

  // Ground view: stand at the selected event.
  const enterGround = useCallback(() => {
    if (!selected) return;
    returnFocus.current = document.activeElement;
    setSpace(false);
    setView("ground");
  }, [selected]);
  const exitGround = useCallback(() => setView("globe"), []);
  const stepGround = useCallback((d: 1 | -1) => {
    if (!visible.length) return;
    const i = visible.findIndex((e) => e.id === eventId);
    setEventId(visible[(i + d + visible.length) % visible.length].id);
  }, [visible, eventId]);
  const waypoints = useMemo<Waypoint[]>(() => {
    if (view !== "ground" || !selected) return [];
    return visible
      .filter((e) => e.id !== selected.id)
      .map((e) => ({ ...e, ...bearingAndDistance(selected.lat, selected.lng, e.lat, e.lng) }))
      .filter((e) => e.km <= 1000)
      .sort((a, b) => a.km - b.km)
      .slice(0, 12);
  }, [view, selected, visible]);

  // A shared link can name an event that has since closed: fall back to the globe and say why.
  // Adjusted while rendering (not in an effect) so the ground view never flashes up first.
  if (view === "ground" && (events.feed || events.error) && !selected) {
    setView("globe");
    setNotice(events.error ? "The event list could not load, so ground view is not available yet. Try again shortly." : "The event in that link is no longer open, so you are on the globe instead.");
  }

  // Hand focus back to whatever opened the ground view.
  const wasGround = useRef(view === "ground");
  useEffect(() => {
    if (wasGround.current && view === "globe") {
      const el = returnFocus.current as HTMLElement | null;
      requestAnimationFrame(() => (el?.isConnected ? el.focus() : document.querySelector<HTMLElement>("li > button[aria-expanded=true]")?.focus()));
    }
    wasGround.current = view === "ground";
  }, [view]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (view === "ground") {
        if (e.key === "Escape") exitGround();
        else if (e.key === "]") stepGround(1);
        else if (e.key === "[") stepGround(-1);
      } else if (view === "globe" && (e.key === "g" || e.key === "G") && selected) enterGround();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view, selected, enterGround, exitGround, stepGround]);
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
                className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:border-white/30 aria-[pressed=false]:opacity-45 max-lg:min-h-10 max-lg:px-3"
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
          <input id="find" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" className="min-w-0 flex-1 rounded-md border border-input bg-black/20 px-3 py-1.5 text-sm placeholder:text-muted-foreground max-lg:min-h-11" />
          <Button size="sm" variant="outline" className="max-lg:h-11" disabled={!visible.length} onClick={() => download("sentinel-earth-events.csv", "text/csv", eventsToCsv(visible))}>CSV</Button>
          <Button size="sm" variant="outline" className="max-lg:h-11" disabled={!visible.length} onClick={() => download("sentinel-earth-events.geojson", "application/geo+json", JSON.stringify(eventsToGeoJson(visible)))}>GeoJSON</Button>
        </div>
      )}
      {all.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground">No events match. Clear the search or turn a type back on.</p>}
      {visible.length > 0 && visible.length < all.length && <p className="text-xs text-muted-foreground" aria-live="polite">Showing {visible.length} of {all.length}. Exports include only these.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
        {(showAll ? visible : visible.slice(0, LIST_CAP)).map((e) => {
          const open = e.id === eventId;
          return (
            <li key={e.id} className={open ? "rounded-md border-l-2 border-primary bg-white/5" : "border-l-2 border-transparent"}>
              <button onClick={() => selectEvent(e.id)} aria-expanded={open} className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5 max-lg:py-3 ${open ? "font-semibold" : ""}`}>
                <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: colorOf(e.category) }} />
                <span className="min-w-0 flex-1">{e.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dayFmt.format(new Date(e.date)).replace(/, \d+$/, "")}</span>
              </button>
              {open && (
                // Category first, then the facts, then what you can do with them.
                <div className="mx-2 mb-2 rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium" style={{ background: `${colorOf(e.category)}2e` }}>
                      <span className="size-2 rounded-full" style={{ background: colorOf(e.category) }} />
                      {e.categoryTitle}
                    </span>
                    <span className="tabular-nums text-muted-foreground">Latest report {dayFmt.format(new Date(e.date))}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Location</dt>
                    <dd className="tabular-nums">{Math.abs(e.lat).toFixed(2)}°{e.lat >= 0 ? "N" : "S"} {Math.abs(e.lng).toFixed(2)}°{e.lng >= 0 ? "E" : "W"}</dd>
                    {e.magnitude && (<><dt className="text-muted-foreground">Magnitude</dt><dd>{e.magnitude}</dd></>)}
                    {e.track && (<><dt className="text-muted-foreground">Track</dt><dd>{e.track.length} reported positions</dd></>)}
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" className="max-lg:h-11" onClick={enterGround}>Ground view</Button>
                    <Button size="sm" variant="outline" className="max-lg:h-11" onClick={() => { setDate(DATES.includes(e.date.slice(0, 10)) ? e.date.slice(0, 10) : date); setLayerId(e.category === "wildfires" ? "burn" : e.category === "severeStorms" ? "truecolor" : layerId); }}>
                      See that day&apos;s imagery
                    </Button>
                    <Button size="sm" variant="outline" className="max-lg:h-11" onClick={() => { setTab("analyst"); setSeed((s) => ({ q: `Tell me about ${e.title} [${e.id}] and anything else happening within 500 km of it.`, n: s.n + 1 })); }}>
                      Ask the analyst
                    </Button>
                    {e.source && <a href={e.source} target="_blank" rel="noreferrer" className="inline-flex items-center px-1 text-xs text-primary underline underline-offset-2 max-lg:min-h-11">Source report</a>}
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

  // Stacked in the narrow desktop panel (the view switch gets its own full-width row);
  // a single row with the switch on the right everywhere else.
  const header = (stacked: boolean) => (
    <header className={stacked ? "flex flex-col gap-1" : "grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1"}>
      <h1 tabIndex={-1} className="font-heading text-xl font-semibold leading-tight outline-none">Sentinel Earth</h1>
      <div role="group" aria-label="View" className={`pointer-events-auto rounded-lg border border-border bg-card/70 p-0.5 ${stacked ? "order-last mt-2 grid grid-cols-2" : "inline-flex lg:row-span-2"}`}>
        {(["globe", "dashboard"] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className="min-h-10 rounded-md px-3 text-sm capitalize transition-colors hover:bg-white/10 aria-pressed:bg-primary aria-pressed:font-medium aria-pressed:text-primary-foreground max-lg:min-h-11">
            {v}
          </button>
        ))}
      </div>
      <p className={`text-sm text-muted-foreground ${stacked ? "" : "col-span-2 lg:col-span-1"}`}>
        {all.length ? `${all.length} natural events open in the last 30 days, from NASA.` : "Live NASA data on fires, storms and passing asteroids."}
      </p>
      <div className={stacked ? "" : "col-span-2 lg:col-span-1"}>
        <Clock saved={[events.feed, neos.feed, weather.feed, epic.feed].some((f) => f?.stale)} />
      </div>
    </header>
  );

  const shownTab = desktop && tab === "events" ? "incoming" : tab;

  return (
    <main className="relative h-svh overflow-hidden">
      <div className={view === "ground" ? "absolute inset-0" : intro ? "absolute inset-0" : `absolute inset-x-0 top-0 lg:h-full ${sheetTall ? "h-[24svh]" : "h-[60svh]"}`} onPointerDown={intro ? undefined : dismissHint}>
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
          ground={view === "ground" ? selected : undefined}
          waypoints={waypoints}
          onGroundPick={setEventId}
        />
      </div>

      {view === "ground" && selected && (
        <GroundHud
          event={selected}
          position={visible.findIndex((e) => e.id === selected.id) + 1 || 1}
          total={visible.length}
          nearby={waypoints.length}
          onExit={exitGround}
          onStep={stepGround}
        />
      )}

      {view === "ground" && !selected && (
        <div role="status" className="hud absolute left-1/2 top-1/2 flex w-[min(420px,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-xl px-4 py-3 text-sm">
          <span aria-hidden className="skeleton size-5 shrink-0 rounded-full" />
          <span className="flex-1">Loading the event for ground view…</span>
          <Button variant="outline" className="h-11 lg:h-9" onClick={exitGround}>Back to globe</Button>
        </div>
      )}

      {notice && (
        <div role="status" className="hud absolute left-1/2 top-3 z-10 flex w-[min(520px,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2 text-sm">
          <span className="flex-1">{notice}</span>
          <Button variant="ghost" size="sm" onClick={() => setNotice("")}>Dismiss</Button>
        </div>
      )}

      {view === "dashboard" && (
        <Dashboard header={header(false)} events={events.feed} neos={neos.feed} weather={weather.feed} epic={epic.feed} selectedNeo={neoDes} onEvent={selectEvent} onNeo={showNeo} />
      )}

      {intro && view === "globe" && <Intro events={events.feed} neos={neos.feed} failed={!!(events.error || neos.error)} onOpen={openConsole} />}

      {hint && !intro && view === "globe" && (
        <p role="status" className="hud pointer-events-none absolute left-1/2 top-[30svh] -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-2 text-sm lg:bottom-32 lg:top-auto">
          Drag to rotate. Click a marker for details.
        </p>
      )}

      {/* Hidden, not unmounted, so the analyst conversation survives a visit to the dashboard. */}
      <div className={view === "globe" && !intro ? "contents" : "hidden"}>
      {desktop ? (
        <aside className="hud absolute bottom-4 left-4 top-4 flex w-[340px] flex-col gap-4 rounded-xl p-4">
          {header(true)}
          {eventsPanel}
        </aside>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-background/90 to-transparent p-3 pb-8">{header(false)}</div>
      )}

      {/* On a phone: one row (layer, play, more) sitting just above the panel; the rest opens upwards. */}
      <section
        aria-label="Imagery"
        className={`hud absolute inset-x-2 rounded-xl px-3 py-2 lg:inset-x-auto lg:bottom-4 lg:left-[372px] lg:right-[412px] lg:top-auto lg:block ${sheetTall ? "hidden" : "bottom-[calc(40svh+0.5rem)]"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="layer" className="sr-only">Imagery layer</label>
          <select id="layer" value={layerId} onChange={(e) => setLayerId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1.5 text-sm max-lg:h-11 lg:flex-none">
            {LAYERS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <Button size="sm" variant="outline" className="max-lg:h-11" disabled={!!layer.fixedDate} aria-pressed={playing} onClick={() => setPlaying(!playing)}>
            {playing ? "Pause" : "Play"}
          </Button>
          <Button size="sm" variant="ghost" className="h-11 lg:hidden" aria-expanded={toolsOpen} aria-controls="imagery-tools" onClick={() => setToolsOpen(!toolsOpen)}>
            {toolsOpen ? "Hide tools" : "Date and tools"}
          </Button>
          <div id="imagery-tools" className={`order-first basis-full flex-wrap items-center gap-2 lg:order-none lg:flex lg:flex-1 lg:basis-0 lg:flex-nowrap ${toolsOpen ? "flex" : "hidden"}`}>
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
              className="min-w-0 basis-full disabled:opacity-40 max-lg:h-11 lg:flex-1 lg:basis-0"
            />
            <Button size="sm" variant="outline" aria-pressed={night} onClick={() => setNight(!night)} className="aria-pressed:border-primary aria-pressed:text-primary max-lg:h-11">Night side</Button>
            <Button size="sm" variant="outline" aria-pressed={density} onClick={() => setDensity(!density)} className="aria-pressed:border-primary aria-pressed:text-primary max-lg:h-11">Density</Button>
            <Button size="sm" variant="ghost" className="max-lg:h-11" onClick={() => navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
              {copied ? "Link copied" : "Copy link"}
            </Button>
          </div>
        </div>
        <p className={`mt-1 truncate text-xs text-muted-foreground lg:block ${toolsOpen ? "block" : "hidden"}`}>
          <span className="tabular-nums text-foreground">{layer.fixedDate ? "Fixed composite" : dayFmt.format(new Date(date))}</span>. {layer.note}
        </p>
      </section>

      <Tabs
        value={shownTab}
        onValueChange={(v) => setTab(String(v))}
        className={`hud absolute inset-x-0 bottom-0 gap-2 rounded-t-xl p-3 pt-0 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:w-[380px] lg:gap-3 lg:rounded-xl lg:p-4 ${sheetTall ? "top-[24svh]" : "top-[60svh]"}`}
      >
        <button
          type="button"
          aria-expanded={sheetTall}
          onClick={() => setSheetTall(!sheetTall)}
          className="flex h-11 w-full shrink-0 flex-col items-center justify-center gap-1 text-xs text-muted-foreground lg:hidden"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-white/30" />
          {sheetTall ? "Show more globe" : "Show more list"}
        </button>
        <TabsList variant="line" className="h-10! w-full border-b border-border max-lg:h-11!">
          {(desktop ? TABS.slice(1) : TABS).map(([value, name]) => (
            // The underline grows from the left under the active tab.
            <TabsTrigger
              key={value}
              value={value}
              className="rounded-b-none hover:bg-white/5 max-lg:min-h-11 after:origin-left after:scale-x-0 after:bg-primary after:opacity-100 after:transition-transform after:duration-300 data-active:after:scale-x-100 group-data-horizontal/tabs:after:bottom-[-1px]"
            >
              {name}
            </TabsTrigger>
          ))}
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
