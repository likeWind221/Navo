import { describe, expect, it } from "vitest";

import {
  sessionArchiveMethod,
  sessionCreateMethod,
  sessionListMethod,
  sessionRenameMethod,
  sessionRestoreMethod,
} from "../../rpc/session.js";
import { RpcError } from "../../rpc/errors.js";

const entry = {
  sessionId: "ordinary-1", title: "Conversation", status: "active" as const,
  createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z", revision: 1,
};

describe("ordinary Session RPC contracts", () => {
  it("exposes versioned create/list/mutation methods with strict inputs", () => {
    expect([
      sessionCreateMethod.name, sessionListMethod.name, sessionRenameMethod.name,
      sessionArchiveMethod.name, sessionRestoreMethod.name,
    ]).toEqual([
      "session.create.v1", "session.list.v1", "session.rename.v1",
      "session.archive.v1", "session.restore.v1",
    ]);
    expect(sessionCreateMethod.parseInput({ title: " Work " })).toEqual({ title: " Work " });
    expect(sessionListMethod.parseInput({ limit: 1, status: "all" })).toEqual({
      limit: 1, query: "", status: "all",
    });
    expect(sessionRenameMethod.parseInput({ sessionId: "ordinary-1", title: "Renamed", expectedRevision: 1 }))
      .toEqual({ sessionId: "ordinary-1", title: "Renamed", expectedRevision: 1 });
    for (const invalid of [
      { limit: 1, status: "all", extra: true },
      { limit: 0, status: "all" },
      { limit: 1, status: "all", query: "x".repeat(257) },
      { limit: 1, status: "all", cursor: { catalogRevision: 1, offset: 0, query: "", status: "all", extra: true } },
    ]) expect(() => sessionListMethod.parseInput(invalid)).toThrow(RpcError);
  });

  it("binds cursors to scope and accepts the empty query emitted by the service", () => {
    const cursor = { catalogRevision: 1, offset: 1, query: "", status: "all" as const };
    expect(sessionListMethod.parseInput({ limit: 1, status: "all", cursor })).toEqual({
      limit: 1, query: "", status: "all", cursor,
    });
    expect(() => sessionListMethod.parseInput({ limit: 1, status: "active", cursor })).toThrow(RpcError);
    expect(sessionListMethod.parseOutput({ catalogRevision: 1, entries: [entry], nextCursor: cursor }))
      .toEqual({ catalogRevision: 1, entries: [entry], nextCursor: cursor });
    expect(sessionListMethod.parseOutput({ catalogRevision: 0, entries: [], nextCursor: null }))
      .toEqual({ catalogRevision: 0, entries: [], nextCursor: null });
  });

  it("rejects missing, repeated, and malformed unary outputs", () => {
    const validator = sessionCreateMethod.createOutputValidator!({});
    expect(() => validator.end()).toThrow(RpcError);
    expect(validator.parse(entry)).toEqual(entry);
    expect(() => validator.parse(entry)).toThrow(RpcError);
    expect(() => sessionArchiveMethod.parseOutput({ ...entry, status: "pending" })).toThrow(RpcError);
    expect(() => sessionRestoreMethod.parseOutput({ ...entry, revision: 0 })).toThrow(RpcError);

    const archiveValidator = sessionArchiveMethod.createOutputValidator!({ sessionId: "ordinary-1", expectedRevision: 1 });
    expect(archiveValidator.parse({ ...entry, status: "archived" })).toMatchObject({ status: "archived" });
    const wrongSessionValidator = sessionArchiveMethod.createOutputValidator!({ sessionId: "ordinary-1", expectedRevision: 1 });
    expect(() => wrongSessionValidator.parse({ ...entry, sessionId: "other", status: "archived" })).toThrow(RpcError);
    const listValidator = sessionListMethod.createOutputValidator!({ limit: 1, query: "", status: "all" });
    expect(() => listValidator.parse({ catalogRevision: 1, entries: [entry, entry], nextCursor: null })).toThrow(RpcError);
    const wrongCursorValidator = sessionListMethod.createOutputValidator!({ limit: 1, query: "", status: "all" });
    expect(() => wrongCursorValidator.parse({ catalogRevision: 1, entries: [entry], nextCursor: {
      catalogRevision: 1, offset: 3, query: "", status: "all",
    } })).toThrow(RpcError);
    const emptyPageValidator = sessionListMethod.createOutputValidator!({
      limit: 1, query: "", status: "all", cursor: { catalogRevision: 1, offset: 2, query: "", status: "all" },
    });
    expect(() => emptyPageValidator.parse({ catalogRevision: 1, entries: [], nextCursor: {
      catalogRevision: 1, offset: 2, query: "", status: "all",
    } })).toThrow(RpcError);
    const staleRevisionValidator = sessionListMethod.createOutputValidator!({
      limit: 1, query: "", status: "all", cursor: { catalogRevision: 2, offset: 0, query: "", status: "all" },
    });
    expect(() => staleRevisionValidator.parse({ catalogRevision: 1, entries: [], nextCursor: null })).toThrow(RpcError);
  });
});
