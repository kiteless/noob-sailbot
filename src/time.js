/**
 * Timezone and clock formatting helpers.
 *
 * All display times arrive from upstream already expressed in the location's
 * local time (Open-Meteo with timezone=auto, NOAA with time_zone=lst_ldt), so
 * these functions format strings rather than converting between zones. The one
 * exception is localParts, which answers "what time is it there right now".
 */

/**
 * Wall-clock parts at an IANA timezone. `stamp` is deliberately formatted to
 * sort lexicographically against NOAA's "YYYY-MM-DD HH:MM" timestamps, which
 * is what lets the tide filter be a plain string comparison.
 */
export function localParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type).value;
  const [year, month, day, hour, minute] = [
    get("year"), get("month"), get("day"), get("hour"), get("minute"),
  ];

  return {
    year, month, day, hour, minute,
    date: `${year}-${month}-${day}`,
    stamp: `${year}-${month}-${day} ${hour}:${minute}`,
  };
}

/** "2026-09-15 08:53" or "2026-09-15T08:53" -> "8:53 AM" */
export function formatClock(stamp) {
  const match = /(\d{2}):(\d{2})/.exec(stamp);
  if (!match) return stamp;
  const hour24 = Number(match[1]);
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

/**
 * Render a bare "YYYY-MM-DD" with the given Intl options. Anchored at noon UTC
 * so the date cannot slide across a day boundary during formatting.
 */
function formatDate(isoDate, options) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
}

/** "2026-09-15" -> "Tuesday, September 15" */
export function formatLongDate(isoDate) {
  return formatDate(isoDate, { weekday: "long", month: "long", day: "numeric" });
}

/** "2026-09-16" -> "Wed" */
export function formatWeekday(isoDate) {
  return formatDate(isoDate, { weekday: "short" });
}

/** 45240 -> "12h 34m" */
export function formatDuration(seconds) {
  if (seconds == null) return null;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
