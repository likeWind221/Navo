import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import { createDataset, writeDataset } from "../../../scripts/compaction/data.js";
import { assertReviewEvidence, reviewInstructions } from "../../../scripts/compaction/evidence.js";
import { createProject } from "../../../scripts/compaction/setup.js";
import { assertRestart, captureRestartState } from "../../../scripts/compaction/state.js";
import { reviewTurnId } from "../../../scripts/compaction/turns.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createWorld } from "./helpers.js";
import { UNBOUNDED } from "./models.js";
import { reviewReplies } from "./script.js";

function call(id: string, name: string, args: unknown): MockLLMEntry {
  return modelResponse([{ type: "tool-call", id: createToolCallId(id), name,
    arguments: JSON.stringify(args) }], "tool-calls");
}

function submit(id: string) {
  return call(id, "submit_completion", { summary: "Claimed result, not independently verified", resource_ids: [],
    criteria: [1, 2].map(criterion_index => ({ criterion_index, satisfied: true, note: "Claim only" })), remaining: [] });
}

describe("BUG-017 targeted review evidence", () => {
  it("publishes source-linked excerpts privately, preserves exact RECORD lines and survives restart", async () => {
    const dataset = createDataset();
    const tasks: MockLLMEntry[] = [];
    const world = await createWorld({ model: UNBOUNDED, fileTools: true, tasks });
    let app = await world.open();
    await writeDataset(world.workspaceRoot, dataset);
    const { projectId, nodeAId, nodeBId, reviewEvidence: evidence } = await createProject(app, world.workspaceRoot, dataset);
    const project = app.projects.get(projectId)!;
    expect(app.resources.listByProject(projectId)).toHaveLength(11);
    for (const resource of app.resources.listByProject(projectId)) {
      expect(resource.access.kind).toBe("private");
      expect(app.resources.getVisible(projectId, resource.id, { kind: "node", nodeId: nodeAId })).toBeUndefined();
      expect(app.resources.getVisible(projectId, resource.id, { kind: "node", nodeId: nodeBId })).toBeUndefined();
    }
    for (const [index, batch] of evidence.batches.entries()) {
      const original = await readFile(join(world.workspaceRoot, dataset.files[index]!.path), "utf8");
      const expected = original.split("\n").flatMap((line, i) => line.startsWith("RECORD") ? [`source line ${i + 1}: ${line}`] : []);
      expect(batch.lines).toEqual(expected);
      expect(evidence.text.split("\n").slice(batch.startLine - 1, batch.startLine - 1 + batch.lines.length)).toEqual(expected);
      const entry = await app.resources.resolveEntry(projectId, batch.sourceId);
      expect(await readFile(entry.path, "utf8")).toBe(original);
    }
    expect(evidence.batches.flatMap(batch => batch.lines)).toHaveLength(80);
    expect(evidence.text).not.toMatch(/Background note|totalSum|totalAnomalies|verified=true/);
    expect(app.nodes.get(nodeBId)!.node.objective.description).toContain(reviewInstructions(evidence, true));
    const before = captureRestartState(app, projectId);
    app = await world.restart(app);
    assertRestart(before, captureRestartState(app, projectId));
    expect(world.requests()).toBe(0);

    const first = evidence.batches[0]!;
    const fetch = (id: string, start: number, max: number) => call(id, "fetch_resource", {
      resource_id: evidence.resourceId, start_line: start, max_lines: max,
    });
    tasks.push(submit("submit-a"), fetch("fetch-a", first.startLine, first.lines.length),
      ...reviewReplies("complete-a", "complete"), submit("submit-b"),
      ...[1, 5, 10].map(batch => {
        const part = evidence.batches[batch - 1]!;
        return fetch(`fetch-b-${batch}`, part.startLine, part.lines.length);
      }), ...reviewReplies("complete-b", "complete"));
    for (const nodeId of [nodeAId, nodeBId]) {
      await app.projectRuntime.startNode({ projectId, nodeId, text: "Submit" });
      await app.projectRuntime.startReview({ projectId, nodeId, text: "Inspect the relevant excerpt" });
    }
    expect(reviewTurnId(app, projectId, nodeAId)).not.toBe(app.nodes.get(nodeAId)!.lastReview!.turnId);
    expect(reviewTurnId(app, projectId, nodeBId)).not.toBe(reviewTurnId(app, projectId, nodeAId));
    const report = assertReviewEvidence(app, projectId, nodeAId, nodeBId, evidence);
    expect(report.map(item => item.readBatches)).toEqual([[1], [1, 5, 10]]);
    expect(report.map(item => item.successfulFetches)).toEqual([1, 3]);
    expect(report[1]!.returnedChars).toBeLessThan(3_000);
    const results = app.sessions.getEvents(project.mainSessionId).flatMap(event => event.type === "tool-call-result"
      ? event.data.message.content.flatMap(block => block.type === "tool-result"
        ? block.content.flatMap(part => part.type === "text" ? [part.text] : []) : []) : []);
    expect(results.some(text => text.includes("source line 12: RECORD 01-01"))).toBe(true);
    expect(results.join("\n")).not.toContain("Background note");
    const incomplete = { ...evidence, batches: evidence.batches.map(batch => batch.batch === 1
      ? { ...batch, lines: [...batch.lines, "source line 999: RECORD missing"] } : batch) };
    expect(() => assertReviewEvidence(app, projectId, nodeAId, nodeBId, incomplete)).toThrow(/did not read/);
  }, 15_000);
});

