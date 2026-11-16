// Logic checks for the pure helpers. Run: npm run selfcheck
import assert from "node:assert/strict";
import { bearingAndDistance, eventsToCsv, eventsToGeoJson, localSolarTime, regionOf, subsolarPoint, sunElevation } from "../src/lib/geo.ts";

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);

// Ground view geometry.
const equinoxNoon = new Date("2026-03-20T12:00:00Z");
near(sunElevation(0, 0, equinoxNoon).elevation, 90, 2.5, "sun overhead at the equator, equinox noon");
assert.ok(sunElevation(0, 180, equinoxNoon).elevation < -80, "sun far below the horizon at local midnight");
assert.ok(sunElevation(51.5, 0, new Date("2026-06-21T00:00:00Z")).elevation < 0, "London midsummer midnight is still below the horizon");
near(sunElevation(51.5, 0, new Date("2026-06-21T12:00:00Z")).elevation, 62, 1.5, "London midsummer noon");
near(sunElevation(40, -100, new Date("2026-03-20T15:00:00Z")).azimuth, 120, 15, "morning sun in the south-east");

near(bearingAndDistance(0, 0, 10, 0).bearing, 0, 1e-9, "due north");
near(bearingAndDistance(0, 0, 0, 10).bearing, 90, 1e-9, "due east");
near(bearingAndDistance(0, 0, -10, 0).bearing, 180, 1e-9, "due south");
near(bearingAndDistance(0, 10, 0, 0).bearing, 270, 1e-9, "due west");
near(bearingAndDistance(0, 0, 1, 0).km, 111.2, 0.2, "one degree of latitude");
const dateLine = bearingAndDistance(0, 179, 0, -179);
near(dateLine.bearing, 90, 1e-6, "across the date line is east, not west");
near(dateLine.km, 222.4, 0.5, "across the date line is short");
near(bearingAndDistance(-59.8, -43.3, -60.5, -42).km, 104, 3, "Southern Ocean distance");

near(localSolarTime(0, equinoxNoon), 11.87, 0.1, "Greenwich solar time at 12:00 UTC in March");
near(localSolarTime(90, equinoxNoon), 17.87, 0.1, "solar time 90° east is six hours later");
near(localSolarTime(-180, equinoxNoon), 23.87, 0.1, "solar time wraps at the date line");

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
assert.equal(regionOf(-69.8, 21), "Antarctic");
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
