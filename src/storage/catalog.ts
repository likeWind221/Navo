import type { DatabaseSync } from "node:sqlite";

export interface ResourceCatalogTransaction {
  getCatalogVersion(projectId: string): number;
  bumpCatalogVersion(projectId: string): void;
}

export const RESOURCE_CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS resource_catalog_versions (
  project_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 0)
) STRICT;
`;

export function resourceCatalogTransaction(db: DatabaseSync): ResourceCatalogTransaction {
  return {
    getCatalogVersion(projectId) {
      const row = db.prepare("SELECT version FROM resource_catalog_versions WHERE project_id = ?")
        .get(projectId) as { version?: unknown } | undefined;
      if (row === undefined) return 0;
      if (!Number.isSafeInteger(row.version) || (row.version as number) < 0) {
        throw new Error("Stored Resource catalog version is invalid.");
      }
      return row.version as number;
    },
    bumpCatalogVersion(projectId) {
      db.prepare(`INSERT INTO resource_catalog_versions (project_id, version) VALUES (?, 1)
        ON CONFLICT(project_id) DO UPDATE SET version = resource_catalog_versions.version + 1`)
        .run(projectId);
    },
  };
}
