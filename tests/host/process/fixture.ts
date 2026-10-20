import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { createApp } from "../../../src/app.js";
import type { ProjectResource } from "../../../src/resource/model.js";
import type { ResourceEvent } from "../../../src/resource/events.js";
import { projectResourceEvent, type ResourceState } from "../../../src/resource/projector.js";
import type { FileOperation } from "../../../src/storage/operations.js";
import { crashOperationId, GUARD_CONTENT, NEW_CONTENT, OLD_CONTENT, type Checkpoint, type CrashPoint } from "./protocol.js";

export async function seedCrashFixture() {
  const base = await mkdtemp(join(tmpdir(), "navo-real-asset-crash-"));
  const home = join(base, "home");
  const root = join(base, "workspace");
  await mkdir(root);
  const path = join(home, "navo.db");
  const ctx = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } } });
  try {
    const project = ctx.projects.create({ name: "Crash matrix", goal: null });
    await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "original.md"), OLD_CONTENT);
    await writeFile(join(root, "guard.md"), GUARD_CONTENT);
    await writeFile(join(root, "replacement.md"), NEW_CONTENT);
    const input = { projectId: project.id, owner: { kind: "main" as const }, description: "Crash fixture", type: "text/markdown" };
    const original = await ctx.resources.publish({ ...input, sourceRef: "original.md", name: "Original" });
    const guard = await ctx.resources.publish({ ...input, sourceRef: "guard.md", name: "Guard" });
    return { base, home, root, path, projectId: project.id, original, guard };
  } finally {
    await ctx.fiber.dispose();
  }
}

export type CrashFixture = Awaited<ReturnType<typeof seedCrashFixture>>;

export function observeDatabase(fixture: CrashFixture, point: CrashPoint) {
  const db = new DatabaseSync(fixture.path, { readOnly: true });
  try {
    const events = db.prepare("SELECT payload FROM events WHERE domain = 'resource' ORDER BY seq").all()
      .map(row => JSON.parse(String(row.payload)) as ResourceEvent);
    const states = new Map<string, ResourceState>();
    for (const event of events) states.set(event.resourceId, projectResourceEvent(states.get(event.resourceId), event));
    return {
      events,
      states,
      operation: db.prepare("SELECT * FROM resource_file_operations WHERE operation_id = ?")
        .get(crashOperationId(point)) as unknown as FileOperation,
      pending: db.prepare("SELECT operation_id FROM resource_file_operations WHERE execution_state NOT IN ('completed', 'failed', 'cancelled')").all(),
    };
  } finally {
    db.close();
  }
}

export function assetFile(fixture: CrashFixture, resource: ProjectResource): string {
  return join(fixture.root, ".navo", "assets", resource.id, resource.entryRef);
}

export function targetFile(fixture: CrashFixture): string {
  return join(fixture.root, ".navo", "assets", fixture.original.id, "versions", "2", "source.md");
}

