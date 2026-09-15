import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AttachmentStore } from "./attachment.js";

const MAX_BODY_SIZE = 64 * 1024;

function authorized(req: IncomingMessage, token: string): boolean {
  const actual = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);

  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_BODY_SIZE) {
      throw new Error("Request body too large");
    }

    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseImageURLs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an image URL array");
  }

  return value.map((item) => {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error("Invalid image URL");
    }

    return item;
  });
}

function send(
  res: ServerResponse,
  status: number,
  body?: string,
  headers?: Record<string, string>,
): void {
  res.writeHead(status, headers);
  res.end(body);
}

export function createStorageServer(
  attachments: AttachmentStore,
  apiToken: string,
) {
  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      send(res, 204);
      return;
    }

    if (req.method !== "POST" || req.url !== "/api/images") {
      send(res, 404, "Not Found");
      return;
    }

    if (!authorized(req, apiToken)) {
      send(res, 401, "Unauthorized", {
        "www-authenticate": "Bearer",
      });
      return;
    }

    let body: string[];

    try {
      body = parseImageURLs(await readJson(req));
    } catch {
      send(res, 400, "Invalid request");
      return;
    }

    try {
      const urls = await attachments.save(body);

      send(res, 200, JSON.stringify(urls), {
        "content-type": "application/json; charset=utf-8",
      });
    } catch (error) {
      console.error(`[image] failed to store ${body.length} image(s):`, error);
      send(res, 502, "Image storage failed");
    }
  });
}
