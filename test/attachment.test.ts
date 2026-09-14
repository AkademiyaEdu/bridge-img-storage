import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AttachmentStore } from "../src/attachment.js";

test("Discord and QQ attachments share SHA-256 storage", async () => {
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
    const [discordResult, qqResult] = await Promise.all([
      store.saveDiscord([{ id: "456", url: discordURL }]),
      store.saveQQ([{ id: "qq-file-id", url: qqURL }]),
    ]);

    const expected = `https://img.example.com/attachments/${digest}.png`;
    assert.deepEqual(discordResult, [expected]);
    assert.deepEqual(qqResult, [expected]);
    assert.deepEqual(await readdir(dir), [`${digest}.png`]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects mismatched QQ fileid", async () => {
  const store = new AttachmentStore("/tmp/unused", "https://img.example.com");

  assert.throws(
    () =>
      store.saveQQ([
        {
          id: "expected",
          url: "https://multimedia.nt.qq.com.cn/download?fileid=other&rkey=test",
        },
      ]),
    /QQ attachment id does not match URL/,
  );
});
