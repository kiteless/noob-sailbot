import test from "node:test";
import assert from "node:assert/strict";

import { parseJsonc, validateConfig, resolveUnits, loadConfig } from "../src/config.js";

const validConfig = {
  location: { label: "Test Marina", lat: 12.34, lon: 56.78 },
  tides: { source: "noaa", noaaStationId: "0000000" },
  units: { temperature: "F", windSpeed: "kn" },
  schedule: { localHour: 7, timezone: "America/Los_Angeles" },
};

test("parseJsonc strips line and block comments", () => {
  assert.deepEqual(
    parseJsonc(`{
      // a line comment
      "a": 1,
      /* a block
         comment */
      "b": 2
    }`),
    { a: 1, b: 2 },
  );
});

test("parseJsonc leaves comment-like sequences inside strings alone", () => {
  const parsed = parseJsonc(`{
    "url": "https://example.com/path",
    "tricky": "not // a comment, not /* one either */",
    "escaped": "a quote \\" then // still in the string"
  }`);
  assert.equal(parsed.url, "https://example.com/path");
  assert.equal(parsed.tricky, "not // a comment, not /* one either */");
  assert.equal(parsed.escaped, 'a quote " then // still in the string');
});

test("parseJsonc forgives trailing commas in objects and arrays", () => {
  assert.deepEqual(parseJsonc('{ "a": [1, 2, 3,], "b": { "c": 1, }, }'), {
    a: [1, 2, 3],
    b: { c: 1 },
  });
});

test("parseJsonc does not eat a comma that is inside a string", () => {
  assert.deepEqual(parseJsonc('{ "a": "ends with a comma," }'), {
    a: "ends with a comma,",
  });
});

test("parseJsonc reports the source name on malformed input", () => {
  assert.throws(() => parseJsonc('{ "a": }', "config.jsonc"), {
    message: /config\.jsonc is not valid JSONC/,
  });
});

test("parseJsonc preserves line numbering when stripping comments", () => {
  // Node echoes the stripped source in the parse error. Comments must be
  // blanked in place rather than removed, or reported lines would shift.
  const text = '{\n  // comment\n  /* block\n     spanning lines */\n  "a": }\n';
  try {
    parseJsonc(text);
    assert.fail("should have thrown");
  } catch (error) {
    const newlines = (string) => (string.match(/\n/g) ?? []).length;
    assert.equal(
      newlines(error.message),
      newlines(text),
      "stripped source should keep every original newline",
    );
  }
});

test("validateConfig accepts a good config", () => {
  assert.equal(validateConfig(validConfig), validConfig);
});

test("validateConfig rejects out-of-range and non-numeric coordinates", () => {
  const cases = [
    [{ lat: 91, lon: 0 }, /lat/],
    [{ lat: -91, lon: 0 }, /lat/],
    [{ lat: "47", lon: 0 }, /lat/],
    [{ lat: 0, lon: 181 }, /lon/],
    [{ lat: 0, lon: -181 }, /lon/],
    [{ lat: NaN, lon: 0 }, /lat/],
  ];
  for (const [location, expected] of cases) {
    assert.throws(
      () => validateConfig({ ...validConfig, location: { label: "x", ...location } }),
      expected,
    );
  }
});

test("validateConfig requires a label", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, location: { lat: 1, lon: 1 } }),
    /label is required/,
  );
});

test("validateConfig requires a station id when tides.source is noaa", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, tides: { source: "noaa" } }),
    /noaaStationId is missing/,
  );
});

test("validateConfig allows tides.source none without a station", () => {
  assert.doesNotThrow(() =>
    validateConfig({ ...validConfig, tides: { source: "none", noaaStationId: "" } }),
  );
});

test("validateConfig rejects an unknown tide source", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, tides: { source: "worldtides" } }),
    /must be "noaa" or "none"/,
  );
});

test("validateConfig bounds localHour to a whole 0-23", () => {
  for (const localHour of [-1, 24, 7.5, "7"]) {
    assert.throws(
      () => validateConfig({ ...validConfig, schedule: { localHour } }),
      /localHour must be an integer/,
    );
  }
});

test("validateConfig rejects an unrecognised timezone", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, schedule: { timezone: "Mars/Olympus" } }),
    /not a recognised IANA timezone/,
  );
});

test("validateConfig rejects unknown unit codes and names the valid ones", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, units: { temperature: "K" } }),
    /Unsupported units\.temperature "K".*F, C/s,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, units: { windSpeed: "knots" } }),
    /Unsupported units\.windSpeed "knots".*mph, kn/s,
  );
});

test("resolveUnits defaults to Fahrenheit and knots", () => {
  const units = resolveUnits({});
  assert.equal(units.temperature, "F");
  assert.equal(units.windSpeed, "kn");
  assert.equal(units.apiTemperature, "fahrenheit");
  assert.equal(units.apiWindSpeed, "kn");
  assert.equal(units.temperatureLabel, "°F");
  assert.equal(units.windLabel, "kt");
});

test("loadConfig parses and validates in one step", () => {
  assert.throws(
    () => loadConfig('{ "location": { "label": "x", "lat": 999, "lon": 0 } }', "c.jsonc"),
    /lat must be a number/,
  );
});
