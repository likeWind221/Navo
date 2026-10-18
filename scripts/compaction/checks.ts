import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { MIN_PRESSURE_COMPACTIONS } from "./config.js";
import type { Dataset } from "./data.js";
import {
  FINAL_PATH,
  SPOT_CHECK_BATCHES,
  SUMMARY_PATH,
  validateFinal,
  validateSummary,
  type Validation,
} from "./protocol.js";
import {
  maxParallelReadCalls,
  type CompactionRecord,
} from "./events.js";
import type { TurnSummary } from "./turns.js";

export interface ArtifactReport {
  readonly summary: Validation;
  readonly final: Validation;
  readonly summaryResourceId: string;
  readonly finalResourceId: string;
  readonly summaryPublishedMatches: boolean;
  readonly finalPublishedMatches: boolean;
  readonly summaryBytes: number;
  readonly finalBytes: number;
}

export function assertCompactions(records: readonly CompactionRecord[], label: string): readonly CompactionRecord[] {
  const completed = records.filter(record => record.status === "completed");
  assert(
    completed.length >= MIN_PRESSURE_COMPACTIONS,
    `${label}: expected at least ${MIN_PRESSURE_COMPACTIONS} successful compactions, found ${completed.length}.`,
  );
  for (const record of records) {
    assert.equal(record.trigger, "pressure", `${label}: compaction ${record.compactionId} used trigger ${record.trigger}.`);
  }
  for (const record of completed) {
    assert.notEqual(record.checkpointMessageId, null, `${label}: ${record.compactionId} has no checkpoint.`);
    assert.notEqual(record.checkpointSequence, null, `${label}: ${record.compactionId} has no checkpoint sequence.`);
    assert.equal(typeof record.beforeTokens, "number", `${label}: ${record.compactionId} has no beforeTokens.`);
    assert.equal(typeof record.afterTokens, "number", `${label}: ${record.compactionId} has no afterTokens.`);
    assert.equal(typeof record.summaryTokens, "number", `${label}: ${record.compactionId} has no summaryTokens.`);
    assert(record.beforeTokens! > record.afterTokens!, `${label}: ${record.compactionId} did not reduce context.`);
    assert.equal(record.savings, record.beforeTokens! - record.afterTokens!);
    assert(record.summaryTokens! > 0, `${label}: ${record.compactionId} used no summary tokens.`);
    assert(record.laterTaskRequests.length > 0, `${label}: ${record.compactionId} was not reused by a task request.`);
    assert(record.generationAfter >= 1, `${label}: ${record.compactionId} has no surface generation.`);
  }
  return completed;
}

export async function assertArtifacts(
  app: Context,
  workspace: string,
  projectId: ProjectId,
  nodeAId: NodeId,
  nodeBId: NodeId,
  dataset: Dataset,
): Promise<ArtifactReport> {
  const summaryText = await readFile(join(workspace, SUMMARY_PATH), "utf8");
  const finalText = await readFile(join(workspace, FINAL_PATH), "utf8");
  const summary = validateSummary(summaryText, dataset.expected);
  const final = validateFinal(finalText, dataset.expected);
  assert(summary.ok, `${SUMMARY_PATH} failed validation: ${summary.errors.join("; ")}`);
  assert(final.ok, `${FINAL_PATH} failed validation: ${final.errors.join("; ")}`);
  const summaryResource = findResource(app, projectId, nodeAId, "summary.json");
  const finalResource = findResource(app, projectId, nodeBId, "final.json");
  assert(summaryResource !== undefined, "Node A did not publish summary.json as a Resource.");
  assert(finalResource !== undefined, "Node B did not publish final.json as a Resource.");
  const summaryTarget = await app.resources.resolveEntry(projectId, summaryResource.id);
  const finalTarget = await app.resources.resolveEntry(projectId, finalResource.id);
  const summaryPublished = await readFile(summaryTarget.path, "utf8");
  const finalPublished = await readFile(finalTarget.path, "utf8");
  assert.equal(summaryPublished, summaryText, "Published summary Resource content differs from out/summary.json.");
  assert.equal(finalPublished, finalText, "Published final Resource content differs from out/final.json.");
  const nodeA = app.nodes.get(nodeAId);
  const nodeB = app.nodes.get(nodeBId);
  assert(nodeA?.submission !== undefined, "Node A has no submission.");
  assert(nodeB?.submission !== undefined, "Node B has no submission.");
  assert(
    nodeA.submission.resourceIds.map(String).includes(String(summaryResource.id)),
    "Node A submission does not cite the published summary Resource.",
  );
  assert(
    nodeB.submission.resourceIds.map(String).includes(String(finalResource.id)),
    "Node B submission does not cite the published final Resource.",
  );
  return Object.freeze({
    summary,
    final,
    summaryResourceId: String(summaryResource.id),
    finalResourceId: String(finalResource.id),
    summaryPublishedMatches: true,
    finalPublishedMatches: true,
    summaryBytes: Buffer.byteLength(summaryText, "utf8"),
    finalBytes: Buffer.byteLength(finalText, "utf8"),
  });
}

