# Sailing Conditions Discord Bot

Posts a daily wind, weather and tide summary to a Discord channel each morning, and answers an on-demand `/conditions` slash command in the same server.

Everything runs on a single Cloudflare Worker — the slash command on request, the daily post on a Cron Trigger. Nothing runs 24/7 and nothing needs a server, so it sits comfortably inside Cloudflare's free tier. There is no CI and no build step; you deploy with one command.

The location lives entirely in a gitignored config file, so **this repository contains no information about where any particular instance is pointed.** The committed example config points at McMurdo Station, Antarctica, which is obviously a placeholder and is meant to be replaced.

```
🌊 McMurdo Station, Antarctica — Wednesday, September 16

Now:   -20°C, overcast
Wind:  11 kt from ESE (gusting 15)
Today: light snow, high -18°C / low -30°C, wind to 18 kt (gusts 24)
Light: 7:24 AM – 6:15 PM (10h 50m)
Sail:  Brisk
```

That is genuine output from the committed example config — the tide block is absent because Antarctica has `tides.source` set to `"none"`. With a NOAA station configured, a "Next tides" table of the next four high/low events follows.

In Discord the same data renders as an embed, with a colour stripe keyed to the day's wind: grey for light, green for good sailing, amber for brisk, red for strong.

---

## Prerequisites

- A Discord server you administer
- A free Cloudflare account
- Node.js 18+ and `git`

```bash
node --version   # need v18+
git --version
```

## Data sources

Both are free, need no API key, and no signup.

