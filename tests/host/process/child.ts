import { writeSync } from "node:fs";
import { createProjectId, createResourceId } from "../../../src/brand/ids.js";
import { acquireHostLock } from "../../../src/host/lock.js";
import { CRASH_POINTS, crashOperationId, type CrashRequest } from "./protocol.js";
import { installCrashProbe } from "./probes.js";

async function main(): Promise<void> {
  const request = JSON.parse(process.argv[2]!) as CrashRequest;
  if (!CRASH_POINTS.includes(request.point) || !["interrupt", "retry"].includes(request.mode)) {
    throw new Error("Invalid test child request.");
  }
  const release = await acquireHostLock();
  if (request.mode === "interrupt") installCrashProbe(request.point);
  const { createApp } = await import("../../../src/app.js");
  const ctx = await createApp({ storage: { path: request.path }, node: { session: { model: { provider: "mock", model: "test" } } } });
  const projectId = createProjectId(request.projectId);
  const operationId = crashOperationId(request.point);
  try {
    try {
      const resource = request.point === "D1"
        ? await ctx.resources.publish({ projectId, owner: { kind: "main" }, sourceRef: "replacement.md",
          name: "New resource", description: "Crash matrix", type: "text/markdown", operationId })
        : await ctx.resources.replace({ projectId, resourceId: createResourceId(request.resourceId), actor: { kind: "main" },
          expectedRevision: 1, sourceRef: "replacement.md", operationId });
      if (request.mode === "interrupt") throw new Error(`Checkpoint ${request.point} was not reached.`);
      writeSync(1, `${JSON.stringify({ outcome: "succeeded", resourceId: resource.id })}\n`);
    } catch (error) {
      if (request.mode !== "retry" || !(error instanceof Error) || !("code" in error) || error.code !== "invalid-resource") throw error;
      writeSync(1, `${JSON.stringify({ outcome: "failed", code: error.code })}\n`);
    }
  } finally {
    await ctx.fiber.dispose();
    await release();
  }
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