export async function assertCheckpoint(fixture: CrashFixture, point: CrashPoint, checkpoint: Checkpoint): Promise<void> {
  const durable = observeDatabase(fixture, point);
  expect(checkpoint.point).toBe(point);
  expect(checkpoint.transaction).toBe(point === "D6");
  expect(checkpoint.matchingEvents).toBe(["D6", "D7", "D8"].includes(point) ? 1 : 0);
  const committed = ["D7", "D8"].includes(point);
  expect(durable.events).toHaveLength(committed ? 3 : 2);
  expect(durable.operation.business_result).toBe(committed ? "succeeded" : "pending");
  expect(checkpoint.operation.execution_state).toBe(point === "D8" ? "cleanup_pending" : point === "D7" ? "committed" : ["D5", "D6"].includes(point) ? "prepared" : "staging");
  expect(durable.operation.execution_state).toBe(checkpoint.operation.execution_state);
  if (point === "D1") {
    expect(durable.operation.resource_id).toBeNull();
    expect(durable.operation.target_relpath).toBeNull();
  } else {
    expect(durable.operation).toMatchObject({ resource_id: fixture.original.id, base_revision: 1,
      source_generation: 1, target_generation: 2,
      target_relpath: `assets/${fixture.original.id}/versions/2/source.md`,
      staging_relpath: `staging/resource-intake/${crashOperationId(point)}/source` });
    const staged = join(fixture.root, ".navo", durable.operation.staging_relpath!);
    const size = (await stat(staged)).size;
    if (point === "D2") {
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(NEW_CONTENT.length);
    } else if (point !== "D8") expect(size).toBe(NEW_CONTENT.length);
    if (["D2", "D3"].includes(point)) await expect(stat(targetFile(fixture))).rejects.toMatchObject({ code: "ENOENT" });
    else expect(await readFile(targetFile(fixture))).toEqual(NEW_CONTENT);
    if (point === "D3") {
      expect(await readFile(join(targetFile(fixture), "..", ".operation"), "utf8")).toBe(crashOperationId(point));
    }
  }
  if (point === "D6") {
    expect(checkpoint.operation.business_result).toBe("pending");
    expect(durable.events.some(event => "operationId" in event.data && event.data.operationId === crashOperationId(point))).toBe(false);
  }
  if (point === "D8") {
    await expect(stat(assetFile(fixture, fixture.original))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(durable.operation.cleanup_targets_json)).toContain(`assets/${fixture.original.id}/${fixture.original.entryRef}`);
  } else expect(await readFile(assetFile(fixture, fixture.original), "utf8")).toBe(OLD_CONTENT);
  expect(await readFile(assetFile(fixture, fixture.guard), "utf8")).toBe(GUARD_CONTENT);
}

export async function assertRecovered(fixture: CrashFixture, point: CrashPoint) {
  const snapshot = observeDatabase(fixture, point);
  const committed = ["D7", "D8"].includes(point);
  expect(snapshot.events).toHaveLength(committed ? 3 : 2);
  expect(snapshot.events.filter(event => "operationId" in event.data && event.data.operationId === crashOperationId(point))).toHaveLength(committed ? 1 : 0);
  expect(snapshot.operation.business_result).toBe(committed ? "succeeded" : "failed");
  expect(snapshot.operation.execution_state).toBe(committed ? "completed" : "failed");
  expect(snapshot.operation.cleanup_targets_json).toBe("[]");
  expect(snapshot.pending).toEqual([]);
  expect(snapshot.states.size).toBe(2);
  const current = snapshot.states.get(fixture.original.id)!;
  expect(current.status).toBe("active");
  expect(current.resource.assetGeneration).toBe(committed ? 2 : 1);
  expect(current.resource.revision).toBe(committed ? 2 : 1);
  expect(await readFile(assetFile(fixture, current.resource))).toEqual(committed ? NEW_CONTENT : Buffer.from(OLD_CONTENT));
  if (committed) expect(await readFile(join(dirname(assetFile(fixture, current.resource)), ".operation"), "utf8")).toBe(crashOperationId(point));
  const obsolete = committed ? assetFile(fixture, fixture.original) : targetFile(fixture);
  await expect(stat(obsolete)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(dirname(obsolete))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(join(fixture.root, ".navo", "staging", "resource-intake", crashOperationId(point)))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(assetFile(fixture, fixture.guard), "utf8")).toBe(GUARD_CONTENT);
  expect(await readFile(join(fixture.root, "original.md"), "utf8")).toBe(OLD_CONTENT);
  expect(await readFile(join(fixture.root, "replacement.md"))).toEqual(NEW_CONTENT);
  return snapshot;
}

export async function removeCrashFixture(fixture: CrashFixture): Promise<void> {
  expect(dirname(resolve(fixture.base))).toBe(resolve(tmpdir()));
  expect(basename(fixture.base)).toMatch(/^navo-real-asset-crash-/);
  await rm(fixture.base, { recursive: true, force: true });
}
