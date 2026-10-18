import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import type { Dataset } from "./data.js";
import { SUMMARY_PATH, validateSummary, type Validation } from "./protocol.js";

export interface HandoffRecord {
  readonly writer: "acceptance-harness";
  readonly source: {
    readonly kind: "node-submission";
    readonly nodeId: string;
    readonly sessionId: string | null;
    readonly turnId: string | null;
    readonly submittedAt: string;
    readonly resourceIds: readonly string[];
    readonly criteria: readonly { readonly criterion: string; readonly satisfied: boolean; readonly note: string }[];
    readonly remaining: readonly string[];
  };
  readonly original: {
    readonly text: string;
    readonly bytes: number;
    readonly validation: Validation;
  };
  readonly file: {
    readonly path: string;
    readonly writer: "acceptance-harness";
    readonly bytes: number;
    readonly matchesOriginal: true;
  };
  readonly resource: {
    readonly id: string;
    readonly owner: unknown;
    readonly access: unknown;
    readonly entryRef: string;
    readonly revision: number;
    readonly matchesOriginal: true;
  };
}

export async function materializeHandoff(
  app: Context,
  projectId: ProjectId,
  workspace: string,
  nodeAId: NodeId,
  dataset: Dataset,
): Promise<HandoffRecord> {
  const node = app.nodes.get(nodeAId);
  assert(node !== undefined, "Node A is missing during handoff.");
  assert.equal(node.status, "submitted", `Node A is ${node.status}, not submitted, during handoff.`);
  const submission = node.submission;
  assert(submission !== undefined, "Node A has no submission during handoff.");
  assert.equal(submission.resourceIds.length, 0, "Node A submission must not cite Resources.");
  const original = submission.summary;
  const validation = validateSummary(original, dataset.expected);
  assert(
    validation.ok,
    `Node A completion summary is not valid summary JSON: ${validation.errors.join("; ")}`,
  );

  const target = join(workspace, SUMMARY_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, original, "utf8");
  const materialized = await readFile(target, "utf8");
  assert.equal(materialized, original, "Materialized summary differs from the original Node A submission.");

  const resource = await app.resources.publish({
    projectId,
    owner: { kind: "main" },
    sourceRef: SUMMARY_PATH,
    name: "Ledger summary (Node A submission)",
    description: "Exact original Node A completion summary materialized by the acceptance harness.",
    type: "application/json",
  });
  const shared = app.resources.setAccess({
    projectId,
    actor: { kind: "main" },
    resourceId: resource.id,
    expectedRevision: resource.revision,
    access: { kind: "public" },
  });
  const entry = await app.resources.resolveEntry(projectId, shared.id);
  const published = await readFile(entry.path, "utf8");
  assert.equal(published, original, "Published Resource content differs from the original Node A submission.");

  const events = node.sessionId === undefined ? [] : app.sessions.getEvents(node.sessionId);
  const lastTurn = [...events].reverse().find(event => event.type === "turn-ended");
  return Object.freeze({
    writer: "acceptance-harness",
    source: Object.freeze({
      kind: "node-submission",
      nodeId: String(nodeAId),
      sessionId: node.sessionId === undefined ? null : String(node.sessionId),
      turnId: lastTurn?.type === "turn-ended" ? String(lastTurn.data.turnId) : null,
      submittedAt: submission.submittedAt,
      resourceIds: Object.freeze(submission.resourceIds.map(String)),
      criteria: Object.freeze(submission.criteria.map(check => Object.freeze({
        criterion: check.criterion,
        satisfied: check.satisfied,
        note: check.note,
      }))),
      remaining: Object.freeze([...submission.remaining]),
    }),
    original: Object.freeze({
      text: original,
      bytes: Buffer.byteLength(original, "utf8"),
      validation,
    }),
    file: Object.freeze({
      path: SUMMARY_PATH,
      writer: "acceptance-harness",
      bytes: Buffer.byteLength(materialized, "utf8"),
      matchesOriginal: true,
    }),
    resource: Object.freeze({
      id: String(shared.id),
      owner: shared.owner,
      access: shared.access,
      entryRef: shared.entryRef,
      revision: shared.revision,
      matchesOriginal: true,
    }),
  });
}
