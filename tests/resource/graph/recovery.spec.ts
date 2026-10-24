import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { adapter, cleanup, close, config, facts, fixture, open, publish, settle } from "./fixture.js";

afterEach(cleanup);
const longBody = Array.from({ length: 10 }, (_, i) => `# Section ${i}\n\n${"Alice knows Bob. ".repeat(65)}`).join("\n\n");
const small = { ...config, inputTokenBudget: 4096 };

describe("graph failure, cancellation and restart", () => {
  it("keeps partial failed work invisible and resumes only after explicit retry, including across restart", async () => {
    let calls = 0;
    const initial = await fixture(chunks => {
      if (++calls === 2) throw new Error("offline");
      return facts(chunks);
    }, { persistent: true, graph: small });
    const resource = await publish(initial.ctx, initial.project.id, initial.workspace, "long.md", longBody);
    const failed = initial.ctx.resourceGraph.status(initial.project.id, resource.id)!;
    expect(failed).toMatchObject({ status: "failed", error_code: "model-failed" });
    expect(failed.next_ordinal).toBeGreaterThan(0);
    expect(initial.ctx.resourceGraph.read(initial.project.id, { kind: "main" })).toEqual({ entities: [], relations: [] });
    await close(initial.ctx);
    const llm = adapter();
    const resumed = await open(initial.path, llm, small);
    await settle(resumed);
    expect(llm.requests).toHaveLength(0);
    resumed.resourceGraph.retry(initial.project.id, resource.id);
    await resumed.resourceGraph.idle();
    expect(resumed.resourceGraph.status(initial.project.id, resource.id)).toMatchObject({ build_id: failed.build_id, status: "active" });
    const text = llm.requests[0]!.messages.at(-1)!.content[0]!;
    expect(text.type === "text" ? text.text : "").not.toContain("Section 0");
    expect(resumed.resourceGraph.read(initial.project.id, { kind: "main" }).relations).toHaveLength(1);
  });

  it("resumes building after shutdown without repeating persisted chunks", async () => {
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    const initial = await fixture(async (chunks, request) => {
      if (++calls === 2) {
        started();
        await new Promise<void>(resolve => request.signal!.addEventListener("abort", () => resolve(), { once: true }));
      }
      return facts(chunks);
    }, { persistent: true, graph: small });
    const publishing = publish(initial.ctx, initial.project.id, initial.workspace, "long.md", longBody);
    await waiting;
    await initial.ctx.resourceGraph.stop();
    const resource = await publishing;
    const pending = initial.ctx.resourceGraph.status(initial.project.id, resource.id)!;
    expect(pending.status).toBe("building");
    expect(pending.next_ordinal).toBeGreaterThan(0);
    await close(initial.ctx);
    const llm = adapter();
    const resumed = await open(initial.path, llm, small);
    await settle(resumed);
    expect(resumed.resourceGraph.status(initial.project.id, resource.id)).toMatchObject({ status: "active", build_id: pending.build_id });
    const text = llm.requests[0]!.messages.at(-1)!.content[0]!;
    expect(text.type === "text" ? text.text : "").not.toContain("Section 0");
  });

  it("cancels an in-flight call and rejects its late response", async () => {
    let started!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    const initial = await fixture(async chunks => {
      started();
      await new Promise<void>(resolve => { release = resolve; });
      return facts(chunks);
    });
    const publishing = publish(initial.ctx, initial.project.id, initial.workspace);
    await waiting;
    initial.ctx.resourceGraph.cancel();
    release();
    const resource = await publishing;
    expect(initial.ctx.resourceGraph.status(initial.project.id, resource.id)).toMatchObject({ status: "failed", error_code: "cancelled", next_ordinal: 0 });
    expect(initial.ctx.resourceGraph.read(initial.project.id, { kind: "main" })).toEqual({ entities: [], relations: [] });
  });

  it("supersedes incompatible building pipelines on restart and cleans orphan facts", async () => {
    const initial = await fixture(undefined, { persistent: true });
    const resource = await publish(initial.ctx, initial.project.id, initial.workspace);
    const old = initial.ctx.resourceGraph.status(initial.project.id, resource.id)!;
    await close(initial.ctx);
    const db = new DatabaseSync(initial.path);
    db.prepare("UPDATE graph_builds SET status = 'building', pipeline_version = 'old-pipeline' WHERE build_id = ?").run(old.build_id);
    db.close();
    const llm = adapter(() => ({ entities: [], relations: [] }));
    const resumed = await open(initial.path, llm);
    await settle(resumed);
    expect(llm.requests).toHaveLength(1);
    expect(resumed.storage.atomic(tx => tx.listGraphBuilds()).find(build => build.build_id === old.build_id)?.status).toBe("superseded");
    expect(resumed.resourceGraph.status(initial.project.id, resource.id)?.status).toBe("active");
    const raw = new DatabaseSync(initial.path);
    try {
      for (const table of ["graph_evidence", "graph_relations", "graph_entities"]) {
        expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
      }
    } finally { raw.close(); }
  });

  it("replaces a resource during extraction without publishing old-generation facts", async () => {
    let started!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    let call = 0;
    const initial = await fixture(async chunks => {
      if (++call === 1) {
        started();
        await new Promise<void>(resolve => { release = resolve; });
        return facts(chunks);
      }
      return { entities: [], relations: [] };
    });
    const publishing = publish(initial.ctx, initial.project.id, initial.workspace);
    await waiting;
    const resource = initial.ctx.resources.listVisible(initial.project.id, { kind: "main" })[0]!;
    await writeFile(join(initial.workspace, "replacement.md"), "empty replacement");
    await initial.ctx.resources.replace({ projectId: initial.project.id, resourceId: resource.id, actor: { kind: "main" },
      expectedRevision: resource.revision, sourceRef: "replacement.md" });
    release();
    await publishing;
    await settle(initial.ctx);
    expect(initial.ctx.resourceGraph.read(initial.project.id, { kind: "main" })).toEqual({ entities: [], relations: [] });
    const builds = initial.ctx.storage.atomic(tx => tx.listGraphBuilds());
    expect(builds.map(build => build.status)).toEqual(["superseded", "active"]);
    expect(builds[1]!.source_asset_generation).toBe(2);
  });
});
