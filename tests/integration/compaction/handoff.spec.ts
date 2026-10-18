import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDataset, type Dataset } from "../../../scripts/compaction/data.js";
import { materializeHandoff } from "../../../scripts/compaction/handoff.js";
import { runPreflight } from "../../../scripts/compaction/preflight.js";
import {
  SPOT_CHECK_BATCHES,
  SUMMARY_PATH,
} from "../../../scripts/compaction/protocol.js";
import { assertRestart, captureRestartState } from "../../../scripts/compaction/state.js";
import { createProject, createWorld } from "./helpers.js";
import { UNBOUNDED } from "./models.js";
import { readReply, submitReply } from "./script.js";

function summaryText(dataset: Dataset): string {
  const expected = dataset.expected;
  return JSON.stringify({
    batches: expected.batches.map(batch => ({
      batch: batch.batch,
      records: batch.records,
      sum: batch.sum,
      anomalies: batch.anomalies,
    })),
    totalRecords: expected.totalRecords,
    totalSum: expected.totalSum,
    totalAnomalies: expected.totalAnomalies,
    anomalyRecords: [...expected.anomalyRecords],
  });
}

function finalText(dataset: Dataset): string {
  const expected = dataset.expected;
  return JSON.stringify({
    verified: true,
    totalRecords: expected.totalRecords,
    totalSum: expected.totalSum,
    totalAnomalies: expected.totalAnomalies,
    spotChecks: SPOT_CHECK_BATCHES.map(batch => {
      const entry = expected.batches.find(candidate => candidate.batch === batch)!;
      return {
        batch,
        records: entry.records,
        sum: entry.sum,
        anomalies: entry.anomalies,
      };
    }),
    discrepancies: [],
  });
}

