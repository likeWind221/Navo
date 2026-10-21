import { stat } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { HOST_LOCK_TARGET } from "../../../src/host/lock.js";
import type { ResourceContentRecord } from "../../../src/storage/content.js";
import type { HostProcessHarness } from "./interruption.js";
import { seedCrashFixture, removeCrashFixture } from "./fixture.js";
import { OLD_CONTENT } from "./protocol.js";

export function registerContentCrashTests(harness: HostProcessHarness): void {
  it("recovers claimed content after real SIGKILL and two fresh formal Host restarts", { timeout: 90_000 }, async () => {
    const fixture = await seedCrashFixture();
    const seed = new DatabaseSync(fixture.path);
    seed.prepare(`UPDATE resource_content SET status = 'pending', body = NULL, page_map_json = NULL,
      extractor_version = NULL, processing_attempt_id = NULL WHERE resource_id = ?`).run(fixture.original.id);
    const events = seed.prepare("SELECT payload FROM events WHERE domain = 'resource' ORDER BY seq").all();
    seed.close();
    const child = harness.startHost("tests/host/process/content/child.ts", {}, [fixture.path, fixture.original.id]);
    const output = harness.capture(child.stdout);
    const errors = harness.capture(child.stderr);
    let terminated = false;
    try {
      await vi.waitFor(() => {
        if (child.exitCode !== null) throw Error(errors.value);
        expect(output.value).toContain("\n");
      }, { timeout: 15_000 });
      const checkpoint = JSON.parse(output.value.trim()) as ResourceContentRecord;
      expect(checkpoint).toMatchObject({ status: "processing", body: null, source_asset_generation: 1 });
      expect(checkpoint.processing_attempt_id).toBeTruthy();
      expect(child.kill("SIGKILL")).toBe(true);
      terminated = true;
      expect((await harness.exitOf(child)).signal).toBe("SIGKILL");
      const lock = await stat(`${HOST_LOCK_TARGET}.lock`);
      await setTimeout(Math.max(1, lock.mtimeMs + 10_001 - Date.now()));
      for (let restart = 0; restart < 2; restart++) {
        await harness.withRealHost({ NAVO_HOME: fixture.home }, async () => {
          await vi.waitFor(() => {
            const db = new DatabaseSync(fixture.path, { readOnly: true });
            try {
              const row = db.prepare("SELECT * FROM resource_content WHERE project_id = ? AND resource_id = ?")
                .get(fixture.projectId, fixture.original.id);
              expect(row).toMatchObject({ status: "ready", source_asset_generation: 1, body: OLD_CONTENT, processing_attempt_id: null });
              expect(db.prepare("SELECT payload FROM events WHERE domain = 'resource' ORDER BY seq").all()).toEqual(events);
            } finally { db.close(); }
          }, { timeout: 15_000 });
        });
      }
    } finally {
      if (!terminated && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await harness.exitOf(child);
      if (!terminated) {
        const lock = await stat(`${HOST_LOCK_TARGET}.lock`).catch(() => undefined);
        if (lock !== undefined) await setTimeout(Math.max(1, lock.mtimeMs + 10_001 - Date.now()));
      }
      await removeCrashFixture(fixture);
    }
  });
}
