import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
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

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(0)} ms`;
}

type ValidatedImage = {
  key: string;
  source: URL;
  sourceName: "Discord" | "QQ";
};

export class ImageStore {
  private readonly pendingSources = new Map<string, Promise<string>>();
  private readonly pendingContents = new Map<string, Promise<string>>();

  constructor(
    private readonly dir: string,
    private readonly publicBaseUrl: string,
  ) {}

  save(urls: readonly string[]): Promise<string[]> {
    const images = urls.map((url) => this.validateSource(url));

    return Promise.all(images.map((image) => this.saveOne(image)));
  }

  private saveOne(image: ValidatedImage): Promise<string> {
    const current = this.pendingSources.get(image.key);

    if (current) {
      return current;
    }

    const task = this.store(image).finally(() => {
      this.pendingSources.delete(image.key);
    });

    this.pendingSources.set(image.key, task);
    return task;
  }

  private validateSource(url: string): ValidatedImage {
    const source = new URL(url);

    if (
      source.protocol === "https:" &&
      source.hostname === "cdn.discordapp.com"
    ) {
      const match = source.pathname.match(/^\/attachments\/\d+\/(\d+)\/[^/]+$/);

      if (!match) {
        throw new Error("Unsupported Discord attachment URL");
      }

      return {
        key: `discord:${match[1]}`,
        source,
        sourceName: "Discord",
      };
    }

    if (
      source.protocol === "https:" &&
      source.hostname === "multimedia.nt.qq.com.cn" &&
      source.pathname === "/download"
    ) {
      const fileid = source.searchParams.get("fileid");

      if (!fileid) {
        throw new Error("QQ attachment URL is missing fileid");
      }

      return {
        key: `qq:${fileid}`,
        source,
        sourceName: "QQ",
      };
    }

    throw new Error("Unsupported image URL");
  }

  private async store(image: ValidatedImage): Promise<string> {
    const startedAt = performance.now();
    console.log(`[image] ${image.key} download start`);

    const response = await fetch(image.source, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    const headersAt = performance.now();

    if (!response.ok) {
      throw new Error(
        `${image.sourceName} attachment download failed: HTTP ${response.status}`,
      );
    }

    if (!response.body) {
      throw new Error(`${image.sourceName} attachment response is empty`);
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

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;

    await mkdir(this.dir, { recursive: true });

    const temporary = join(this.dir, `${randomUUID()}.tmp`);
    const hash = createHash("sha256");
    let bytes = 0;
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body as any),
        hasher,
        createWriteStream(temporary, { flags: "wx" }),
      );
      const downloadedAt = performance.now();

      const digest = hash.digest("hex");
      const url = await this.storeContent(temporary, digest, extension);
      const storedAt = performance.now();

      const downloadMs = downloadedAt - headersAt;
      const speedMiBs =
        downloadMs > 0 ? bytes / 1024 / 1024 / (downloadMs / 1000) : 0;
      const expectedSize =
        contentLength !== undefined && Number.isFinite(contentLength)
          ? ` (content-length=${formatMiB(contentLength)})`
          : "";

      console.log(
        `[image] ${image.key} -> ${digest}` +
          ` | size=${formatMiB(bytes)}${expectedSize}` +
          ` | headers=${formatMs(headersAt - startedAt)}` +
          ` | download=${formatMs(downloadMs)} @ ${speedMiBs.toFixed(2)} MiB/s` +
          ` | store=${formatMs(storedAt - downloadedAt)}` +
          ` | total=${formatMs(storedAt - startedAt)}`,
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

    const task = this.commitContent(temporary, digest, extension).finally(
      () => {
        this.pendingContents.delete(digest);
      },
    );

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
    return new URL(`/images/${filename}`, this.publicBaseUrl).toString();
  }
}
