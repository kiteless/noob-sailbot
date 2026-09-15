# Noob Sailbot

Posts wind, weather and tide conditions to Discord: a daily summary each morning, plus a `/conditions` slash command on demand.

One Cloudflare Worker does both — nothing runs continuously, so it stays in the free tier. No CI, no build step.

Your location lives in a gitignored config file, so this repo says nothing about where any instance points. The committed example uses McMurdo Station, Antarctica.

```
🌊 McMurdo Station, Antarctica — Wednesday, September 16

Now:   -20°C, overcast
Wind:  11 kt from ESE (gusting 15)
Today: light snow, high -18°C / low -30°C, wind to 18 kt (gusts 24)
Light: 7:24 AM – 6:15 PM (10h 50m)
Sail:  Brisk
```

Antarctica has no NOAA station, so there's no tide block. With one configured you also get the next four high/low events. In Discord it renders as an embed, colour-coded by wind strength.

Data comes from [Open-Meteo](https://open-meteo.com/) (worldwide) and [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/) (tides, US only). Both are free and need no key.

You need Node 18+, a Discord server you administer, and a free Cloudflare account.

## Setup

**1. Install**

```bash
git clone https://github.com/YOUR-USERNAME/noob-sailbot.git
cd noob-sailbot
npm install
cp config.example.jsonc config.jsonc
```

Edit `config.jsonc` (see [Config](#config)), then check it:

```bash
npm run preview
```

**2. Create the Discord app**

At the [Developer Portal](https://discord.com/developers/applications): **New Application**, then copy the **Application ID** and **Public Key** from General Information. Under **Bot**, hit **Reset Token** and save the token — it's shown once.

Under **OAuth2 → URL Generator**, tick `applications.commands`, open the generated URL, and authorize the app into your server.

**3. Create a webhook**

Channel → **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**. Treat it as a secret; anyone with it can post to that channel.

**4. Deploy**

```bash
npm install -g wrangler
wrangler login
wrangler deploy
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_WEBHOOK_URL
```

Deploy from the repo root. `config.jsonc` is bundled into the Worker at deploy time, so it must exist first, and config changes need another `wrangler deploy`.

The app ID and public key aren't confidential, but they're secrets rather than committed vars so `wrangler.toml` stays instance-free.

**5. Point Discord at the Worker**

Put the URL `wrangler deploy` printed into **Interactions Endpoint URL** on General Information.

Discord immediately sends a signed test PING and won't save the URL without a valid response, so deploy and set the secrets first. If it fails, run `wrangler tail` and retry to see why.

**6. Register the command**

```bash
export DISCORD_APPLICATION_ID=your-app-id
export DISCORD_BOT_TOKEN=your-bot-token
export DISCORD_GUILD_ID=your-server-id
npm run register
```

With a guild ID the command appears instantly; without one it registers globally and can take an hour. Get the ID by enabling **Developer Mode** (Settings → Advanced), then right-clicking your server icon.

Re-run only if you change the command's name or description.

## Config

`config.jsonc` is JSONC — comments and trailing commas are fine. The shipped example is commented field by field.

| Field | Meaning |
|---|---|
| `location.label` | Heading on the message |
| `location.lat` / `lon` | Forecast coordinates |
| `tides.source` | `"noaa"` or `"none"` |
| `tides.noaaStationId` | From the [station map](https://tidesandcurrents.noaa.gov/map/). Pick the station nearest your water, not the nearest city — a few miles around a headland reads differently |
| `units.temperature` | `"F"` or `"C"` |
| `units.windSpeed` | `"kn"`, `"mph"`, `"kmh"` or `"ms"` |
| `schedule.localHour` | Hour (0–23) for the daily post |
| `schedule.timezone` | IANA zone the hour is measured in, e.g. `America/Los_Angeles` |

## Timing

Cron Triggers are UTC-only and ignore daylight saving, so encoding a local time in a cron expression breaks twice a year. Instead the Worker wakes hourly (`crons = ["0 * * * *"]`) and compares the clock at `schedule.timezone` against `schedule.localHour`. Non-matching wakes return before any API call.

So `config.jsonc` is the only place timing lives. Set `localHour` to `18` and the post moves to 6pm — no cron edits, no UTC arithmetic, works in any zone.

Omit `schedule.timezone` and the Worker falls back to the zone Open-Meteo reports for your coordinates, costing one wasted API call per non-matching hour.

## Testing

```bash
npm test                              # 46 unit tests, no network
npm run preview                       # print the message
DISCORD_WEBHOOK_URL=... npm run post  # post it now
npm run dev                           # run the Worker locally
```

With `npm run dev` running, trigger the daily post without waiting for the cron:

```bash
curl "http://127.0.0.1:8799/__scheduled?cron=0+*+*+*+*"
```

That needs a gitignored `.dev.vars` holding the three Discord values. The local-hour gate still applies, so set `localHour` to the current hour to exercise the posting path.

In production, type `/conditions`. A "thinking…" placeholder should fill in within a couple of seconds. If it doesn't, the deferred ack worked but the follow-up failed — check `wrangler tail`.

## How it works

```
Discord /conditions ──> Worker.fetch()      ──┐
                                              ├──> conditions.js ──> sources.js ──> Open-Meteo
Cron Trigger (hourly) ─> Worker.scheduled() ──┘         │                        └─> NOAA
                                                        v
                                                   format.js ──> Discord embed
```

| Module | Does |
|---|---|
| `src/config.js` | JSONC parsing, defaults, validation. Called once at startup so a bad config fails at deploy, not at 7am |
| `src/sources.js` | One function per upstream API |
| `src/conditions.js` | Reduces both responses to a flat snapshot |
| `src/format.js` | Text and Discord embed renderers |
| `src/time.js` | Timezone and clock helpers |

Nothing in `src/` imports `node:` builtins, so every module runs unchanged in both the Workers runtime and Node. Only `src/postDaily.js`, the local CLI, touches the filesystem.

The slash command defers before doing any work: Discord wants a reply in 3 seconds, which two API calls can't guarantee, so the Worker acks immediately and PATCHes the real embed over the placeholder from `ctx.waitUntil()`.

## Limits

- Tides are US-only. Elsewhere set `tides.source` to `"none"`. (There's an extension point for a paid international source like WorldTides.info; it isn't built.)
- Tide predictions are astronomical, not observed. Wind and pressure shift actual levels.
- Config changes need a redeploy.
- Cloudflare's free tier allows 100,000 requests/day. This uses 24 scheduled wakes plus slash commands.

## Layout

```
├── config.example.jsonc         commented placeholder — committed
├── config.jsonc                 your real config — gitignored
├── src/
│   ├── config.js                parsing, defaults, validation
│   ├── sources.js               Open-Meteo and NOAA clients
│   ├── conditions.js            builds the snapshot
│   ├── format.js                renderers
│   ├── time.js                  timezone helpers
│   └── postDaily.js             local CLI
├── worker/index.js              slash command + scheduled post
├── scripts/registerCommand.js   one-time command registration
├── test/                        node --test
└── wrangler.toml                Worker config, cron, .jsonc text rule
```

## License

MIT — see [LICENSE](LICENSE).
