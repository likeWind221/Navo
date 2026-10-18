import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "cordis";

import type { ProjectId, SessionId } from "../src/brand/ids.js";
import { resolveAcceptanceHostConfig } from "./acceptance.js";
import { assertArtifacts, assertCompactions, assertCompletion } from "./compaction/checks.js";
import {
  ACCEPTANCE_TIMEOUT_MS,
  MIN_PRESSURE_COMPACTIONS,
  MODEL,
  PROVIDER,
  REQUEST_LIMIT,
} from "./compaction/config.js";
import { createDataset, writeDataset } from "./compaction/data.js";
import { materializeHandoff } from "./compaction/handoff.js";
import { assertReviewEvidence } from "./compaction/evidence.js";
import {
  captureFailureState,
  describe,
  disposeWithin,
  stopAndSettle,
  type DisposeResult,
} from "./compaction/lifecycle.js";
import { runPreflight } from "./compaction/preflight.js";
import { EXPIRED, RequestLedger, deadlineAfter, raceDeadline } from "./compaction/request.js";
import { abortActive, createProject, openApp } from "./compaction/setup.js";
import { assertRestart, captureRestartState, restartEvidence } from "./compaction/state.js";
import { turnSummaries } from "./compaction/turns.js";
import { watchSecondCompaction } from "./compaction/watch.js";
import { writeEvidence } from "./longterm/evidence.js";

const SETTLE_TIMEOUT_MS = 15_000;
const DISPOSE_TIMEOUT_MS = 15_000;

class AcceptanceTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceTimeout";
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const preflightOnly = process.argv.includes("--preflight");
  const workspace = await mkdtemp(join(tmpdir(), "navo-f127-workspace-"));
  const storage = await mkdtemp(join(tmpdir(), "navo-f127-storage-"));
  const database = join(storage, "navo.db");
  const evidenceDir = process.env.NAVO_EVIDENCE_DIR?.trim()
    || join(tmpdir(), `navo-f127-evidence-${Date.now()}`);
  const progress = (value: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  let stage = "setup";
  const ledger = new RequestLedger(REQUEST_LIMIT, (entry, used) => progress({
    event: "request",
    stage,
    index: entry.index,
    used,
    limit: REQUEST_LIMIT,
    kind: entry.kind,
    status: entry.status,
  }));
  const setStage = (value: string): void => {
    stage = value;
    progress({ event: "stage", stage: value, used: ledger.used });
  };
  const dataset = createDataset();
  await writeDataset(workspace, dataset);
  await mkdir(join(workspace, "out"), { recursive: true });
  const deadline = deadlineAfter(ACCEPTANCE_TIMEOUT_MS - (Date.now() - startedAt));
  let app: Context | undefined;
  let projectId: ProjectId | undefined;
  let sessionA: SessionId | undefined;
  let passed = false;
  let abortFailure: string | null = null;
  const onExhausted = (): void => {
    if (app !== undefined && projectId !== undefined) {
      abortFailure = abortActive(app, projectId);
      if (abortFailure !== null) {
        progress({ event: "abort-failure", stage, error: abortFailure });
      }
    }
  };

  try {
    const config = preflightOnly ? undefined : resolveAcceptanceHostConfig(process.env, MODEL);
    app = await openApp(database, config, ledger, onExhausted);
    const nodes = await createProject(app, workspace, dataset);
    const project = nodes.projectId;
    const nodeA = nodes.nodeAId;
    const nodeB = nodes.nodeBId;
    projectId = project;
    setStage("preflight");
    const preflight = runPreflight(app, project, nodeA, nodeB, dataset);
    await writeEvidence(evidenceDir, "review-materials", nodes.reviewEvidence);
    await writeEvidence(evidenceDir, "preflight", preflight);
    if (preflightOnly) {
      passed = true;
      progress({
        event: "outcome",
        outcome: "preflight",
        evidenceDir,
        projectId: preflight.projectId,
        mainSessionId: preflight.mainSessionId,
        dataTokens: preflight.dataTokens,
      });
      return;
    }
    assert(config !== undefined, "Acceptance configuration is missing.");
    setStage("stage1");
    const watch = watchSecondCompaction(app, project, nodeA);
    let first;
    try {
      first = await raceDeadline(app.autoRun.start(project), deadline);
    } finally {
      watch.dispose();
    }
    if (first === EXPIRED) throw new AcceptanceTimeout("Acceptance exceeded 20 minutes during stage 1.");
    assert.equal(first.status, "paused", `Stage 1 AutoRun stopped with ${first.status}.`);
    assert.equal(first.reason, "human-paused", `Stage 1 AutoRun paused with ${String(first.reason)}.`);
    assert.equal(watch.pauseError, null, `AutoRun pause failed: ${String(watch.pauseError)}.`);
    assert.equal(app.projectRuntime.isMainActive(project), false, "Main Turn is still active at the pause boundary.");
    for (const node of app.nodes.getByProject(project)) {
      assert.equal(app.projectRuntime.isNodeActive(node.node.id), false, `Node ${node.node.id} is still active at the pause boundary.`);
    }
    const aSession = app.nodes.get(nodeA)?.sessionId;
    assert(aSession !== undefined, "Node A has no Session.");
    assert.equal(app.nodes.get(nodeA)?.status, "submitted", "Node A did not submit before the pause boundary.");
    sessionA = aSession;
    const handoff = await materializeHandoff(app, project, workspace, nodeA, dataset);
    await writeEvidence(evidenceDir, "handoff", handoff);
    const before = captureRestartState(app, project);
    const firstCompactions = assertCompactions(
      before.sessions.find(session => session.evidence.sessionId === String(aSession))!.evidence.compactions,
      "before restart",
    );
    assert(
      watch.completed >= MIN_PRESSURE_COMPACTIONS,
      `Only ${watch.completed} successful pressure compactions were observed before pause.`,
    );
    await writeEvidence(evidenceDir, "before-restart", {
      compactions: firstCompactions.length,
      handoff: {
        writer: handoff.writer,
        resourceId: handoff.resource.id,
        originalBytes: handoff.original.bytes,
      },
      state: restartEvidence(before),
    });
    const firstDispose = await disposeWithin(app, DISPOSE_TIMEOUT_MS);
    assert(firstDispose.disposed && firstDispose.error === null, "Host disposed with an error before restart.");
    app = undefined;

    setStage("restart");
    const requestsBeforeRestart = ledger.used;
    app = await openApp(database, config, ledger, onExhausted);
    const requestsAfterReopen = ledger.used;
    assert.equal(requestsAfterReopen, requestsBeforeRestart, "Restart issued a model request before explicit start.");
    assert.equal(app.autoRun.get(project), undefined, "AutoRun state survived the restart.");
    const after = captureRestartState(app, project);
    assertRestart(before, after);
    await writeEvidence(evidenceDir, "restart", {
      requestsBeforeRestart,
      requestsAfterReopen,
      requestsAfterRestart: requestsAfterReopen,
      autoRunSnapshotAbsent: true,
      comparison: "in-memory deepEqual of project, workspace, domain state, session events and effective history",
      state: restartEvidence(after),
    });

    setStage("stage2");
    const second = await raceDeadline(app.autoRun.start(project), deadline);
    if (second === EXPIRED) throw new AcceptanceTimeout("Acceptance exceeded 20 minutes during stage 2.");
    assert.equal(second.status, "completed", `Stage 2 AutoRun stopped with ${second.status}.`);
    assert.equal(second.reason, "roadmap-complete", `Stage 2 AutoRun ended with ${String(second.reason)}.`);
    const turns = turnSummaries(app, project, dataset.expected.totalSum);
    const artifacts = await assertArtifacts(app, workspace, project, nodeA, nodeB, dataset);
    assertCompletion(app, project, nodeA, nodeB, turns, dataset);
    const reviewEvidence = assertReviewEvidence(app, project, nodeA, nodeB, nodes.reviewEvidence);
    const finalState = captureRestartState(app, project);
    const finalSession = finalState.sessions.find(session => session.evidence.sessionId === String(aSession));
    assert(finalSession !== undefined, "Node A Session is missing at completion.");
    const finalCompactions = assertCompactions(finalSession.evidence.compactions, "after restart");
    const elapsedMs = Date.now() - startedAt;
    assert(elapsedMs <= ACCEPTANCE_TIMEOUT_MS, `Acceptance took ${elapsedMs}ms.`);
    assert(ledger.used <= REQUEST_LIMIT, `Acceptance used ${ledger.used} requests.`);
    const summaryRequests = ledger.entries.filter(entry => entry.kind === "summary").length;
    assert(
      summaryRequests >= finalCompactions.length,
      `Compaction summaries (${summaryRequests}) are fewer than successful compactions (${finalCompactions.length}).`,
    );
    await writeEvidence(evidenceDir, "final", {
      outcome: "passed",
      provider: PROVIDER,
      model: MODEL,
      project,
      sessions: { nodeA: String(aSession), main: String(app.projects.get(project)!.mainSessionId) },
      elapsedMs,
      requests: { used: ledger.used, limit: REQUEST_LIMIT, summaryRequests, entries: ledger.entries },
      compactions: finalSession.evidence.compactions,
      restart: { requestsBeforeRestart, requestsAfterRestart: requestsAfterReopen, autoRunSnapshotAbsent: true },
      handoff: {
        writer: handoff.writer,
        resourceId: handoff.resource.id,
        originalBytes: handoff.original.bytes,
      },
      turns,
      artifacts,
      reviewEvidence,
      state: restartEvidence(finalState),
      claims: {
        overflowInjected: false,
        serverCapacityValidated: false,
        manualCompactions: finalSession.evidence.compactions.filter(record => record.trigger === "manual").length,
        automaticPressureCompactions: finalCompactions.length,
      },
    });
    passed = true;
    progress({
      event: "outcome",
      outcome: "passed",
      evidenceDir,
      elapsedMs,
      requests: ledger.used,
      sessions: { nodeA: String(aSession), main: String(app.projects.get(project)!.mainSessionId) },
      compactions: finalCompactions.map(record => ({
        id: record.compactionId,
        trigger: record.trigger,
        before: record.beforeTokens,
        after: record.afterTokens,
        savings: record.savings,
      })),
      nodes: app.nodes.getByProject(project).map(node => ({ id: String(node.node.id), status: node.status })),
    });
  } catch (error: unknown) {
    const failure: Record<string, unknown> = {
      outcome: "failed",
      stage,
      elapsedMs: Date.now() - startedAt,
      provider: PROVIDER,
      model: MODEL,
      error: describe(error),
      requests: { used: ledger.used, limit: REQUEST_LIMIT, entries: ledger.entries },
      preserved: { database, workspace },
      ...(abortFailure === null ? {} : { abortFailure }),
    };
    let disposition: DisposeResult | null = null;
    if (app !== undefined && projectId !== undefined) {
      failure.beforeAbort = captureFailureState(app, projectId);
      if (error instanceof AcceptanceTimeout) {
        failure.settle = await stopAndSettle(app, projectId, SETTLE_TIMEOUT_MS);
        failure.afterAbort = captureFailureState(app, projectId);
      }
      disposition = await disposeWithin(app, DISPOSE_TIMEOUT_MS);
      failure.dispose = disposition;
      app = undefined;
    }
    await writeEvidence(evidenceDir, "failure", failure);
    process.stderr.write([
      `Acceptance failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`,
      `Evidence: ${evidenceDir}`,
      `Preserved database: ${database}`,
      `Preserved workspace: ${workspace}`,
    ].join("\n") + "\n");
    process.exitCode = 1;
    if (disposition !== null && !disposition.disposed) process.exit(1);
  } finally {
    deadline.cancel();
    if (app !== undefined) {
      const disposition = await disposeWithin(app, DISPOSE_TIMEOUT_MS);
      if (!disposition.disposed || disposition.error !== null) {
        await writeEvidence(evidenceDir, "dispose-failure", disposition);
        process.exitCode = 1;
      }
    }
    if (passed) {
      try {
        await rm(storage, { recursive: true, force: true });
        await rm(workspace, { recursive: true, force: true });
      } catch (error: unknown) {
        await writeEvidence(evidenceDir, "cleanup-failure", {
          error: describe(error),
          database,
          workspace,
        });
        process.stderr.write(`Acceptance cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
