import { stat } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { projectResourcesMethod, type StreamRpcClient } from "../../../rpc/index.js";
import { HOST_LOCK_TARGET } from "../../../src/host/lock.js";
import { assertCheckpoint, assertRecovered, removeCrashFixture, seedCrashFixture } from "./fixture.js";
import { CRASH_POINTS, type Checkpoint, type CrashPoint, type CrashRequest } from "./protocol.js";

export interface HostProcessHarness {
  readonly startHost: (entry: string, env?: Readonly<Record<string, string>>, args?: readonly string[]) => ChildProcessWithoutNullStreams;
  readonly exitOf: (child: ChildProcessWithoutNullStreams) => Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  readonly capture: (stream: NodeJS.ReadableStream) => { readonly value: string };
  readonly collect: <T>(stream: AsyncIterable<T>) => Promise<T[]>;
  readonly withRealHost: <T>(env: Readonly<Record<string, string>>, use: (client: StreamRpcClient) => Promise<T>,
    entry?: "src/host/main.ts" | "scripts/host/mock.ts", onPhase?: (phase: HostProcessPhase) => void) => Promise<T>;
}

export interface AssetCrashOptions {
  readonly points: readonly CrashPoint[];
  readonly restarts: 1 | 2;
}

export type HostProcessPhase = "ready" | "assertions" | "dispose" | "exit";

const CRASH_CASE_TIMEOUT_MS = 20_000 + 11_000 + 2 * (15_000 + 15_000) + 15_000 + 14_000;

export function registerAssetCrashTests(
  harness: HostProcessHarness,
  { points, restarts }: AssetCrashOptions = { points: CRASH_POINTS, restarts: 2 },
): void {
  describe("asset crash recovery", () => {
    it.each(points)(`%s survives parent SIGKILL and ${restarts} fresh formal Host recovery runs`, { timeout: CRASH_CASE_TIMEOUT_MS }, async point => {
      let previous = performance.now();
      const timings: Record<string, number> = {};
      const mark = (phase: string) => {
        const now = performance.now();
        timings[phase] = Math.round(now - previous);
        previous = now;
      };
      const fixture = await seedCrashFixture();
      mark("fixture");
      const request: CrashRequest = { mode: "interrupt", point, path: fixture.path,
        projectId: fixture.projectId, resourceId: fixture.original.id };
      const child = harness.startHost("tests/host/process/child.ts", {}, [JSON.stringify(request)]);
      const stderr = harness.capture(child.stderr);
      let terminated = false;
      let waitedForLock = false;
      try {
        const checkpoint = await readCheckpoint(child, stderr);
        await assertCheckpoint(fixture, point, checkpoint);
        mark("checkpoint");
        expect(child.exitCode).toBeNull();
        expect(child.kill("SIGKILL")).toBe(true);
        terminated = true;
        const exit = await harness.exitOf(child);
        expect(exit.signal).toBe("SIGKILL");
        mark("kill");
        await waitForNaturalLockExpiry();
        waitedForLock = true;
        mark("lockExpiry");

        let firstSnapshot: Awaited<ReturnType<typeof assertRecovered>> | undefined;
        for (let restart = 1; restart <= restarts; restart++) {
          await harness.withRealHost({ NAVO_HOME: fixture.home }, async client => {
            const snapshot = await assertRecovered(fixture, point);
            const [reply] = await harness.collect(client.stream(projectResourcesMethod, { projectId: fixture.projectId }));
            expect(reply!.resources).toHaveLength(2);
            for (const resource of reply!.resources) {
              const projected = snapshot.states.get(resource.resourceId)!.resource;
              expect(resource).toMatchObject({ resourceId: projected.id, entryRef: projected.entryRef, revision: projected.revision });
            }
            if (firstSnapshot === undefined) firstSnapshot = snapshot;
            else expect(snapshot).toEqual(firstSnapshot);
          }, "src/host/main.ts", phase => mark(`restart${restart}.${phase}`));
        }

        const retry = harness.startHost("tests/host/process/child.ts", {}, [JSON.stringify({ ...request, mode: "retry" })]);
        const result = harness.capture(retry.stdout);
        const retryErrors = harness.capture(retry.stderr);
        expect(await harness.exitOf(retry), retryErrors.value).toEqual({ code: 0, signal: null });
        const expectedOutcome = ["D7", "D8"].includes(point) ? "succeeded" : "failed";
        expect(JSON.parse(result.value)).toMatchObject({ outcome: expectedOutcome });
        expect(await assertRecovered(fixture, point)).toEqual(firstSnapshot);
        mark("retry");
        console.info(`${point}: pid=${child.pid}, SIGKILL; writerTransaction=${checkpoint.transaction}, writerEvents=${checkpoint.matchingEvents}; formalRestarts=${restarts}, retry=${expectedOutcome}; DB/RPC/content/cleanup/guard assertions passed; phaseMs=${JSON.stringify(timings)}`);
      } finally {
        if (!terminated && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          terminated = true;
        }
        await harness.exitOf(child);
        if (terminated && !waitedForLock) await waitForNaturalLockExpiry();
        await removeCrashFixture(fixture);
      }
    });
  });
}

function readCheckpoint(child: ChildProcessWithoutNullStreams, stderr: { readonly value: string }): Promise<Checkpoint> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = globalThis.setTimeout(() => finish(new Error(`Child did not reach a checkpoint: ${stderr.value}`)), 20_000);
    const onExit = () => finish(new Error(`Child exited before checkpoint: ${stderr.value}`));
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const checkpoint = JSON.parse(buffer.slice(0, newline)) as Checkpoint;
        finish(undefined, checkpoint);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    function finish(error?: Error, checkpoint?: Checkpoint) {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.stdout.removeListener("data", onData);
      if (error !== undefined) reject(error);
      else resolve(checkpoint!);
    }
    child.once("exit", onExit);
    child.stdout.on("data", onData);
  });
}

async function waitForNaturalLockExpiry(): Promise<void> {
  const lock = await stat(`${HOST_LOCK_TARGET}.lock`);
  const remaining = lock.mtimeMs + 10_001 - Date.now();
  if (remaining > 0) await setTimeout(remaining);
}
