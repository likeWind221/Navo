import { Service, type Context } from "cordis";
import type { ProjectId, ResourceId } from "../brand/ids.js";
import type { GraphBuildRecord } from "../storage/graph.js";
import type { ResourcePrincipal } from "./model.js";
import { GraphExtractor, type GraphConfig } from "./graph/extraction.js";
import { GraphError } from "./graph/errors.js";
import { GraphStore } from "./graph/store.js";
import { readGraph, type GraphSnapshot } from "./graph/read.js";

export class ResourceGraph extends Service {
  static inject = ["storage", "resources", "content", "llm"];
  private readonly extractor: GraphExtractor | undefined;
  private readonly store: GraphStore;
  private readonly shutdown = new AbortController();
  private active: { build: GraphBuildRecord; controller: AbortController } | undefined;
  private running: Promise<void> | undefined;
  private scheduled: NodeJS.Immediate | undefined;
  private started = false;
  private requested = false;

  constructor(ctx: Context, config?: GraphConfig) {
    super(ctx, "resourceGraph");
    this.extractor = config === undefined ? undefined : new GraphExtractor(ctx.llm, config);
    this.store = new GraphStore(ctx, this.extractor?.pipelineVersion);
    this.store.reconcile();
    ctx.on("resource/index-changed", () => this.notify());
    ctx.on("resource/content-changed", () => this.notify());
    ctx.on("resource/committed", () => this.notify());
    const unregister = ctx.storage.beforeClose(() => this.stop());
    ctx.effect(() => async () => { await this.stop(); unregister(); }, "resource-graph.lifecycle");
  }

  start(): void { if (!this.shutdown.signal.aborted) { this.started = true; this.schedule(); } }

  notify(): void {
    if (this.shutdown.signal.aborted) return;
    this.store.reconcile();
    if (this.active !== undefined && !this.store.current(this.active.build)) this.active.controller.abort();
    this.schedule();
  }

  retry(projectId: ProjectId, resourceId: ResourceId): void {
    if (this.shutdown.signal.aborted || this.extractor === undefined) return;
    this.store.reconcile();
    this.ctx.storage.atomic(tx => {
      for (const build of tx.listGraphBuilds()) {
        if (build.project_id === projectId && build.resource_id === resourceId && build.status === "failed") tx.resumeGraphBuild(build.build_id);
      }
    });
    this.schedule();
  }

  cancel(): void { this.active?.controller.abort(); }

  status(projectId: ProjectId, resourceId: ResourceId): GraphBuildRecord | undefined {
    return this.ctx.storage.atomic(tx => tx.listGraphBuilds()).filter(build => build.project_id === projectId && build.resource_id === resourceId).at(-1);
  }

  read(projectId: ProjectId, viewer: ResourcePrincipal, resourceIds?: readonly ResourceId[]): GraphSnapshot {
    return readGraph(this.ctx, projectId, viewer, resourceIds);
  }

  async idle(): Promise<void> {
    while (this.scheduled !== undefined || this.running !== undefined) {
      if (this.running !== undefined) await this.running;
      else await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.scheduled !== undefined) clearImmediate(this.scheduled);
    this.scheduled = undefined;
    this.shutdown.abort();
    await this.running;
  }

  private schedule(): void {
    this.requested = true;
    if (!this.started || this.extractor === undefined || this.running !== undefined || this.scheduled !== undefined) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.requested = false;
      this.running = this.drain().catch(() => {
        console.error("[resource-graph] persistence unavailable; recovery deferred to next startup.");
      }).finally(() => {
        this.running = undefined;
        if (this.requested) this.schedule();
      });
    });
  }

  private async drain(): Promise<void> {
    while (!this.shutdown.signal.aborted) {
      const build = this.store.next();
      if (build === undefined) return;
      await this.run(build);
    }
  }

  private async run(build: GraphBuildRecord): Promise<void> {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.shutdown.signal, controller.signal]);
    this.active = { build, controller };
    let next = build.next_ordinal;
    try {
      const chunks = this.ctx.storage.atomic(tx => tx.listBuildChunks(build.source_build_id));
      while (next < chunks.length) {
        signal.throwIfAborted();
        const batch = this.extractor!.batch(chunks.slice(next));
        await this.extractor!.extract(batch, signal, (completed, graph) => {
          signal.throwIfAborted();
          const end = completed.at(-1)!.ordinal + 1;
          if (!this.store.current(build) || !this.ctx.storage.atomic(tx => tx.writeGraphBatch(build.build_id, next, end, graph))) {
            throw new GraphError("source-changed", "Graph source changed before batch commit.");
          }
          next = end;
        });
      }
      signal.throwIfAborted();
      if (!this.store.current(build) || !this.ctx.storage.atomic(tx => tx.publishGraphBuild(build.build_id))) {
        this.ctx.storage.atomic(tx => tx.supersedeGraphBuild(build.build_id));
      }
    } catch (error) {
      if (this.shutdown.signal.aborted) return;
      this.ctx.storage.atomic(tx => {
        if (!this.store.current(build)) tx.supersedeGraphBuild(build.build_id);
        else tx.failGraphBuild(build.build_id, signal.aborted ? "cancelled" : error instanceof GraphError ? error.code : "graph-failed");
      });
    } finally {
      this.active = undefined;
    }
  }
}

declare module "cordis" { interface Context { resourceGraph: ResourceGraph } }
