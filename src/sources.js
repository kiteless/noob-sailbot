/**
 * Upstream data sources. Each function owns one API and knows nothing about
 * how the result will be rendered.
 *
 * Runtime-agnostic: fetch and AbortSignal.timeout exist in both Node 18+ and
 * the Workers runtime.
 */
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const REQUEST_TIMEOUT_MS = 10_000;

async function getJson(url, sourceName) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "user-agent": "noob-sailbot" },
    });
  } catch (cause) {
    throw new Error(`${sourceName} request failed: ${cause.message}`, { cause });
  }
  if (!response.ok) {
    throw new Error(`${sourceName} returned HTTP ${response.status}`);
  }
  return response.json();
}

/** Current conditions plus today's summary, in the configured units. */
export async function fetchWeather(config, units) {
  const url = new URL(OPEN_METEO);
  url.searchParams.set("latitude", String(config.location.lat));
  url.searchParams.set("longitude", String(config.location.lon));
  url.searchParams.set(
    "current",
    "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max," +
      "weather_code,sunrise,sunset,daylight_duration",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("temperature_unit", units.apiTemperature);
  url.searchParams.set("wind_speed_unit", units.apiWindSpeed);

  const data = await getJson(url, "Open-Meteo");
  if (!data?.current || !data?.daily) {
    throw new Error("Open-Meteo response was missing current/daily data");
  }
  return data;
}

/**
 * High/low tide predictions covering a 72-hour window.
 *
 * Tides are a nice-to-have: a failure here returns a warning rather than
 * throwing, so wind and weather still go out with a note explaining the gap.
 * Resolves to { predictions, warning } with exactly one side populated.
 */
export async function fetchTidePredictions(config) {
  if ((config?.tides?.source ?? "none") !== "noaa") {
    return { predictions: null, warning: null };
  }

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
    // stations or parameters, so the status code alone proves nothing.
    if (data?.error?.message) throw new Error(data.error.message.trim());
    if (!Array.isArray(data?.predictions) || data.predictions.length === 0) {
      throw new Error("no predictions returned");
    }
    return { predictions: data.predictions, warning: null };
  } catch (error) {
    return { predictions: null, warning: `tides unavailable (${error.message})` };
  }
}
