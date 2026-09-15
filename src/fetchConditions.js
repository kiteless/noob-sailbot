/**
 * Shared conditions logic. Used by both entry points:
 *   - worker/index.js   Cloudflare Worker: /conditions command AND the daily cron post
 *   - src/postDaily.js  local CLI for previewing / manually posting
 *
 * Nothing here may import node: builtins — this file has to run unchanged in
 * the Workers runtime. fetch, AbortSignal.timeout and Intl exist in both.
 */

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const REQUEST_TIMEOUT_MS = 10_000;

/** How many upcoming high/low events to show. */
const TIDE_EVENTS_SHOWN = 4;

/** WMO weather interpretation codes used by Open-Meteo. */
const WEATHER_CODES = {
  0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  56: "freezing drizzle", 57: "heavy freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with heavy hail",
};

const TEMPERATURE_UNITS = { F: "fahrenheit", C: "celsius" };
const WIND_UNITS = { mph: "mph", kn: "kn", kmh: "kmh", ms: "ms" };

const TEMPERATURE_LABELS = { F: "°F", C: "°C" };
const WIND_LABELS = { mph: "mph", kn: "kt", kmh: "km/h", ms: "m/s" };

/** Multipliers into knots, used only to pick the sailing-condition band. */
const TO_KNOTS = { kn: 1, mph: 0.868976, kmh: 0.539957, ms: 1.94384 };

/**
 * Sailing-condition bands in knots, used for the embed's colour stripe so the
 * post is readable at a glance before anyone reads the numbers.
 */
const WIND_BANDS = [
  { max: 4, label: "Light", color: 0x8b949e },
  { max: 12, label: "Good sailing", color: 0x3fb950 },
  { max: 20, label: "Brisk", color: 0xd29922 },
  { max: Infinity, label: "Strong — reef early", color: 0xda3633 },
];

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

function degreesToCompass(degrees) {
  return COMPASS[Math.round(degrees / 22.5) % 16];
}

function round(value) {
  return Math.round(Number(value));
}

async function getJson(url, label) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "user-agent": "sailing-conditions-bot" },
    });
  } catch (cause) {
    throw new Error(`${label} request failed: ${cause.message}`, { cause });
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

function resolveUnits(config) {
  const temperature = config?.units?.temperature ?? "F";
  const windSpeed = config?.units?.windSpeed ?? "kn";

  if (!TEMPERATURE_UNITS[temperature]) {
    throw new Error(
      `Unsupported units.temperature "${temperature}" — use one of: ${Object.keys(TEMPERATURE_UNITS).join(", ")}`,
    );
  }
  if (!WIND_UNITS[windSpeed]) {
    throw new Error(
      `Unsupported units.windSpeed "${windSpeed}" — use one of: ${Object.keys(WIND_UNITS).join(", ")}`,
    );
  }
  return { temperature, windSpeed };
}

/**
 * Parse JSONC — JSON with // and /* *\/ comments and trailing commas.
 * Hand-rolled rather than pulled from npm so it runs identically in Node and
 * the Workers runtime with no dependency. Newlines inside comments are kept so
 * that JSON.parse error positions still line up with the original file.
 */
export function parseJsonc(text, sourceName = "config") {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      } else if (ch === "\n") {
        out += ch;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    // Drop a trailing comma before a closing brace/bracket. Safe here because
    // this branch only runs outside strings and comments.
    if (ch === "}" || ch === "]") {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      if (j >= 0 && out[j] === ",") out = out.slice(0, j) + out.slice(j + 1);
    }
    out += ch;
  }

  try {
    return JSON.parse(out);
  } catch (cause) {
    throw new Error(`${sourceName} is not valid JSONC: ${cause.message}`, { cause });
  }
}

export function validateConfig(config) {
  const lat = config?.location?.lat;
  const lon = config?.location?.lon;

  if (typeof lat !== "number" || lat < -90 || lat > 90) {
    throw new Error("config.location.lat must be a number between -90 and 90");
  }
  if (typeof lon !== "number" || lon < -180 || lon > 180) {
    throw new Error("config.location.lon must be a number between -180 and 180");
  }
  if (!config?.location?.label) throw new Error("config.location.label is required");

  const source = config?.tides?.source ?? "none";
  if (source !== "noaa" && source !== "none") {
    // Extension point: an international source such as WorldTides.info could
    // slot in as a third value. It needs a paid API key, so it isn't built.
    throw new Error('config.tides.source must be "noaa" or "none"');
  }
  if (source === "noaa" && !config?.tides?.noaaStationId) {
    throw new Error(
      'config.tides.source is "noaa" but config.tides.noaaStationId is missing — ' +
        "find your station at https://tidesandcurrents.noaa.gov/map/",
    );
  }

  const hour = config?.schedule?.localHour;
  if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
    throw new Error("config.schedule.localHour must be an integer from 0 to 23");
  }

  const timezone = config?.schedule?.timezone;
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    } catch {
      throw new Error(
        `config.schedule.timezone "${timezone}" is not a recognised IANA timezone ` +
          '(for example "America/Los_Angeles"). See ' +
          "https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
      );
    }
  }

  resolveUnits(config);
  return config;
}

