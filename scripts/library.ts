import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeId, ProjectId, SessionId, TurnId } from "../src/brand/ids.js";
import { captureTurn, writeEvidence } from "./longterm/evidence.js";
import { criteria, documents, goal } from "./library/data.js";
import { assertIndex, assertReview, durable, validateAnswer } from "./library/checks.js";
import { createRuntime } from "./library/runtime.js";

async function main(): Promise<void> {
  const preflight = process.argv.includes("--preflight");
  assert(preflight || process.argv.includes("--real"), "Use --preflight (zero inference) or explicitly authorized --real");
  const started = Date.now();
  const runtime = await createRuntime(preflight);
  let projectId: ProjectId | undefined;
  let stage = "intake";
  let sequence = 0;
  const turns: unknown[] = [];
  process.stdout.write(`${JSON.stringify({ event: "workspace", root: runtime.root, preflight })}\n`);
  const run = async (label: string, action: () => Promise<{ sessionId: SessionId; turn: { status: string; turnId: TurnId } }>) => {
    stage = label;
    const result = await action();
    const evidence = captureTurn(runtime.app, projectId!, result.sessionId, result.turn.turnId);
    turns.push({ label, ...evidence.record });
    await writeEvidence(runtime.evidence, `${++sequence}-${label}`, { result, ...evidence.record });
    assert.equal(result.turn.status, "completed", `${label} did not complete`);
    return evidence;
  };
  const materialize = async (nodeId: NodeId, filename: string) => {
    const submission = runtime.app.nodes.get(nodeId)!.submission!;
    await writeFile(join(runtime.workspace, filename), submission.summary);
    const resource = await runtime.app.resources.publish({ projectId: projectId!, owner: { kind: "main" },
      sourceRef: filename, name: filename, description: "Exact Node submission materialized by Human acceptance harness", type: "text/markdown" });
    await runtime.settle();
    const text = await runtime.app.resources.withEntry(projectId!, resource.id, { kind: "main" }, async (_, entry) => readFile(entry.path, "utf8"));
    assert.equal(text, submission.summary);
    await writeEvidence(runtime.evidence, filename.replace(".md", ""), {
      writer: "acceptance-harness", source: "node-submission", nodeId, summary: submission.summary, resource,
    });
    assertIndex(runtime.app, projectId!, resource.id);
    return resource;
  };
  try {
    const project = runtime.app.projects.create({ name: "F13.6 backend library acceptance", goal });
    projectId = project.id;
    await runtime.app.projectWorkspaces.create(projectId, runtime.workspace);
    const sources = [];
    for (const document of documents) {
      const path = join(runtime.intake, document.name);
      await writeFile(path, document.body);
      sources.push({ kind: "file" as const, path });
    }
    const imported = [];
    for await (const item of runtime.app.userResources.import({ projectId, requestId: "f136_sources", sources }, runtime.signal)) {
      imported.push(item);
      assert.equal(item.status, "saved");
    }
    await runtime.settle();
    const resources = runtime.app.resources.listByProject(projectId);
    assert.equal(resources.length, 3);
    assert(resources.every(resource => resource.owner.kind === "user" && resource.access.kind === "public"));
    assert(resources.every(resource => runtime.app.content.status(projectId!, resource.id)?.status === "ready"));
    await writeEvidence(runtime.evidence, "intake", { imported, resources, model: runtime.model });
    if (preflight) {
      assert.equal(runtime.ledger.used, 0);
      assert.equal(runtime.embeddingCalls.length, 0);
      await writeEvidence(runtime.evidence, "preflight", { passed: true, inferenceRequests: 0, contentReady: resources.map(resource =>
        runtime.app.content.status(projectId!, resource.id)?.status), boundary: "No Embedding, graph extraction or task model configured" });
      process.stdout.write(`${JSON.stringify({ outcome: "preflight-passed", root: runtime.root, requests: 0 })}\n`);
      return;
    }
    for (const resource of resources) assertIndex(runtime.app, projectId, resource.id);
    const originalIds = resources.map(resource => resource.id);
    const schema = 'Return submit_completion.summary as ONLY JSON: {"atlas":{"scores":[82,88],"price":40},"boreal":{"score":78,"price":35},"budget":45,"deployment_cost":null,"conflict":"unresolved","source_ids":["actually fetched Resource IDs"],"recommendation":"your supported recommendation"}. Read and verify the values from sources, do not infer that supplied schema values prove the facts. Do not use write, shell or the internet. Answers are deliverables; use resource_ids=[] and satisfy each criterion only after checking sources.';
    await run("plan", () => runtime.app.projectRuntime.startMain({ projectId: projectId!, signal: runtime.signal,
      text: `Create exactly two required dependent work Nodes titled Compare and Recommend, in that order. Compare must search Atlas and fetch all three source Resources, compare facts and report conflict and missing costs. Recommend must consume a reviewed comparison shared by Main, fetch that comparison plus constraints.md, and provide a recommendation. Each Node has exactly these two acceptance criteria: ${JSON.stringify(criteria)}. Do not start the Nodes or do their work.` }));
    const nodes = runtime.app.nodes.getByProject(projectId);
    assert.equal(nodes.length, 2);
    const a = nodes.find(node => node.node.objective.title === "Compare")!;
    const b = nodes.find(node => node.node.objective.title === "Recommend")!;
    assert(a && b);
    assert.equal(a.status, "idle");
    assert.equal(b.status, "locked");
    const first = await run("node-a", () => runtime.app.projectRuntime.startNode({ projectId: projectId!, nodeId: a.node.id,
      signal: runtime.signal, text: `Search Atlas in the project library, then fetch all three original documents. ${schema}` }));
    validateAnswer(runtime.app, a.node.id, first, originalIds);
    assert(first.succeeded.some(call => call.name === "search_resources"));
    const searches = first.succeeded.filter(call => call.name === "search_resources").map(call => JSON.parse(call.result));
    assert(searches.some(result => result.resources.some((resource: { snippets: { paths: unknown[] }[] }) =>
      resource.snippets.some(snippet => snippet.paths.length > 0))), "Task search did not expose real graph evidence");
    const comparison = await materialize(a.node.id, "comparison.md");
    assert.equal(runtime.app.resources.getVisible(projectId, comparison.id, { kind: "node", nodeId: b.node.id }), undefined);
    const reviewA = await run("review-a", () => runtime.app.projectRuntime.startReview({ projectId: projectId!, nodeId: a.node.id,
      signal: runtime.signal, text: `Review the actual answer against objective and both criteria. The Human harness saved the exact answer as Resource ${comparison.id}. Fetch that Resource and check primary sources as necessary. If it passes, submit complete and then use set_resource_access to share Resource ${comparison.id} only with Node ${b.node.id}. If it fails, return concrete rework; do not grant access to unsupported output.` }));
    assertReview(runtime.app, a.node.id, comparison.id, reviewA);
    assert(runtime.app.resources.getVisible(projectId, comparison.id, { kind: "node", nodeId: b.node.id }));
    await runtime.settle();
    stage = "restart";
    const before = durable(runtime.app, projectId);
    const counts = { model: runtime.ledger.used, embedding: runtime.embeddingCalls.length };
    await runtime.restart();
    await runtime.settle();
    assert.deepEqual(durable(runtime.app, projectId), before);
    assert.deepEqual({ model: runtime.ledger.used, embedding: runtime.embeddingCalls.length }, counts);
    assert.equal(runtime.app.autoRun.get(projectId), undefined);
    await writeEvidence(runtime.evidence, "restart", { passed: true, counts, state: before });
    const constraints = resources.find(resource => resource.name === "constraints.md")!;
    const second = await run("node-b", () => runtime.app.projectRuntime.startNode({ projectId: projectId!, nodeId: b.node.id,
      signal: runtime.signal, text: `Main shared reviewed comparison Resource ${comparison.id}. Fetch it and original constraints.md; use search_resources if more evidence is needed. ${schema}` }));
    validateAnswer(runtime.app, b.node.id, second, [comparison.id, constraints.id]);
    const final = await materialize(b.node.id, "recommendation.md");
    const reviewB = await run("review-b", () => runtime.app.projectRuntime.startReview({ projectId: projectId!, nodeId: b.node.id,
      signal: runtime.signal, text: `Review the final recommendation against the objective and both criteria. The Human harness saved the exact answer as Resource ${final.id}. Fetch it and inspect actual sources as needed. Record complete only if all criteria are satisfied; otherwise report rework or request Human decision.` }));
    assertReview(runtime.app, b.node.id, final.id, reviewB);
    assert(runtime.app.nodes.getByProject(projectId).every(node => node.status === "completing"));
    await writeEvidence(runtime.evidence, "result", { outcome: "passed", elapsedMs: Date.now() - started,
      model: runtime.model, requests: runtime.ledger.entries, graphRequestIndexes: runtime.graphRequests,
      embeddingCalls: runtime.embeddingCalls, state: durable(runtime.app, projectId),
      boundaries: { writer: "acceptance-harness", renderer: false, bridge: false, forcedProcessCrash: false, overflow: false } });
    process.stdout.write(`${JSON.stringify({ outcome: "passed", root: runtime.root, elapsedMs: Date.now() - started,
      generationRequests: runtime.ledger.used, graphRequests: runtime.graphRequests.length, embeddingRequests: runtime.embeddingCalls.length })}\n`);
  } catch (error) {
    await writeEvidence(runtime.evidence, "failure", { stage, elapsedMs: Date.now() - started,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      requests: runtime.ledger.entries, graphRequestIndexes: runtime.graphRequests, embeddingCalls: runtime.embeddingCalls,
      turns, ...(projectId === undefined ? {} : { state: durable(runtime.app, projectId) }) });
    throw error;
  } finally {
    await runtime.close();
    await writeEvidence(runtime.evidence, "requests", { generation: runtime.ledger.entries,
      graphRequestIndexes: runtime.graphRequests, embedding: runtime.embeddingCalls });
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
