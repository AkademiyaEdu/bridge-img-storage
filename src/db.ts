import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class AvatarDB {
  private readonly db: DatabaseSync;
  private readonly getStmt;
  private readonly saveStmt;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS avatar (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL
      ) STRICT
    `);
    this.getStmt = this.db.prepare("SELECT url FROM avatar WHERE id = ?");
    this.saveStmt = this.db.prepare(`
      INSERT INTO avatar (id, url) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET url = excluded.url
    `);
  }

  get(id: string): string | undefined {
    return (this.getStmt.get(id) as { url: string } | undefined)?.url;
  }

  save(id: string, url: string): void {
    this.saveStmt.run(id, url);
  }

  close(): void {
    this.db.close();
  }
}
