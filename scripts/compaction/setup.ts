import type { Context } from "cordis";

import { createApp } from "../../src/app.js";
import { createNodeId } from "../../src/brand/ids.js";
import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { resolveAcceptanceHostConfig, createAcceptanceAdapter } from "../acceptance.js";
import { acceptanceModel, MAX_MODEL_RETRIES, MAX_STEPS, PROJECT_GOAL } from "./config.js";
import { nodeAObjective, nodeBObjective } from "./protocol.js";
import { createGuardedAdapter, type RequestLedger } from "./request.js";
import { publishReviewEvidence, reviewInstructions, type ReviewEvidence } from "./evidence.js";
import type { Dataset } from "./data.js";

export type AcceptanceConfig = ReturnType<typeof resolveAcceptanceHostConfig>;

export interface ProjectNodes {
  readonly projectId: ProjectId;
  readonly nodeAId: NodeId;
  readonly nodeBId: NodeId;
  readonly reviewEvidence: ReviewEvidence;
}

export async function openApp(
  database: string,
  config: AcceptanceConfig | undefined,
  ledger: RequestLedger,
  onExhausted: () => void,
): Promise<Context> {
  const app = await createApp({
    storage: { path: database },
    node: { session: { model: acceptanceModel() } },
    runtime: { maxSteps: MAX_STEPS, maxModelRetries: MAX_MODEL_RETRIES },
    tools: {
      file: {
        resolveFileEnvironment: async () => {
          throw new Error("File access requires a Project-bound Session.");
        },
      },
    },
  });
  if (config !== undefined) {
    app.llm.registerAdapter(
      config.provider,
      createGuardedAdapter(createAcceptanceAdapter(config), ledger, onExhausted),
    );
  }
  return app;
}

export async function createProject(app: Context, workspace: string, dataset: Dataset): Promise<ProjectNodes> {
  const project = app.projects.create({ name: "F12.7 synthetic ledger acceptance", goal: PROJECT_GOAL });
  await app.projectWorkspaces.create(project.id, workspace);
  const reviewEvidence = await publishReviewEvidence(app, project.id, workspace, dataset);
  const a = nodeAObjective();
  const b = nodeBObjective();
  const nodeA = app.nodes.create({ projectId: project.id, objective: {
    ...a, description: `${a.description} ${reviewInstructions(reviewEvidence, false)}`,
  } });
  const nodeB = app.nodes.create({ projectId: project.id, objective: {
    ...b, description: `${b.description} ${reviewInstructions(reviewEvidence, true)}`,
  } });
  app.roadmaps.create({
    definition: {
      projectId: project.id,
      nodes: [nodeA.node.id, nodeB.node.id],
      edges: [{ from: nodeA.node.id, to: nodeB.node.id }],
    },
    reason: "Two dependent synthetic ledger Nodes approved for acceptance.",
  });
  return Object.freeze({ projectId: project.id, nodeAId: nodeA.node.id, nodeBId: nodeB.node.id, reviewEvidence });
}

export function abortActive(app: Context, projectId: ProjectId): string | null {
  const errors: string[] = [];
  try {
    const run = app.autoRun.get(projectId);
    if (run?.currentTarget?.kind === "node") {
      app.projectRuntime.stopNode(projectId, createNodeId(run.currentTarget.nodeId));
    } else if (run?.currentTarget?.kind === "main") {
      app.projectRuntime.stopMain(projectId);
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    app.autoRun.pause(projectId);
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors.length === 0 ? null : errors.join("; ");
}
