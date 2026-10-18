import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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
import { reviewTurnId, type TurnSummary } from "./turns.js";

export interface ArtifactReport {
  readonly summary: Validation;
  readonly final: Validation;
  readonly summaryText: string;
  readonly finalText: string;
  readonly summaryBytes: number;
  readonly finalBytes: number;
  readonly summaryResourceId: string;
  readonly summaryResourceOwner: unknown;
  readonly summaryResourceAccess: unknown;
  readonly summaryFileMatchesOriginal: boolean;
  readonly summaryPublishedMatches: boolean;
  readonly finalArtifact: {
    readonly path: string;
    readonly writer: "acceptance-harness";
    readonly bytes: number;
    readonly matchesOriginal: true;
  };
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
  const nodeA = app.nodes.get(nodeAId);
  const nodeB = app.nodes.get(nodeBId);
  assert(nodeA?.submission !== undefined, "Node A has no submission.");
  assert(nodeB?.submission !== undefined, "Node B has no submission.");
  assert.equal(nodeA.submission.resourceIds.length, 0, "Node A submission cited Resources.");
  assert.equal(nodeB.submission.resourceIds.length, 0, "Node B submission cited Resources.");
  const summaryText = nodeA.submission.summary;
  const finalText = nodeB.submission.summary;
  const summary = validateSummary(summaryText, dataset.expected);
  const final = validateFinal(finalText, dataset.expected);
  assert(summary.ok, `Node A completion summary failed validation: ${summary.errors.join("; ")}`);
  assert(final.ok, `Node B completion summary failed validation: ${final.errors.join("; ")}`);
  const summaryFile = await readFile(join(workspace, SUMMARY_PATH), "utf8");
  assert.equal(summaryFile, summaryText, `${SUMMARY_PATH} differs from the original Node A submission.`);
  const resource = app.resources.listByProject(projectId).find(candidate => (
    candidate.owner.kind === "main" && candidate.entryRef === "summary.json"
  ));
  assert(resource !== undefined, "The acceptance harness summary Resource is missing.");
  assert.equal(resource.access.kind, "public", "The acceptance harness summary Resource is not public.");
  const entry = await app.resources.resolveEntry(projectId, resource.id);
  const published = await readFile(entry.path, "utf8");
  assert.equal(published, summaryText, "Published summary Resource content differs from the Node A submission.");
  const finalPath = join(workspace, FINAL_PATH);
  await writeFile(finalPath, finalText, "utf8");
  const finalFile = await readFile(finalPath, "utf8");
  assert.equal(finalFile, finalText, `${FINAL_PATH} differs from the original Node B submission.`);
  return Object.freeze({
    summary,
    final,
    summaryText,
    finalText,
    summaryBytes: Buffer.byteLength(summaryText, "utf8"),
    finalBytes: Buffer.byteLength(finalText, "utf8"),
    summaryResourceId: String(resource.id),
    summaryResourceOwner: resource.owner,
    summaryResourceAccess: resource.access,
    summaryFileMatchesOriginal: true,
    summaryPublishedMatches: true,
    finalArtifact: Object.freeze({
      path: FINAL_PATH,
      writer: "acceptance-harness",
      bytes: Buffer.byteLength(finalText, "utf8"),
      matchesOriginal: true,
    }),
  });
}

export function assertCompletion(
  app: Context,
  projectId: ProjectId,
  nodeAId: NodeId,
  nodeBId: NodeId,
  turns: readonly TurnSummary[],
  dataset: Dataset,
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
    assert.equal(node.submission.resourceIds.length, 0, `Node ${nodeId} submission cited Resources.`);
    assert(node.submission.criteria.every(check => check.satisfied), `Node ${nodeId} has an unsatisfied criterion.`);
    assert.equal(node.submission.remaining.length, 0, `Node ${nodeId} reported remaining work.`);
    assert(node.lastReview?.turnId !== undefined, `Node ${nodeId} review has no turn.`);
    const review = turns.find(turn => (
      turn.sessionId === mainSession && turn.turnId === String(reviewTurnId(app, projectId, nodeId))
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
  assert.equal(maxParallelReadCalls(app, nodeA.sessionId), 1, "Node A issued parallel read calls.");
  assert.deepEqual(
    bTurns.flatMap(turn => turn.readPaths),
    [SUMMARY_PATH, ...SPOT_CHECK_BATCHES.map(batch => `data/batch-${String(batch).padStart(2, "0")}.txt`)],
    "Node B did not read the shared summary and the three spot-check batches in order.",
  );
  const aReadCalls = aTurns.flatMap(turn => turn.toolCalls).filter(call => call.name === "read");
  assert.equal(aReadCalls.length, dataset.files.length, "Node A made extra read calls.");
  assert(aReadCalls.every(call => call.isError === false), "Node A had a failed read call.");
  const bReadCalls = bTurns.flatMap(turn => turn.toolCalls).filter(call => call.name === "read");
  assert.equal(bReadCalls.length, 1 + SPOT_CHECK_BATCHES.length, "Node B made extra read calls.");
  assert(bReadCalls.every(call => call.isError === false), "Node B had a failed read call.");
  assert.equal(maxParallelReadCalls(app, nodeB.sessionId), 1, "Node B issued parallel read calls.");
  for (const turn of [...aTurns, ...bTurns]) {
    assert(
      turn.calls.every(name => name === "read" || name === "submit_completion"),
      `Node Turn ${turn.turnId} used a tool outside read and submit_completion: ${turn.calls.join(", ")}.`,
    );
  }
  const completionA = aTurns.flatMap(turn => turn.submitCompletion === null ? [] : [turn.submitCompletion]).at(-1);
  const completionB = bTurns.flatMap(turn => turn.submitCompletion === null ? [] : [turn.submitCompletion]).at(-1);
  assert(completionA !== undefined && completionB !== undefined, "A Node did not submit completion.");
  assert(completionA.satisfied === completionA.total && completionA.remaining === 0, "Node A submission is incomplete.");
  assert(completionB.satisfied === completionB.total && completionB.remaining === 0, "Node B submission is incomplete.");
  assert(completionA.resourceIds.length === 0, "Node A completion cited Resources.");
  assert(completionB.resourceIds.length === 0, "Node B completion cited Resources.");
  for (const turn of turns) {
    assert.equal(turn.unrecovered, 0, `Turn ${turn.turnId} has an unrecovered error: ${turn.errorCodes.join(", ")}.`);
    assert(!turn.calls.includes("web_search"), `Turn ${turn.turnId} used web_search.`);
    assert(!turn.calls.includes("web_fetch"), `Turn ${turn.turnId} used web_fetch.`);
    assert(!turn.calls.includes("shell"), `Turn ${turn.turnId} used shell.`);
    assert(!turn.calls.includes("write"), `Turn ${turn.turnId} used write.`);
    assert(!turn.calls.includes("register_resource"), `Turn ${turn.turnId} used register_resource.`);
  }
  const roadmap = app.roadmaps.get(projectId);
  assert(roadmap !== undefined, "Roadmap is missing at completion.");
  assert.deepEqual(
    [...roadmap.graph.topologicalOrder].sort(),
    [nodeAId, nodeBId].sort(),
    "Roadmap does not contain exactly the two acceptance Nodes.",
  );
}
