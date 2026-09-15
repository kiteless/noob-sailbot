import test from "node:test";
import assert from "node:assert/strict";

import {
  localParts,
  formatClock,
  formatLongDate,
  formatWeekday,
  formatDuration,
} from "../src/time.js";

test("localParts reports wall-clock time at the requested zone", () => {
  const parts = localParts("America/Los_Angeles", new Date("2026-07-15T14:00:00Z"));
  assert.equal(parts.date, "2026-07-15");
  assert.equal(parts.hour, "07");
  assert.equal(parts.stamp, "2026-07-15 07:00");
});

test("localParts uses a 24-hour clock, including midnight", () => {
  // hourCycle h23 matters: h24 would render midnight as "24".
  assert.equal(localParts("UTC", new Date("2026-07-15T00:30:00Z")).hour, "00");
  assert.equal(localParts("UTC", new Date("2026-07-15T23:30:00Z")).hour, "23");
});

test("localParts crosses the date line correctly for UTC+12", () => {
  const parts = localParts("Antarctica/McMurdo", new Date("2026-09-15T19:00:00Z"));
  assert.equal(parts.date, "2026-09-16", "local date should already be tomorrow");
  assert.equal(parts.hour, "07");
});

test("localParts stamps sort against NOAA's timestamp format", () => {
  // This ordering property is what the tide filter relies on.
  const now = localParts("America/Los_Angeles", new Date("2026-09-15T21:00:00Z")).stamp;
  assert.equal(now, "2026-09-15 14:00");
  assert.ok("2026-09-15 19:55" >= now, "a later tide today should sort after now");
  assert.ok(!("2026-09-15 08:53" >= now), "an earlier tide today should sort before now");
  assert.ok("2026-09-16 02:45" >= now, "tomorrow should sort after now");
});

test("the hourly cron gate fires exactly once a day across DST", () => {
  // Every UTC hour of a day must yield exactly one match for 7am local, in
  // both standard and daylight time, and on the transition days themselves.
  const days = ["2026-07-15", "2026-01-15", "2026-03-08", "2026-11-01"];
  for (const day of days) {
    const matches = [];
    for (let utcHour = 0; utcHour < 24; utcHour++) {
      const at = new Date(`${day}T${String(utcHour).padStart(2, "0")}:00:00Z`);
      if (Number(localParts("America/Los_Angeles", at).hour) === 7) {
        matches.push(utcHour);
      }
    }
    assert.equal(matches.length, 1, `${day} should match once, matched ${matches.length}`);
  }
});

test("formatClock renders 12-hour times from either timestamp shape", () => {
  assert.equal(formatClock("2026-09-15 08:53"), "8:53 AM");
  assert.equal(formatClock("2026-09-15T19:55"), "7:55 PM");
  assert.equal(formatClock("2026-09-15 00:05"), "12:05 AM", "midnight is 12 AM");
  assert.equal(formatClock("2026-09-15 12:00"), "12:00 PM", "noon is 12 PM");
});

test("formatClock passes through anything it cannot parse", () => {
  assert.equal(formatClock("not a time"), "not a time");
});

test("date formatters do not drift across timezone boundaries", () => {
  assert.equal(formatLongDate("2026-09-15"), "Tuesday, September 15");
  assert.equal(formatWeekday("2026-09-16"), "Wed");
  assert.equal(formatLongDate("2026-01-01"), "Thursday, January 1");
});

test("formatDuration renders hours and zero-padded minutes", () => {
  assert.equal(formatDuration(45240), "12h 34m");
  assert.equal(formatDuration(3600), "1h 00m");
  assert.equal(formatDuration(null), null);
});
