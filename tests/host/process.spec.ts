import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  agentTurnV2Method,
  encodeNdjson,
  NdjsonDecoder,
  parseRpcServerFrame,
  projectCreateMethod,
  projectGetMethod,
  projectListMethod,
  projectMailboxMethod,
  projectResourcesMethod,
  projectNodeReviewMethod,
  projectTurnMethod,
  sessionCommandMethod,
  StreamRpcClient,
} from "../../rpc/index.js";
import type { RpcClientFrame, RpcClientTransport } from "../../rpc/index.js";
import type { SessionEvent } from "../../src/session/types.js";
import { eventMessage } from "../../src/session/surface.js";
import { HOST_LOCK_TARGET } from "../../src/host/lock.js";
import { registerAssetCrashTests, type HostProcessPhase } from "./process/interruption.js";

import { describe, expect, it } from "vitest";

const PROCESS_TEST_TIMEOUT_MS = 20_000;
const PROCESS_WAIT_MS = 15_000;
const mode = process.env.NAVO_TEST_MODE ?? "all";

if (!["all", "normal", "crash-pr", "crash-full"].includes(mode)) {
  throw new Error(`Unknown NAVO_TEST_MODE: ${mode}`);
}

if (mode === "all" || mode === "normal") describe("Kernel Host process lifecycle", { timeout: PROCESS_TEST_TIMEOUT_MS }, () => {
  it("rejects a second real Host across NAVO_HOME values before opening its database", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-exclusive-"));
    const first = startHost("src/host/main.ts", { NAVO_HOME: join(base, "one") });
    const stderr = capture(first.stderr);
    try {
      await waitUntil(() => stderr.value.includes("[kernel-host] ready"));
      const second = startHost("src/host/main.ts", { NAVO_HOME: join(base, "two") });
      const rejected = capture(second.stderr);
      await expect(exitOf(second)).resolves.toEqual({ code: 1, signal: null });
      expect(rejected.value).toContain("host-already-running");
      expect(rejected.value).not.toContain("[kernel-host] ready");
      await expect(stat(join(base, "two", "navo.db"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      first.stdin.end();
      await exitOf(first);
      await rm(base, { recursive: true, force: true });
    }
  });

  it("recovers the real Host lock after a forced process exit once its lock becomes stale", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-stale-"));
    const first = startHost("src/host/main.ts", { NAVO_HOME: base });
    const stderr = capture(first.stderr);
    try {
      await waitUntil(() => stderr.value.includes("[kernel-host] ready"));
      expect(first.kill("SIGKILL")).toBe(true);
      await exitOf(first);
      const expired = new Date(Date.now() - 30_000);
      await utimes(`${HOST_LOCK_TARGET}.lock`, expired, expired);
      const restarted = startHost("src/host/main.ts", { NAVO_HOME: base });
      const ready = capture(restarted.stderr);
      try {
        await waitUntil(() => ready.value.includes("[kernel-host] ready"));
      } finally {
        restarted.stdin.end();
        await expect(exitOf(restarted)).resolves.toEqual({ code: 0, signal: null });
      }
      await expect(stat(`${HOST_LOCK_TARGET}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (first.exitCode === null && first.signalCode === null) first.kill("SIGKILL");
      await exitOf(first);
      await rm(base, { recursive: true, force: true });
    }
  });

  it("starts the real Host without exposing configuration on stdout and exits on stdin EOF", async () => {
    const home = await mkdtemp(join(tmpdir(), "navo-process-home-"));
    const child = startHost("src/host/main.ts", { NAVO_HOME: home });
    const stderr = capture(child.stderr);
    const stdout = capture(child.stdout);
    await waitUntil(() => stderr.value.includes("[kernel-host] ready"));

    child.stdin.end();
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
    expect(stdout.value).toBe("");
    expect(stderr.value).not.toContain("LLM_API_KEY");
    expect(stderr.value).not.toContain("ExperimentalWarning");
    await rm(home, { recursive: true, force: true });
  });

  it("restores Projects and Workspace bindings after the real Host restarts", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-restart-"));
    const env = { NAVO_HOME: join(base, "home") };
    const root = join(base, "workspace");
    const other = join(base, "other");
    await mkdir(root);
    await mkdir(other);
    try {
      const created = await withRealHost(env, async (client) => {
        const [project] = await collect(client.stream(projectCreateMethod, {
          name: "Durable project", goal: "Survive a restart", workspaceRoot: root,
        }));
        await collect(client.stream(projectCreateMethod, {
          name: "Second project", goal: null, workspaceRoot: other,
        }));
        return project!;
      });
      const before = await withRealHost(env, async (client) => {
        const [list] = await collect(client.stream(projectListMethod, {}));
        const [detail] = await collect(client.stream(projectGetMethod, { projectId: created.projectId }));
        expect(detail).toMatchObject({ project: created, roadmap: null });
        return list!;
      });
      expect(before.projects.map(project => project.name)).toEqual(["Second project", "Durable project"]);
      expect(before.projects[1]).toEqual(created);

      await rm(root, { recursive: true, force: true });
      const after = await withRealHost(env, async (client) => (await collect(client.stream(projectListMethod, {})))[0]!);
      expect(after).toEqual(before);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("keeps a healthy Project usable when another Project has bad JSON", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-isolation-"));
    const home = join(base, "home");
    const badRoot = join(base, "bad-workspace");
    const healthyRoot = join(base, "healthy-workspace");
    const nextRoot = join(base, "next-workspace");
    await mkdir(badRoot);
    await mkdir(healthyRoot);
    await mkdir(nextRoot);
    try {
      const projects = await withRealHost({ NAVO_HOME: home }, async client => {
        const [bad] = await collect(client.stream(projectCreateMethod, {
          name: "Broken project", goal: "Broken", workspaceRoot: badRoot,
        }));
        const [healthy] = await collect(client.stream(projectCreateMethod, {
          name: "Healthy project", goal: "Continue", workspaceRoot: healthyRoot,
        }));
        return { badId: bad!.projectId, healthyId: healthy!.projectId };
      });
      const db = new DatabaseSync(join(home, "navo.db"));
      db.prepare("UPDATE events SET payload = '{' WHERE domain = 'project' AND project_id = ?").run(projects.badId);
      db.close();

      await withRealHost({ NAVO_HOME: home }, async client => {
        const [list] = await collect(client.stream(projectListMethod, {}));
        expect(list!.projects.map(project => project.name)).toEqual(["Healthy project"]);
        const [detail] = await collect(client.stream(projectGetMethod, { projectId: projects.healthyId }));
        expect(detail!.project.projectId).toBe(projects.healthyId);
        const [next] = await collect(client.stream(projectCreateMethod, {
          name: "Next project", goal: "Continue writing", workspaceRoot: nextRoot,
        }));
        expect(next!.name).toBe("Next project");
      });

      const check = new DatabaseSync(join(home, "navo.db"));
      expect(check.prepare(
        "SELECT payload FROM events WHERE domain = 'project' AND project_id = ?",
      ).all(projects.badId).map(row => String(row.payload))).toEqual(["{"]);
      check.close();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("restores a Roadmap and Node review results after the Host restarts", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-roadmap-"));
    const home = join(base, "home");
    const root = join(base, "workspace");
    await mkdir(root);
    try {
      const before = await withRealHost({ NAVO_HOME: home, NAVO_MOCK_LLM_MODE: "roadmap" }, async (client) => {
        const [project] = await collect(client.stream(projectCreateMethod, {
          name: "Planned project", goal: "Survive a restart with a plan", workspaceRoot: root,
        }));
        const projectId = project!.projectId;
        await collect(client.stream(projectTurnMethod, {
          projectId, requestId: "plan", text: "Please plan this project.", target: { kind: "main" },
        }));
        const [planned] = await collect(client.stream(projectGetMethod, { projectId }));
        expect(planned!.roadmap?.nodes.map(node => node.status)).toEqual(["idle", "locked"]);
        const first = planned!.roadmap!.nodes[0]!;
        await collect(client.stream(projectNodeReviewMethod, {
          projectId, nodeId: first.nodeId, action: "complete" as const, reason: "Reviewed", reviewedRevision: first.revision,
        }));
        const [reviewed] = await collect(client.stream(projectGetMethod, { projectId }));
        expect(reviewed!.roadmap?.nodes.map(node => node.status)).toEqual(["completing", "idle"]);
        return reviewed!;
      }, "scripts/host/mock.ts");

      const after = await withRealHost({ NAVO_HOME: home }, async (client) => (
        await collect(client.stream(projectGetMethod, { projectId: before.project.projectId }))
      )[0]!, "scripts/host/mock.ts");
      expect(after).toEqual(before);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("restores messages and readable Resources after a real Host restart", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-handoff-"));
    const home = join(base, "home");
    const root = join(base, "workspace");
    await mkdir(root);
    await writeFile(join(root, "report.md"), "Persistent findings");
    try {
      const before = await withRealHost({ NAVO_HOME: home, NAVO_MOCK_LLM_MODE: "handoff" }, async client => {
        const [created] = await collect(client.stream(projectCreateMethod, { name: "Handoff", goal: "Persist findings", workspaceRoot: root }));
        const projectId = created!.projectId;
        await collect(client.stream(projectTurnMethod, { projectId, requestId: "plan", text: "Plan", target: { kind: "main" } }));
        const [detail] = await collect(client.stream(projectGetMethod, { projectId }));
        const nodeId = detail!.roadmap!.nodes[0]!.nodeId;
        await collect(client.stream(projectTurnMethod, { projectId, requestId: "work", text: "Publish", target: { kind: "node", nodeId } }));
        const [afterWork] = await collect(client.stream(projectGetMethod, { projectId }));
        const [mailbox] = await collect(client.stream(projectMailboxMethod, { projectId, afterSequence: 0, limit: 100 }));
        const [resources] = await collect(client.stream(projectResourcesMethod, { projectId }));
        expect(mailbox!.messages).toHaveLength(1);
        expect(resources!.resources).toHaveLength(1);
        return { projectId, detail: afterWork, mailbox, resources };
      }, "scripts/host/mock.ts");
      await withRealHost({ NAVO_HOME: home }, async client => {
        const [detail] = await collect(client.stream(projectGetMethod, { projectId: before.projectId }));
        const [mailbox] = await collect(client.stream(projectMailboxMethod, { projectId: before.projectId, afterSequence: 0, limit: 100 }));
        const [resources] = await collect(client.stream(projectResourcesMethod, { projectId: before.projectId }));
        expect(detail).toEqual(before.detail);
        expect(mailbox).toEqual(before.mailbox);
        expect(resources).toEqual(before.resources);
        const resource = resources!.resources[0]!;
        expect(await readFile(join(root, ".navo", "assets", resource.resourceId, resource.entryRef), "utf8")).toBe("Persistent findings");
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("refuses to start when the database schema is not recognized", async () => {
    const home = await mkdtemp(join(tmpdir(), "navo-process-schema-"));
    try {
      await withRealHost({ NAVO_HOME: home }, async () => undefined);
      const db = new DatabaseSync(join(home, "navo.db"));
      db.exec("PRAGMA user_version = 99");
      db.close();

      const child = startHost("src/host/main.ts", { NAVO_HOME: home });
      const stderr = capture(child.stderr);
      const stdout = capture(child.stdout);
      await expect(exitOf(child)).resolves.toEqual({ code: 1, signal: null });
      expect(stderr.value).toContain("[kernel-host] fatal:");
      expect(stderr.value).toContain("schema 99");
      expect(stderr.value).not.toContain("[kernel-host] ready");
      expect(stdout.value).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("continues Main and Node contexts across separate Host processes without replaying tool side effects", async () => {
    const base = await mkdtemp(join(tmpdir(), "navo-process-session-"));
    const home = join(base, "home");
    const root = join(base, "workspace");
    await mkdir(root);
    await writeFile(join(root, "report.md"), "# Report\nPersist once.\n");
    try {
      const before = await withRealHost({ NAVO_HOME: home, NAVO_MOCK_LLM_MODE: "handoff" }, async client => {
        const [project] = await collect(client.stream(projectCreateMethod, {
          name: "Session project", goal: "Resume original contexts", workspaceRoot: root,
        }));
        const projectId = project!.projectId;
        await collect(client.stream(projectTurnMethod, {
          projectId, requestId: "plan", text: "Main original question", target: { kind: "main" },
        }));
        const [detail] = await collect(client.stream(projectGetMethod, { projectId }));
        const nodeId = detail!.roadmap!.nodes[0]!.nodeId;
        await collect(client.stream(projectTurnMethod, {
          projectId, requestId: "work", text: "Node original question", target: { kind: "node", nodeId },
        }));
        const [mailbox] = await collect(client.stream(projectMailboxMethod, { projectId, afterSequence: 0, limit: 50 }));
        const [resources] = await collect(client.stream(projectResourcesMethod, { projectId }));
        return { projectId, nodeId, mailbox, resources };
      }, "scripts/host/mock.ts");
      const history = readSessionEvents(home);
      const ids = [...new Set(history.map(event => event.sessionId))];
      expect(ids).toHaveLength(2);
      const messages = new Map(ids.map(id => [id, history.filter(event => event.sessionId === id)
        .map(eventMessage).filter(message => message !== undefined)]));

      await withRealHost({ NAVO_HOME: home }, async client => {
        expect(readSessionEvents(home)).toEqual(history);
        const main = await collect(client.stream(projectTurnMethod, {
          projectId: before.projectId, requestId: "continue-main", text: "Continue Main", target: { kind: "main" },
        }));
        expect(main.at(-1)?.type).toBe("turn-completed");
        const node = await collect(client.stream(projectTurnMethod, {
          projectId: before.projectId, requestId: "continue-node", text: "Continue Node",
          target: { kind: "node", nodeId: before.nodeId },
        }));
        expect(node.at(-1)?.type).toBe("turn-completed");
        const [mailbox] = await collect(client.stream(projectMailboxMethod, { projectId: before.projectId, afterSequence: 0, limit: 50 }));
        const [resources] = await collect(client.stream(projectResourcesMethod, { projectId: before.projectId }));
        expect(mailbox).toEqual(before.mailbox);
        expect(resources).toEqual(before.resources);
      }, "scripts/host/mock.ts");
      const after = readSessionEvents(home);
      expect([...new Set(after.map(event => event.sessionId))]).toEqual(ids);
      for (const id of ids) {
        const events = after.filter(event => event.sessionId === id);
        const old = history.filter(event => event.sessionId === id);
        expect(events.slice(0, old.length)).toEqual(old);
        const request = events.findLast(event => event.type === "llm-requested");
        if (request?.type !== "llm-requested") throw new Error("Missing continued request");
        expect(request.data.messages.slice(1, -1)).toEqual(messages.get(id));
        expect(events.filter(event => event.type === "tool-call-requested"))
          .toEqual(old.filter(event => event.type === "tool-call-requested"));
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("continues standalone Sessions with tool records across separate Host processes", async () => {
    const home = await mkdtemp(join(tmpdir(), "navo-process-standalone-"));
    try {
      await withRealHost({ NAVO_HOME: home, NAVO_MOCK_LLM_MODE: "roadmap" }, async client => {
        await collect(client.stream(agentTurnV2Method, {
          sessionId: "plain", requestId: "original", text: "Original question",
        }));
      }, "scripts/host/mock.ts");
      const history = readSessionEvents(home);
      expect(history.some(event => event.type === "tool-call-requested")).toBe(true);
      expect(history.some(event => event.type === "tool-call-result")).toBe(true);
      const messages = history.map(eventMessage).filter(message => message !== undefined);
      await withRealHost({ NAVO_HOME: home }, async client => {
        expect(readSessionEvents(home)).toEqual(history);
        const continued = await collect(client.stream(agentTurnV2Method, {
          sessionId: "plain", requestId: "continued", text: "Continue",
        }));
        expect(continued.at(-1)?.type).toBe("turn-completed");
        const separate = await collect(client.stream(agentTurnV2Method, {
          sessionId: "other", requestId: "separate", text: "Separate question",
        }));
        expect(separate.at(-1)?.type).toBe("turn-completed");
      }, "scripts/host/mock.ts");
      const after = readSessionEvents(home);
      const continued = after.filter(event => event.sessionId === "plain");
      expect(continued.slice(0, history.length)).toEqual(history);
      const request = continued.findLast(event => event.type === "llm-requested");
      if (request?.type !== "llm-requested") throw new Error("Missing continued request");
      expect(request.data.messages.slice(0, -1)).toEqual(messages);
      expect(continued.filter(event => event.type === "tool-call-requested"))
        .toEqual(history.filter(event => event.type === "tool-call-requested"));
      const separate = after.filter(event => event.sessionId === "other").find(event => event.type === "llm-requested");
      if (separate?.type !== "llm-requested") throw new Error("Missing separate request");
      expect(separate.data.messages).toHaveLength(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("closes a Turn interrupted by Host termination before accepting another Turn", async () => {
    const home = await mkdtemp(join(tmpdir(), "navo-process-interrupted-"));
    const child = startHost("scripts/host/mock.ts", {
      NAVO_HOME: home,
      NAVO_MOCK_LLM_MODE: "hang",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    const iterator = client.stream(agentTurnV2Method, {
      sessionId: "interrupted-process",
      requestId: "interrupted-request",
      text: "Wait for a reply",
    });
    let terminated = false;
    try {
      await expect(iterator.next()).resolves.toMatchObject({ value: { type: "turn-started" } });
      await waitUntil(() => readSessionEvents(home).some(event => event.type === "llm-requested"));
      expect(readSessionEvents(home).some(event => event.type === "turn-ended")).toBe(false);
      expect(child.kill()).toBe(true);
      terminated = true;
      await exitOf(child);
    } finally {
      if (!terminated) {
        await client.dispose();
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await exitOf(child);
      }
    }

    try {
      await withRealHost({ NAVO_HOME: home, NAVO_MOCK_LLM_MODE: "completed" }, async next => {
        const repaired = readSessionEvents(home).filter(event => event.sessionId === "interrupted-process");
        expect(repaired.slice(-3)).toEqual([
          expect.objectContaining({ type: "error", data: expect.objectContaining({ failure: expect.objectContaining({ code: "interrupted" }) }) }),
          expect.objectContaining({ type: "step-ended", data: expect.objectContaining({ status: "failed" }) }),
          expect.objectContaining({ type: "turn-ended", data: expect.objectContaining({ status: "failed" }) }),
        ]);
        const events = await collect(next.stream(agentTurnV2Method, {
          sessionId: "interrupted-process",
          requestId: "continued-request",
          text: "Continue after restart",
        }));
        expect(events.at(-1)?.type).toBe("turn-completed");
      }, "scripts/host/mock.ts");
      const after = readSessionEvents(home).filter(event => event.sessionId === "interrupted-process");
      expect(after.filter(event => event.type === "error" && event.data.failure.code === "interrupted")).toHaveLength(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs the scripted Mock Host and exposes a deterministic crash for Main supervision", async () => {
    const child = startHost("scripts/host/mock.ts", {
      NAVO_MOCK_MODE: "crash",
      NAVO_MOCK_TEXT: "before-crash",
      NAVO_MOCK_CHUNK_CHARS: "64",
    });
    const stderr = capture(child.stderr);
    const stdout = capture(child.stdout);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    child.stdin.write(`${JSON.stringify({
      version: 1,
      type: "open",
      id: "rpc-crash",
      method: "agent.turn.v1",
      params: { sessionId: "session", requestId: "request", text: "hello" },
    })}\n`);

    await expect(exitOf(child)).resolves.toEqual({ code: 23, signal: null });
    const frames = stdout.value.trim().split("\n").map((line) => JSON.parse(line));
    expect(frames).toMatchObject([
      { type: "item", value: { type: "started" } },
      { type: "item", value: { type: "text-delta", text: "before-crash" } },
    ]);
  });

  it("exits promptly when Electron terminates the Host process", async () => {
    const child = startHost("scripts/host/mock.ts");
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));

    expect(child.kill()).toBe(true);
    const result = await exitOf(child);
    expect(result.code === 0 || result.signal === "SIGTERM").toBe(true);
  });

  it("serves v2 turns and sidecar commands through the real stdio boundary", async () => {
    const child = startHost("scripts/host/mock.ts", {
      NAVO_MOCK_LLM_MODE: "completed",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    const input = { sessionId: "process-session", requestId: "process-request", text: "hello" };
    try {
      const turn = await collect(client.stream(agentTurnV2Method, input));
      const started = turn.find((event) => event.type === "turn-started");
      expect(turn.map((event) => event.type)).toEqual([
        "turn-started",
        "step-started",
        "content-started",
        "content-delta",
        "content-completed",
        "step-completed",
        "turn-completed",
      ]);
      expect(started?.type === "turn-started" ? started.turnId : undefined).toBeTruthy();

      const command = await collect(client.stream(sessionCommandMethod, {
        sessionId: input.sessionId,
        commandId: "process-command",
        name: "hello",
        args: "",
      }));
      expect(command.map((event) => event.type)).toEqual([
        "command-started",
        "command-completed",
      ]);
      expect(command[1]).toMatchObject({
        summary: "hello",
        anchor: { kind: "turn", turnId: started?.type === "turn-started" ? started.turnId : "" },
      });
    } finally {
      await client.dispose();
    }
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });

  it("creates and reads a Project through the real stdio boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "navo-process-project-"));
    const child = startHost("scripts/host/mock.ts");
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    try {
      const [created] = await collect(client.stream(projectCreateMethod, {
        name: "Process project", goal: "Cross the stdio boundary", workspaceRoot: root,
      }));
      const [detail] = await collect(client.stream(projectGetMethod, { projectId: created!.projectId }));
      expect(detail).toMatchObject({ project: { name: "Process project" }, roadmap: null });
    } finally {
      await client.dispose();
      await exitOf(child);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("forwards a model failure as one terminal v2 event", async () => {
    const child = startHost("scripts/host/mock.ts", {
      NAVO_MOCK_LLM_MODE: "failed",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    try {
      const events = await collect(client.stream(agentTurnV2Method, {
        sessionId: "process-session",
        requestId: "process-request",
        text: "fail",
      }));
      expect(events.at(-1)).toMatchObject({
        type: "turn-failed",
        failure: {
          code: "stream-output-interrupted",
          message: "Model stream failed after publishing live content.",
        },
      });
      expect(events.filter((event) => event.type === "turn-failed")).toHaveLength(1);
    } finally {
      await client.dispose();
    }
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });

  it("cancels a running v2 turn in the child process", async () => {
    const child = startHost("scripts/host/mock.ts", {
      NAVO_MOCK_LLM_MODE: "hang",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    const controller = new AbortController();
    const iterator = client.stream(agentTurnV2Method, {
      sessionId: "process-session",
      requestId: "process-request",
      text: "wait",
    }, { signal: controller.signal });
    try {
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "turn-started" },
      });
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
    } finally {
      await client.dispose();
    }
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });
});

if (mode !== "normal") {
  registerAssetCrashTests({ startHost, exitOf, capture, collect, withRealHost },
    mode === "crash-pr" ? { points: ["D6", "D8"], restarts: 1 } : undefined);
}

function readSessionEvents(home: string): SessionEvent[] {
  const db = new DatabaseSync(join(home, "navo.db"));
  try {
    return db.prepare("SELECT payload FROM events WHERE domain = 'session' ORDER BY owner_id, seq").all()
      .map(row => JSON.parse(String(row.payload)) as SessionEvent);
  } finally {
    db.close();
  }
}

async function withRealHost<T>(
  env: Readonly<Record<string, string>>,
  use: (client: StreamRpcClient) => Promise<T>,
  entry: "src/host/main.ts" | "scripts/host/mock.ts" = "src/host/main.ts",
  onPhase?: (phase: HostProcessPhase) => void,
): Promise<T> {
  const child = startHost(entry, env);
  const stderr = capture(child.stderr);
  const ready = entry === "src/host/main.ts" ? "[kernel-host] ready" : "[mock-kernel-host] ready";
  await waitUntil(() => stderr.value.includes(ready));
  onPhase?.("ready");
  const client = new StreamRpcClient(new ChildRpcTransport(child));
  let result: T;
  try {
    result = await use(client);
    onPhase?.("assertions");
  } finally {
    await client.dispose();
    onPhase?.("dispose");
  }
  await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  onPhase?.("exit");
  return result;
}

class ChildRpcTransport implements RpcClientTransport {
  readonly incoming: AsyncIterable<unknown>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.incoming = readFrames(child.stdout);
  }

  send(frame: RpcClientFrame): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(encodeNdjson(frame), "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    if (this.child.stdin.writableEnded) return Promise.resolve();
    return new Promise<void>((resolve) => this.child.stdin.end(resolve));
  }
}

async function* readFrames(stream: NodeJS.ReadableStream): AsyncGenerator<unknown> {
  const decoder = new NdjsonDecoder(parseRpcServerFrame);
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Uint8Array;
    yield* decoder.push(bytes);
  }
  yield* decoder.finish();
}

async function collect<TValue>(stream: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

function startHost(
  entry: string,
  extraEnv: Readonly<Record<string, string>> = {},
  args: readonly string[] = [],
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function capture(stream: NodeJS.ReadableStream): { readonly value: string } {
  let value = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => { value += chunk; });
  return {
    get value() {
      return value;
    },
  };
}

function exitOf(
  child: ChildProcessWithoutNullStreams,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Host process did not exit within ${PROCESS_WAIT_MS} ms.`));
    }, PROCESS_WAIT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + PROCESS_WAIT_MS;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Host process did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
