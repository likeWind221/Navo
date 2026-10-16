import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";

import { createApp } from "../src/app.js";
import type { ProjectId } from "../src/brand/ids.js";
import { createAcceptanceAdapter, resolveAcceptanceHostConfig } from "./acceptance.js";
import { projectState, writeEvidence } from "./longterm/evidence.js";

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

    const first = app.nodes.create({
      projectId,
      objective: {
        title: "Prepare the result",
        description: "Produce a concise result from the supplied workspace and submit it for review.",
        acceptanceCriteria: ["A result is submitted for Main review."],
      },
    });
    const second = app.nodes.create({
      projectId,
      objective: {
        title: "Summarize the result",
        description: "Read the completed upstream work through the available Project context and submit a concise summary.",
        acceptanceCriteria: ["A summary is submitted for Main review."],
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
    assert.equal(app.nodes.get(second.node.id)?.status, "completing");

    await writeEvidence(evidenceDir, "result", {
      model: config.agent.model.model,
      snapshot: result,
      state: projectState(app, projectId),
    });
    process.stdout.write(JSON.stringify({ outcome: "passed", evidenceDir, snapshot: result }) + "\n");
  } catch (error: unknown) {
    await writeEvidence(evidenceDir, "failure", {
      model: config.agent.model.model,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
      state: projectId === undefined ? null : projectState(app, projectId),
    });
    throw error;
  } finally {
    await app.fiber.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  }
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
