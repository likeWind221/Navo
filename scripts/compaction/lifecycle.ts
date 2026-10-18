import type { Context } from "cordis";

import type { ProjectId } from "../../src/brand/ids.js";
import { abortActive } from "./setup.js";
import { captureRestartState, restartEvidence } from "./state.js";

const SETTLE_POLL_MS = 100;

export interface SettleResult {
  readonly settled: boolean;
  readonly active: readonly string[];
  readonly abortError: string | null;
}

export interface DisposeResult {
  readonly disposed: boolean;
  readonly error: string | null;
}

export function describe(error: unknown): { readonly name: string; readonly message: string; readonly stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: "Error", message: String(error) };
}

export function captureFailureState(app: Context, projectId: ProjectId): unknown {
  try {
    return restartEvidence(captureRestartState(app, projectId));
  } catch (error: unknown) {
    return { stateError: describe(error) };
  }
}

export async function stopAndSettle(app: Context, projectId: ProjectId, timeoutMs: number): Promise<SettleResult> {
  const abortError = abortActive(app, projectId);
  const deadline = Date.now() + timeoutMs;
  while (activeTargets(app, projectId).length > 0 && Date.now() < deadline) {
    await delay(SETTLE_POLL_MS);
  }
  const active = activeTargets(app, projectId);
  return Object.freeze({ settled: active.length === 0, active, abortError });
}

export async function disposeWithin(app: Context, timeoutMs: number): Promise<DisposeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(1, timeoutMs));
  });
  const disposal = app.fiber.dispose().then(
    () => "disposed" as const,
    (error: unknown) => ({ error: describe(error).message }),
  );
  const result = await Promise.race([disposal, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (result === "timeout") return Object.freeze({ disposed: false, error: null });
  if (result === "disposed") return Object.freeze({ disposed: true, error: null });
  return Object.freeze({ disposed: false, error: result.error });
}

function activeTargets(app: Context, projectId: ProjectId): readonly string[] {
  const active: string[] = [];
  if (app.projectRuntime.isMainActive(projectId)) active.push("main");
  for (const node of app.nodes.getByProject(projectId)) {
    if (app.projectRuntime.isNodeActive(node.node.id)) active.push(String(node.node.id));
  }
  return active;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
