import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";

import { createApp } from "../src/app.js";
import type { ProjectId } from "../src/brand/ids.js";
import { createAcceptanceAdapter, resolveAcceptanceHostConfig } from "./acceptance.js";
import { captureTurn, projectState, writeEvidence } from "./longterm/evidence.js";

const MODEL = "gpt-6-sol";

async function main(): Promise<void> {
  const config = resolveAcceptanceHostConfig(process.env, MODEL);
  const root = await mkdtemp(join(tmpdir(), "navo-real-f114-workspace-"));
  const data = await mkdtemp(join(tmpdir(), "navo-real-f114-db-"));
  const evidenceDir = process.env.NAVO_EVIDENCE_DIR?.trim()
    || join(tmpdir(), `navo-autorun-evidence-${Date.now()}`);

  let app = await open(config, join(data, "navo.db"));
  let projectId: ProjectId | undefined;

  try {
    const project = app.projects.create({
      name: "AutoRun acceptance",
      goal: "Complete the approved work plan without internet research. Submit each Node for Main review and finish the Project.",
    });
    projectId = project.id;
    await app.projectWorkspaces.create(projectId, root);
    await writeFile(join(root, "input.txt"), "Synthetic acceptance input: 2 + 3 = 5. Source: Human-provided fixture. No external claims.\n");
    const input = await app.resources.publish({
      projectId,
      owner: { kind: "main" },
      sourceRef: "input.txt",
      name: "Acceptance input",
      description: "Human-supplied synthetic result for both Nodes to read and summarize.",
      type: "text/plain",
    });
    app.resources.setAccess({
      projectId,
      actor: { kind: "main" },
      resourceId: input.id,
      expectedRevision: input.revision,
      access: { kind: "public" },
    });

    const first = app.nodes.create({
      projectId,
      objective: {
        title: "Prepare the result",
        description: "Read the Acceptance input Resource, report its calculation and source to Main, then submit_completion.",
        acceptanceCriteria: ["The submitted result reports 2 + 3 = 5 and cites the Human-provided fixture."],
      },
    });
    const second = app.nodes.create({
      projectId,
      objective: {
        title: "Summarize the result",
        description: "After the upstream Node is reviewed, read the shared Acceptance input Resource and submit a concise summary of its calculation and source. The shared Resource is the complete input; no additional upstream artifact is required.",
        acceptanceCriteria: ["The submitted summary reports 2 + 3 = 5 and cites the Human-provided fixture."],
      },
    });
    app.roadmaps.create({
      definition: {
        projectId,
        nodes: [first.node.id, second.node.id],
        edges: [{ from: first.node.id, to: second.node.id }],
      },
      reason: "Human-approved acceptance plan",
    });

    const result = await app.autoRun.start(projectId);
    assert.equal(result.status, "completed", `AutoRun stopped with ${result.reason ?? "no reason"}`);
    assert.equal(result.reason, "roadmap-complete");
    assert.equal(app.nodes.get(first.node.id)?.status, "completing");
    assert.equal(app.nodes.get(second.node.id)?.status, "completing");
    for (const nodeId of [first.node.id, second.node.id]) {
      assert.equal(app.nodes.get(nodeId)?.lastReview?.decision, "complete");
    }

    await writeEvidence(evidenceDir, "result", {
      model: config.agent.model.model,
      snapshot: result,
      ...evidence(app, projectId),
    });
    process.stdout.write(JSON.stringify({ outcome: "passed", evidenceDir, snapshot: result }) + "\n");
  } catch (error: unknown) {
    await writeEvidence(evidenceDir, "failure", {
      model: config.agent.model.model,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
      ...(projectId === undefined ? { state: null } : evidence(app, projectId)),
    });
    throw error;
  } finally {
    await app.fiber.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  }
}

function evidence(app: Context, projectId: ProjectId) {
  const project = app.projects.get(projectId)!;
  const sessions = [project.mainSessionId, ...app.nodes.getByProject(projectId)
    .flatMap(node => node.sessionId === undefined ? [] : [node.sessionId])];
  return {
    state: projectState(app, projectId),
    turns: sessions.flatMap(sessionId => app.sessions.getEvents(sessionId)
      .flatMap(event => event.type === "turn-started"
        ? [captureTurn(app, projectId, sessionId, event.data.turnId).record] : [])),
  };
}

async function open(config: ReturnType<typeof resolveAcceptanceHostConfig>, database: string): Promise<Context> {
  const app = await createApp({
    storage: { path: database },
    node: { session: { model: config.agent.model } },
    runtime: { maxSteps: 16, maxModelRetries: 0 },
  });
  app.llm.registerAdapter(config.provider, createAcceptanceAdapter(config));
  return app;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
