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

`config.json` is gitignored so your location never reaches the repository. Create yours from the placeholder:

```bash
cp config.example.json config.json
```

Then edit it:

```json
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
    "localHour": 7
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
| `schedule.localHour` | Local hour (0–23) for the daily post. See [Daily post timing](#daily-post-timing) |

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

> Your `config.json` is bundled into the Worker at deploy time, because Workers have no filesystem to read at runtime. It must exist before you deploy, and **any config change needs another `wrangler deploy`** to take effect.

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

Cloudflare Cron Triggers are UTC-only and do not follow daylight saving, so a single daily cron drifts by an hour twice a year. This repo avoids that: it fires on **both** candidate UTC hours, and the Worker checks the marina's local clock — whichever run isn't `schedule.localHour` exits without posting.

The committed pair in `wrangler.toml` targets 7am US Pacific:

```toml
crons = ["0 14 * * *", "0 15 * * *"]   # 07:00 PDT and 07:00 PST
```

If you are elsewhere, replace them with your own pair: `localHour` minus your daylight offset, and `localHour` minus your standard offset, each mod 24. Then set `schedule.localHour` to match. The cost is one extra no-op Worker invocation per day, which is free.

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

This needs a `.dev.vars` file (gitignored) holding `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` and `DISCORD_WEBHOOK_URL`. Note the local-hour gate still applies — outside your `schedule.localHour` it will log that it skipped rather than posting.

**In production:** type `/conditions` in your server. You should see a "thinking…" placeholder that fills in a second or two later. If it stays on the placeholder, the deferred ack worked but the follow-up failed — run `wrangler tail` and try again.

## How it works

```
Discord /conditions ──> Worker.fetch()      ──┐
                                              ├──> src/fetchConditions.js ──> Open-Meteo + NOAA
Cron Trigger (UTC)  ──> Worker.scheduled()  ──┘                                      │
                                                                                     v
                                                                        Discord embed (webhook
                                                                        or interaction follow-up)
```

`src/fetchConditions.js` avoids all `node:` imports so the same file runs unchanged in both the Workers runtime and local Node. It returns a structured snapshot; `formatEmbed()` renders it for Discord and `formatText()` for the terminal.

The slash command defers before doing any work. Discord requires a reply within 3 seconds, which two upstream API calls can't guarantee, so the Worker returns a type-5 "thinking…" acknowledgement immediately, finishes in `ctx.waitUntil()`, then PATCHes the real embed over the placeholder.

## Known limitations

- **Tides are US-only.** NOAA covers US stations. Elsewhere, set `tides.source` to `"none"`. (There's an extension point in the code for an international source such as WorldTides.info, which needs a paid key and isn't built.)
- **Tide predictions are astronomical**, not observed. Real water levels shift with wind and barometric pressure.
- **Config changes require a redeploy**, since the config is bundled into the Worker.
- **The cron pair is timezone-specific.** Change it if you're not on US Pacific time, or the post never fires.
- **Free-tier headroom is ample.** Cloudflare allows 100,000 Worker requests/day; this uses two scheduled invocations plus a handful of slash commands.

## Repository layout

```
├── config.example.json          placeholder (McMurdo) — committed
├── config.json                  your real config — gitignored
├── src/
│   ├── fetchConditions.js       shared fetch + formatting, runtime-agnostic
│   └── postDaily.js             local CLI for preview / manual posting
├── worker/index.js              Worker: slash command + scheduled daily post
├── scripts/registerCommand.js   one-time slash command registration
├── wrangler.toml                Worker config and cron schedule
└── LICENSE                      MIT
```

## License

MIT — see [LICENSE](LICENSE).
