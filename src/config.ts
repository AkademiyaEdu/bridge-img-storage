import { resolve } from "node:path";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const config = {
  token: env("DISCORD_BOT_TOKEN"),
  channelId: process.env.DISCORD_CHANNEL_ID?.trim() || undefined,
  dbPath: resolve(process.env.DB_PATH || "./data/avatar.db"),
  avatarDir: resolve(process.env.AVATAR_DIR || "./data/avatars"),
};
