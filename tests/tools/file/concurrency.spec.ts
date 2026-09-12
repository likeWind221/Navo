import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionId, ToolCallId } from "../../../src/brand/ids.js";
import { createEditTool } from "../../../src/tools/builtins/file/edit.js";
import { FileMutationCoordinator } from "../../../src/tools/builtins/file/lock.js";
import { FileObservationStore } from "../../../src/tools/builtins/file/observation.js";
import { createReadTool } from "../../../src/tools/builtins/file/read.js";
import { createWriteTool } from "../../../src/tools/builtins/file/write.js";

let root: string;
const signal = new AbortController().signal;
const sessionA = "session-a" as SessionId;
const sessionB = "session-b" as SessionId;

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skillworld-concurrency-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function kit() {
  const observations = new FileObservationStore();
  const mutations = new FileMutationCoordinator();
  const resolveFileEnvironment = () => ({ cwd: root });
  return {
    observations,
    mutations,
    read: createReadTool({ resolveFileEnvironment, observations }),
    write: createWriteTool({ resolveFileEnvironment, observations, mutations }),
    edit: createEditTool({ resolveFileEnvironment, observations, mutations }),
  };
}

function execution(sessionId: SessionId, callId: string) {
  return { callId: callId as ToolCallId, sessionId, signal };
}

describe("file version and concurrency guards", () => {
  it("rejects Write after an external change and preserves the newer content", async () => {
    await writeFile(join(root, "file.txt"), "v1");
    const { read, write } = kit();
    await read.execute({ path: "file.txt" }, execution(sessionA, "read-v1"));
    await writeFile(join(root, "file.txt"), "external-v2");

    await expect(write.execute(
      { path: "file.txt", content: "agent-v2" },
      execution(sessionA, "stale-write"),
    )).rejects.toMatchObject({
      modelMessage: "The file changed since it was read. Read it again before modifying it.",
    });
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("external-v2");
  });

  it("lets only one Session commit from the same observed version", async () => {
    await writeFile(join(root, "file.txt"), "v1");
    const { read, write } = kit();
    await Promise.all([
      read.execute({ path: "file.txt" }, execution(sessionA, "read-a")),
      read.execute({ path: "file.txt" }, execution(sessionB, "read-b")),
    ]);

    const results = await Promise.allSettled([
      write.execute({ path: "file.txt", content: "from-a" }, execution(sessionA, "write-a")),
      write.execute({ path: "file.txt", content: "from-b" }, execution(sessionB, "write-b")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { modelMessage: "The file changed since it was read. Read it again before modifying it." },
    });
  });

  it("never combines paginated coverage from different file versions", async () => {
    const firstVersion = Array.from({ length: 250 }, (_, index) => `v1-${index + 1}`).join("\n");
    const secondVersion = Array.from({ length: 250 }, (_, index) => `v2-${index + 1}`).join("\n");
    await writeFile(join(root, "long.txt"), firstVersion);
    const { read, write } = kit();
    await read.execute(
      { path: "long.txt", maxLines: 200 },
      execution(sessionA, "page-v1"),
    );
    await writeFile(join(root, "long.txt"), secondVersion);
    await read.execute(
      { path: "long.txt", startLine: 201, maxLines: 200 },
      execution(sessionA, "page-v2"),
    );

    await expect(write.execute(
      { path: "long.txt", content: "replacement" },
      execution(sessionA, "mixed-pages-write"),
    )).rejects.toMatchObject({
      modelMessage: "Read the existing file in this Session before replacing it.",
    });
    expect(await readFile(join(root, "long.txt"), "utf8")).toBe(secondVersion);
  });

  it("protects concurrent create-if-absent publication", async () => {
    const { write } = kit();
    const results = await Promise.allSettled([
      write.execute({ path: "new.txt", content: "one" }, execution(sessionA, "create-a")),
      write.execute({ path: "new.txt", content: "two" }, execution(sessionB, "create-b")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["one", "two"]).toContain(await readFile(join(root, "new.txt"), "utf8"));
  });

  it("requires Edit observation and rejects a stale observed version", async () => {
    await writeFile(join(root, "file.txt"), "before");
    const { read, edit } = kit();
    await expect(edit.execute(
      { path: "file.txt", oldText: "before", newText: "after" },
      execution(sessionA, "blind-edit"),
    )).rejects.toMatchObject({
      modelMessage: "Read the existing file in this Session before replacing it.",
    });

    await read.execute({ path: "file.txt" }, execution(sessionA, "read-edit"));
    await writeFile(join(root, "file.txt"), "before external");
    await expect(edit.execute(
      { path: "file.txt", oldText: "before", newText: "after" },
      execution(sessionA, "stale-edit"),
    )).rejects.toMatchObject({
      modelMessage: "The file changed since it was read. Read it again before modifying it.",
    });
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("before external");
  });
});