describe("F12.7 acceptance handoff", () => {
  it("materializes the exact Node A submission as a public Main Resource and preserves it across restart", async () => {
    const dataset = createDataset();
    const summary = summaryText(dataset);
    const final = finalText(dataset);
    const world = await createWorld({
      model: UNBOUNDED,
      fileTools: true,
      tasks: [
        submitReply("handoff-submit-a", summary),
        readReply("handoff-read-summary", SUMMARY_PATH),
        submitReply("handoff-submit-b", final),
      ],
    });
    let app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Handoff A", "Handoff B"]);
    const nodeA = nodeIds[0]!;
    const nodeB = nodeIds[1]!;

    const submittedA = await app.projectRuntime.startNode({
      projectId: project.id,
      nodeId: nodeA,
      text: "Submit the computed summary.",
    });
    expect(submittedA.turn.status).toBe("completed");
    const submissionBefore = structuredClone(app.nodes.get(nodeA)!.submission);

    const handoff = await materializeHandoff(app, project.id, world.workspaceRoot, nodeA, dataset);

    expect(handoff.writer).toBe("acceptance-harness");
    expect(handoff.original.text).toBe(summary);
    expect(handoff.original.validation).toEqual({ ok: true, errors: [] });
    expect(handoff.source.nodeId).toBe(String(nodeA));
    expect(handoff.source.sessionId).toBe(String(app.nodes.get(nodeA)!.sessionId));
    expect(handoff.source.resourceIds).toEqual([]);
    expect(handoff.resource.owner).toEqual({ kind: "main" });
    expect(handoff.resource.access).toEqual({ kind: "public" });
    expect(await readFile(join(world.workspaceRoot, SUMMARY_PATH), "utf8")).toBe(summary);
    expect(app.nodes.get(nodeA)!.submission).toEqual(submissionBefore);

    const resource = app.resources.listByProject(project.id).find(candidate => candidate.owner.kind === "main")!;
    expect(resource).toBeDefined();
    expect(app.resources.getVisible(project.id, resource.id, { kind: "node", nodeId: nodeB })).toBeDefined();

    app.projectRuntime.confirmCompletion(project.id, nodeA, {
      confirmedBy: "human",
      reason: "Handoff test accepted the upstream result",
      reviewedRevision: app.nodes.get(nodeA)!.revision,
    });
    const submittedB = await app.projectRuntime.startNode({
      projectId: project.id,
      nodeId: nodeB,
      text: "Read the shared summary and submit.",
    });
    expect(submittedB.turn.status).toBe("completed");
    expect(app.nodes.get(nodeB)?.status).toBe("submitted");
    const sessionB = app.nodes.get(nodeB)!.sessionId!;
    const readResult = app.sessions.getEvents(sessionB).find(event => event.type === "tool-call-result");
    expect(readResult?.type).toBe("tool-call-result");
    const resultText = readResult?.type === "tool-call-result"
      ? readResult.data.message.content.flatMap(block => block.type === "tool-result"
        ? block.content.flatMap(item => item.type === "text" ? [item.text] : [])
        : []).join("\n")
      : "";
    expect(resultText).toContain(summary);

    const before = captureRestartState(app, project.id);
    app = await world.restart(app);
    assertRestart(before, captureRestartState(app, project.id));

    const restored = app.resources.listByProject(project.id).find(candidate => candidate.owner.kind === "main")!;
    expect(app.resources.getVisible(project.id, restored.id, { kind: "node", nodeId: nodeB })).toBeDefined();
    const entry = await app.resources.resolveEntry(project.id, restored.id);
    expect(await readFile(entry.path, "utf8")).toBe(summary);
    expect(await readFile(join(world.workspaceRoot, SUMMARY_PATH), "utf8")).toBe(summary);
    expect(app.nodes.get(nodeA)!.submission).toEqual(submissionBefore);
  });

  const invalidCases: readonly { label: string; make: (dataset: Dataset) => string }[] = [
    { label: "malformed JSON", make: () => "not json" },
    {
      label: "wrong values",
      make: (dataset) => {
        const value = JSON.parse(summaryText(dataset)) as { totalSum: number };
        value.totalSum += 1;
        return JSON.stringify(value);
      },
    },
    { label: "fenced JSON", make: (dataset) => "```json\n" + summaryText(dataset) + "\n```" },
  ];

  it.each(invalidCases)("rejects $label before writing or publishing", async ({ make }) => {
    const dataset = createDataset();
    const summary = make(dataset);
    const world = await createWorld({
      model: UNBOUNDED,
      fileTools: true,
      tasks: [submitReply("reject-submit-a", summary)],
    });
    const app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Reject A", "Reject B"]);
    const nodeA = nodeIds[0]!;
    await app.projectRuntime.startNode({
      projectId: project.id,
      nodeId: nodeA,
      text: "Submit the computed summary.",
    });
    const submissionBefore = structuredClone(app.nodes.get(nodeA)!.submission);

    await expect(materializeHandoff(app, project.id, world.workspaceRoot, nodeA, dataset))
      .rejects.toThrow(/completion summary is not valid summary JSON/);
    await expect(readFile(join(world.workspaceRoot, SUMMARY_PATH), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(app.resources.listByProject(project.id).filter(candidate => candidate.owner.kind === "main")).toHaveLength(0);
    expect(app.nodes.get(nodeA)!.submission).toEqual(submissionBefore);
  });

  it("reports the required profile capabilities and rejects a Node profile without read", async () => {
    const dataset = createDataset();
    const supported = await createWorld({ model: UNBOUNDED, fileTools: true, tasks: [] });
    const supportedApp = await supported.open();
    const supportedProject = await createProject(
      supportedApp,
      supported.workspaceRoot,
      ["Capability A", "Capability B"],
    );
    const report = runPreflight(
      supportedApp,
      supportedProject.project.id,
      supportedProject.nodeIds[0]!,
      supportedProject.nodeIds[1]!,
      dataset,
    );
    expect(report.capabilities.nodeA.required).toEqual(["read", "submit_completion"]);
    expect(report.capabilities.nodeA.missing).toEqual([]);
    expect(report.capabilities.nodeB.missing).toEqual([]);
    expect(report.capabilities.mainReview.required).toEqual(["read_node_turn", "submit_review", "fetch_resource"]);
    expect(report.capabilities.mainReview.missing).toEqual([]);

    const unsupported = await createWorld({ model: UNBOUNDED, tasks: [] });
    const unsupportedApp = await unsupported.open();
    const unsupportedProject = await createProject(
      unsupportedApp,
      unsupported.workspaceRoot,
      ["No Read A", "No Read B"],
    );
    expect(() => runPreflight(
      unsupportedApp,
      unsupportedProject.project.id,
      unsupportedProject.nodeIds[0]!,
      unsupportedProject.nodeIds[1]!,
      dataset,
    )).toThrow(/Node A is missing required capabilities: read/);
  });
});
