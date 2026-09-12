import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { AvatarDB } from "../src/db.js";
import { AvatarStore, avatarKey } from "../src/avatar.js";

test("cache, replacement, recovery and concurrent updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "avatar-sync-"));
  const db = new AvatarDB(join(dir, "avatar.db"));
  const images = join(dir, "avatars");
  const store = new AvatarStore(images, db);
  const originalFetch = globalThis.fetch;
  const hash1 = "a".repeat(32);
  const hash2 = "b".repeat(32);
  const hash3 = "c".repeat(32);
  const url1 = `https://cdn.discordapp.com/avatars/123/${hash1}.webp?size=128`;
  const url2 = `https://cdn.discordapp.com/avatars/123/${hash2}.webp?size=128`;
  const url3 = `https://cdn.discordapp.com/avatars/123/${hash3}.webp?size=128`;
  const makeImage = (color: string) => sharp({
    create: { width: 8, height: 8, channels: 4, background: color },
  }).png().toBuffer();
  const red = await makeImage("#ff0000");
  const blue = await makeImage("#0000ff");
  const green = await makeImage("#00ff00");
  const pixels = new Map([[url1, red], [url2, blue], [url3, green]]);
  let downloads = 0;
  let fail = false;
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });

  globalThis.fetch = async input => {
    downloads++;
    if (fail) return new Response("unavailable", { status: 503 });
    if (String(input) === url2 && release) {
      started?.();
      await blocked;
    }
    return new Response(pixels.get(String(input)), { status: 200 });
  };

  const user = (id: string, url: string) => ({
    id,
    displayAvatarURL: () => url,
  });

  try {
    assert.equal(avatarKey(url1), avatarKey(url1.replace(".webp", ".png")));
    assert.notEqual(avatarKey(url1), avatarKey(url2));

    await store.save(user("123", url1));
    await store.save(user("123", url1));
    assert.equal(downloads, 1);
    assert.equal(db.get("123"), url1);

    const path = join(images, "123.webp");
    const first = await readFile(path);
    const firstMeta = await sharp(first).metadata();
    assert.equal(firstMeta.width, 48);
    assert.equal(firstMeta.height, 48);

    const old = store.save(user("123", url2));
    await waiting;
    const newer = store.save(user("123", url3));
    release?.();
    await Promise.all([old, newer]);
    assert.equal(db.get("123"), url3);
    assert.notDeepEqual(await readFile(path), first);

    fail = true;
    await assert.rejects(store.save(user("123", url1)), /HTTP 503/);
    assert.equal(db.get("123"), url3);
    fail = false;

    await unlink(path);
    await store.save(user("123", url3));
    assert.equal(db.get("123"), url3);
    assert.equal((await readFile(path)).length > 0, true);
    const pixel = (await sharp(await readFile(path)).raw().toBuffer()).subarray(0, 3);
    assert(pixel[0] < 5 && pixel[1] > 250 && pixel[2] < 5);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
