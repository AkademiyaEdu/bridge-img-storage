import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  AttachmentStore,
  DiscordAttachment,
  QQAttachment,
} from "./attachment.js";

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

function parseDiscordAttachments(value: unknown): DiscordAttachment[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an attachment array");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid attachment");
    }

    const { id, url } = item as { id?: unknown; url?: unknown };

    if (
      typeof id !== "string" ||
      !/^\d+$/.test(id) ||
      typeof url !== "string"
    ) {
      throw new Error("Invalid attachment");
    }

    return { id, url };
  });
}

function parseQQAttachments(value: unknown): QQAttachment[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an attachment array");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid attachment");
    }

    const { id, url } = item as { id?: unknown; url?: unknown };

    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof url !== "string"
    ) {
      throw new Error("Invalid attachment");
    }

    return { id, url };
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

    const source =
      req.method === "POST" && req.url === "/api/discord/attachments"
        ? "discord"
        : req.method === "POST" && req.url === "/api/qq/attachments"
          ? "qq"
          : undefined;

    if (!source) {
      send(res, 404, "Not Found");
      return;
    }

    if (!authorized(req, apiToken)) {
      send(res, 401, "Unauthorized", {
        "www-authenticate": "Bearer",
      });
      return;
    }

    let value: unknown;

    try {
      value = await readJson(req);
    } catch {
      send(res, 400, "Invalid request");
      return;
    }

    if (source === "discord") {
      let body: DiscordAttachment[];

      try {
        body = parseDiscordAttachments(value);
      } catch {
        send(res, 400, "Invalid request");
        return;
      }

      try {
        const urls = await attachments.saveDiscord(body);

        send(res, 200, JSON.stringify(urls), {
          "content-type": "application/json; charset=utf-8",
        });
      } catch (error) {
        console.error(
          `[attachment] Discord ${body.map((attachment) => attachment.id).join(",")}:`,
          error,
        );
        send(res, 502, "Attachment storage failed");
      }

      return;
    }

    let body: QQAttachment[];

    try {
      body = parseQQAttachments(value);
    } catch {
      send(res, 400, "Invalid request");
      return;
    }

    try {
      const urls = await attachments.saveQQ(body);

      send(res, 200, JSON.stringify(urls), {
        "content-type": "application/json; charset=utf-8",
      });
    } catch (error) {
      console.error(
        `[attachment] QQ ${body.map((attachment) => attachment.id).join(",")}:`,
        error,
      );
      send(res, 502, "Attachment storage failed");
    }
  });
}
