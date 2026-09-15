/**
 * Cloudflare Worker. Does both jobs:
 *
 *   fetch()      — handles Discord's /conditions slash command
 *   scheduled()  — posts the daily summary to a Discord webhook (Cron Trigger)
 *
 * Everything runs here so the source repo stays free of instance-specific
 * data: the location lives in a gitignored config.jsonc bundled at deploy
 * time, and the Discord values are Cloudflare secrets.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   DISCORD_PUBLIC_KEY      verifies interaction signatures
 *   DISCORD_APPLICATION_ID  builds the follow-up webhook URL
 *   DISCORD_WEBHOOK_URL     target channel for the daily post
 */
import { verifyKey } from "discord-interactions";

// Bundled by wrangler at deploy time — Workers have no filesystem at runtime.
// The [[rules]] Text entry in wrangler.toml imports this as a string so the
// comments in it survive to be stripped here.
import configText from "../config.jsonc";
import { loadConfig, DEFAULTS } from "../src/config.js";
import { fetchConditions } from "../src/conditions.js";
import { formatEmbed } from "../src/format.js";
import { localParts } from "../src/time.js";

// Parsed and validated once, at module load. A malformed config therefore
// fails immediately and visibly rather than silently skipping a 7am post.
const config = loadConfig(configText, "config.jsonc");

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const InteractionResponseType = { PONG: 1, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5 };

const DISCORD_API = "https://discord.com/api/v10";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function postJson(url, payload, description) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${description} failed: HTTP ${response.status} ${body}`.trim());
  }
}

/**
 * Replace the "thinking..." placeholder with the real content. The interaction
 * token authenticates this, so no bot token is needed.
 */
async function editOriginalResponse(applicationId, token, payload) {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Follow-up PATCH failed: HTTP ${response.status} ${body}`);
  }
}

async function respondWithConditions(env, token) {
  let payload;
  try {
    payload = { embeds: [formatEmbed(await fetchConditions(config))] };
  } catch (error) {
    console.error(`fetchConditions failed: ${error.stack || error.message}`);
    payload = { content: `⚠️ Couldn't fetch conditions right now: ${error.message}` };
  }
  await editOriginalResponse(env.DISCORD_APPLICATION_ID, token, payload);
}

/**
 * Cron Triggers only understand UTC, so rather than encoding a local post time
 * in a UTC cron expression (which breaks twice a year at daylight saving), the
 * Worker wakes hourly and checks the local clock itself.
 *
 * With schedule.timezone configured the check happens before any network call,
 * so the 23 non-matching wakes each day cost nothing. Without it we have to
 * fetch first to learn the timezone from the coordinates.
 */
async function runDailyPost(env) {
  if (!env.DISCORD_WEBHOOK_URL) {
    console.error("DISCORD_WEBHOOK_URL is not set — skipping daily post.");
    return;
  }

  const { localHour = DEFAULTS.localHour, timezone } = config.schedule ?? {};

  const shouldPost = (zone) => {
    const hour = Number(localParts(zone).hour);
    if (hour === localHour) return true;
    console.log(`${zone} is at ${hour}:00, target ${localHour}:00 — not posting.`);
    return false;
  };

  if (timezone && !shouldPost(timezone)) return;

  const conditions = await fetchConditions(config);
  if (!timezone && !shouldPost(conditions.timezone)) return;

  await postJson(
    env.DISCORD_WEBHOOK_URL,
    { embeds: [formatEmbed(conditions)] },
    "Discord webhook",
  );
  console.log(`Posted daily conditions for ${conditions.label}.`);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      // Handy for confirming in a browser that the Worker is deployed.
      return new Response("sailing-conditions-bot: POST Discord interactions here.", {
        status: 405,
      });
    }

    if (!env.DISCORD_PUBLIC_KEY || !env.DISCORD_APPLICATION_ID) {
      console.error("Missing DISCORD_PUBLIC_KEY or DISCORD_APPLICATION_ID secret.");
      return new Response("Worker is not configured", { status: 500 });
    }

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();

    // Discord probes this endpoint with deliberately bad signatures and expects
    // a 401; anything else and it refuses to save the endpoint URL.
    if (!signature || !timestamp) {
      return new Response("Missing signature headers", { status: 401 });
    }
    if (!(await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY))) {
      return new Response("Bad request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === InteractionType.PING) {
      return json({ type: InteractionResponseType.PONG });
    }

    if (
      interaction.type === InteractionType.APPLICATION_COMMAND &&
      interaction.data?.name === "conditions"
    ) {
      // Discord demands a reply within 3s, which two upstream APIs can't
      // guarantee. Ack immediately, then PATCH the real embed into place.
      ctx.waitUntil(respondWithConditions(env, interaction.token));
      return json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
    }

    return new Response("Unhandled interaction type", { status: 400 });
  },

  async scheduled(event, env, ctx) {
    // Unlike the interaction path there is no user waiting to be told, so a
    // failure here has to be logged loudly or it vanishes silently.
    ctx.waitUntil(
      runDailyPost(env).catch((error) => {
        console.error(`Daily post failed: ${error.stack || error.message}`);
      }),
    );
  },
};
