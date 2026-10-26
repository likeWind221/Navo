import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeId } from "../../../src/brand/ids.js";
import { criteria, comparison, feedback } from "../../../scripts/library/data.js";
import { captureTurn } from "../../../scripts/longterm/evidence.js";
import { settle } from "../../resource/graph/fixture.js";
import { callResourceTool, resourceArtifact, resourceResultText } from "../../tools/resource/helpers.js";
import { answer, call, resultText, step } from "../longterm/script.js";
import { submission, world } from "./fixture.js";

it("completes a cross-document task with Main rework, directed Node handoff and a durable restart", async () => {
  const w = await world();
  const projectId = w.project.id;
  const node = (title: string) => w.app.nodes.getByProject(projectId).find(value => value.node.objective.title === title)!;
  const resource = (name: string) => w.app.resources.listByProject(projectId).find(value => value.name === name)!;
  const materialize = async (nodeId: NodeId, name: string) => {
    const submitted = w.app.nodes.get(nodeId)!.submission!;
    await writeFile(join(w.workspace, name), submitted.summary);
    const published = await w.app.resources.publish({ projectId, owner: { kind: "main" }, sourceRef: name,
      name, description: "Human materialized exact submitted answer", type: "text/markdown" });
    await settle(w.app);
    return published;
  };
  const completed = async (run: Promise<{ turn: { status: string } }>) => {
    const result = await run;
    expect(result.turn.status, JSON.stringify(w.app.sessions.getEvents(w.project.mainSessionId).filter(event => event.type === "error"))).toBe("completed");
  };
  w.enqueue(call("plan", "create_roadmap", { reason: "Compare before recommending", nodes: [
    { key: "compare", title: "Compare", goal: "Compare source documents", done_when: [...criteria], required: true, depends_on: [] },
    { key: "recommend", title: "Recommend", goal: "Recommend using the reviewed comparison", done_when: [...criteria], required: true, depends_on: ["compare"] },
  ] }), answer("Plan ready"));
  await completed(w.app.projectRuntime.startMain({ projectId, text: "Plan two dependent work Nodes" }));
  const a = node("Compare").node.id;
  const b = node("Recommend").node.id;
  expect(node("Recommend").status).toBe("locked");

  w.enqueue(call("search-a", "search_resources", { query: "Atlas", top_k: 10 }), step(request => {
    const search = JSON.parse(resultText(request, "search-a"));
    expect(search.status).toBe("found");
    expect(search.resources.map((value: { name: string }) => value.name)).toEqual(expect.arrayContaining(["measurements.md", "constraints.md"]));
    expect(JSON.stringify(search)).toContain("COMPARED_WITH");
    return call("read-measurements", "fetch_resource", { resource_id: w.source("measurements.md").id });
  }), step(request => {
    expect(resultText(request, "read-measurements")).toContain("Atlas score: 82");
    return call("read-constraints", "fetch_resource", { resource_id: w.source("constraints.md").id });
  }), step(request => {
    expect(resultText(request, "read-constraints")).toContain("Deployment cost is not supplied");
    return call("draft-submit", "submit_completion", submission(undefined, "Atlas score 82, price 40; Boreal score 78, price 35."));
  }));
  const first = await w.app.projectRuntime.startNode({ projectId, nodeId: a, text: "Compare the library sources" });
  expect(first.turn.status, JSON.stringify(captureTurn(w.app, projectId, first.sessionId, first.turn.turnId).errors)).toBe("completed");
  expect(node("Compare").status).toBe("submitted");
  expect(node("Recommend").status).toBe("locked");
  await materialize(a, "draft.md");

  w.enqueue(call("review-draft", "fetch_resource", { resource_id: resource("draft.md").id }),
    call("review-search", "search_resources", { query: "Atlas conflict" }),
    call("review-conflict", "fetch_resource", { resource_id: w.source("conflict.md").id }),
    step(request => {
      expect(resultText(request, "review-conflict")).toContain("score: 88");
      expect(resultText(request, "review-draft")).toContain("Atlas score 82");
      return call("return-draft", "submit_review", { decision: "rework", reason: "Draft omits a conflict and unknown deployment cost", feedback });
    }), answer("Returned for source reconciliation"));
  await completed(w.app.projectRuntime.startReview({ projectId, nodeId: a, text: "Check actual sources against both criteria" }));
  expect(node("Compare").pendingFeedback?.feedback).toBe(feedback);
  expect(node("Recommend").status).toBe("locked");

  w.enqueue(step(request => {
    expect(JSON.stringify(request.turnContext)).toContain(feedback);
    return call("a-conflict", "fetch_resource", { resource_id: w.source("conflict.md").id });
  }), call("report-main", "send_to_main", { message: comparison }),
  call("final-submit", "submit_completion", submission(undefined, comparison)));
  await completed(w.app.projectRuntime.continueNode({ projectId, nodeId: a, text: "Apply the review feedback" }));
  const artifact = await materialize(a, "comparison.md");
  expect(w.app.resources.getVisible(projectId, artifact.id, { kind: "node", nodeId: b })).toBeUndefined();
  const before = { nodes: w.app.nodes.getByProject(projectId), resources: w.app.resources.listByProject(projectId),
    mailbox: w.app.mailbox.getHistory(projectId), sessions: [w.project.mainSessionId, first.sessionId].map(id => w.app.sessions.getEvents(id)) };
  const callsBefore = w.requests.length;
  const graphBefore = w.graph.requests.length;
  await w.restart();
  expect(w.requests).toHaveLength(callsBefore);
  expect(w.graph.requests).toHaveLength(graphBefore);
  expect(w.app.autoRun.get(projectId)).toBeUndefined();
  expect({ nodes: w.app.nodes.getByProject(projectId), resources: w.app.resources.listByProject(projectId),
    mailbox: w.app.mailbox.getHistory(projectId), sessions: [w.project.mainSessionId, first.sessionId].map(id => w.app.sessions.getEvents(id)) }).toEqual(before);

  w.enqueue(call("check-comparison", "fetch_resource", { resource_id: artifact.id }), step(request => {
    expect(resultText(request, "check-comparison")).toContain(comparison);
    return call("accept-a", "submit_review", { decision: "complete", reason: "Verified scores, prices, conflict and missing cost against the three sources" });
  }), call("grant-b", "set_resource_access", { resource_id: artifact.id, expected_revision: artifact.revision,
    access: { kind: "shared", node_ids: [b] } }), answer("Comparison accepted and shared with B"));
  await completed(w.app.projectRuntime.startReview({ projectId, nodeId: a, text: "Review the revised comparison and share it with the downstream Node" }));
  expect(node("Compare").lastReview?.decision).toBe("complete");
  expect(node("Recommend").status).toBe("idle");
  expect(node("Recommend").sessionId).toBeUndefined();

  w.enqueue(call("discover-b", "list_resources", {}), step(request => {
    expect(resultText(request, "discover-b")).toContain(artifact.id);
    expect(resultText(request, "discover-b")).not.toContain(resource("draft.md").id);
    return call("handoff-read", "fetch_resource", { resource_id: artifact.id });
  }), step(request => {
    expect(resultText(request, "handoff-read")).toContain(comparison);
    return call("b-search", "search_resources", { query: "Atlas budget" });
  }), call("b-source", "fetch_resource", { resource_id: w.source("constraints.md").id }),
  call("b-submit", "submit_completion", submission(undefined, `Recommendation: Atlas provisionally; verify conflict and deployment cost. ${comparison}`)));
  const second = await w.app.projectRuntime.startNode({ projectId, nodeId: b, text: "Use the reviewed comparison and check the constraints" });
  expect(second.turn.status).toBe("completed");
  await materialize(b, "recommendation.md");
  w.enqueue(call("final-check", "fetch_resource", { resource_id: resource("recommendation.md").id }),
    call("accept-b", "submit_review", { decision: "complete", reason: "Final recommendation preserves verified facts, uncertainty and missing costs" }), answer("Task complete"));
  await completed(w.app.projectRuntime.startReview({ projectId, nodeId: b, text: "Verify the final deliverable" }));
  expect(node("Recommend").lastReview?.decision).toBe("complete");
  expect(node("Compare").reworkCount).toBe(1);
  expect(w.app.nodes.getByProject(projectId).every(value => value.status === "completing")).toBe(true);
  for (const run of [first, second]) expect(captureTurn(w.app, projectId, run.sessionId, run.turn.turnId).errors).toEqual([]);

  await callResourceTool(w.app, w.project.mainSessionId, "delete_resource", { resource_id: artifact.id, expected_revision: artifact.revision + 1 });
  const listed = await callResourceTool(w.app, second.sessionId, "list_resources", {});
  expect(JSON.stringify(resourceArtifact(listed))).not.toContain(artifact.id);
  const searched = await callResourceTool(w.app, second.sessionId, "search_resources", { query: "Atlas" });
  expect(resourceResultText(searched)).not.toContain(artifact.id);
  expect((await callResourceTool(w.app, second.sessionId, "fetch_resource", { resource_id: artifact.id })).kind).toBe("failure");
}, 20_000);
