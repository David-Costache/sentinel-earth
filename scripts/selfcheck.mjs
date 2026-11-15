// Logic checks for the pure helpers. Run: npm run selfcheck
import assert from "node:assert/strict";
import { eventsToCsv, eventsToGeoJson, regionOf, subsolarPoint } from "../src/lib/geo.ts";

// Sun: overhead near the equator and the Greenwich meridian at noon UTC on the March equinox,
// and at the Tropic of Cancer in late June.
const equinox = subsolarPoint(new Date("2026-03-20T12:00:00Z"));
assert.ok(Math.abs(equinox.lat) < 1.5, `equinox latitude ${equinox.lat}`);
assert.ok(Math.abs(equinox.lng) < 3, `equinox longitude ${equinox.lng}`);
assert.ok(Math.abs(subsolarPoint(new Date("2026-06-21T12:00:00Z")).lat - 23.44) < 0.5);
assert.ok(Math.abs(subsolarPoint(new Date("2026-06-21T00:00:00Z")).lng) > 175, "midnight UTC puts the sun over the date line");

assert.equal(regionOf(31.2, -89.0), "North America"); // Mississippi
assert.equal(regionOf(-15, -55), "South America");
assert.equal(regionOf(48.8, 2.3), "Europe");
assert.equal(regionOf(-1.3, 36.8), "Africa");
assert.equal(regionOf(35.7, 139.7), "Asia");
assert.equal(regionOf(-33.9, 151.2), "Oceania");
assert.equal(regionOf(-69.8, 21), "Antarctica and Southern Ocean");
assert.equal(regionOf(0, -140), "Open ocean");

const ev = { id: "E1", title: 'Fire "Big", north', category: "wildfires", categoryTitle: "Wildfires", date: "2026-11-12T00:00:00Z", started: "2026-11-10T00:00:00Z", lat: 1, lng: 2 };
const csv = eventsToCsv([ev]).split("\r\n");
assert.equal(csv.length, 2);
assert.equal(csv[1], 'E1,"Fire ""Big"", north",Wildfires,2026-11-10T00:00:00Z,2026-11-12T00:00:00Z,1,2,,');
assert.ok(eventsToCsv([{ ...ev, title: "=HYPERLINK(1)" }]).includes(",'=HYPERLINK(1),"), "formula-like text is neutralised");
assert.ok(eventsToCsv([{ ...ev, lat: -59.8 }]).includes(",-59.8,"), "negative numbers stay numbers");
const geo = eventsToGeoJson([ev, { ...ev, id: "E2", track: [[1, 2], [3, 4]] }]);
assert.deepEqual(geo.features[0].geometry, { type: "Point", coordinates: [2, 1] });
assert.deepEqual(geo.features[1].geometry, { type: "LineString", coordinates: [[2, 1], [4, 3]] });
assert.equal(geo.features[0].properties.title, ev.title);

console.log("selfcheck passed");
