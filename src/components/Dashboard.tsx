"use client";

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { regionOf } from "@/lib/geo";
import { CATEGORY_ORDER, colorOf } from "@/lib/layers";
import type { EonetEvent, EpicImage, Feed, Neo, SpaceEvent } from "@/lib/types";
import NeoChart, { size } from "./NeoChart";

const DAY = 86_400_000;
const INK = "#9aa6c8";
const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const stamp = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
const KINDS: [SpaceEvent["kind"], string][] = [["flare", "Solar flares"], ["cme", "Coronal mass ejections"], ["stream", "High-speed streams"], ["storm", "Geomagnetic storms"]];

type Table = { head: string[]; rows: (string | number)[][] };

// One hover tooltip shared by every chart on the page.
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const on = (text: string) => ({
    onMouseMove: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onMouseLeave: () => setTip(null),
  });
  const node = tip && (
    <div role="tooltip" className="globe-tip pointer-events-none fixed z-50 whitespace-pre-line" style={{ left: Math.min(tip.x + 14, window.innerWidth - 250), top: tip.y + 14 }}>
      {tip.text}
    </div>
  );
  return { on, node };
}

function Chart({ title, note, table, children, className = "" }: { title: string; note: string; table: Table; children: ReactNode; className?: string }) {
  return (
    <figure className={`hud flex flex-col gap-2 rounded-xl p-4 ${className}`}>
      <h3 className="font-heading font-semibold">{title}</h3>
      {children}
      <figcaption className="text-xs text-muted-foreground">{note}</figcaption>
      {/* The text equivalent of the chart. */}
      <details className="text-xs">
        <summary className="cursor-pointer py-1 text-muted-foreground hover:text-foreground">Show as table</summary>
        <div className="max-h-56 overflow-auto">
          <table className="w-full border-collapse text-left tabular-nums">
            <thead><tr>{table.head.map((h) => <th key={h} scope="col" className="border-b border-border py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-border/50 py-1 pr-3">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Bars({ rows, onPick, tip }: { rows: { name: string; n: number; color: string; pick?: () => void }[]; onPick?: boolean; tip: ReturnType<typeof useTip>["on"] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-2 text-sm">
          <span className="truncate">{r.name}</span>
          <button
            type="button"
            disabled={!onPick || !r.pick}
            onClick={r.pick}
            aria-label={`${r.name}: ${r.n}. Show the latest on the globe.`}
            className="group h-5 rounded-r enabled:cursor-pointer"
            {...tip(`${r.name}: ${r.n}`)}
          >
            <span className="block h-3 rounded-r-[4px] transition-[filter] group-enabled:group-hover:brightness-125" style={{ width: `${Math.max(1.5, (r.n / max) * 100)}%`, background: r.color }} />
          </button>
          <span className="text-right tabular-nums">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

// Counts the first number in a value up from zero, once, when it first appears.
function CountUp({ value }: { value: string }) {
  const m = value.match(/\d+(\.\d+)?/);
  const target = m ? Number(m[0]) : 0;
  const decimals = m?.[1] ? m[1].length - 1 : 0;
  const calm = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [shown, setShown] = useState(calm || !m ? target : 0);
  useEffect(() => {
    if (calm || !m) return;
    let frame = 0;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      setShown(target * (1 - (1 - k) ** 3));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, calm, m === null]); // eslint-disable-line react-hooks/exhaustive-deps -- m is re-derived each render
  if (!m) return <>{value}</>;
  return (
    <>
      <span aria-hidden>{value.replace(m[0], shown.toFixed(decimals))}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}

// A single series, so no legend: the tile's label names it.
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - (v / max) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-2 h-7 w-full" role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={`0,24 ${pts} 100,24`} fill="rgba(255,178,56,0.12)" stroke="none" />
      <polyline points={pts} fill="none" stroke="#FFB238" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ label, value, sub, spark }: { label: string; value: string; sub: string; spark?: { values: number[]; label: string } }) {
  return (
    <div className="hud rounded-xl p-4 transition-colors hover:border-white/20">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-heading text-3xl font-bold leading-tight tabular-nums [font-stretch:118%]">{value === "…" ? <span className="skeleton inline-block h-8 w-16 align-middle" /> : <CountUp value={value} />}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
      {spark && spark.values.some((v) => v > 0) && <Sparkline {...spark} />}
    </div>
  );
}

type Props = {
  header: ReactNode;
  events?: Feed<EonetEvent>;
  neos?: Feed<Neo>;
  weather?: Feed<SpaceEvent>;
  epic?: Feed<EpicImage>;
  selectedNeo?: string;
  onEvent: (id: string) => void;
  onNeo: (des: string) => void;
};

export default function Dashboard({ header, events, neos, weather, epic, selectedNeo, onEvent, onNeo }: Props) {
  const [now] = useState(Date.now);
  const tip = useTip();
  const all = useMemo(() => events?.items ?? [], [events]);
  const rocks = neos?.items ?? [];
  const sun = weather?.items ?? [];

  const cats = useMemo(() => {
    const present = [...new Set(all.map((e) => e.category))];
    return present.sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 99) % 99 - (CATEGORY_ORDER.indexOf(b) + 99) % 99);
  }, [all]);
  const titleOf = (c: string) => all.find((e) => e.category === c)?.categoryTitle ?? c;

  // Latest report per event, bucketed by UTC day, for the last 30 days.
  const days = useMemo(() => {
    const list = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * DAY).toISOString().slice(0, 10));
    return list.map((d) => ({ d, items: all.filter((e) => e.date.slice(0, 10) === d) }));
  }, [all, now]);
  const peak = Math.max(1, ...days.map((x) => x.items.length));
  const startedPerDay = days.map((x) => all.filter((e) => e.started.slice(0, 10) === x.d).length);
  const passesPerDay = Array.from({ length: 30 }, (_, i) => rocks.filter((n) => Math.floor((new Date(n.date).getTime() - now) / DAY) === i).length);

  const regions = useMemo(() => {
    const m = new Map<string, EonetEvent[]>();
    for (const e of all) m.set(regionOf(e.lat, e.lng), [...(m.get(regionOf(e.lat, e.lng)) ?? []), e]);
    return [...m].sort((a, b) => b[1].length - a[1].length);
  }, [all]);

  const fresh = all.filter((e) => now - new Date(e.started).getTime() <= 7 * DAY).length;
  const closest = rocks.reduce<Neo | undefined>((a, n) => (!a || n.distLd < a.distLd ? n : a), undefined);
  const storm = sun.filter((s) => s.kind === "storm").sort((a, b) => b.time.localeCompare(a.time))[0];
  const flare = sun.filter((s) => s.kind === "flare").sort((a, b) => b.time.localeCompare(a.time))[0];

  const W = 640, H = 210, L = 28, R = 6, T = 8, B = 22;
  const bw = (W - L - R) / 30;
  const yOf = (n: number) => T + (1 - n / peak) * (H - T - B);

  const sources: [string, Feed<unknown> | undefined][] = [
    ["NASA EONET (natural events)", events],
    ["JPL close approaches and NASA NeoWs", neos],
    ["NASA DONKI (space weather)", weather],
    ["NASA EPIC (Earth image)", epic],
  ];
  const earth = epic?.items[0];

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 lg:p-6">
        {header}

        <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Open natural events"
            value={events ? String(all.length) : "…"}
            sub="reported in the last 30 days"
            spark={{ values: days.map((x) => x.items.length), label: "Event reports per day over the last 30 days" }}
          />
          <Tile
            label="New this week"
            value={events ? String(fresh) : "…"}
            sub="events first reported in the last 7 days"
            spark={{ values: startedPerDay, label: "New events per day over the last 30 days" }}
          />
          <Tile
            label="Closest asteroid pass"
            value={closest ? `${closest.distLd.toFixed(1)} LD` : neos ? "None" : "…"}
            sub={closest ? `${closest.des} on ${day.format(new Date(closest.date))}, ${size(closest)}` : "within 20 lunar distances, next 30 days"}
            spark={{ values: passesPerDay, label: "Asteroid passes per day over the next 30 days" }}
          />
          {flare && !storm ? (
            <Tile label="Latest solar flare" value={flare.label.split(" ")[0]} sub={`peaked ${day.format(new Date(flare.time))}`} />
          ) : (
            <Tile
              label="Latest geomagnetic storm"
              value={storm ? `Kp ${storm.value}` : weather ? "None" : "…"}
              sub={storm ? `began ${day.format(new Date(storm.time))}. Kp 5 and above is a storm.` : "in the last 30 days"}
            />
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <Chart
            className="lg:col-span-2"
            title="Event reports per day"
            note="Each event counts once, on the day of its latest report. Click a segment to see that event on the globe."
            table={{ head: ["Day", ...cats.map(titleOf), "Total"], rows: days.filter((x) => x.items.length).map((x) => [day.format(new Date(x.d)), ...cats.map((c) => x.items.filter((e) => e.category === c).length), x.items.length]) }}
          >
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {cats.map((c) => (
                <li key={c} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: colorOf(c) }} />{titleOf(c)}</li>
              ))}
            </ul>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Stacked bars of event reports per day for the last 30 days. The busiest day had ${peak}.`}>
              {[0, Math.ceil(peak / 2), peak].map((t) => (
                <g key={t}>
                  <line x1={L} x2={W - R} y1={yOf(t)} y2={yOf(t)} stroke="rgba(255,255,255,0.1)" />
                  <text x={L - 6} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill={INK}>{t}</text>
                </g>
              ))}
              {days.map((x, i) => {
                let base = 0;
                const segs = cats.map((c) => ({ c, items: x.items.filter((e) => e.category === c) })).filter((s) => s.items.length);
                return (
                  <g key={x.d}>
                    {i % 5 === 4 && <text x={L + (i + 0.5) * bw} y={H - 6} textAnchor="middle" fontSize="10" fill={INK}>{day.format(new Date(x.d))}</text>}
                    {segs.map((s, k) => {
                      const y1 = yOf(base + s.items.length), h = yOf(base) - y1;
                      base += s.items.length;
                      const top = k === segs.length - 1;
                      return (
                        <rect
                          key={s.c}
                          x={L + i * bw + 2}
                          y={y1 + (top ? 0 : 1)}
                          width={bw - 4}
                          height={Math.max(1, h - (top ? 1 : 2))}
                          rx={top ? 3 : 0}
                          fill={colorOf(s.c)}
                          className="cursor-pointer hover:brightness-125"
                          onClick={() => onEvent(s.items[0].id)}
                          {...tip.on(`${day.format(new Date(x.d))}\n${titleOf(s.c)}: ${s.items.length}\n${s.items.slice(0, 3).map((e) => e.title).join("\n")}${s.items.length > 3 ? "\n…" : ""}`)}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </Chart>

          <Chart
            title="Events by type"
            note="Click a bar to see the latest event of that type."
            table={{ head: ["Type", "Open events"], rows: cats.map((c) => [titleOf(c), all.filter((e) => e.category === c).length]) }}
          >
            <Bars onPick tip={tip.on} rows={cats.map((c) => ({ name: titleOf(c), n: all.filter((e) => e.category === c).length, color: colorOf(c), pick: () => onEvent(all.find((e) => e.category === c)!.id) }))} />
          </Chart>

          <Chart
            title="Events by region"
            note="Approximate: regions are rough boxes around each continent, worked out from each event's coordinates."
            table={{ head: ["Region (approximate)", "Open events"], rows: regions.map(([r, list]) => [r, list.length]) }}
          >
            <Bars onPick tip={tip.on} rows={regions.map(([r, list]) => ({ name: r, n: list.length, color: "#3987e5", pick: () => onEvent(list[0].id) }))} />
          </Chart>

          <Chart
            title="Asteroid passes, next 30 days"
            note="Miss distance in lunar distances, log scale. Bigger dots are bigger rocks. Click one to see it around Earth."
            table={{ head: ["Asteroid", "When (UTC)", "Lunar distances", "Size", "km/s"], rows: rocks.map((n) => [n.des, stamp.format(new Date(n.date)), n.distLd.toFixed(1), size(n), n.vKms.toFixed(1)]) }}
          >
            {rocks.length ? <NeoChart neos={rocks} selected={selectedNeo} onSelect={onNeo} /> : <p className="text-sm text-muted-foreground">{neos ? "No passes within 20 lunar distances." : "Loading asteroid passes…"}</p>}
          </Chart>

          <Chart
            title="Space weather, last 30 days"
            note="Each dot is one event from NASA DONKI. Bigger dots are faster ejections or stronger storms."
            table={{ head: ["When (UTC)", "Event"], rows: sun.map((s) => [stamp.format(new Date(s.time)), s.label]) }}
          >
            {sun.length ? (
              <svg viewBox="0 0 340 150" className="w-full" role="img" aria-label={`Timeline of ${sun.length} space weather events in the last 30 days, in rows by kind.`}>
                {KINDS.filter(([k]) => sun.some((s) => s.kind === k)).map(([k, name], row) => {
                  const y = 22 + row * 30;
                  return (
                    <g key={k}>
                      <text x={0} y={y - 9} fontSize="10" fill={INK}>{name} ({sun.filter((s) => s.kind === k).length})</text>
                      <line x1={0} x2={340} y1={y + 3} y2={y + 3} stroke="rgba(255,255,255,0.1)" />
                      {sun.filter((s) => s.kind === k).map((s) => (
                        <circle
                          key={s.id}
                          cx={6 + (1 - (now - new Date(s.time).getTime()) / (30 * DAY)) * 328}
                          cy={y + 3}
                          r={k === "cme" ? Math.min(7, 3 + (s.value ?? 0) / 400) : k === "storm" ? Math.min(7, (s.value ?? 5) - 1) : 4}
                          fill={k === "storm" ? "#FFB238" : "#9FB4E8"}
                          fillOpacity={0.8}
                          stroke="#101b3a"
                          strokeWidth={1.5}
                          {...tip.on(`${stamp.format(new Date(s.time))} UTC\n${s.label}`)}
                        />
                      ))}
                    </g>
                  );
                })}
                <text x={0} y={146} fontSize="10" fill={INK}>30 days ago</text>
                <text x={340} y={146} fontSize="10" fill={INK} textAnchor="end">today</text>
              </svg>
            ) : (
              <p className="text-sm text-muted-foreground">{weather ? "NASA lists no space weather events in the last 30 days." : "Loading space weather…"}</p>
            )}
          </Chart>

          {earth && (
            <figure className="hud flex flex-col gap-2 rounded-xl p-4">
              <h3 className="font-heading font-semibold">Earth today</h3>
              {/* eslint-disable-next-line @next/next/no-img-element -- remote NASA image, already sized by the archive */}
              <img src={earth.url} alt={`Full sunlit disk of Earth seen from the DSCOVR spacecraft on ${stamp.format(new Date(earth.date))} UTC`} width={1080} height={1080} loading="lazy" className="aspect-square w-full rounded-lg bg-black object-cover" />
              <p className="text-xs text-muted-foreground">
                Taken {stamp.format(new Date(earth.date))} UTC by NASA&apos;s EPIC camera, 1.5 million km away, centred near {Math.abs(earth.lat).toFixed(0)}°{earth.lat >= 0 ? "N" : "S"} {Math.abs(earth.lon).toFixed(0)}°{earth.lon >= 0 ? "E" : "W"}.
              </p>
            </figure>
          )}

          <section aria-label="Data freshness" className="hud rounded-xl p-4 lg:col-span-2">
            <h3 className="font-heading font-semibold">Data freshness</h3>
            <table className="mt-2 w-full border-collapse text-left text-sm">
              <thead><tr className="text-muted-foreground"><th scope="col" className="py-1 pr-3 font-medium">Source</th><th scope="col" className="py-1 pr-3 font-medium">Last updated (UTC)</th><th scope="col" className="py-1 font-medium">Status</th></tr></thead>
              <tbody>
                {sources.map(([name, feed]) => (
                  <tr key={name} className="border-t border-border/50">
                    <td className="py-1.5 pr-3">{name}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{feed?.fetchedAt ? stamp.format(new Date(feed.fetchedAt)) : feed ? "Bundled snapshot" : "Loading…"}</td>
                    <td className="py-1.5">{!feed ? "" : feed.stale ? "⚠ Saved data" : "● Live"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
      {tip.node}
    </div>
  );
}
