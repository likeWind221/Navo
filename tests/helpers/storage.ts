import type { Context } from "cordis";

import { StorageService } from "../../src/storage/database.js";

export const MEMORY_STORAGE = { path: ":memory:" } as const;

export async function memoryStorage(ctx: Context): Promise<void> {
  await ctx.plugin(StorageService, MEMORY_STORAGE);
}
