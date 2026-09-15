import test from "node:test";
import assert from "node:assert/strict";

import { degreesToCompass, windBandFor, upcomingTides } from "../src/conditions.js";

test("degreesToCompass maps the cardinal and intercardinal points", () => {
  const expected = [
    [0, "N"], [45, "NE"], [90, "E"], [135, "SE"],
    [180, "S"], [225, "SW"], [270, "W"], [315, "NW"],
  ];
  for (const [degrees, point] of expected) {
    assert.equal(degreesToCompass(degrees), point);
  }
});

test("degreesToCompass wraps past 360 back to north", () => {
  assert.equal(degreesToCompass(349), "N");
  assert.equal(degreesToCompass(360), "N");
  assert.equal(degreesToCompass(11), "N");
  assert.equal(degreesToCompass(12), "NNE");
});

test("windBandFor judges every unit on the same knot scale", () => {
  // 10 kt is "Good sailing"; the same wind in other units must agree.
  assert.equal(windBandFor(10, "kn").label, "Good sailing");
  assert.equal(windBandFor(11.5, "mph").label, "Good sailing");
  assert.equal(windBandFor(18.5, "kmh").label, "Good sailing");
  assert.equal(windBandFor(5.1, "ms").label, "Good sailing");
});

test("windBandFor covers the whole range including extremes", () => {
  assert.equal(windBandFor(0, "kn").label, "Light");
  assert.equal(windBandFor(3.9, "kn").label, "Light");
  assert.equal(windBandFor(4, "kn").label, "Good sailing");
  assert.equal(windBandFor(19.9, "kn").label, "Brisk");
  assert.equal(windBandFor(20, "kn").label, "Strong — reef early");
  assert.equal(windBandFor(200, "kn").label, "Strong — reef early");
});

const predictions = [
  { t: "2026-09-15 02:05", v: "0.209", type: "L" },
  { t: "2026-09-15 08:53", v: "9.873", type: "H" },
  { t: "2026-09-15 14:22", v: "5.572", type: "L" },
  { t: "2026-09-15 19:55", v: "10.186", type: "H" },
  { t: "2026-09-16 02:45", v: "0.148", type: "L" },
  { t: "2026-09-16 09:54", v: "9.686", type: "H" },
  { t: "2026-09-16 15:14", v: "6.669", type: "L" },
];

test("upcomingTides drops events that have already happened", () => {
  // The bug this guards: an evening /conditions listing four stale tides.
  const result = upcomingTides(predictions, "2026-09-15 18:00");
  assert.deepEqual(
    result.map((entry) => entry.t),
    ["2026-09-15 19:55", "2026-09-16 02:45", "2026-09-16 09:54", "2026-09-16 15:14"],
  );
});

test("upcomingTides returns at most four events", () => {
  assert.equal(upcomingTides(predictions, "2026-09-15 00:00").length, 4);
});

test("upcomingTides keeps an event happening exactly now", () => {
  const result = upcomingTides(predictions, "2026-09-15 19:55");
  assert.equal(result[0].t, "2026-09-15 19:55");
});

test("upcomingTides returns null rather than an empty list", () => {
  assert.equal(upcomingTides(predictions, "2026-09-20 00:00"), null);
  assert.equal(upcomingTides(null, "2026-09-15 00:00"), null);
});
