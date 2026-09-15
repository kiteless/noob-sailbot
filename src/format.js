/**
 * Renderers. Both take the snapshot from conditions.js and know nothing about
 * where the data came from.
 *
 *   formatText()  — terminal previews
 *   formatEmbed() — Discord, for both the daily post and /conditions
 */
import { formatClock, formatWeekday } from "./time.js";

/** "2026-09-16 09:54" -> "Wed 9:54 AM", or just "9:54 AM" if it is today. */
function tideWhen(stamp, today) {
  const date = stamp.slice(0, 10);
  const clock = formatClock(stamp);
  return date === today ? clock : `${formatWeekday(date)} ${clock}`;
}

/** Monospace table of upcoming high/low events. */
function tideTable(conditions) {
  return conditions.tides
    .map((entry) => {
      const arrow = entry.type === "H" ? "▲" : "▼";
      const label = (entry.type === "H" ? "High" : "Low").padEnd(4, " ");
      const when = tideWhen(entry.t, conditions.today).padStart(12, " ");
      const height = `${Number(entry.v).toFixed(1)} ft`.padStart(8, " ");
      return `${arrow} ${label} ${when}  ${height}`;
    })
    .join("\n");
}

/** "7 kt from NNE", optionally with a gust clause. */
function windPhrase({ wind, compass, gust }, units, gustSeparator = " ") {
  const base = `${wind} ${units.wind} from ${compass}`;
  return gust == null ? base : `${base}${gustSeparator}(gusting ${gust})`;
}

/** "high 66°F / low 53°F" */
function tempRange(forecast, units) {
  return `high ${forecast.high}${units.temp} / low ${forecast.low}${units.temp}`;
}

/** "wind to 8 kt (gusts 11)" */
function windOutlook(forecast, units) {
  const base = `wind to ${forecast.wind} ${units.wind}`;
  return forecast.gust == null ? base : `${base} (gusts ${forecast.gust})`;
}

export function formatText(conditions) {
  const { current, forecast, units } = conditions;
  const lines = [`🌊 ${conditions.label} — ${conditions.heading}`, ""];

  lines.push(`Now:   ${current.temp}${units.temp}, ${current.sky}`);
  lines.push(`Wind:  ${windPhrase(current, units)}`);
  lines.push(
    `Today: ${forecast.sky}, ${tempRange(forecast, units)}, ${windOutlook(forecast, units)}`,
  );

  if (forecast.sunrise && forecast.sunset) {
    const daylight = forecast.daylight ? ` (${forecast.daylight})` : "";
    lines.push(`Light: ${forecast.sunrise} – ${forecast.sunset}${daylight}`);
  }
  lines.push(`Sail:  ${conditions.band.label}`);

  if (conditions.tides) {
    lines.push("", "Next tides:", tideTable(conditions));
  }
  if (conditions.warnings.length > 0) {
    lines.push("", `⚠️  ${conditions.warnings.join("; ")}`);
  }
  return lines.join("\n");
}

export function formatEmbed(conditions) {
  const { current, forecast, units } = conditions;

  const fields = [
    {
      name: "Now",
      value: `**${current.temp}${units.temp}**\n${current.sky}`,
      inline: true,
    },
    {
      name: "Wind",
      value: `**${current.wind} ${units.wind}** from ${current.compass}` +
        (current.gust == null ? "" : `\ngusting ${current.gust} ${units.wind}`),
      inline: true,
    },
  ];

  if (forecast.sunrise && forecast.sunset) {
    fields.push({
      name: "Daylight",
      value: `${forecast.sunrise} – ${forecast.sunset}` +
        (forecast.daylight ? `\n${forecast.daylight}` : ""),
      inline: true,
    });
  }

  fields.push({
    name: "Today",
    value: `${forecast.sky}, ${tempRange(forecast, units)}\n${windOutlook(forecast, units)}`,
    inline: false,
  });

  if (conditions.tides) {
    fields.push({
      name: "Next tides",
      value: `\`\`\`\n${tideTable(conditions)}\n\`\`\``,
      inline: false,
    });
  }

  const sources = conditions.tides ? "Open-Meteo · NOAA CO-OPS" : "Open-Meteo";
  const warning =
    conditions.warnings.length > 0 ? ` · ⚠️ ${conditions.warnings.join("; ")}` : "";

  return {
    title: `🌊 ${conditions.label}`,
    description: `${conditions.heading} · **${conditions.band.label}**`,
    color: conditions.band.color,
    fields,
    footer: { text: `${sources}${warning}` },
    timestamp: new Date().toISOString(),
  };
}
