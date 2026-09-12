import { Client, Events, GatewayIntentBits } from "discord.js";
import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { AvatarDB } from "./db.js";
import { AvatarStore } from "./avatar.js";

await mkdir(config.avatarDir, { recursive: true });

const db = new AvatarDB(config.dbPath);
const avatars = new AvatarStore(config.avatarDir, db);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

function update(user: Parameters<AvatarStore["save"]>[0]): void {
  void avatars.save(user).catch(error => {
    console.error(`[avatar] ${user.id}:`, error);
  });
}

client.on(Events.MessageCreate, msg => {
  if (
    !msg.author.bot &&
    (!config.channelId || msg.channelId === config.channelId)
  ) {
    update(msg.author);
  }
});

client.on(Events.UserUpdate, (_before, after) => {
  if (after.avatar !== _before.avatar) {
    update(after);
  }
});

client.once(Events.ClientReady, ready => {
  console.log(`[discord] ${ready.user.tag}`);
});

await client.login(config.token);

function stop(): void {
  client.destroy();
  db.close();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
