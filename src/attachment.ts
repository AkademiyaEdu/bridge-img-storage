import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const EXTENSION_BY_CONTENT_TYPE = new Map([
  ["image/png", "png"],
  ["image/apng", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
]);

const IMAGE_EXTENSIONS = [...new Set(EXTENSION_BY_CONTENT_TYPE.values())];

export interface DiscordAttachment {
  id: string;
  url: string;
}

export interface QQAttachment {
  id: string;
  url: string;
}

type ValidatedAttachment = {
  key: string;
  id: string;
  source: URL;
  sourceName: "Discord" | "QQ";
};

export class AttachmentStore {
  private readonly pendingSources = new Map<string, Promise<string>>();
  private readonly pendingContents = new Map<string, Promise<string>>();

  constructor(
    private readonly dir: string,
    private readonly publicBaseUrl: string,
  ) {}

  saveDiscord(attachments: readonly DiscordAttachment[]): Promise<string[]> {
    return this.save(
      attachments.map((attachment) => ({
        key: `discord:${attachment.id}`,
        id: attachment.id,
        source: this.validateDiscordSource(attachment),
        sourceName: "Discord" as const,
      })),
    );
  }

  saveQQ(attachments: readonly QQAttachment[]): Promise<string[]> {
    return this.save(
      attachments.map((attachment) => ({
        key: `qq:${attachment.id}`,
        id: attachment.id,
        source: this.validateQQSource(attachment),
        sourceName: "QQ" as const,
      })),
    );
  }

  private save(attachments: readonly ValidatedAttachment[]): Promise<string[]> {
    return Promise.all(
      attachments.map((attachment) => this.saveOne(attachment)),
    );
  }

  private saveOne(attachment: ValidatedAttachment): Promise<string> {
    const current = this.pendingSources.get(attachment.key);

    if (current) {
      return current;
    }

    const task = this.store(attachment).finally(() => {
      this.pendingSources.delete(attachment.key);
    });

    this.pendingSources.set(attachment.key, task);
    return task;
  }

  private validateDiscordSource(attachment: DiscordAttachment): URL {
    if (!/^\d+$/.test(attachment.id)) {
      throw new Error("Invalid Discord attachment id");
    }

    const source = new URL(attachment.url);

    if (
      source.protocol !== "https:" ||
      source.hostname !== "cdn.discordapp.com"
    ) {
      throw new Error("Unsupported Discord attachment URL");
    }

    const match = source.pathname.match(
      /^\/attachments\/\d+\/(\d+)\/[^/]+$/,
    );

    if (!match || match[1] !== attachment.id) {
      throw new Error("Discord attachment id does not match URL");
    }

    return source;
  }

  private validateQQSource(attachment: QQAttachment): URL {
    if (!attachment.id) {
      throw new Error("Invalid QQ attachment id");
    }

    const source = new URL(attachment.url);

    if (
      source.protocol !== "https:" ||
      source.hostname !== "multimedia.nt.qq.com.cn" ||
      source.pathname !== "/download"
    ) {
      throw new Error("Unsupported QQ attachment URL");
    }

    if (source.searchParams.get("fileid") !== attachment.id) {
      throw new Error("QQ attachment id does not match URL");
    }

    return source;
  }

  private async store(attachment: ValidatedAttachment): Promise<string> {
    const response = await fetch(attachment.source, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(
        `${attachment.sourceName} attachment download failed: HTTP ${response.status}`,
      );
    }

    if (!response.body) {
      throw new Error(`${attachment.sourceName} attachment response is empty`);
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const extension = contentType
      ? EXTENSION_BY_CONTENT_TYPE.get(contentType)
      : undefined;

    if (!extension) {
      throw new Error(`Unsupported image type: ${contentType ?? "unknown"}`);
    }

    await mkdir(this.dir, { recursive: true });

    const temporary = join(this.dir, `${randomUUID()}.tmp`);
    const hash = createHash("sha256");
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body),
        hasher,
        createWriteStream(temporary, { flags: "wx" }),
      );

      const digest = hash.digest("hex");
      const url = await this.storeContent(temporary, digest, extension);

      console.log(
        `[attachment] ${attachment.sourceName} ${attachment.id} -> ${digest}`,
      );
      return url;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private storeContent(
    temporary: string,
    digest: string,
    extension: string,
  ): Promise<string> {
    const current = this.pendingContents.get(digest);

    if (current) {
      return current;
    }

    const task = this.commitContent(temporary, digest, extension).finally(() => {
      this.pendingContents.delete(digest);
    });

    this.pendingContents.set(digest, task);
    return task;
  }

  private async commitContent(
    temporary: string,
    digest: string,
    extension: string,
  ): Promise<string> {
    const existing = await this.findExisting(digest);
    if (existing) {
      return this.publicUrl(existing);
    }

    const filename = `${digest}.${extension}`;
    await rename(temporary, join(this.dir, filename));
    return this.publicUrl(filename);
  }

  private async findExisting(digest: string): Promise<string | undefined> {
    for (const extension of IMAGE_EXTENSIONS) {
      const filename = `${digest}.${extension}`;

      try {
        await access(join(this.dir, filename));
        return filename;
      } catch {
        // Try the next supported image extension.
      }
    }

    return undefined;
  }

  private publicUrl(filename: string): string {
    return new URL(`/attachments/${filename}`, this.publicBaseUrl).toString();
  }
}
