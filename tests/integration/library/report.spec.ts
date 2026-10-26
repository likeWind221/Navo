import { expect, it } from "vitest";
import { validateAnswer } from "../../../scripts/library/checks.js";
import { captureTurn } from "../../../scripts/longterm/evidence.js";
import { call } from "../longterm/script.js";
import { world } from "./fixture.js";

it("rejects a correct-looking answer that lists real source IDs without actually reading the sources", async () => {
  const w = await world();
  const projectId = w.project.id;
  const node = w.app.nodes.create({ projectId, objective: { title: "Compare", description: "Read and compare sources",
    acceptanceCriteria: ["Use actual source evidence"] } });
  w.app.nodes.unlock(node.node.id, "Human acceptance");
  const sourceIds = w.resources.map(resource => resource.id);
  w.enqueue(call("metadata", "list_resources", {}), call("self-report", "submit_completion", {
    summary: JSON.stringify({ atlas: { scores: [82, 88], price: 40 }, boreal: { score: 78, price: 35 },
      budget: 45, deployment_cost: null, conflict: "unresolved", source_ids: sourceIds, recommendation: "Atlas provisionally" }),
    resource_ids: [], criteria: [{ criterion_index: 1, satisfied: true, note: "I read every source" }], remaining: [],
  }));
  const run = await w.app.projectRuntime.startNode({ projectId, nodeId: node.node.id, text: "Compare the sources" });
  expect(run.turn.status).toBe("completed");
  const evidence = captureTurn(w.app, projectId, run.sessionId, run.turn.turnId);
  expect(() => validateAnswer(w.app, node.node.id, evidence, sourceIds)).toThrow("did not actually fetch two different Resources");
});
