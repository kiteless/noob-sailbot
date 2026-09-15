/**
 * Config loading, defaulting and validation.
 *
 * Runtime-agnostic: no node: imports, so the Worker and the local CLI share it.
 * Entry points call loadConfig() exactly once at startup, so a broken config
 * fails loudly at deploy rather than silently at 7am.
 */

/** Every default in one place, so no entry point invents its own. */
export const DEFAULTS = {
  temperature: "F",
  windSpeed: "kn",
  tideSource: "none",
  localHour: 7,
};

export const TEMPERATURE_UNITS = { F: "fahrenheit", C: "celsius" };
export const WIND_UNITS = { mph: "mph", kn: "kn", kmh: "kmh", ms: "ms" };

export const TEMPERATURE_LABELS = { F: "°F", C: "°C" };
export const WIND_LABELS = { mph: "mph", kn: "kt", kmh: "km/h", ms: "m/s" };

/**
 * Parse JSONC — JSON plus // and block comments, and a forgiving trailing
 * comma. Hand-rolled rather than a dependency so it behaves identically in
 * Node and the Workers runtime. Newlines inside comments are preserved so
 * JSON.parse error positions still line up with the original file.
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
    // Drop a trailing comma before a closing brace/bracket. Only reached
    // outside strings and comments, so it cannot corrupt string content.
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

/** Config unit codes -> the API values and display labels they imply. */
export function resolveUnits(config) {
  const temperature = config?.units?.temperature ?? DEFAULTS.temperature;
  const windSpeed = config?.units?.windSpeed ?? DEFAULTS.windSpeed;

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

  return {
    temperature,
    windSpeed,
    apiTemperature: TEMPERATURE_UNITS[temperature],
    apiWindSpeed: WIND_UNITS[windSpeed],
    temperatureLabel: TEMPERATURE_LABELS[temperature],
    windLabel: WIND_LABELS[windSpeed],
  };
}

/** Throws a human-readable error on the first problem found. */
export function validateConfig(config) {
  const lat = config?.location?.lat;
  const lon = config?.location?.lon;

  if (typeof lat !== "number" || Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error("config.location.lat must be a number between -90 and 90");
  }
  if (typeof lon !== "number" || Number.isNaN(lon) || lon < -180 || lon > 180) {
    throw new Error("config.location.lon must be a number between -180 and 180");
  }
  if (!config?.location?.label) {
    throw new Error("config.location.label is required");
  }

  const source = config?.tides?.source ?? DEFAULTS.tideSource;
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

/** Parse and validate in one step. Entry points call this once at startup. */
export function loadConfig(text, sourceName = "config") {
  return validateConfig(parseJsonc(text, sourceName));
}
