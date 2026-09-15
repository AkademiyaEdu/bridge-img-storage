import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AttachmentStore } from "../src/attachment.js";

test("Discord and QQ image URLs share SHA-256 storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "attachment-store-"));
  const store = new AttachmentStore(dir, "https://img.example.com");
  const originalFetch = globalThis.fetch;
  const image = Buffer.from("same image bytes");
  const digest = createHash("sha256").update(image).digest("hex");
  const discordURL =
    "https://cdn.discordapp.com/attachments/123/456/image.png?ex=test";
  const qqURL =
    "https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=qq-file-id&rkey=test&spec=0";

  globalThis.fetch = async input => {
    const url = String(input);
    assert(url === discordURL || url === qqURL);
    return new Response(image, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };

  try {
    const result = await store.save([discordURL, qqURL]);

    const expected = `https://img.example.com/attachments/${digest}.png`;
    assert.deepEqual(result, [expected, expected]);
    assert.deepEqual(await readdir(dir), [`${digest}.png`]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects unsupported image URLs", () => {
  const store = new AttachmentStore("/tmp/unused", "https://img.example.com");

  assert.throws(
    () => store.save(["https://example.com/image.png"]),
    /Unsupported image URL/,
  );
});

test("rejects QQ URLs without fileid", () => {
  const store = new AttachmentStore("/tmp/unused", "https://img.example.com");

  assert.throws(
    () =>
      store.save([
        "https://multimedia.nt.qq.com.cn/download?appid=1407&rkey=test",
      ]),
    /missing fileid/,
  );
});
