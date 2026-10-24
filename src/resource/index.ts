import { Service, type Context } from "cordis";
import type { EmbeddingProvider } from "../embedding/types.js";
import { EmbeddingError } from "../embedding/errors.js";
import { createProjectId, createResourceId, type ProjectId, type ResourceId } from "../brand/ids.js";
import type { ResourceContentRecord } from "../storage/content.js";
import type { ResourceIndexBuildRecord } from "../storage/indexing.js";
import { chunkText } from "./index/chunker.js";
import { compatible, ResourceIndexStore } from "./index/store.js";
import { encodeVector } from "./index/vector.js";

export interface ResourceIndexConfig { readonly provider?: EmbeddingProvider; readonly batchSize?: number }
export type ResourceIndexStatus =
  | { readonly status: "waiting-config" }
  | { readonly status: "absent" }
  | { readonly status: ResourceIndexBuildRecord["status"]; readonly buildId: string; readonly errorCode: string | null };

export class ResourceIndexProcessor extends Service {
  static inject = ["storage", "resources", "projects", "content"];
  private readonly provider: EmbeddingProvider | undefined;
  private readonly store: ResourceIndexStore;
  private readonly batchSize: number;
  private readonly blocked = new Map<string, number>();
  private readonly shutdown = new AbortController();
  private active: { readonly build: ResourceIndexBuildRecord; readonly controller: AbortController } | undefined;
  private running: Promise<void> | undefined;
  private scheduled: NodeJS.Immediate | undefined;
  private requested = false;
  private started = false;