| Data | Source | Coverage |
|---|---|---|
| Weather, wind, sun times | [Open-Meteo](https://open-meteo.com/) | Worldwide |
| Tides | [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/) | **US stations only** |

---

## 1. Get the code

```bash
git clone https://github.com/YOUR-USERNAME/sailing-conditions-bot.git
cd sailing-conditions-bot
npm install
```

## 2. Create your config

`config.jsonc` is gitignored so your location never reaches the repository. Create yours from the placeholder:

```bash
cp config.example.jsonc config.jsonc
```

It is JSONC — regular JSON, plus `//` and `/* */` comments and forgiving of a trailing comma. The shipped example is commented field by field; here it is with the comments removed:

```jsonc
{
  "location": {
    "label": "Your Marina, Your Town",
    "lat": 40.7003,
    "lon": -74.0137
  },
  "tides": {
    "source": "noaa",
    "noaaStationId": "8518750"
  },
  "units": {
    "temperature": "F",
    "windSpeed": "kn"
  },
  "schedule": {
    "localHour": 7,
    "timezone": "America/New_York"
  }
}
```

| Field | Meaning |
|---|---|
| `location.label` | Heading shown on the message |
| `location.lat` / `lon` | Used for the weather forecast |
| `tides.source` | `"noaa"` or `"none"`. Outside the US use `"none"` and the tide section is left out |
| `tides.noaaStationId` | Find yours on the [NOAA station map](https://tidesandcurrents.noaa.gov/map/). The example above is 8518750, The Battery in New York — NOAA's own reference station. **Pick the station nearest your water, not the nearest big city**; a station a few miles around a headland can read noticeably differently |
| `units.temperature` | `"F"` or `"C"` |
| `units.windSpeed` | `"kn"`, `"mph"`, `"kmh"` or `"ms"`. Use `"kn"` for sailing |
| `schedule.localHour` | Local hour (0–23) for the daily post |
| `schedule.timezone` | IANA timezone the hour is measured in, e.g. `America/Los_Angeles`. Together with `localHour` this is the **only** place post timing is configured — see [Daily post timing](#daily-post-timing) |

Check it before touching Discord — this prints the message and posts nothing:

```bash
npm run preview
```

## 3. Create the Discord application

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. On **General Information**, copy the **Application ID** and the **Public Key**.
3. **Bot** → **Add Bot** → **Reset Token**, and copy the token. **It is shown once.**
4. **OAuth2** → **URL Generator**, tick only **`applications.commands`**, open the generated URL and authorize the app into your server. This is what lets the slash command appear; no other permissions are needed.

## 4. Create the channel webhook

In your server: channel → **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**.

> Treat this URL as a secret. Anyone holding it can post to that channel.

## 5. Deploy the Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

Deploy from the **repository root** — `wrangler.toml` lives there and points at `worker/index.js`.

> Your `config.jsonc` is bundled into the Worker at deploy time, because Workers have no filesystem to read at runtime. It must exist before you deploy, and **any config change needs another `wrangler deploy`** to take effect.

Then set the three secrets. Each prompts for its value rather than taking it as an argument:

```bash
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_WEBHOOK_URL
```

The application ID and public key are not truly confidential — Discord publishes the public key precisely so endpoints can verify signatures. They are kept as secrets rather than committed `[vars]` so that `wrangler.toml` stays free of instance-specific values and the repo remains fork-ready.

`wrangler deploy` prints your Worker URL, something like `https://sailing-conditions-bot.YOUR-SUBDOMAIN.workers.dev`.

## 6. Point Discord at the Worker

In the Developer Portal, under **General Information**, set **Interactions Endpoint URL** to your Worker URL and save.

Discord immediately sends a signed test PING and refuses to save the URL unless it gets a correct response, so **deploy and set the secrets first**. If saving fails, run `wrangler tail` in another terminal and try again to see the real error.

## 7. Register the slash command

One time only, locally:

```bash
export DISCORD_APPLICATION_ID=your-app-id
export DISCORD_BOT_TOKEN=your-bot-token
export DISCORD_GUILD_ID=your-server-id      # optional but recommended
npm run register
```

With `DISCORD_GUILD_ID` set, the command registers to that one server and appears **instantly**. Without it, registration is global: up to an hour to propagate, and it installs into every server the app ever joins. To get your server ID, enable **Developer Mode** in Discord (Settings → Advanced), then right-click the server icon → **Copy Server ID**.

Re-run this only if you change the command's name or description.

---

## Daily post timing

Cron Triggers are UTC-only and do not follow daylight saving, so encoding a local post time in a UTC cron expression breaks twice a year. This repo sidesteps that entirely: the Worker wakes **every hour** and checks the clock itself.

```toml
crons = ["0 * * * *"]
```

On each wake it compares the current time at `schedule.timezone` against `schedule.localHour`. If they do not match it returns immediately, before making any API calls, so 23 of the 24 daily runs cost essentially nothing — and 24 invocations a day is negligible against a 100,000/day free tier.

The practical effect is that **`config.jsonc` is the only place timing lives.** Change `localHour` to `18`, redeploy, and the post moves to 6pm. No cron editing, no UTC arithmetic, no twice-yearly drift, and it works in any timezone including the half-hour-offset ones.

If you omit `schedule.timezone`, the Worker falls back to the timezone Open-Meteo reports for your coordinates. That is still correct, it just spends one wasted API call on each non-matching hour.

## Testing

**Preview locally, no Discord involved:**

```bash
npm run preview                      # print the message
DISCORD_WEBHOOK_URL=... npm run post # actually post it now
```

**Run the Worker locally:**

```bash
npx wrangler dev --test-scheduled
```

Then in another terminal, trigger the daily post without waiting for the cron:

```bash
curl "http://127.0.0.1:8799/__scheduled?cron=0+14+*+*+*"
```

This needs a `.dev.vars` file (gitignored) holding `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` and `DISCORD_WEBHOOK_URL`. Note the local-hour gate still applies — outside your `schedule.localHour` it logs that it skipped rather than posting. To exercise the posting path, temporarily set `localHour` to the current hour.

**In production:** type `/conditions` in your server. You should see a "thinking…" placeholder that fills in a second or two later. If it stays on the placeholder, the deferred ack worked but the follow-up failed — run `wrangler tail` and try again.

## How it works

```
Discord /conditions ──> Worker.fetch()      ──┐
                                              ├──> conditions.js ──> sources.js ──> Open-Meteo
Cron Trigger (hourly) ─> Worker.scheduled() ──┘         │                        └─> NOAA
                                                        v
                                                   format.js ──> Discord embed
```

| Module | Responsibility |
|---|---|
| `src/config.js` | JSONC parsing, defaults, validation. `loadConfig()` is called once at startup so a bad config fails at deploy, not at 7am |
| `src/sources.js` | One function per upstream API; knows nothing about rendering |
| `src/conditions.js` | Reduces both responses to a flat, rounded, unit-labelled snapshot |
| `src/format.js` | `formatText()` for the terminal, `formatEmbed()` for Discord |
| `src/time.js` | Timezone and clock helpers, including the local-hour gate |

None of `src/` imports `node:` builtins, so every module runs unchanged in both the Workers runtime and local Node. Only `src/postDaily.js`, the local CLI, reads the filesystem.

The slash command defers before doing any work. Discord requires a reply within 3 seconds, which two upstream API calls can't guarantee, so the Worker returns a type-5 "thinking…" acknowledgement immediately, finishes in `ctx.waitUntil()`, then PATCHes the real embed over the placeholder.

## Tests

```bash
npm test
```

46 tests covering the JSONC parser, config validation, the DST gate, tide filtering and both renderers. They are all pure functions — no network, no credentials, runs in about a fifth of a second.

## Known limitations

- **Tides are US-only.** NOAA covers US stations. Elsewhere, set `tides.source` to `"none"`. (There's an extension point in the code for an international source such as WorldTides.info, which needs a paid key and isn't built.)
- **Tide predictions are astronomical**, not observed. Real water levels shift with wind and barometric pressure.
- **Config changes require a redeploy**, since the config is bundled into the Worker.
- **Free-tier headroom is ample.** Cloudflare allows 100,000 Worker requests/day; this uses two scheduled invocations plus a handful of slash commands.

## Repository layout

```
├── config.example.jsonc         commented placeholder (McMurdo) — committed
├── config.jsonc                 your real config — gitignored
├── src/
│   ├── config.js                JSONC parsing, defaults, validation
│   ├── sources.js               Open-Meteo and NOAA clients
│   ├── conditions.js            builds the conditions snapshot
│   ├── format.js                text and Discord embed renderers
│   ├── time.js                  timezone and clock helpers
│   └── postDaily.js             local CLI for preview / manual posting
├── test/                        unit tests (node --test)
├── worker/index.js              Worker: slash command + scheduled daily post
├── scripts/registerCommand.js   one-time slash command registration
├── wrangler.toml                Worker config, cron, and the .jsonc text-import rule
└── LICENSE                      MIT
```

## License

MIT — see [LICENSE](LICENSE).