/**
 * Wall-clock parts at an IANA timezone. Used to compare against NOAA's local
 * timestamps and to decide whether the cron should fire.
 */
export function localParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour"), minute: get("minute"),
    // Sorts identically to NOAA's "YYYY-MM-DD HH:MM" format.
    stamp: `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`,
  };
}

async function fetchWeather(config, units) {
  const url = new URL(OPEN_METEO);
  url.searchParams.set("latitude", String(config.location.lat));
  url.searchParams.set("longitude", String(config.location.lon));
  url.searchParams.set(
    "current",
    "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,weather_code,sunrise,sunset,daylight_duration",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("temperature_unit", TEMPERATURE_UNITS[units.temperature]);
  url.searchParams.set("wind_speed_unit", WIND_UNITS[units.windSpeed]);

  const data = await getJson(url, "Open-Meteo");
  if (!data?.current || !data?.daily) {
    throw new Error("Open-Meteo response was missing current/daily data");
  }
  return data;
}

/**
 * Tides are a nice-to-have: if NOAA is down or the station is wrong we still
 * want wind and weather to go out, with a note explaining the gap.
 */
async function fetchTidePredictions(config, warnings) {
  if ((config?.tides?.source ?? "none") !== "noaa") return null;

  // NOAA ignores `range` when combined with `date=today` — it silently returns
  // today only — so an explicit begin_date is required. Anchor one day before
  // the current UTC date: the station's local date can trail UTC by up to a
  // day, and starting at UTC-today would drop a late-evening local tide.
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const beginDate =
    `${start.getUTCFullYear()}` +
    `${String(start.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(start.getUTCDate()).padStart(2, "0")}`;

  const url = new URL(NOAA);
  url.searchParams.set("station", String(config.tides.noaaStationId));
  url.searchParams.set("product", "predictions");
  url.searchParams.set("datum", "MLLW");
  // NOAA's valid time_zone values are gmt, lst and lst_ldt. lst_ldt gives
  // local time with daylight saving applied, which is what we print.
  url.searchParams.set("time_zone", "lst_ldt");
  url.searchParams.set("units", "english");
  url.searchParams.set("interval", "hilo");
  url.searchParams.set("format", "json");
  url.searchParams.set("begin_date", beginDate);
  url.searchParams.set("range", "72");

  try {
    const data = await getJson(url, "NOAA");
    // NOAA answers HTTP 200 with an { error: { message } } body for bad
    // stations or params, so the status code alone proves nothing.
    if (data?.error?.message) throw new Error(data.error.message.trim());
    if (!Array.isArray(data?.predictions) || data.predictions.length === 0) {
      throw new Error("no predictions returned");
    }
    return data.predictions;
  } catch (error) {
    warnings.push(`tides unavailable (${error.message})`);
    return null;
  }
}

/**
 * Keep only events still ahead of us at the station's local time. Without this
 * an afternoon /conditions would list four tides that already happened.
 */
function upcomingTides(predictions, timezone) {
  if (!predictions) return null;
  const now = localParts(timezone).stamp;
  const upcoming = predictions
    .filter((entry) => entry.t >= now)
    .slice(0, TIDE_EVENTS_SHOWN);
  return upcoming.length > 0 ? upcoming : null;
}

/** "2026-09-15 08:53" or "2026-09-15T08:53" (already local) -> "8:53 AM" */
function formatClock(stamp) {
  const match = /(\d{2}):(\d{2})/.exec(stamp);
  if (!match) return stamp;
  const hour24 = Number(match[1]);
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

/** "2026-09-15 08:53" -> "Tue 8:53 AM" when it isn't today at the station. */
function formatTideWhen(stamp, todayDate) {
  const clock = formatClock(stamp);
  const date = stamp.slice(0, 10);
  if (date === todayDate) return clock;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  return `${weekday} ${clock}`;
}

function formatHeading(isoDate, timezone) {
  // Anchor at noon UTC so the date can't slide across a day boundary when
  // re-rendered in the location's own timezone.
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function formatDaylight(seconds) {
  if (seconds == null) return null;
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/**
 * Fetch everything and return a structured snapshot. Callers pick a renderer.
 * Throws if weather fails; tides degrade to a warning.
 */
export async function fetchConditions(config) {
  validateConfig(config);
  const units = resolveUnits(config);
  const warnings = [];

  const [weather, predictions] = await Promise.all([
    fetchWeather(config, units),
    fetchTidePredictions(config, warnings),
  ]);

  const timezone = weather.timezone || "UTC";
  const current = weather.current;
  const daily = weather.daily;
  const today = localParts(timezone);

  const windMax = Number(daily.wind_speed_10m_max[0]);
  const band =
    WIND_BANDS.find((b) => windMax * (TO_KNOTS[units.windSpeed] ?? 1) < b.max) ??
    WIND_BANDS[WIND_BANDS.length - 1];

  return {
    label: config.location.label,
    timezone,
    heading: formatHeading(daily.time[0], timezone),
    todayDate: `${today.year}-${today.month}-${today.day}`,
    units: {
      temp: TEMPERATURE_LABELS[units.temperature],
      wind: WIND_LABELS[units.windSpeed],
    },
    band,
    current: {
      temp: round(current.temperature_2m),
      sky: WEATHER_CODES[current.weather_code] ?? "unsettled",
      wind: round(current.wind_speed_10m),
      gust: current.wind_gusts_10m == null ? null : round(current.wind_gusts_10m),
      compass: degreesToCompass(current.wind_direction_10m),
    },
    today: {
      sky: WEATHER_CODES[daily.weather_code?.[0]] ?? "unsettled",
      high: round(daily.temperature_2m_max[0]),
      low: round(daily.temperature_2m_min[0]),
      wind: round(windMax),
      gust: daily.wind_gusts_10m_max?.[0] == null ? null : round(daily.wind_gusts_10m_max[0]),
      sunrise: daily.sunrise?.[0] ? formatClock(daily.sunrise[0]) : null,
      sunset: daily.sunset?.[0] ? formatClock(daily.sunset[0]) : null,
      daylight: formatDaylight(daily.daylight_duration?.[0]),
    },
    tides: upcomingTides(predictions, timezone),
    warnings,
  };
}

function tideTable(conditions) {
  return conditions.tides
    .map((entry) => {
      const arrow = entry.type === "H" ? "▲" : "▼";
      const label = (entry.type === "H" ? "High" : "Low").padEnd(4, " ");
      const when = formatTideWhen(entry.t, conditions.todayDate).padStart(12, " ");
      const height = `${Number(entry.v).toFixed(1)} ft`.padStart(8, " ");
      return `${arrow} ${label} ${when}  ${height}`;
    })
    .join("\n");
}

/** Plain-text rendering, used for terminal previews. */
export function formatText(c) {
  const lines = [`🌊 ${c.label} — ${c.heading}`, ""];

  lines.push(`Now:   ${c.current.temp}${c.units.temp}, ${c.current.sky}`);
  let wind = `Wind:  ${c.current.wind} ${c.units.wind} from ${c.current.compass}`;
  if (c.current.gust != null) wind += ` (gusting ${c.current.gust})`;
  lines.push(wind);

  let today = `Today: ${c.today.sky}, high ${c.today.high}${c.units.temp} / low ${c.today.low}${c.units.temp}, wind to ${c.today.wind} ${c.units.wind}`;
  if (c.today.gust != null) today += ` (gusts ${c.today.gust})`;
  lines.push(today);

  if (c.today.sunrise && c.today.sunset) {
    lines.push(`Light: ${c.today.sunrise} – ${c.today.sunset}${c.today.daylight ? ` (${c.today.daylight})` : ""}`);
  }
  lines.push(`Sail:  ${c.band.label}`);

  if (c.tides) {
    lines.push("", "Next tides:", tideTable(c));
  }
  if (c.warnings.length > 0) {
    lines.push("", `⚠️  ${c.warnings.join("; ")}`);
  }
  return lines.join("\n");
}

/** Discord embed rendering, used for both the daily post and /conditions. */
export function formatEmbed(c) {
  const gustNow = c.current.gust != null ? `\ngusting ${c.current.gust} ${c.units.wind}` : "";
  const gustToday = c.today.gust != null ? ` (gusts ${c.today.gust})` : "";

  const fields = [
    {
      name: "Now",
      value: `**${c.current.temp}${c.units.temp}**\n${c.current.sky}`,
      inline: true,
    },
    {
      name: "Wind",
      value: `**${c.current.wind} ${c.units.wind}** from ${c.current.compass}${gustNow}`,
      inline: true,
    },
  ];

  if (c.today.sunrise && c.today.sunset) {
    fields.push({
      name: "Daylight",
      value: `${c.today.sunrise} – ${c.today.sunset}${c.today.daylight ? `\n${c.today.daylight}` : ""}`,
      inline: true,
    });
  }

  fields.push({
    name: "Today",
    value:
      `${c.today.sky}, high ${c.today.high}${c.units.temp} / low ${c.today.low}${c.units.temp}\n` +
      `wind to ${c.today.wind} ${c.units.wind}${gustToday}`,
    inline: false,
  });

  if (c.tides) {
    fields.push({ name: "Next tides", value: `\`\`\`\n${tideTable(c)}\n\`\`\``, inline: false });
  }

  const embed = {
    title: `🌊 ${c.label}`,
    description: `${c.heading} · **${c.band.label}**`,
    color: c.band.color,
    fields,
    footer: { text: c.tides ? "Open-Meteo · NOAA CO-OPS" : "Open-Meteo" },
    timestamp: new Date().toISOString(),
  };

  if (c.warnings.length > 0) {
    embed.footer.text += ` · ⚠️ ${c.warnings.join("; ")}`;
  }
  return embed;
}

export default fetchConditions;
