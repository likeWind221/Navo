import type { Context } from "cordis";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createToolCallId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { createFileEnvironment } from "../../src/tools/builtins/file/path.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { modelResponse } from "../helpers/runtime.js";
import { MEMORY_STORAGE } from "../helpers/storage.js";

let app: Context | undefined;

afterEach(async () => {
  await app?.fiber.dispose();
  app = undefined;
});

describe("Project Agent application wiring", () => {
  it("lets Main and Node write files in their bound project workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "navo-project-files-"));
    try {
      app = await createApp({
        storage: MEMORY_STORAGE,
        node: { session: { model: { provider: "mock", model: "agent-test" } } },
        tools: { file: { resolveFileEnvironment: () => createFileEnvironment(root) } },
      });
      const write = (id: string, path: string) => modelResponse([{
        type: "tool-call", id: createToolCallId(id), name: "write", arguments: JSON.stringify({ path, content: id }),
      }], "tool-calls");
      const adapter = new MockLLMAdapter([
        write("main-written", "main.txt"), modelResponse([{ type: "text", text: "Main done" }]),
        write("node-written", "node.txt"), modelResponse([{ type: "text", text: "Node done" }]),
      ]);
      app.llm.registerAdapter("mock", adapter);
      const project = app.projects.create({ name: "Project", goal: "Write files" });
      await app.projectWorkspaces.create(project.id, root);
      const created = app.nodes.create({ projectId: project.id, objective: {
        title: "Write a file", description: "Create a file", acceptanceCriteria: ["File exists"],
      } });
      const node = app.nodes.unlock(created.node.id, "Ready");
      await app.mainSessions.sendMessage({ projectId: project.id, text: "Write main file" });
      await app.nodeSessions.start({ nodeId: node.node.id, text: "Write node file" });
      expect(await readFile(join(root, "main.txt"), "utf8")).toBe("main-written");
      expect(await readFile(join(root, "node.txt"), "utf8")).toBe("node-written");
      for (const request of [adapter.requests[0], adapter.requests[2]]) {
        expect(request?.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(["read", "write", "edit", "shell"]));
      }
    } finally {
      await app?.fiber.dispose();
      app = undefined;
      await rm(root, { recursive: true, force: true });
    }
  });
  it("runs Main and Node profiles through the same AgentRuntime", async () => {
    app = await createApp({
      storage: MEMORY_STORAGE,
      node: { session: { model: { provider: "mock", model: "agent-test" } } },
      tools: { search: { adapter: new MockSearchAdapter([]) } },
    });
    const adapter = new MockLLMAdapter([
      modelResponse([{ type: "text", text: "main done" }]),
      modelResponse([{ type: "text", text: "node done" }]),
    ]);
    app.llm.registerAdapter("mock", adapter);
    const project = app.projects.create({ name: "Project", goal: "Ship the Project" });
    const created = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Implement the Node",
        description: "Complete one isolated work unit",
        acceptanceCriteria: ["Node result is concrete"],
      },
    });
    const node = app.nodes.unlock(created.node.id, "Ready");

    await app.mainSessions.sendMessage({ projectId: project.id, text: "Plan globally" });
    await app.nodeSessions.start({ nodeId: node.node.id, text: "Execute locally" });

    expect(app.agentRuntime).toBeDefined();
    expect(adapter.requests).toHaveLength(2);
    expect(JSON.stringify(adapter.requests[0]?.messages[0])).toContain("Main Agent");
    expect(JSON.stringify(adapter.requests[0]?.turnContext)).toContain("Ship the Project");
    expect(JSON.stringify(adapter.requests[1]?.messages[0])).toContain("Node Agent");
    expect(JSON.stringify(adapter.requests[1]?.turnContext)).toContain("Implement the Node");
    expect(JSON.stringify(adapter.requests[1]?.turnContext)).toContain("Ship the Project");
  });

  it("exposes read to Main when the host mounts file tools", async () => {
    app = await createApp({
      storage: MEMORY_STORAGE,
      node: { session: { model: { provider: "mock", model: "agent-test" } } },
      tools: { file: { resolveFileEnvironment: async () => { throw new Error("Project binding required"); } } },
    });
    const adapter = new MockLLMAdapter([
      modelResponse([{ type: "text", text: "main done" }]),
    ]);
    app.llm.registerAdapter("mock", adapter);
    const project = app.projects.create({ name: "Project", goal: "Read a workspace file" });

    await app.mainSessions.sendMessage({ projectId: project.id, text: "Inspect the workspace" });

    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toContain("read");
    expect(JSON.stringify(adapter.requests[0]?.messages[0])).toContain("use read to inspect its actual contents");
  });
});
