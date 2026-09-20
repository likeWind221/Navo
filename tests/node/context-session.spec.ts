import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { GenerateRequest } from "../../src/llm/types.js";
import { modelResponse } from "../helpers/runtime.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })));
});

function systemText(request: GenerateRequest): string {
  const block = request.messages[0]?.content[0];
  if (request.messages[0]?.role !== "system" || block?.type !== "text") {
    throw new Error("Expected Node system context.");
  }
  return block.text;
}

describe("Node Turn Resource context integration", () => {
  it("refreshes visible Resource metadata only when the next Human-started Turn begins", async () => {
    const root = await mkdtemp(join(tmpdir(), "navo-node-context-session-"));
    roots.push(root);
    await writeFile(join(root, "handoff.md"), "resource body stays out of prompt\n", "utf8");

    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "node-test" } } },
    });
    apps.push(app);
    const adapter = new MockLLMAdapter([
      modelResponse([{ type: "text", text: "first turn" }]),
      modelResponse([{ type: "text", text: "second turn" }]),
    ]);
    app.llm.registerAdapter("mock", adapter);

    const project = app.projects.create({ goal: "Use a handed-off Resource" });
    await app.projectWorkspaces.create(project.id, root);
    const node = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Consume handoff",
        description: "Use the Resource when it becomes available",
        acceptanceCriteria: ["Inspect the authorized Resource"],
      },
    });
    app.nodes.unlock(node.node.id, "Ready");
    const resource = await app.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "handoff.md",
      name: "Handoff evidence",
      description: "Metadata visible after Main grants access",
      type: "text/markdown",
    });

    await app.nodeSessions.start({
      nodeId: node.node.id,
      text: "Check what is currently available.",
    });
    expect(adapter.requests).toHaveLength(1);
    expect(systemText(adapter.requests[0]!)).not.toContain(String(resource.id));

    const eventsBeforeGrant = app.nodes.getEvents(node.node.id).length;
    app.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: resource.revision,
      access: { kind: "shared", nodeIds: [node.node.id] },
    });
    expect(adapter.requests).toHaveLength(1);
    expect(app.nodes.getEvents(node.node.id)).toHaveLength(eventsBeforeGrant);

    await app.nodeSessions.start({
      nodeId: node.node.id,
      text: "Check again after the human starts this Turn.",
    });
    expect(adapter.requests).toHaveLength(2);
    const second = systemText(adapter.requests[1]!);
    expect(second).toContain(String(resource.id));
    expect(second).toContain("Handoff evidence");
    expect(second).toContain("ownedByCurrentAgent");
    expect(second).not.toContain("resource body stays out of prompt");
    expect(second).not.toContain("handoff.md");
  });
});
