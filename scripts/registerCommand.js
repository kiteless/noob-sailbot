/**
 * One-time registration of the /conditions slash command.
 *
 *   export DISCORD_APPLICATION_ID=...
 *   export DISCORD_BOT_TOKEN=...
 *   export DISCORD_GUILD_ID=...        # optional, strongly recommended
 *   node scripts/registerCommand.js
 *
 * With DISCORD_GUILD_ID set the command registers to that one server and
 * appears instantly. Without it the command registers globally, which can take
 * up to an hour to propagate and installs into every server the app joins.
 *
 * Re-run only if the definition below changes.
 */
const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !botToken) {
  console.error(
    "Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in your shell before running this.\n" +
      "  export DISCORD_APPLICATION_ID=your-app-id\n" +
      "  export DISCORD_BOT_TOKEN=your-bot-token\n" +
      "  export DISCORD_GUILD_ID=your-server-id   # optional but recommended",
  );
  process.exit(1);
}

const commands = [
  {
    name: "conditions",
    description: "Current wind, weather and tide conditions for the club's sailing area",
    type: 1,
  },
];

const url = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});

const body = await response.text();

if (!response.ok) {
  console.error(`Discord returned HTTP ${response.status}:\n${body}`);
  process.exit(1);
}

console.log(guildId ? `Registered to guild ${guildId} (available now):` : "Registered globally (may take up to an hour):");
for (const command of JSON.parse(body)) {
  console.log(`  /${command.name} — ${command.description}`);
}
