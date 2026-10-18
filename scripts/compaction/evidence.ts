import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "cordis";

import type { NodeId, ProjectId, ResourceId } from "../../src/brand/ids.js";
import type { Dataset } from "./data.js";
import { SPOT_CHECK_BATCHES } from "./protocol.js";
import { reviewTurnId } from "./turns.js";

export interface ReviewEvidence {
  readonly resourceId: ResourceId;
  readonly name: string;
  readonly text: string;
  readonly directoryLines: number;
  readonly batches: readonly {
    readonly batch: number;
    readonly sourceId: ResourceId;
    readonly startLine: number;
    readonly lines: readonly string[];
  }[];
}

export async function publishReviewEvidence(
  app: Context,
  projectId: ProjectId,
  workspace: string,
  dataset: Dataset,
): Promise<ReviewEvidence> {
  const directoryLines = dataset.files.length + 2;
  const body: string[] = [];
  const batches: ReviewEvidence["batches"][number][] = [];
  for (const [index, file] of dataset.files.entries()) {
    const original = await readFile(join(workspace, file.path), "utf8");
    const source = await app.resources.publish({
      projectId, owner: { kind: "main" }, sourceRef: file.path,
      name: `Original ledger batch ${index + 1}`, type: "text/plain",
      description: "Original fictional input, published by the acceptance harness for Main review.",
    });
    const lines = original.split("\n").flatMap((line, lineIndex) => line.startsWith("RECORD")
      ? [`source line ${lineIndex + 1}: ${line}`] : []);
    const startLine = directoryLines + body.length + 1;
    batches.push({ batch: index + 1, sourceId: source.id, startLine, lines });
    body.push(...lines);
  }
  const text = [
    "Acceptance-harness excerpts: every RECORD line copied from each original; no computed answers.",
    "Directory: batch -> excerpt lines -> original Resource ID. Source line numbers appear on each record.",
    ...batches.map(batch => `Batch ${batch.batch}: lines ${batch.startLine}-${batch.startLine + batch.lines.length - 1}; original ${batch.sourceId}`),
    ...body,
  ].join("\n");
  await mkdir(join(workspace, "review"), { recursive: true });
  await writeFile(join(workspace, "review", "records.txt"), text, "utf8");
  const name = "Ledger review evidence";
  const resource = await app.resources.publish({
    projectId, owner: { kind: "main" }, sourceRef: "review/records.txt", name, type: "text/plain",
    description: "Main-only source-linked RECORD excerpts and directory; not a Node claim or a correctness verdict.",
  });
  return { resourceId: resource.id, name, text, directoryLines, batches };
}

export function reviewInstructions(evidence: ReviewEvidence, verify: boolean): string {
  return [
    `Main review evidence: fetch_resource resource_id=${evidence.resourceId} (${evidence.name}), start_line=1, max_lines=${evidence.directoryLines} for the directory.`,
    "This Main-only Resource contains all original RECORD lines with original locations, mechanically extracted by the acceptance harness; no precomputed answers. Node workers must still follow their original read-only task protocol.",
    verify
      ? "For Main review, compare final JSON with the summary Resource, check the per-batch totals add up, and independently recompute batches 1, 5 and 10 from their small excerpt ranges."
      : "For Main review, check the submission JSON and internal totals, confirm the required reads in read_node_turn, and select at least one batch excerpt to check its reported values. This is a spot-check, not a full raw-data recomputation.",
    "Use fetch_resource with explicit small start_line/max_lines ranges. Only expand to an original source range if there is a concrete doubt. Empty submitted resource_ids is required here; these review materials belong to the harness, not the Node deliverable.",
  ].join(" ");
}

export function assertReviewEvidence(
  app: Context,
  projectId: ProjectId,
  nodeAId: NodeId,
  nodeBId: NodeId,
  evidence: ReviewEvidence,
) {
  for (const id of [evidence.resourceId, ...evidence.batches.map(batch => batch.sourceId)]) {
    const resource = app.resources.getVisible(projectId, id, { kind: "main" });
    assert(resource !== undefined && resource.revision === 1 && resource.access.kind === "private",
      `Review evidence ${id} was removed or changed.`);
  }
  const project = app.projects.get(projectId)!;
  const events = app.sessions.getEvents(project.mainSessionId);
  return [nodeAId, nodeBId].map((nodeId, index) => {
    const turnId = reviewTurnId(app, projectId, nodeId);
    assert(turnId !== undefined, `Node ${nodeId} has no review Turn.`);
    const fetchIds = new Set(events.flatMap(event => event.type === "tool-call-requested"
      && event.data.turnId === turnId && event.data.toolCall.name === "fetch_resource"
      ? [event.data.toolCall.id] : []));
    const reads = events.flatMap(event => {
      if (event.type !== "tool-call-result" || event.data.turnId !== turnId) return [];
      return event.data.message.content.flatMap(block => block.type === "tool-result"
        && fetchIds.has(block.toolCallId) && !block.isError
        ? [block.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n")] : []);
    });
    const excerpts = reads.filter(text => text.startsWith(`Resource: ${evidence.name} (${evidence.resourceId})\n`));
    const covered = evidence.batches.filter(batch => batch.lines.every((line, offset) => {
      const match = /^source line (\d+): (.*)$/.exec(line)!;
      return excerpts.some(text => text.split("\n").includes(`${batch.startLine + offset}: ${line}`))
        || reads.some(text => text.startsWith(`Resource: Original ledger batch ${batch.batch} (${batch.sourceId})\n`)
          && text.split("\n").includes(`${match[1]}: ${match[2]}`));
    }));
    if (index === 0) assert(covered.length > 0, "Main did not read one complete batch excerpt for Node A.");
    else assert(SPOT_CHECK_BATCHES.every(batch => covered.some(entry => entry.batch === batch)),
      "Main did not read the three required batch excerpts for Node B.");
    const usages = events.flatMap(event => event.type === "assistant-message" && event.data.turnId === turnId
      && event.data.usage !== undefined ? [event.data.usage] : []);
    return { nodeId: String(nodeId), successfulFetches: reads.length,
      returnedChars: reads.reduce((total, text) => total + text.length, 0),
      readBatches: covered.map(batch => batch.batch),
      usage: usages.length === 0 ? null : {
        reportedSteps: usages.length,
        inputTokens: usages.reduce((total, usage) => total + usage.inputTokens, 0),
        outputTokens: usages.reduce((total, usage) => total + usage.outputTokens, 0),
      } };
  });
}