  constructor(ctx: Context, config: ResourceIndexConfig = {}) {
    super(ctx, "resourceIndex");
    this.provider = config.provider;
    this.batchSize = config.batchSize ?? 16;
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 32) throw new TypeError("Index batchSize must be from 1 through 32.");
    this.store = new ResourceIndexStore(ctx.storage);
    for (const build of this.store.builds("failed")) this.blocked.set(identity(build.project_id, build.resource_id), build.source_asset_generation);
    ctx.on("resource/content-changed", (projectId, resourceId) => this.notify(projectId, resourceId));
    const unregister = ctx.storage.beforeClose(() => this.stop());
    ctx.effect(() => async () => { await this.stop(); unregister(); }, "resource-index.lifecycle");
  }

  start(): void { if (!this.shutdown.signal.aborted) { this.started = true; this.schedule(); } }

  notify(projectId: ProjectId, resourceId: ResourceId): void {
    if (this.shutdown.signal.aborted) return;
    const key = identity(projectId, resourceId);
    if (this.active !== undefined && identity(this.active.build.project_id, this.active.build.resource_id) === key) {
      const content = this.ctx.content.read(projectId, resourceId);
      if (content?.source_asset_generation !== this.active.build.source_asset_generation) this.active.controller.abort();
    }
    this.schedule();
  }

  retry(projectId: ProjectId, resourceId: ResourceId): void { this.blocked.delete(identity(projectId, resourceId)); this.schedule(); }
  cancel(): void { this.active?.controller.abort(); }

  status(projectId: ProjectId, resourceId: ResourceId): ResourceIndexStatus {
    const builds = this.store.builds().filter(build => build.project_id === projectId && build.resource_id === resourceId);
    const latest = builds.at(-1);
    if (latest !== undefined) return { status: latest.status, buildId: latest.build_id, errorCode: latest.error_code };
    return this.provider === undefined && this.ctx.content.read(projectId, resourceId) !== undefined ? { status: "waiting-config" } : { status: "absent" };
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
      this.shutdown.abort(new Error("Resource index processor stopped."));
      this.active?.controller.abort(this.shutdown.signal.reason);
    }
    await this.running;
  }

  private schedule(): void {
    this.requested = true;
    if (!this.started || this.provider === undefined || this.running !== undefined || this.scheduled !== undefined) return;
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
    const provider = this.provider!;
    for (const build of this.store.recoverable(provider)) {
      const content = this.current(build);
      if (content === undefined) this.store.supersede(build.build_id);
      else if (!this.isBlocked(build.project_id, build.resource_id, build.source_asset_generation)) await this.run(build, content);
    }
    while (!this.shutdown.signal.aborted) {
      const content = this.ctx.storage.atomic(tx => tx.listResourceContent()).find(row => row.status === "ready"
        && !this.isBlocked(row.project_id, row.resource_id, row.source_asset_generation) && this.needsBuild(row, provider));
      if (content === undefined) return;
      const resource = this.ctx.resources.get(createProjectId(content.project_id), createResourceId(content.resource_id));
      if (resource?.assetGeneration !== content.source_asset_generation || content.body === null) continue;
      const pageMap = parsePageMap(content.page_map_json);
      const chunks = chunkText({ text: content.body, type: resource.type, pageMap });
      const build = this.store.prepare(content, chunks, provider);
      if (build !== undefined) await this.run(build, content);
    }
  }

  private needsBuild(content: ResourceContentRecord, provider: EmbeddingProvider): boolean {
    const builds = this.store.builds().filter(build => build.project_id === content.project_id && build.resource_id === content.resource_id);
    return !builds.some(build => (build.status === "building" || build.status === "active")
      && compatible(build, content, provider));
  }

  private async run(build: ResourceIndexBuildRecord, content: ResourceContentRecord): Promise<void> {
    const provider = this.provider!;
    const controller = new AbortController();
    this.active = { build, controller };
    const signal = AbortSignal.any([controller.signal, this.shutdown.signal]);
    try {
      this.store.validateStored(build);
      while (true) {
        signal.throwIfAborted();
        if (this.current(build) === undefined) { this.store.supersede(build.build_id); return; }
        const batch = this.store.pending(build.build_id, this.batchSize);
        if (batch.length === 0) break;
        this.store.attempt(build.build_id);
        const vectors = await provider.embedMany({ kind: "document", inputs: batch.map(chunk => chunk.embedding_text), signal });
        signal.throwIfAborted();
        const values = batch.map((chunk, index) => ({ chunkId: chunk.chunk_id, embedding: encodeVector(vectors[index]!, provider.dimension) }));
        if (!this.store.write(build.build_id, values)) throw new Error("Index batch changed before it could be stored.");
      }
      if (this.current(build) === undefined || !this.store.publish(build.build_id)) {
        this.store.supersede(build.build_id);
        return;
      }
      this.ctx.emit("resource/index-changed", createProjectId(build.project_id), createResourceId(build.resource_id));
    } catch (error) {
      if (this.shutdown.signal.aborted) return;
      if (this.current(build) === undefined) this.store.supersede(build.build_id);
      else {
        const code = error instanceof EmbeddingError ? error.code : signal.aborted ? "cancelled" : "index-failed";
        const message = error instanceof Error ? error.message : "Resource index build failed.";
        this.store.fail(build.build_id, code, message);
        this.blocked.set(identity(build.project_id, build.resource_id), build.source_asset_generation);
      }
    } finally {
      if (this.active?.build.build_id === build.build_id) this.active = undefined;
    }
  }

  private current(build: ResourceIndexBuildRecord): ResourceContentRecord | undefined {
    const projectId = createProjectId(build.project_id);
    const resourceId = createResourceId(build.resource_id);
    const resource = this.ctx.resources.get(projectId, resourceId);
    const content = this.ctx.content.read(projectId, resourceId);
    return resource?.assetGeneration === build.source_asset_generation && content?.source_asset_generation === build.source_asset_generation ? content : undefined;
  }

  private isBlocked(projectId: string, resourceId: string, generation: number): boolean {
    return this.blocked.get(identity(projectId, resourceId)) === generation;
  }

  private diagnose(): void { console.error("[resource-index] persistence unavailable; recovery deferred to next startup."); }
}

function identity(projectId: string, resourceId: string): string { return JSON.stringify([projectId, resourceId]); }
function parsePageMap(value: string | null): readonly { readonly page: number; readonly start: number; readonly end: number }[] {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(page => typeof page !== "object" || page === null || !("page" in page) || !("start" in page) || !("end" in page)
    || !Number.isSafeInteger(page.page) || !Number.isSafeInteger(page.start) || !Number.isSafeInteger(page.end))) throw new Error("Stored page map is invalid.");
  return parsed as readonly { readonly page: number; readonly start: number; readonly end: number }[];
}

declare module "cordis" {
  interface Context { resourceIndex: ResourceIndexProcessor }
  interface Events { "resource/index-changed"(projectId: ProjectId, resourceId: ResourceId): void }
}
