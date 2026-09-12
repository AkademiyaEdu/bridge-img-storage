import { randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

export class AttachmentStore {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private readonly dir: string,
    private readonly publicBaseUrl: string,
  ) {}

  save(attachment: DiscordAttachment): Promise<string> {
    const source = this.validateSource(attachment);
    const current = this.pending.get(attachment.id);

    if (current) {
      return current;
    }

    const task = this.store(attachment.id, source).finally(() => {
      this.pending.delete(attachment.id);
    });

    this.pending.set(attachment.id, task);
    return task;
  }

  private validateSource(attachment: DiscordAttachment): URL {
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

  private async store(id: string, source: URL): Promise<string> {
    const existing = await this.findExisting(id);
    if (existing) {
      return this.publicUrl(existing);
    }

    const response = await fetch(source, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(
        `Discord attachment download failed: HTTP ${response.status}`,
      );
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

    const image = Buffer.from(await response.arrayBuffer());
    const filename = `${id}.${extension}`;
    const path = join(this.dir, filename);

    await mkdir(this.dir, { recursive: true });

    const temporary = join(this.dir, `${id}.${randomUUID()}.tmp`);

    try {
      await writeFile(temporary, image);
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }

    console.log(`[attachment] ${id} stored`);
    return this.publicUrl(filename);
  }

  private async findExisting(id: string): Promise<string | undefined> {
    for (const extension of IMAGE_EXTENSIONS) {
      const filename = `${id}.${extension}`;

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
