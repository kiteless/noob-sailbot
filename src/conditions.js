/**
 * Builds the conditions snapshot: fetch from each source, then reduce to a
 * flat, already-rounded, already-unit-labelled object that renderers consume
 * without needing to know anything about the upstream APIs.
 */
import { resolveUnits } from "./config.js";
import { fetchWeather, fetchTidePredictions } from "./sources.js";
import { localParts, formatClock, formatLongDate, formatDuration } from "./time.js";

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

/** Multipliers into knots, so the band below is judged on one scale. */
const TO_KNOTS = { kn: 1, mph: 0.868976, kmh: 0.539957, ms: 1.94384 };

/**
 * Sailing-condition bands in knots. Drives the embed's colour stripe so the
 * post is readable at a glance before anyone reads the numbers.
 */
export const WIND_BANDS = [
  { max: 4, label: "Light", color: 0x8b949e },
  { max: 12, label: "Good sailing", color: 0x3fb950 },
  { max: 20, label: "Brisk", color: 0xd29922 },
  { max: Infinity, label: "Strong — reef early", color: 0xda3633 },
];

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function degreesToCompass(degrees) {
  return COMPASS[Math.round(degrees / 22.5) % 16];
}

export function windBandFor(speed, windSpeedUnit) {
  const knots = speed * TO_KNOTS[windSpeedUnit];
  return WIND_BANDS.find((band) => knots < band.max);
}

/**
 * Keep only events still ahead of us at the location's local time. Without
 * this an afternoon /conditions would list tides that already happened.
 */
export function upcomingTides(predictions, nowStamp) {
  if (!predictions) return null;
  const upcoming = predictions
    .filter((entry) => entry.t >= nowStamp)
    .slice(0, TIDE_EVENTS_SHOWN);
  return upcoming.length > 0 ? upcoming : null;
}

function round(value) {
  return Math.round(Number(value));
}

function optionalRound(value) {
  return value == null ? null : round(value);
}

/**
 * Fetch everything and return a structured snapshot. Callers pick a renderer.
 * Throws if weather fails; a tide failure degrades to a warning.
 *
 * Expects an already-validated config — see loadConfig() in config.js.
 */
export async function fetchConditions(config) {
  const units = resolveUnits(config);

  const [weather, tideResult] = await Promise.all([
    fetchWeather(config, units),
    fetchTidePredictions(config),
  ]);

  const timezone = weather.timezone || "UTC";
  const { current, daily } = weather;

  // One clock governs the heading, the tide day-labels and the tide cutoff, so
  // they cannot disagree with each other near midnight.
  const now = localParts(timezone);
  const windMax = Number(daily.wind_speed_10m_max[0]);

  return {
    label: config.location.label,
    timezone,
    today: now.date,
    heading: formatLongDate(now.date),
    units: { temp: units.temperatureLabel, wind: units.windLabel },
    band: windBandFor(windMax, units.windSpeed),
    current: {
      temp: round(current.temperature_2m),
      sky: WEATHER_CODES[current.weather_code] ?? "unsettled",
      wind: round(current.wind_speed_10m),
      gust: optionalRound(current.wind_gusts_10m),
      compass: degreesToCompass(current.wind_direction_10m),
    },
    forecast: {
      sky: WEATHER_CODES[daily.weather_code?.[0]] ?? "unsettled",
      high: round(daily.temperature_2m_max[0]),
      low: round(daily.temperature_2m_min[0]),
      wind: round(windMax),
      gust: optionalRound(daily.wind_gusts_10m_max?.[0]),
      sunrise: daily.sunrise?.[0] ? formatClock(daily.sunrise[0]) : null,
      sunset: daily.sunset?.[0] ? formatClock(daily.sunset[0]) : null,
      daylight: formatDuration(daily.daylight_duration?.[0]),
    },
    tides: upcomingTides(tideResult.predictions, now.stamp),
    warnings: tideResult.warning ? [tideResult.warning] : [],
  };
}
