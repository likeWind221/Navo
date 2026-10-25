import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Context } from "cordis";

import { turnContextMessage } from "../../src/context/turn.js";
import { createProjectTurnContext } from "../../src/project/context.js";
import { createMessageId, createSessionId } from "../../src/brand/ids.js";
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

export interface CapabilityCheck {
  readonly required: readonly string[];
  readonly declared: readonly string[];
  readonly available: readonly string[];
  readonly missing: readonly string[];
}

export interface CapabilityReport {
  readonly nodeA: CapabilityCheck;
  readonly nodeB: CapabilityCheck;
  readonly mainReview: CapabilityCheck;
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
  readonly capabilities: CapabilityReport;
  readonly overflowInjected: false;
  readonly serverCapacityValidated: false;
}

const NODE_REQUIRED = ["read", "submit_completion"] as const;
const MAIN_REVIEW_REQUIRED = ["read_node_turn", "submit_review", "fetch_resource"] as const;

export function runPreflight(
  app: Context,
  projectId: ProjectId,
  nodeAId: NodeId,
  nodeBId: NodeId,
  dataset: Dataset,
): PreflightReport {
  const nodeA = app.nodes.get(nodeAId);
  assert(nodeA !== undefined, "Node A is missing during preflight.");
  const nodeB = app.nodes.get(nodeBId);
  assert(nodeB !== undefined, "Node B is missing during preflight.");
  const nodeAProfile = createNodeAgentProfile({ allowFileRead: true });
  const nodeBProfile = createNodeAgentProfile({ allowFileRead: true });
  const allSchemas = app.tools.schemas();
  const nodeASchemas = allSchemas.filter(schema => nodeAProfile.toolNames.includes(schema.name));
  const nodeBSchemas = allSchemas.filter(schema => nodeBProfile.toolNames.includes(schema.name));
  const nodeACapabilities = capabilityCheck(NODE_REQUIRED, nodeAProfile.toolNames, nodeASchemas);
  const nodeBCapabilities = capabilityCheck(NODE_REQUIRED, nodeBProfile.toolNames, nodeBSchemas);
  const nodeContext = new NodeTurnContextBuilder(app).build(nodeA);
  const nodeBaseline = estimateRequest({
    turnContext: turnContextMessage({ sections: [
      { kind: "runtime-state", data: { projectGoal: nodeContext.projectGoal, status: nodeContext.status,
        objective: { ...nodeContext.objective, acceptanceCriteria: [...nodeContext.objective.acceptanceCriteria] } } },
      { kind: "resource-catalog", data: nodeContext.resources.map(resource => ({ ...resource })) },
    ] }, createSessionId("preflight")),
    messages: [
      message("system", nodeAProfile.systemPrompt),
      message("user", "Start working on this Node objective and its acceptance criteria."),
    ],
    tools: nodeASchemas,
  });
  const project = app.projects.get(projectId);
  assert(project !== undefined, "Project is missing during preflight.");
  const mainProfile = createMainAgentProfile(true);
  const mainSchemas = allSchemas.filter(schema => mainProfile.toolNames.includes(schema.name));
  const mainCapabilities = capabilityCheck(
    MAIN_REVIEW_REQUIRED,
    mainProfile.toolNames,
    mainSchemas,
  );
  const mainBaseline = estimateRequest({
    turnContext: turnContextMessage(createProjectTurnContext(app, project.mainSessionId, { observe: false }).build(), project.mainSessionId),
    messages: [
      message("system", mainProfile.systemPrompt),
      message("user", "Automatically review this Node submission against its acceptance criteria."),
    ],
    tools: mainSchemas,
  });
  assertCapabilities("Node A", nodeACapabilities);
  assertCapabilities("Node B", nodeBCapabilities);
  assertCapabilities("Main review", mainCapabilities);
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
    capabilities: Object.freeze({
      nodeA: nodeACapabilities,
      nodeB: nodeBCapabilities,
      mainReview: mainCapabilities,
    }),
    overflowInjected: false,
    serverCapacityValidated: false,
  });
}

function capabilityCheck(
  required: readonly string[],
  declared: readonly string[],
  schemas: readonly { readonly name: string }[],
): CapabilityCheck {
  const available = schemas.map(schema => schema.name);
  const missing = required.filter(name => !declared.includes(name) || !available.includes(name));
  return Object.freeze({
    required: Object.freeze([...required]),
    declared: Object.freeze([...declared]),
    available: Object.freeze(available),
    missing: Object.freeze([...missing]),
  });
}

function assertCapabilities(label: string, check: CapabilityCheck): void {
  assert(
    check.missing.length === 0,
    `${label} is missing required capabilities: ${check.missing.join(", ")}. Declared: ${check.declared.join(", ")}. Available: ${check.available.join(", ")}.`,
  );
}

function message(role: "system" | "user", text: string): Message {
  return Object.freeze({
    id: createMessageId(randomUUID()),
    role,
    content: [{ type: "text" as const, text }],
  });
}
