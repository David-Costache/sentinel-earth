import type { EonetEvent } from "./types";

const DAY = 86_400_000;

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

const dayOfYear = (now: Date) => (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / DAY;
const utcHours = (now: Date) => now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;

// Minutes the sundial runs ahead of the clock.
function equationOfTime(now: Date) {
  const b = (2 * Math.PI * (dayOfYear(now) - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

// Where the sun is overhead right now. Accurate to about a degree, which is plenty for a terminator line.
export function subsolarPoint(now: Date) {
  return {
    lat: -23.44 * Math.cos((2 * Math.PI * (dayOfYear(now) + 10)) / 365),
    lng: wrap360((12 - utcHours(now) - equationOfTime(now) / 60) * 15 + 180) - 180,
  };
}

// Great-circle distance, and the initial compass bearing (0 = north, 90 = east) from A towards B.
export function bearingAndDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const [p1, p2, dl] = [lat1 * RAD, lat2 * RAD, (lng2 - lng1) * RAD];
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { bearing: wrap360(Math.atan2(y, x) / RAD), km: 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h))) };
}

// The sun's height above the horizon (degrees, negative below it) and its compass direction, seen from a place.
// Geometric: ignores refraction, so near the horizon it can be about half a degree low.
export function sunElevation(lat: number, lng: number, now: Date) {
  const s = subsolarPoint(now);
  const { bearing, km } = bearingAndDistance(lat, lng, s.lat, s.lng);
  return { elevation: 90 - km / EARTH_KM / RAD, azimuth: bearing };
}

// Apparent solar time at a longitude, in hours 0-24: 12 is when the sun is highest.
export function localSolarTime(lng: number, now: Date) {
  return (((utcHours(now) + lng / 15 + equationOfTime(now) / 60) % 24) + 24) % 24;
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
