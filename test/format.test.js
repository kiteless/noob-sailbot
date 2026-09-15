import test from "node:test";
import assert from "node:assert/strict";

import { formatText, formatEmbed } from "../src/format.js";
import { WIND_BANDS } from "../src/conditions.js";

/** A complete snapshot, shaped exactly as fetchConditions() returns one. */
function snapshot(overrides = {}) {
  return {
    label: "Test Marina",
    timezone: "America/Los_Angeles",
    today: "2026-09-15",
    heading: "Tuesday, September 15",
    units: { temp: "°F", wind: "kt" },
    band: WIND_BANDS[1],
    current: { temp: 65, sky: "clear", wind: 7, gust: 9, compass: "NNE" },
    forecast: {
      sky: "overcast", high: 66, low: 53, wind: 8, gust: 12,
      sunrise: "6:47 AM", sunset: "7:21 PM", daylight: "12h 34m",
    },
    tides: [
      { t: "2026-09-15 19:55", v: "10.186", type: "H" },
      { t: "2026-09-16 02:45", v: "0.148", type: "L" },
    ],
    warnings: [],
    ...overrides,
  };
}

test("formatText renders the whole report", () => {
  const text = formatText(snapshot());
  assert.match(text, /🌊 Test Marina — Tuesday, September 15/);
  assert.match(text, /Now:\s+65°F, clear/);
  assert.match(text, /Wind:\s+7 kt from NNE \(gusting 9\)/);
  assert.match(text, /Today:\s+overcast, high 66°F \/ low 53°F, wind to 8 kt \(gusts 12\)/);
  assert.match(text, /Light:\s+6:47 AM – 7:21 PM \(12h 34m\)/);
  assert.match(text, /Sail:\s+Good sailing/);
});

test("tide rows label today by time alone and later days by weekday", () => {
  const text = formatText(snapshot());
  assert.match(text, /▲ High\s+7:55 PM\s+10\.2 ft/, "today needs no date prefix");
  assert.match(text, /▼ Low\s+Wed 2:45 AM\s+0\.1 ft/, "tomorrow is prefixed");
});

test("tide columns stay aligned across mixed labels and widths", () => {
  const rows = formatText(snapshot())
    .split("\n")
    .filter((line) => line.startsWith("▲") || line.startsWith("▼"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, rows[1].length, "rows should be equal width");
});

test("gust clauses disappear when no gust is reported", () => {
  const text = formatText(
    snapshot({
      current: { temp: 65, sky: "clear", wind: 7, gust: null, compass: "N" },
      forecast: { ...snapshot().forecast, gust: null },
    }),
  );
  assert.match(text, /Wind:\s+7 kt from N$/m);
  assert.doesNotMatch(text, /gust/);
});

test("the daylight line is omitted when sun times are unavailable", () => {
  const text = formatText(
    snapshot({ forecast: { ...snapshot().forecast, sunrise: null, sunset: null } }),
  );
  assert.doesNotMatch(text, /Light:/);
});

test("the tide section is omitted entirely when there are no tides", () => {
  const text = formatText(snapshot({ tides: null }));
  assert.doesNotMatch(text, /Next tides/);
});

test("warnings are surfaced in the text output", () => {
  const text = formatText(snapshot({ tides: null, warnings: ["tides unavailable (boom)"] }));
  assert.match(text, /⚠️\s+tides unavailable \(boom\)/);
});

test("formatEmbed produces a valid Discord embed", () => {
  const embed = formatEmbed(snapshot());
  assert.equal(embed.title, "🌊 Test Marina");
  assert.equal(embed.description, "Tuesday, September 15 · **Good sailing**");
  assert.equal(embed.color, WIND_BANDS[1].color);
  assert.equal(embed.footer.text, "Open-Meteo · NOAA CO-OPS");
  assert.ok(Date.parse(embed.timestamp), "timestamp must be parseable ISO 8601");

  const names = embed.fields.map((field) => field.name);
  assert.deepEqual(names, ["Now", "Wind", "Daylight", "Today", "Next tides"]);
});

test("embed field values stay within Discord's 1024-character limit", () => {
  for (const field of formatEmbed(snapshot()).fields) {
    assert.ok(field.value.length <= 1024, `${field.name} is ${field.value.length} chars`);
    assert.ok(field.value.length > 0, `${field.name} must not be empty`);
  }
});

test("the embed drops optional fields the same way the text output does", () => {
  const embed = formatEmbed(
    snapshot({ tides: null, forecast: { ...snapshot().forecast, sunrise: null, sunset: null } }),
  );
  assert.deepEqual(embed.fields.map((field) => field.name), ["Now", "Wind", "Today"]);
  assert.equal(embed.footer.text, "Open-Meteo");
});

test("a tide warning is appended to the embed footer", () => {
  const embed = formatEmbed(snapshot({ tides: null, warnings: ["tides unavailable (boom)"] }));
  assert.match(embed.footer.text, /Open-Meteo · ⚠️ tides unavailable \(boom\)/);
});

test("the band colour tracks the wind band", () => {
  for (const band of WIND_BANDS) {
    assert.equal(formatEmbed(snapshot({ band })).color, band.color);
  }
});
