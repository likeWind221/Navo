import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Context } from "cordis";

import { createMessageId } from "../../src/brand/ids.js";
import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { resolveContextBudget } from "../../src/context/budget.js";
import { estimateRequest } from "../../src/context/meter.js";
import type { Message } from "../../src/llm/types.js";
import { NodeTurnContextBuilder } from "../../src/node/context.js";
import { createNodeAgentProfile } from "../../src/node/profile.js";
import { createMainAgentProfile } from "../../src/project/profile.js";
import {
  AUTO_COMPACT_LIMIT,
  BASELINE_LIMIT,
  MAX_DATA_TOKENS,
  MIN_DATA_TOKENS,
  acceptanceModel,
} from "./config.js";
import type { Dataset } from "./data.js";

export interface FilePreflight {
  readonly path: string;
  readonly lines: number;
  readonly chars: number;
  readonly tokens: number;
  readonly readCost: number;
  readonly readBudget: number;
}

export interface PreflightReport {
  readonly projectId: string;
  readonly mainSessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly autoCompactLimit: number;
  readonly contextWindow: null;
  readonly thresholdTokens: number;
  readonly retainTokens: number;
  readonly nodeBaselineTokens: number;
  readonly mainBaselineTokens: number;
  readonly baselineLimit: number;
  readonly dataTokens: number;
  readonly dataTokenRange: readonly [number, number];
  readonly files: readonly FilePreflight[];
  readonly overflowInjected: false;
  readonly serverCapacityValidated: false;
}

export function runPreflight(
  app: Context,
  projectId: ProjectId,
  nodeAId: NodeId,
  dataset: Dataset,
): PreflightReport {
  const node = app.nodes.get(nodeAId);
  assert(node !== undefined, "Node A is missing during preflight.");
  const nodeProfile = createNodeAgentProfile(new NodeTurnContextBuilder(app).build(node), { allowFileRead: true });
  const nodeBaseline = estimateRequest({
    messages: [
      message("system", nodeProfile.systemPrompt),
      message("user", "Start working on this Node objective and its acceptance criteria."),
    ],
    tools: app.tools.schemas(nodeProfile.toolNames),
  });
  const project = app.projects.get(projectId);
  assert(project !== undefined, "Project is missing during preflight.");
  const mainProfile = createMainAgentProfile(project, true);
  const mainBaseline = estimateRequest({
    messages: [
      message("system", mainProfile.systemPrompt),
      message("user", "Automatically review this Node submission against its acceptance criteria."),
    ],
    tools: app.tools.schemas(mainProfile.toolNames),
  });
  const budget = resolveContextBudget(acceptanceModel());
  assert(budget.kind === "enabled", "The fixed compaction budget must be enabled.");
  assert.equal(budget.contextWindow, undefined, "Acceptance must not invent a provider context window.");
  assert.equal(budget.thresholdTokens, AUTO_COMPACT_LIMIT, "The pressure threshold must equal the fixed limit.");
  assert.equal(budget.retainTokens, Math.floor(AUTO_COMPACT_LIMIT * 0.2), "The retain budget changed unexpectedly.");
  assert(nodeBaseline <= BASELINE_LIMIT, `Node baseline ${nodeBaseline} exceeds ${BASELINE_LIMIT} tokens.`);
  assert(mainBaseline <= BASELINE_LIMIT, `Main baseline ${mainBaseline} exceeds ${BASELINE_LIMIT} tokens.`);
  for (const file of dataset.files) {
    assert(file.readCost <= file.readBudget, `${file.path} needs pagination: ${file.readCost} > ${file.readBudget}.`);
  }
  assert(
    dataset.tokens >= MIN_DATA_TOKENS && dataset.tokens <= MAX_DATA_TOKENS,
    `Synthetic data uses ${dataset.tokens} tokens, outside ${MIN_DATA_TOKENS}..${MAX_DATA_TOKENS}.`,
  );
  return Object.freeze({
    projectId: String(project.id),
    mainSessionId: String(project.mainSessionId),
    provider: acceptanceModel().provider,
    model: acceptanceModel().model,
    autoCompactLimit: AUTO_COMPACT_LIMIT,
    contextWindow: null,
    thresholdTokens: budget.thresholdTokens,
    retainTokens: budget.retainTokens,
    nodeBaselineTokens: nodeBaseline,
    mainBaselineTokens: mainBaseline,
    baselineLimit: BASELINE_LIMIT,
    dataTokens: dataset.tokens,
    dataTokenRange: Object.freeze([MIN_DATA_TOKENS, MAX_DATA_TOKENS] as const),
    files: Object.freeze(dataset.files.map(file => Object.freeze({
      path: file.path,
      lines: file.lines,
      chars: file.chars,
      tokens: file.tokens,
      readCost: file.readCost,
      readBudget: file.readBudget,
    }))),
    overflowInjected: false,
    serverCapacityValidated: false,
  });
}

function message(role: "system" | "user", text: string): Message {
  return Object.freeze({
    id: createMessageId(randomUUID()),
    role,
    content: [{ type: "text" as const, text }],
  });
}
