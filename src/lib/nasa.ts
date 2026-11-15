import type { EonetEvent, EpicImage, Feed, Neo, SpaceEvent } from "./types";
import epicSnapshot from "@/data/epic.json";
import spaceSnapshot from "@/data/space.json";
import eventsSnapshot from "@/data/events.json";
import neosSnapshot from "@/data/neos.json";

const AU_KM = 149_597_870.7;
const LD_KM = 384_400;

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

// shortcut: per-instance memory cache, fine for one server; move to a shared cache if this runs on many instances.
const memo = new Map<string, { at: number; feed: Feed<unknown> }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T[]>, snapshot: T[]): Promise<Feed<T>> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.feed as Feed<T>;
  try {
    const feed = { items: await load(), stale: false, fetchedAt: new Date().toISOString() };
    memo.set(key, { at: Date.now(), feed });
    return feed;
  } catch (err) {
    console.error(`[${key}] live fetch failed, serving fallback:`, err);
    // The last good live answer beats the bundled snapshot.
    if (hit) return { ...(hit.feed as Feed<T>), stale: true };
    return { items: snapshot, stale: true, fetchedAt: "" };
  }
}

type RawGeom = { date: string; coordinates: unknown; magnitudeValue?: number | null; magnitudeUnit?: string | null };
type RawEvent = { id: string; title: string; categories: { id: string; title: string }[]; sources: { url: string }[]; geometry: RawGeom[] };

function point(g: RawGeom): [number, number] | null {
  let c = g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; // polygon -> first vertex
  if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  return [c[1], c[0]]; // GeoJSON is [lng, lat]
}

