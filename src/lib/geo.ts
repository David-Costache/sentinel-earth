import type { EonetEvent } from "./types";

const DAY = 86_400_000;

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

// shortcut: rough bounding boxes, good for a dashboard tally; swap for real boundaries if regions ever drive decisions.
const BOXES: [string, number, number, number, number][] = [
  // name, south, north, west, east
  ["North America", 7, 84, -170, -52],
  ["South America", -56, 13, -82, -34],
  ["Europe", 35, 72, -25, 45],
  ["Africa", -35, 37, -18, 52],
  ["Oceania", -50, -10, 110, 180],
  ["Asia", -10, 78, 45, 180],
];

export function regionOf(lat: number, lng: number) {
  if (lat < -60) return "Antarctic";
  return BOXES.find(([, s, n, w, e]) => lat >= s && lat <= n && lng >= w && lng <= e)?.[0] ?? "Open ocean";
}

const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // Feed text that starts like a formula would run in a spreadsheet; a leading quote makes it plain text.
  if (typeof v === "string" && /^[=+@-]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function eventsToCsv(events: EonetEvent[]) {
  const cols = ["id", "title", "categoryTitle", "started", "date", "lat", "lng", "magnitude", "source"] as const;
  return [cols.join(","), ...events.map((e) => cols.map((c) => cell(e[c])).join(","))].join("\r\n");
}

export function eventsToGeoJson(events: EonetEvent[]) {
  return {
    type: "FeatureCollection",
    features: events.map(({ lat, lng, track, ...properties }) => ({
      type: "Feature",
      geometry: track
        ? { type: "LineString", coordinates: track.map(([la, lo]) => [lo, la]) }
        : { type: "Point", coordinates: [lng, lat] },
      properties,
    })),
  };
}
