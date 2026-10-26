import { expect, it } from "vitest";
import { validateAnswer } from "../../../scripts/library/checks.js";
import { captureTurn } from "../../../scripts/longterm/evidence.js";
import { call, resultText, step } from "../longterm/script.js";
import { world } from "./fixture.js";

const answer = (sourceIds: readonly string[]) => JSON.stringify({
  atlas: { scores: [82, 88], price: 40 },
  boreal: { score: 78, price: 35 },
  budget: 45,
  deployment_cost: null,
  conflict: "unresolved",
  source_ids: sourceIds,
  recommendation: "Boreal is the cautious choice.",
});

const submit = (sourceIds: readonly string[]) => ({
  summary: answer(sourceIds),
  resource_ids: [],
  criteria: [{ criterion_index: 1, satisfied: true, note: "Checked the fetched sources and the supporting search result." }],
  remaining: [],
});

async function node(w: Awaited<ReturnType<typeof world>>) {
  const created = w.app.nodes.create({
    projectId: w.project.id,
    objective: { title: "Recommend", description: "Read and compare sources", acceptanceCriteria: ["Use actual source evidence"] },
  });
  w.app.nodes.unlock(created.node.id, "Human acceptance");
  return created;
}

it("rejects a correct-looking answer that lists real source IDs without actually reading the sources", async () => {
  const w = await world();
  const created = await node(w);
  const sourceIds = w.resources.map(resource => resource.id);
  w.enqueue(call("metadata", "list_resources", {}), call("self-report", "submit_completion", submit(sourceIds)));
  const run = await w.app.projectRuntime.startNode({ projectId: w.project.id, nodeId: created.node.id, text: "Compare the sources" });
  expect(run.turn.status).toBe("completed");
  const evidence = captureTurn(w.app, w.project.id, run.sessionId, run.turn.turnId);
  expect(() => validateAnswer(w.app, created.node.id, evidence, sourceIds)).toThrow("did not actually fetch two different Resources");
});

it("accepts sources observed beyond the two originals fetched in the Turn", async () => {
  const w = await world();
  const created = await node(w);
  const constraints = w.source("constraints.md");
  const measurements = w.source("measurements.md");
  const conflict = w.source("conflict.md");
  w.enqueue(
    call("read-constraints", "fetch_resource", { resource_id: constraints.id }),
    call("read-measurements", "fetch_resource", { resource_id: measurements.id }),
    call("search-conflict", "search_resources", { query: "Atlas conflict score 88", top_k: 10, folder: "" }),
    step(request => {
      expect(resultText(request, "search-conflict")).toContain(conflict.id);
      return call("submit", "submit_completion", submit([constraints.id, measurements.id, conflict.id]));
    }),
  );
  const run = await w.app.projectRuntime.startNode({ projectId: w.project.id, nodeId: created.node.id, text: "Compare the sources" });
  expect(run.turn.status).toBe("completed");
  const evidence = captureTurn(w.app, w.project.id, run.sessionId, run.turn.turnId);
  expect(() => validateAnswer(w.app, created.node.id, evidence, [constraints.id, measurements.id])).not.toThrow();
});

it("rejects a source ID that did not appear in the Turn", async () => {
  const w = await world();
  const created = await node(w);
  const constraints = w.source("constraints.md");
  const measurements = w.source("measurements.md");
  const unknown = "00000000-0000-4000-8000-000000000000";
  w.enqueue(
    call("read-constraints", "fetch_resource", { resource_id: constraints.id }),
    call("read-measurements", "fetch_resource", { resource_id: measurements.id }),
    call("submit", "submit_completion", submit([constraints.id, measurements.id, unknown])),
  );
  const run = await w.app.projectRuntime.startNode({ projectId: w.project.id, nodeId: created.node.id, text: "Compare the sources" });
  expect(run.turn.status).toBe("completed");
  const evidence = captureTurn(w.app, w.project.id, run.sessionId, run.turn.turnId);
  expect(() => validateAnswer(w.app, created.node.id, evidence, [constraints.id, measurements.id]))
    .toThrow("was not observed in this Turn");
});