export function assertCompletion(
  app: Context,
  projectId: ProjectId,
  nodeAId: NodeId,
  nodeBId: NodeId,
  turns: readonly TurnSummary[],
  dataset: Dataset,
  artifacts: ArtifactReport,
): void {
  const project = app.projects.get(projectId);
  assert(project !== undefined, "Project is missing at completion.");
  const mainSession = String(project.mainSessionId);
  for (const nodeId of [nodeAId, nodeBId]) {
    const node = app.nodes.get(nodeId);
    assert(node !== undefined, `Node ${nodeId} is missing at completion.`);
    assert.equal(node.status, "completing", `Node ${nodeId} is ${node.status}, not completing.`);
    assert.equal(node.lastReview?.decision, "complete", `Node ${nodeId} was not reviewed complete.`);
    assert(node.submission !== undefined, `Node ${nodeId} has no submission.`);
    assert(node.submission.criteria.every(check => check.satisfied), `Node ${nodeId} has an unsatisfied criterion.`);
    assert.equal(node.submission.remaining.length, 0, `Node ${nodeId} reported remaining work.`);
    assert(node.lastReview?.turnId !== undefined, `Node ${nodeId} review has no turn.`);
    const review = turns.find(turn => (
      turn.sessionId === mainSession && turn.turnId === String(node.lastReview!.turnId)
    ));
    assert(review !== undefined, `Main review turn for Node ${nodeId} was not captured.`);
    assert(
      review.submitReviewDecisions.includes("complete"),
      `Main review for Node ${nodeId} did not submit a complete decision.`,
    );
  }
  const nodeA = app.nodes.get(nodeAId)!;
  const nodeB = app.nodes.get(nodeBId)!;
  assert(nodeA.sessionId !== undefined && nodeB.sessionId !== undefined, "A Node Session is missing.");
  const aTurns = turns.filter(turn => turn.sessionId === String(nodeA.sessionId));
  const bTurns = turns.filter(turn => turn.sessionId === String(nodeB.sessionId));
  assert.deepEqual(
    aTurns.flatMap(turn => turn.readPaths),
    dataset.files.map(file => file.path),
    "Node A did not read the ten batch files exactly once in order.",
  );
  assert.equal(
    maxParallelReadCalls(app, nodeA.sessionId),
    1,
    "Node A issued parallel read calls.",
  );
  const bReads = bTurns.flatMap(turn => turn.readPaths);
  assert.deepEqual(
    bReads,
    [SUMMARY_PATH, ...SPOT_CHECK_BATCHES.map(batch => `data/batch-${String(batch).padStart(2, "0")}.txt`)],
    "Node B did not read the summary and the three spot-check batches in order.",
  );
  const aReadCalls = aTurns.flatMap(turn => turn.toolCalls).filter(call => call.name === "read");
  assert.equal(aReadCalls.length, dataset.files.length, "Node A made extra read calls.");
  assert(aReadCalls.every(call => call.isError === false), "Node A had a failed read call.");
  const bReadCalls = bTurns.flatMap(turn => turn.toolCalls).filter(call => call.name === "read");
  assert.equal(bReadCalls.length, 1 + SPOT_CHECK_BATCHES.length, "Node B made extra read calls.");
  assert(bReadCalls.every(call => call.isError === false), "Node B had a failed read call.");
  assert.equal(maxParallelReadCalls(app, nodeB.sessionId), 1, "Node B issued parallel read calls.");
  const completionA = aTurns.flatMap(turn => turn.submitCompletion === null ? [] : [turn.submitCompletion]).at(-1);
  const completionB = bTurns.flatMap(turn => turn.submitCompletion === null ? [] : [turn.submitCompletion]).at(-1);
  assert(completionA !== undefined && completionB !== undefined, "A Node did not submit completion.");
  assert(completionA.satisfied === completionA.total && completionA.remaining === 0, "Node A submission is incomplete.");
  assert(completionB.satisfied === completionB.total && completionB.remaining === 0, "Node B submission is incomplete.");
  assert(completionA.resourceIds.includes(artifacts.summaryResourceId), "Node A did not cite its summary Resource.");
  assert(completionB.resourceIds.includes(artifacts.finalResourceId), "Node B did not cite its final Resource.");
  for (const turn of turns) {
    assert.equal(turn.unrecovered, 0, `Turn ${turn.turnId} has an unrecovered error: ${turn.errorCodes.join(", ")}.`);
    assert(!turn.calls.includes("web_search"), `Turn ${turn.turnId} used web_search.`);
    assert(!turn.calls.includes("web_fetch"), `Turn ${turn.turnId} used web_fetch.`);
    assert(!turn.calls.includes("shell"), `Turn ${turn.turnId} used shell.`);
  }
  const roadmap = app.roadmaps.get(projectId);
  assert(roadmap !== undefined, "Roadmap is missing at completion.");
  assert.deepEqual(
    [...roadmap.graph.topologicalOrder].sort(),
    [nodeAId, nodeBId].sort(),
    "Roadmap does not contain exactly the two acceptance Nodes.",
  );
}

function findResource(
  app: Context,
  projectId: ProjectId,
  nodeId: NodeId,
  entryRef: string,
) {
  return app.resources.listByProject(projectId).find(resource => (
    resource.owner.kind === "node" && resource.owner.nodeId === nodeId && resource.entryRef === entryRef
  ));
}
