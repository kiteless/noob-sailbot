/**
 * Local CLI for previewing and manually posting. The real daily post runs on
 * Cloudflare Cron Triggers (see worker/index.js) — this is for testing.
 *
 *   node src/postDaily.js --dry-run   print the message, post nothing
 *   node src/postDaily.js             post to $DISCORD_WEBHOOK_URL now
 *   node src/postDaily.js --text      post as plain text instead of an embed
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadConfig } from "./config.js";
import { fetchConditions } from "./conditions.js";
import { formatText, formatEmbed } from "./format.js";

const CONFIG_FILE = "config.jsonc";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readConfig() {
  const path = join(repoRoot, CONFIG_FILE);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Could not read ${path}. Copy config.example.jsonc to ${CONFIG_FILE} and fill in your location.`,
    );
  }
  return loadConfig(raw, CONFIG_FILE);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const conditions = await fetchConditions(readConfig());

  if (args.has("--dry-run")) {
    console.log(formatText(conditions));
    return;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error(
      "DISCORD_WEBHOOK_URL is not set. Export it for this shell, or use --dry-run to preview.",
    );
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      args.has("--text")
        ? { content: formatText(conditions) }
        : { embeds: [formatEmbed(conditions)] },
    ),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook returned HTTP ${response.status} ${text}`.trim());
  }
  console.log(`Posted conditions for ${conditions.label}.`);
}

main().catch((error) => {
  console.error(`postDaily failed: ${error.message}`);
  process.exit(1);
});
