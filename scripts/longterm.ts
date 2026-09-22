import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import type { NodeId } from "../src/brand/ids.js";
import { resolveKernelHostConfig } from "../src/host/config.js";
import { QwenChatCompletionsAdapter } from "../src/llm/adapters/qwen.js";
import { projectNode } from "../src/node/projector.js";
import { projectRoadmap } from "../src/roadmap/projector.js";

async function main() {
  const config = resolveKernelHostConfig();
  const root = await mkdtemp(join(tmpdir(), "navo-real-f98-"));
  const app = await createApp({
    node: { session: { model: config.agent.model } },
    runtime: { maxSteps: 16, maxModelRetries: 0 },
  });
  try {
    await writeFile(join(root, "evidence.txt"), "Candidate A: latency 120 ms, accuracy 94%. Candidate B: latency 180 ms, accuracy 95%. Requirement: latency below 150 ms and accuracy at least 93%. These measurements have not been independently validated.");
    await writeFile(join(root, "validation.txt"), "Independent repeat: Candidate A latency 125 ms, accuracy 93.5%; Candidate B latency 175 ms, accuracy 94.5%. Candidate A meets both requirements; Candidate B fails latency. Small synthetic sample; production workload remains untested.");
    app.llm.registerAdapter(config.provider, new QwenChatCompletionsAdapter(config.adapter));
    const project = app.projects.create({ goal: "Recommend A or B using supplied measurements and independent validation. No internet research is needed. Humans control every turn and completion." });
    await app.projectWorkspaces.create(project.id, root);
    const projectId = project.id;
    type Execution = Pick<Awaited<ReturnType<typeof app.projectRuntime.startMain>>, "sessionId" | "turn">;
    const turns: Execution[] = [];
    const node = (title: string) => {
      const value = app.nodes.getByProject(projectId).find(value => value.node.kind === "work" && value.node.objective.title === title);
      assert(value, `Missing node ${title}`);
      return value;
    };
    const confirm = (nodeId: NodeId) => app.projectRuntime.confirmCompletion(projectId, nodeId, {
      confirmedBy: "human", reason: "Live acceptance harness reviewed asserted output", reviewedRevision: app.nodes.get(nodeId)!.revision,
    });
    const run = async (label: string, action: () => Promise<Execution>) => {
      const started = Date.now();
      console.log(`START ${label}`);
      const result = await action();
      turns.push(result);
      const events = app.sessions.getEvents(result.sessionId).filter(event => "turnId" in event.data && event.data.turnId === result.turn.turnId);
      const calls = events.flatMap(event => event.type === "assistant-message"
        ? event.data.message.content.filter(block => block.type === "tool-call").map(block => block.name) : []);
      const answers = events.flatMap(event => event.type === "assistant-message"
        ? event.data.message.content.filter(block => block.type === "text").map(block => block.text) : []);
      const errors = events.filter(event => event.type === "error").map(event => event.data);
      const resourceSnapshots = events.filter(event => event.type === "llm-requested").map(event => {
        const system = JSON.stringify(event.data.messages.find(message => message.role === "system"));
        return app.resources.listByProject(projectId).filter(resource => system?.includes(resource.id)).map(resource => resource.id);
      });
      console.log(JSON.stringify({ label, seconds: (Date.now() - started) / 1000, result: result.turn, calls, errors, resourceSnapshots, answer: answers.at(-1) }));
      assert.equal(result.turn.status, "completed", `${label} did not complete`);
      assert.equal(errors.length, 0, `${label} reported errors`);
      return { result, calls, answer: answers.at(-1) ?? "" };
    };
    const mainTurn = (text: string) => app.projectRuntime.startMain({ projectId, text });
    console.log(JSON.stringify({ model: config.agent.model.model, thinking: config.adapter.enableThinking, maxTokens: config.agent.model.maxTokens }));
    await run("1-plan", () => mainTurn("Read the roadmap, then create exactly two required work nodes with titles evidence and synthesis. evidence publishes supplied measurements; synthesis recommends a candidate after reviewing evidence and independent validation, reporting a blocker if validation is missing. synthesis depends on evidence. Use tools to persist the plan, then stop. Do not add validation yet."));
    assert.equal(app.nodes.getByProject(projectId).length, 2);
    assert.equal(node("evidence").status, "idle");
    assert.equal(node("synthesis").status, "locked");
    const evidenceId = node("evidence").node.id;
    const synthesisId = node("synthesis").node.id;

    await run("2-evidence", () => app.projectRuntime.startNode({ projectId, nodeId: evidenceId, text: "Publish the supplied existing workspace file evidence.txt as a text/plain resource. Fetch it to review the measurements. Report the resource ID and its lack of independent validation to Main using send_to_main. Do not use the internet. Then stop for Human review." }));
    const evidence = app.resources.listByProject(projectId).find(value => value.owner.kind === "node" && value.owner.nodeId === evidenceId);
    assert(evidence);
    assert.equal(evidence.access.kind, "private");
    assert.equal(app.resources.getVisible(projectId, evidence.id, { kind: "node", nodeId: synthesisId }), undefined);
    assert.equal(node("evidence").status, "idle");
    assert(app.mailbox.getHistory(projectId).some(value => value.body.includes(evidence.id)));
    confirm(evidenceId);
    assert.equal(node("synthesis").status, "idle");

    await run("3-handoff", () => mainTurn("The Human confirmed evidence. Read the mailbox and share its published measurement resource with synthesis only, using set_resource_access. Do not change the roadmap yet; stop after sharing."));
    assert(app.resources.getVisible(projectId, evidence.id, { kind: "node", nodeId: synthesisId }));
    assert.equal(node("synthesis").sessionId, undefined);
    const blocked = await run("4-blocker", () => app.projectRuntime.startNode({ projectId, nodeId: synthesisId, text: "Fetch the available measurement resource and assess whether a final recommendation is justified. Independent validation is required. If missing, report this blocker to Main via send_to_main and stop; do not invent validation or use internet research." }));
    assert(blocked.calls.includes("fetch_resource"));
    assert(blocked.calls.includes("send_to_main"));
    assert.equal(node("synthesis").status, "idle");
    assert.equal(app.roadmaps.get(projectId)?.revision, 1);

    await run("5-replan", () => mainTurn("Read the mailbox and roadmap. Resolve the reported blocker by adding one required work node titled validation, dependent on evidence, to publish and review supplied validation.txt. Also make synthesis depend on validation while preserving the existing dependency. Use current roadmap versions for mutations. Do not run or complete nodes; stop after persisting both changes."));
    const validationId = node("validation").node.id;
    assert.equal(app.nodes.getByProject(projectId).length, 3);
    assert.equal(node("synthesis").status, "locked");
    assert.equal(node("synthesis").sessionId, blocked.result.sessionId);
    assert.equal(node("validation").status, "idle");
    assert.throws(() => app.projectRuntime.continueNode({ projectId, nodeId: synthesisId, text: "Continue" }));
    assert.deepEqual(app.roadmaps.get(projectId)?.graph.definition.edges, [
      { from: evidenceId, to: synthesisId }, { from: evidenceId, to: validationId }, { from: validationId, to: synthesisId },
    ]);

    await run("6-validation", () => app.projectRuntime.startNode({ projectId, nodeId: validationId, text: "Publish the supplied existing workspace file validation.txt as a text/plain resource, fetch it and review the independent results. Send its resource ID, findings and limitations to Main via send_to_main. Do not invent measurements or use internet research. Stop for Human review." }));
    const validation = app.resources.listByProject(projectId).find(value => value.owner.kind === "node" && value.owner.nodeId === validationId);
    assert(validation);
    assert.equal(validation.access.kind, "private");
    assert.equal(node("validation").status, "idle");
    await run("7-handoff", () => mainTurn("Read the mailbox and share validation's new resource with synthesis only. Do not change the roadmap or complete any node. Stop after sharing."));
    assert(app.resources.getVisible(projectId, validation.id, { kind: "node", nodeId: synthesisId }));
    assert.equal(node("synthesis").status, "locked");
    confirm(validationId);
    assert.equal(node("synthesis").status, "idle");
    const final = await run("8-resume", () => app.projectRuntime.continueNode({ projectId, nodeId: synthesisId, text: "The Human confirmed validation. Fetch the newly shared independent validation resource and continue your earlier analysis. Give a concise final recommendation with numerical support and the supplied limitation. Do not invent further research." }));
    assert.equal(final.result.sessionId, blocked.result.sessionId);
    assert(final.calls.includes("fetch_resource"));
    assert.match(final.answer, /125/);
    assert.match(final.answer, /93\.5/);
    assert.equal(node("synthesis").status, "idle");
    confirm(synthesisId);
    for (const snapshot of app.nodes.getByProject(projectId)) {
      assert.equal(snapshot.status, "completing");
      assert.deepEqual(projectNode(snapshot.node.id, app.nodes.getEvents(snapshot.node.id)), snapshot);
    }
    assert.deepEqual(projectRoadmap(projectId, app.roadmaps.getEvents(projectId), app.nodes.getByProject(projectId).map(value => value.node)), app.roadmaps.get(projectId));
    assert.equal(new Set(turns.map(value => value.sessionId)).size, 4);
    assert.equal(app.projects.get(projectId)?.status, "active");
    console.log(JSON.stringify({ outcome: "passed", humanTurns: turns.length, modelSteps: turns.reduce((total, value) => total + value.turn.steps, 0), sessions: 4, roadmapRevision: app.roadmaps.get(projectId)?.revision, nodes: app.nodes.getByProject(projectId).map(value => ({ id: value.node.id, status: value.status })), projectStatus: app.projects.get(projectId)?.status }));
  } finally {
    await app.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