export function normalizeEvents(raw: { events: RawEvent[] }): EonetEvent[] {
  return raw.events
    .flatMap((e) => {
      const pts = e.geometry.map(point).filter((p): p is [number, number] => p !== null);
      const last = e.geometry[e.geometry.length - 1];
      if (!pts.length || !last) return [];
      const [lat, lng] = pts[pts.length - 1];
      return [{
        id: e.id,
        title: e.title,
        category: e.categories[0]?.id ?? "other",
        categoryTitle: e.categories[0]?.title ?? "Other",
        date: last.date,
        started: e.geometry[0].date,
        lat,
        lng,
        magnitude: last.magnitudeValue != null ? `${last.magnitudeValue} ${last.magnitudeUnit ?? ""}`.trim() : undefined,
        source: e.sources[0]?.url,
        track: pts.length > 1 ? pts : undefined,
      }];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const getEvents = () =>
  cached<EonetEvent>(
    "eonet",
    10 * 60_000,
    async () => normalizeEvents(await getJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30")),
    eventsSnapshot as EonetEvent[],
  );

// Diameter in metres from absolute magnitude H, assuming a typical albedo of 0.14.
export const diameterFromH = (h: number) => (1329 / Math.sqrt(0.14)) * 10 ** (-h / 5) * 1000;

type NeoWs = {
  near_earth_objects: Record<string, {
    name: string;
    is_potentially_hazardous_asteroid: boolean;
    estimated_diameter: { meters: { estimated_diameter_min: number; estimated_diameter_max: number } };
  }[]>;
};

async function loadNeos(): Promise<Neo[]> {
  const cad = await getJson("https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B30&dist-max=0.05&sort=date");
  const f: string[] = cad.fields;
  const col = (row: string[], name: string) => row[f.indexOf(name)];

  // NeoWs adds catalogued sizes and the hazard flag for the next 7 days. It is rate limited, so it is optional.
  const extra = new Map<string, { hazardous: boolean; diameterM: number }>();
  try {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const key = process.env.NASA_API_KEY || "DEMO_KEY";
    const feed: NeoWs = await getJson(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${day(0)}&end_date=${day(7)}&api_key=${key}`);
    for (const o of Object.values(feed.near_earth_objects).flat()) {
      const d = o.estimated_diameter.meters;
      extra.set(o.name.replace(/[()]/g, "").trim(), {
        hazardous: o.is_potentially_hazardous_asteroid,
        diameterM: (d.estimated_diameter_min + d.estimated_diameter_max) / 2,
      });
    }
  } catch (err) {
    console.error("[neows] enrichment skipped:", err);
  }

  return ((cad.data ?? []) as string[][]).map((row) => {
    const des = col(row, "des");
    const au = Number(col(row, "dist"));
    const more = extra.get(des);
    return {
      des,
      date: new Date(`${col(row, "cd").replace(/-/g, " ")} UTC`).toISOString(),
      distKm: au * AU_KM,
      distLd: (au * AU_KM) / LD_KM,
      vKms: Number(col(row, "v_rel")),
      diameterM: more?.diameterM ?? diameterFromH(Number(col(row, "h"))),
      diameterEstimated: !more,
      hazardous: more?.hazardous,
    };
  });
}

export const getNeos = () => cached<Neo>("neos", 60 * 60_000, loadNeos, neosSnapshot as Neo[]);

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * rad) / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLng - aLng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const nasaKey = () => process.env.NASA_API_KEY || "DEMO_KEY";
const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const validTime = (t: unknown) => (typeof t === "string" && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null);

type Donki = Record<string, unknown>;

async function getDonki(type: string): Promise<Donki[]> {
  const res = await fetch(
    `https://api.nasa.gov/DONKI/${type}?startDate=${utcDay(-30)}&endDate=${utcDay(0)}&api_key=${nasaKey()}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`${res.status} from DONKI ${type}`);
  const text = await res.text(); // DONKI answers with an empty body when there is nothing to report
  return text.trim() ? JSON.parse(text) : [];
}

async function loadSpaceWeather(): Promise<SpaceEvent[]> {
  // Fetched separately: NASA's flare endpoint has had outages while the others kept working.
  const [cme, gst, hss, flr] = await Promise.allSettled(["CME", "GST", "HSS", "FLR"].map(getDonki));
  for (const r of [cme, gst, hss, flr]) if (r.status === "rejected") console.error("[donki]", String(r.reason));
  if ([cme, gst, hss, flr].every((r) => r.status === "rejected")) throw new Error("all DONKI feeds failed");
  const rows = (r: PromiseSettledResult<Donki[]>) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
  const link = (d: Donki) => (typeof d.link === "string" ? d.link : undefined);

  const out: (SpaceEvent | null | "")[] = [
    ...rows(cme).map((d) => {
      const time = validTime(d.startTime);
      const best = (Array.isArray(d.cmeAnalyses) ? (d.cmeAnalyses as Donki[]) : []).find((a) => a.isMostAccurate);
      const speed = typeof best?.speed === "number" ? Math.round(best.speed) : undefined;
      return time && { id: String(d.activityID), kind: "cme" as const, time, value: speed, label: speed ? `Coronal mass ejection at ${speed} km/s` : "Coronal mass ejection", note: typeof d.note === "string" ? d.note : undefined, link: link(d) };
    }),
    ...rows(gst).map((d) => {
      const time = validTime(d.startTime);
      const kp = Math.max(0, ...(Array.isArray(d.allKpIndex) ? (d.allKpIndex as Donki[]) : []).map((k) => Number(k.kpIndex) || 0));
      return time && { id: String(d.gstID), kind: "storm" as const, time, value: kp, label: `Geomagnetic storm, Kp ${kp}`, link: link(d) };
    }),
    ...rows(hss).map((d) => {
      const time = validTime(d.eventTime);
      return time && { id: String(d.hssID), kind: "stream" as const, time, label: "High-speed solar wind stream", link: link(d) };
    }),
    ...rows(flr).map((d) => {
      const time = validTime(d.peakTime ?? d.beginTime);
      return time && typeof d.classType === "string"
        ? { id: String(d.flrID), kind: "flare" as const, time, label: `${d.classType} solar flare`, note: typeof d.sourceLocation === "string" ? `Source region ${d.sourceLocation}` : undefined, link: link(d) }
        : null;
    }),
  ];
  return out.filter((e): e is SpaceEvent => !!e).sort((a, b) => b.time.localeCompare(a.time));
}

export const getSpaceWeather = () => cached<SpaceEvent>("donki", 30 * 60_000, loadSpaceWeather, spaceSnapshot as SpaceEvent[]);

async function loadEpic(): Promise<EpicImage[]> {
  const list = await getJson(`https://api.nasa.gov/EPIC/api/natural?api_key=${nasaKey()}`);
  const last = Array.isArray(list) ? list[list.length - 1] : undefined;
  const time = validTime(`${last?.date}`.replace(" ", "T") + "Z");
  if (!last || !time || !/^[\w-]+$/.test(last.image)) return [];
  const [y, m, d] = time.slice(0, 10).split("-");
  // The image comes from the archive host that needs no key, so the key never reaches the browser.
  return [{
    date: time,
    url: `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${last.image}.jpg`,
    caption: String(last.caption ?? ""),
    lat: Number(last.centroid_coordinates?.lat) || 0,
    lon: Number(last.centroid_coordinates?.lon) || 0,
  }];
}

export const getEpic = () => cached<EpicImage>("epic", 60 * 60_000, loadEpic, epicSnapshot as EpicImage[]);
