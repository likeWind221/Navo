import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";
import { createApp } from "../src/app.js";
import type { NodeId, ProjectId, SessionId, TurnId } from "../src/brand/ids.js";
import { projectNode } from "../src/node/projector.js";
import { projectRoadmap } from "../src/roadmap/projector.js";
import { createAcceptanceAdapter, resolveAcceptanceHostConfig } from "./acceptance.js";
import { captureTurn, projectState, writeEvidence } from "./longterm/evidence.js";

const MODEL = "gpt-6-sol";

interface Execution {
  readonly sessionId: SessionId;
  readonly turn: { readonly turnId: TurnId; readonly status: string; readonly steps: number };
}

async function main() {
  const config = resolveAcceptanceHostConfig(process.env, MODEL);
  const root = await mkdtemp(join(tmpdir(), "navo-real-f105-"));
  const data = await mkdtemp(join(tmpdir(), "navo-real-f105-db-"));
  const evidenceDir = process.env.NAVO_EVIDENCE_DIR?.trim() || join(tmpdir(), `navo-rework-evidence-${Date.now()}`);
  const open = async () => {
    const app = await createApp({
      storage: { path: join(data, "navo.db") },
      node: { session: { model: config.agent.model } },
      runtime: { maxSteps: 16, maxModelRetries: 0 },
    });
    app.llm.registerAdapter(config.provider, createAcceptanceAdapter(config));
    return app;
  };
  let app = await open();
  let activeProject: ProjectId | undefined;
  console.log(JSON.stringify({ provider: config.provider, model: config.agent.model.model, evidenceDir }));
  try {
    await writeFile(join(root, "draft.txt"), "Candidate A: latency 120 ms, accuracy 94%. Candidate B: latency 180 ms, accuracy 95%. Requirement: latency below 150 ms and accuracy at least 93%. Source: not recorded.");
    await writeFile(join(root, "sourced.txt"), "Candidate A: latency 120 ms, accuracy 94%. Candidate B: latency 180 ms, accuracy 95%. Requirement: latency below 150 ms and accuracy at least 93%. Source: benchmark log bench-2026-10-03, run 17. Caution: these numbers come from a single run and must be independently validated before any final recommendation.");
    await writeFile(join(root, "validation.txt"), "Independent repeat: Candidate A latency 125 ms, accuracy 93.5%; Candidate B latency 175 ms, accuracy 94.5%. Source: repeat run bench-2026-10-09. Candidate A meets both requirements; Candidate B fails latency. Limitation: small synthetic sample.");
    const project = app.projects.create({ name: "Project", goal: "Recommend candidate A or B from the supplied workspace files. Every measurement must cite its source. No internet research. Humans start every turn." });
    const projectId = project.id;
    activeProject = projectId;
    await app.projectWorkspaces.create(projectId, root);
    const turns: Execution[] = [];
    const node = (title: string) => {
      const value = app.nodes.getByProject(projectId).find(value => value.node.kind === "work" && value.node.objective.title === title);
      assert(value, `Missing node ${title}`);
      return value;
    };
    const status = (nodeId: NodeId) => app.nodes.get(nodeId)!;
    let sequence = 0;
    const run = async (label: string, action: () => Promise<Execution>) => {
      const started = Date.now();
      console.log(`START ${label}`);
      const result = await action();
      turns.push(result);
      const seconds = (Date.now() - started) / 1000;
      const { calls, answers, errors, unrecovered, succeeded, record } = captureTurn(app, projectId, result.sessionId, result.turn.turnId);
      const file = await writeEvidence(evidenceDir, `${String(++sequence).padStart(2, "0")}-${label}`, { label, seconds, result: result.turn, ...record });
      console.log(JSON.stringify({ label, seconds, result: result.turn, calls, errors, unrecovered: unrecovered.length, evidence: file, answer: answers.at(-1) }));
      assert.equal(result.turn.status, "completed", `${label} did not complete`);
      return { calls, succeeded };
    };
    const mainTurn = (text: string) => app.projectRuntime.startMain({ projectId, text });
    const nodeTurn = (nodeId: NodeId, text: string) => status(nodeId).sessionId === undefined
      ? app.projectRuntime.startNode({ projectId, nodeId, text })
      : app.projectRuntime.continueNode({ projectId, nodeId, text });
    const review = (nodeId: NodeId, text: string) => app.projectRuntime.startReview({ projectId, nodeId, text });
    const restart = async (label: string) => {
      const sessions = [...new Set(turns.map(turn => turn.sessionId))];
      const before = await durable(app, projectId, sessions);
      await app.fiber.dispose();
      app = await open();
      assert.deepEqual(await durable(app, projectId, sessions), before, `${label} changed durable state`);
      await writeEvidence(evidenceDir, `${String(++sequence).padStart(2, "0")}-${label}`, { state: projectState(app, projectId) });
      console.log(JSON.stringify({ label, sessions: sessions.length, nodes: before.nodes.length, resources: before.resources.length }));
    };

    const planRequest = "Read the roadmap, then create exactly two required work nodes. evidence: publish the measurements supplied in the workspace as a resource; its only acceptance criterion is 'Every measurement cites its source'. synthesis: recommend a candidate from the reviewed evidence; it depends on evidence. Persist the plan with tools, then stop.";
    await run("01-confirm", () => mainTurn(planRequest));
    if (app.roadmaps.get(projectId) === undefined) {
      await run("01-plan", () => mainTurn(`I agree with the recorded goal. ${planRequest}`));
    }
    const evidenceId = node("evidence").node.id;
    const synthesisId = node("synthesis").node.id;
    assert.equal(status(synthesisId).status, "locked");

    await run("02-draft", () => nodeTurn(evidenceId, "Publish the existing workspace file draft.txt as a text/plain resource, then submit your work with submit_completion. Do not edit files and do not use the internet."));
    assert.equal(status(evidenceId).status, "submitted", "evidence did not submit");
    assert.equal(status(synthesisId).status, "locked");

    await run("03-review-draft", () => review(evidenceId, "Review the evidence Node's submission against its acceptance criteria."));
    assert.equal(status(evidenceId).lastReview?.decision, "rework", "Main did not return the unsourced draft");
    assert.equal(status(evidenceId).status, "idle");
    assert(status(evidenceId).pendingFeedback, "rework feedback was not recorded");
    assert.equal(status(synthesisId).status, "locked");

    await restart("04-restart");

    const feedback = status(evidenceId).pendingFeedback!.feedback;
    await run("05-rework", () => nodeTurn(evidenceId, "Address the review feedback. The workspace also contains sourced.txt with sourced measurements; publish it as a text/plain resource and submit again. Do not edit files."));
    assert.equal(status(evidenceId).status, "submitted", "evidence did not resubmit");
    assert.equal(status(evidenceId).pendingFeedback, undefined);
    const sourced = app.resources.listByProject(projectId).find(value => value.entryRef.endsWith("sourced.txt"));
    assert(sourced, "sourced.txt was not published");
    assert(status(evidenceId).submission?.resourceIds.includes(sourced.id), "resubmission does not name sourced.txt");
    console.log(JSON.stringify({ feedback }));

    const edges = () => app.roadmaps.get(projectId)!.graph.definition.edges;
    const plannedNodes = new Set(app.nodes.getByProject(projectId).map(value => value.node.id));
    await run("06-review-sourced", () => review(evidenceId, "Review the evidence Node's new submission against its acceptance criteria. After your decision, adjust the downstream plan if the results show it is needed."));
    assert.equal(status(evidenceId).lastReview?.decision, "complete", "Main did not complete sourced evidence");
    assert.equal(status(evidenceId).confirmation?.confirmedBy, "main");
    const added = app.nodes.getByProject(projectId).filter(value => value.node.kind === "work" && !plannedNodes.has(value.node.id));
    assert.equal(added.length, 1, "Main did not add exactly one work node from the review result");
    const validationId = added[0]!.node.id;
    assert(edges().some(edge => edge.from === validationId && edge.to === synthesisId), "synthesis does not wait for the added node");
    assert.equal(status(synthesisId).status, "locked");

    await run("07-review-unrun", () => review(validationId, "Review this Node."));
    assert.notEqual(status(validationId).status, "completing", "Main completed a Node that never ran");
    assert.equal(status(validationId).confirmation, undefined);

    await run("08-validation", () => nodeTurn(validationId, "Publish the existing workspace file validation.txt as a text/plain resource, review it against your objective and submit your work. Do not edit files and do not use the internet."));
    assert.equal(status(validationId).status, "submitted", "validation did not submit");
    await run("09-review-validation", () => review(validationId, "Review the submission against its acceptance criteria. After your decision, share the resources the synthesis Node needs with it."));
    assert.equal(status(validationId).lastReview?.decision, "complete", "Main did not complete validation");
    assert.equal(status(synthesisId).status, "idle");
    const visible = app.resources.listVisible(projectId, { kind: "node", nodeId: synthesisId }).map(value => value.entryRef);
    assert(visible.some(ref => ref.endsWith("sourced.txt")) && visible.some(ref => ref.endsWith("validation.txt")), "synthesis cannot see both resources");

    const final = await run("10-synthesis", () => nodeTurn(synthesisId, "Fetch the shared resources, recommend a candidate with numbers, their sources and the stated limitation, then submit your work. Do not invent research."));
    assert(final.calls.includes("fetch_resource"));
    assert.equal(status(synthesisId).status, "submitted", "synthesis did not submit");
    await run("11-review-synthesis", () => review(synthesisId, "Review the synthesis Node's submission against its acceptance criteria."));
    assert.equal(status(synthesisId).lastReview?.decision, "complete", "Main did not complete synthesis");

    await restart("12-restart");
    for (const snapshot of app.nodes.getByProject(projectId)) {
      assert.equal(snapshot.status, "completing");
      assert.equal(snapshot.confirmation?.confirmedBy, "main");
      assert.deepEqual(projectNode(snapshot.node.id, app.nodes.getEvents(snapshot.node.id)), snapshot);
    }
    assert.deepEqual(projectRoadmap(projectId, app.roadmaps.getEvents(projectId), app.nodes.getByProject(projectId).map(value => value.node)), app.roadmaps.get(projectId));
    console.log(JSON.stringify({
      outcome: "passed", turns: turns.length, modelSteps: turns.reduce((total, value) => total + value.turn.steps, 0),
      roadmapRevision: app.roadmaps.get(projectId)?.revision,
      nodes: app.nodes.getByProject(projectId).map(value => ({ id: value.node.id, status: value.status, reworkCount: value.reworkCount ?? 0 })),
    }));
  } catch (error: unknown) {
    await writeEvidence(evidenceDir, "failure", {
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      state: activeProject === undefined ? null : projectState(app, activeProject),
    });
    throw error;
  } finally {
    await app.fiber.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  }
}

async function durable(app: Context, projectId: ProjectId, sessions: readonly SessionId[]) {
  return {
    project: app.projects.get(projectId),
    workspace: await app.projectWorkspaces.get(projectId),
    roadmap: app.roadmaps.get(projectId),
    nodes: app.nodes.getByProject(projectId),
    resources: app.resources.listByProject(projectId),
    mailbox: app.mailbox.getHistory(projectId),
    sessions: sessions.map(sessionId => app.sessions.getEvents(sessionId)),
  };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
