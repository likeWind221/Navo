import assert from "node:assert/strict";
import type { Context } from "cordis";
import type { ProjectId, NodeId, ResourceId } from "../../src/brand/ids.js";
import type { TurnEvidence } from "../longterm/evidence.js";

export function validateAnswer(app: Context, nodeId: NodeId, evidence: TurnEvidence, requiredSources: readonly string[]) {
  const submission = app.nodes.get(nodeId)?.submission;
  assert(submission !== undefined, "Node did not submit an answer");
  const answer = JSON.parse(submission.summary);
  assert.deepEqual([...answer.atlas.scores].sort(), [82, 88]);
  assert.equal(answer.atlas.price, 40);
  assert.equal(answer.boreal.score, 78);
  assert.equal(answer.boreal.price, 35);
  assert.equal(answer.budget, 45);
  assert.equal(answer.deployment_cost, null);
  assert.equal(answer.conflict, "unresolved");
  assert(typeof answer.recommendation === "string" && answer.recommendation.trim().length > 0);
  assert(Array.isArray(answer.source_ids));
  const sourceIds: string[] = [];
  for (const id of answer.source_ids as unknown[]) {
    assert(typeof id === "string" && id.trim().length > 0, "Source IDs must be non-empty strings");
    sourceIds.push(id);
  }
  assert(new Set(sourceIds).size === sourceIds.length, "Source IDs must be unique");
  assert(sourceIds.length >= 2, "Answer must cite at least two source Resources");
  const fetched = evidence.succeeded.filter(call => call.name === "fetch_resource")
    .map(call => (JSON.parse(call.arguments) as { resource_id: string }).resource_id);
  assert(new Set(fetched).size >= 2, "Node did not actually fetch two different Resources");
  for (const id of requiredSources) assert(fetched.includes(id), `Required source was not fetched: ${id}`);
  for (const id of requiredSources) assert(sourceIds.includes(id), `Required source was not cited: ${id}`);
  const received = evidence.succeeded
    .filter(call => call.name === "fetch_resource" || call.name === "search_resources")
    .map(call => call.result).join("\n");
  for (const id of sourceIds) assert(received.includes(id), `Source ID was not observed in this Turn: ${id}`);
  assert(submission.criteria.every(item => item.satisfied));
  assert.deepEqual(submission.remaining, []);
  assert.equal(evidence.unrecovered.length, 0);
  return answer;
}

export function durable(app: Context, projectId: ProjectId) {
  const project = app.projects.get(projectId)!;
  const nodes = app.nodes.getByProject(projectId);
  const sessions = [project.mainSessionId, ...nodes.flatMap(node => node.sessionId === undefined ? [] : [node.sessionId])];
  return { project, nodes, roadmap: app.roadmaps.get(projectId), resources: app.resources.listByProject(projectId),
    mailbox: app.mailbox.getHistory(projectId), sessions: sessions.map(id => ({ id, events: app.sessions.getEvents(id) })) };
}

export function assertIndex(app: Context, projectId: ProjectId, resourceId: ResourceId) {
  assert.equal(app.resourceIndex.status(projectId, resourceId).status, "active");
  assert.equal(app.resourceGraph.status(projectId, resourceId)?.status, "active");
}

export function assertReview(app: Context, nodeId: NodeId, artifactId: string, evidence: TurnEvidence) {
  assert.equal(app.nodes.get(nodeId)?.lastReview?.decision, "complete", "Main did not approve the submitted work");
  assert(evidence.succeeded.some(call => call.name === "fetch_resource"
    && JSON.parse(call.arguments).resource_id === artifactId), "Main did not read the materialized deliverable");
  assert.equal(evidence.unrecovered.length, 0);
}
