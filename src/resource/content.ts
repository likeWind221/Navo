import { randomUUID } from "node:crypto";
import { Service, type Context } from "cordis";
import { createProjectId, createResourceId, type ProjectId, type ResourceId } from "../brand/ids.js";
import type { ResourceContentRecord } from "../storage/content.js";
import { CONTENT_LIMITS, extractContent, type ContentExtractor, type ContentLimits } from "./content/extraction.js";
import { contentFailure, shutdownReason } from "./content/errors.js";
import { ResourceContentStore } from "./content/store.js";

export interface ContentProcessorConfig {
  readonly extractor?: ContentExtractor;
  readonly limits?: ContentLimits;
}

export class ContentProcessor extends Service {
  static inject = ["storage", "resources", "projects"];
  private readonly extractor: ContentExtractor;
  private readonly limits: ContentLimits;
  private readonly store: ResourceContentStore;
  private readonly resources;
  private readonly blocked = new Set<string>();
  private readonly shutdown = new AbortController();
  private running: Promise<void> | undefined;
  private started = false;
  private requested = false;
  private scheduled: NodeJS.Immediate | undefined;
  private active: { row: ResourceContentRecord; attemptId: string; controller: AbortController } | undefined;

  constructor(ctx: Context, config: ContentProcessorConfig = {}) {
    super(ctx, "content");
    this.extractor = config.extractor ?? extractContent;
    this.limits = config.limits ?? CONTENT_LIMITS;
    this.resources = ctx.resources;
    this.store = new ResourceContentStore(ctx.storage, ctx.resources, ctx.projects);
    this.store.reconcile();
    ctx.on("resource/committed", (projectId, resourceId) => this.notify(projectId, resourceId));
    const unregister = ctx.storage.beforeClose(() => this.stop());
    ctx.effect(() => async () => { await this.stop(); unregister(); }, "content.lifecycle");
  }

  start(): void {
    if (this.shutdown.signal.aborted) return;
    this.started = true;
    this.schedule();
  }

  notify(projectId: ProjectId, resourceId: ResourceId): void {
    if (this.shutdown.signal.aborted) return;
    try {
      if (this.store.ensure(projectId, resourceId)) this.ctx.emit("resource/content-changed", projectId, resourceId);
      this.schedule();
    } catch {
      this.diagnose();
    }
  }

  retry(projectId: ProjectId, resourceId: ResourceId): void {
    if (this.shutdown.signal.aborted) return;
    if (this.store.ensure(projectId, resourceId, true)) this.ctx.emit("resource/content-changed", projectId, resourceId);
    this.schedule();
  }

  status(projectId: ProjectId, resourceId: ResourceId): ResourceContentRecord | undefined {
    return this.store.get(projectId, resourceId);
  }

  read(projectId: ProjectId, resourceId: ResourceId): ResourceContentRecord | undefined {
    const row = this.status(projectId, resourceId);
    return row?.status === "ready" ? row : undefined;
  }

  cancel(): void {
    this.active?.controller.abort();
  }

  cancelCurrent(projectId: ProjectId, resourceId: ResourceId, assetGeneration: number): "requested" | "not-active" {
    const active = this.active;
    if (active === undefined || active.row.project_id !== projectId || active.row.resource_id !== resourceId
      || active.row.source_asset_generation !== assetGeneration) return "not-active";
    active.controller.abort();
    return "requested";
  }

  async idle(): Promise<void> {
    while (this.scheduled !== undefined || this.running !== undefined) {
      if (this.running !== undefined) await this.running;
      else await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  async stop(): Promise<void> {
    if (!this.shutdown.signal.aborted) {
      this.started = false;
      if (this.scheduled !== undefined) clearImmediate(this.scheduled);
      this.scheduled = undefined;
      if (this.active !== undefined) {
        try { this.store.finish(this.active.row, this.active.attemptId, "shutdown"); }
        catch { this.diagnose(); }
      }
      this.shutdown.abort(shutdownReason);
    }
    await this.running;
  }

  private schedule(): void {
    this.requested = true;
    if (!this.started || this.running !== undefined || this.scheduled !== undefined) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.requested = false;
      this.running = this.drain().catch(() => this.diagnose()).finally(() => {
        this.running = undefined;
        if (this.requested) this.schedule();
      });
    });
  }

  private async drain(): Promise<void> {
    while (!this.shutdown.signal.aborted) {
      const row = this.store.pending().find(item => !this.blocked.has(this.key(item)));
      if (row === undefined) return;
      const attemptId = randomUUID();
      try {
        if (!this.store.claim(row, attemptId)) continue;
        this.ctx.emit("resource/content-changed", createProjectId(row.project_id), createResourceId(row.resource_id));
        await this.process(row, attemptId);
      } catch {
        this.blocked.add(this.key(row));
        this.diagnose();
      }
    }
  }

  private async process(row: ResourceContentRecord, attemptId: string): Promise<void> {
    const controller = new AbortController();
    this.active = { row, attemptId, controller };
    const signal = AbortSignal.any([controller.signal, this.shutdown.signal, AbortSignal.timeout(this.limits.timeoutMs)]);
    const projectId = createProjectId(row.project_id);
    const resourceId = createResourceId(row.resource_id);
    let target: Awaited<ReturnType<typeof this.resources.resolveEntry>> | undefined;
    let result;
    try {
      const current = this.resources.get(projectId, resourceId);
      if (current?.assetGeneration !== row.source_asset_generation) return;
      target = await this.resources.resolveEntry(projectId, resourceId);
      signal.throwIfAborted();
      result = await this.extractor(target.path, signal, this.limits);
      signal.throwIfAborted();
    } catch (error) {
      result = contentFailure(error, signal);
    } finally {
      target?.release();
      this.active = undefined;
    }
    if (this.shutdown.signal.aborted) return;
    if (this.store.finish(row, attemptId, result)) {
      this.ctx.emit("resource/content-changed", projectId, resourceId);
    }
    await this.resources.recover();
  }

  private key(row: ResourceContentRecord): string {
    return JSON.stringify([row.project_id, row.resource_id, row.source_asset_generation]);
  }

  private diagnose(): void {
    console.error("[resource-content] persistence unavailable; recovery deferred to next startup.");
  }
}

declare module "cordis" {
  interface Context {
    content: ContentProcessor;
  }
  interface Events {
    "resource/content-changed"(projectId: ProjectId, resourceId: ResourceId): void;
  }
}
