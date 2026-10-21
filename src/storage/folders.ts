import type { DatabaseSync } from "node:sqlite";

export interface LibraryFolder {
  readonly projectId: string;
  readonly path: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const LIBRARY_FOLDERS_SCHEMA = `
CREATE TABLE library_folders (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
) STRICT;
`;

export interface LibraryFolderTransaction {
  insertFolder(folder: LibraryFolder): void;
  deleteFolder(projectId: string, path: string): void;
}

export function libraryFolderTransaction(db: DatabaseSync): LibraryFolderTransaction {
  return {
    insertFolder(folder) {
      db.prepare("INSERT INTO library_folders VALUES (?, ?, ?, ?)")
        .run(folder.projectId, folder.path, folder.createdAt, folder.updatedAt);
    },
    deleteFolder(projectId, path) {
      db.prepare("DELETE FROM library_folders WHERE project_id = ? AND path = ?").run(projectId, path);
    },
  };
}
