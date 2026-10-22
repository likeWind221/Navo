import { describe, expect, it } from "vitest";
import {
  resourceDeleteMethod,
  resourceFolderCreateMethod,
  resourceFolderDeleteMethod,
  resourceFolderOrganizeMethod,
  resourceLibraryBrowseMethod,
  resourceLibraryFollowMethod,
  resourceReplaceMethod,
  resourceUpdateMethod,
  userImportMethod,
} from "../resource.js";

const item = {
  resourceId: "resource-1", owner: { kind: "user" }, name: "report.md", description: "",
  type: "text/markdown", libraryPath: "papers/report.md", access: { kind: "public" },
  revision: 2, assetGeneration: 1, createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:01.000Z",
  content: { status: "failed", errorCode: "extract-failed", errorMessage: "Unreadable",
    updatedAt: "2026-10-22T00:00:02.000Z" },
} as const;

const snapshot = { projectId: "project-1", path: null,
  directories: [{ path: "papers", explicit: true }], resources: [item] } as const;

describe("resource library RPC contract", () => {
  it("strictly parses browsing, mutation and deletion shapes", () => {
    expect(resourceLibraryBrowseMethod.parseInput({ projectId: "project-1", path: null }))
      .toEqual({ projectId: "project-1", path: null });
    expect(resourceLibraryBrowseMethod.parseOutput(snapshot)).toEqual(snapshot);
    expect(resourceFolderCreateMethod.parseInput({ projectId: "project-1", path: "papers" }))
      .toEqual({ projectId: "project-1", path: "papers" });
    expect(resourceFolderOrganizeMethod.parseInput({ projectId: "project-1", path: "papers", targetPath: "sources" }))
      .toEqual({ projectId: "project-1", path: "papers", targetPath: "sources" });
    expect(resourceFolderDeleteMethod.parseOutput({ status: "partial", deleted: ["resource-1"],
      failed: [{ resourceId: "resource-2", code: "resource-unavailable" }] })).toMatchObject({ status: "partial" });
    expect(resourceUpdateMethod.parseInput({ projectId: "project-1", resourceId: "resource-1",
      expectedRevision: 1, folder: "", description: "" })).toMatchObject({ folder: "", description: "" });
    expect(resourceReplaceMethod.parseInput({ projectId: "project-1", resourceId: "resource-1",
      expectedRevision: 1, operationId: "replace_1", sourcePath: "C:\\source.md" })).toMatchObject({ operationId: "replace_1" });
    expect(resourceDeleteMethod.parseOutput({ resourceId: "resource-1", deleted: true }))
      .toEqual({ resourceId: "resource-1", deleted: true });
  });

  it("rejects extra keys, empty updates, invalid operation identities and malformed output", () => {
    expect(() => resourceLibraryBrowseMethod.parseInput({ projectId: "project-1", path: null, actor: "user" })).toThrow();
    expect(() => resourceUpdateMethod.parseInput({ projectId: "project-1", resourceId: "resource-1", expectedRevision: 1 })).toThrow();
    expect(() => resourceFolderDeleteMethod.parseInput({ projectId: "project-1", path: "papers",
      recursive: true, operationId: "bad/id" })).toThrow();
    expect(() => resourceLibraryBrowseMethod.parseOutput({ ...snapshot, resources: [{ ...item, secret: true }] })).toThrow();
    expect(() => userImportMethod.parseInput({ projectId: "project-1", requestId: "import-1", sources: [] })).toThrow();
  });

  it("requires a scoped baseline from the follow stream", () => {
    const validator = resourceLibraryFollowMethod.createOutputValidator!({ projectId: "project-1", path: null });
    expect(validator.parse(snapshot)).toEqual(snapshot);
    expect(() => validator.parse({ ...snapshot, projectId: "project-2" })).toThrow();
    expect(() => resourceLibraryFollowMethod.createOutputValidator!({ projectId: "project-1", path: null }).end()).toThrow();
  });
});
