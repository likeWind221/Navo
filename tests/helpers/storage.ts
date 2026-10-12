import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Context } from "cordis";

import { StorageService } from "../../src/storage/database.js";

export const MEMORY_STORAGE = { path: ":memory:" } as const;

export async function memoryStorage(ctx: Context): Promise<void> {
  await ctx.plugin(StorageService, MEMORY_STORAGE);
}

export async function temporaryDatabase(roots: string[], prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return join(root, "navo.db");
}

export async function removeRoots(roots: string[]): Promise<void> {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
}

export function rawSql(path: string, statement: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(statement);
  } finally {
    db.close();
  }
}

export function storedRows(path: string, domain: string): { ownerId: string; seq: number; type: string }[] {
  const db = new DatabaseSync(path);
  try {
    return db.prepare("SELECT owner_id, seq, payload FROM events WHERE domain = ? ORDER BY rowid").all(domain)
      .map(row => ({
        ownerId: String(row.owner_id),
        seq: Number(row.seq),
        type: String((JSON.parse(String(row.payload)) as { type: unknown }).type),
      }));
  } finally {
    db.close();
  }
}
