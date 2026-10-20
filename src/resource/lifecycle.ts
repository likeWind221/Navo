import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { Context } from "cordis";
import { createProjectId, createResourceId } from "../brand/ids.js";
import type { ProjectId, ResourceId } from "../brand/ids.js";
import type { FileOperation } from "../storage/operations.js";
import type { ProjectWorkspace } from "../workspace/model.js";
import { requireResourceOwner, normalizeResourcePrincipal, canReadResource } from "./access.js";
import { assetLocation, prepareVersion, stageAsset } from "./assets.js";
import { agreesWithOperation, operationEvent, type CommittedEvent } from "./commit.js";
import { ResourceError } from "./errors.js";
import { createResourceEvent, type ResourceEvent } from "./events.js";
import { libraryPathKey, normalizeLibraryPath } from "./library.js";
import type { DeleteResourceInput, ProjectResource, PublishResourceInput, ReplaceResourceInput, ResourcePrincipal, ResourceEntryTarget } from "./model.js";
import { resolveResourceEntry } from "./path.js";
import { AssetRecovery } from "./recovery.js";
import type { ResourceStore } from "./store.js";
import { requireActiveResourceProject, requireResourcePrincipal, requireResourceRevision, requireResourceWorkspace, validateResourceMetadata } from "./validation.js";

export interface AssetIntake {
  readonly filename: string;
  readonly receive: (workspace: ProjectWorkspace) => Promise<{ readonly path: string }>;
}

export interface AssetCreation extends AssetIntake {
  readonly choosePath: (resources: readonly ProjectResource[]) => string;
}

export class ResourceLifecycle {
  readonly recovery: AssetRecovery;
  private readonly running = new Map<string, { readonly request: string; readonly result: Promise<ProjectResource> }>();

  constructor(private readonly ctx: Context, private readonly store: ResourceStore, private readonly maxFileBytes: number) {
    this.recovery = new AssetRecovery(ctx, store);
  }

  create(input: PublishResourceInput, intake: AssetCreation, signal?: AbortSignal): Promise<ProjectResource> {
    const operationId = this.operationId(input.operationId);
    this.authorize(input.projectId, input.owner);
    const running = this.running.get(operationId);
    if (running !== undefined) {
      if (running.request !== this.request(input)) throw new ResourceError("invalid-resource", "Operation ID belongs to different input or actor.");
      return running.result;
    }
    const task = this.write(operationId, input, intake, signal).finally(() => this.running.delete(operationId));
    this.running.set(operationId, { request: this.request(input), result: task });
    return task;
  }

  replace(input: ReplaceResourceInput, intake: AssetIntake, signal?: AbortSignal): Promise<ProjectResource> {
    const operationId = this.operationId(input.operationId);
    this.authorize(input.projectId, input.actor);
    const running = this.running.get(operationId);
    if (running !== undefined) {
      if (running.request !== this.request(input)) throw new ResourceError("invalid-resource", "Operation ID belongs to different input or actor.");
      return running.result;
    }
    const task = this.write(operationId, input, intake, signal).finally(() => this.running.delete(operationId));
    this.running.set(operationId, { request: this.request(input), result: task });
    return task;
  }

  delete(input: DeleteResourceInput): Promise<void> {
    const operationId = this.operationId(input.operationId);
    this.authorize(input.projectId, input.actor);
    const previous = this.recovery.get(operationId);
    if (previous !== undefined) {
      this.requireOperation(previous, input.projectId, "delete", input.actor, input.resourceId);
      this.requireRequest(previous, input);
      if (previous.business_result !== "succeeded") throw new ResourceError("invalid-resource", "Operation has not succeeded.");
      this.requireCommitted(previous);
      return this.recovery.recover().catch(() => undefined);
    }
    const current = this.current(input.projectId, input.resourceId, input.actor, input.expectedRevision);
    const operation = this.intent(operationId, input, "delete", current);
    this.ctx.storage.atomic(tx => {
      tx.insertFileOperation({ ...operation, execution_state: "committed", business_result: "succeeded",
        cleanup_targets_json: JSON.stringify([this.target(current)]) });
      this.append(input.projectId, current.id, current.revision, "resource-deleted", { operationId });
    });
    return this.recovery.recover().catch(() => undefined);
  }

  async read<T>(projectId: ProjectId, resourceId: ResourceId, viewer: ResourcePrincipal | undefined,
    work: (resource: ProjectResource, target: ResourceEntryTarget) => Promise<T>): Promise<T> {
    const lease = this.lease(projectId, resourceId, viewer);
    try {
      const workspace = await requireResourceWorkspace(this.ctx, projectId);
      return await work(lease.resource, await resolveResourceEntry(workspace, lease.resource));
    } finally {
      lease.release();
      await this.recovery.recover().catch(() => undefined);
    }
  }

  lease(projectId: ProjectId, resourceId: ResourceId, viewer?: ResourcePrincipal) {
    const resource = this.store.getState(resourceId);
    if (viewer !== undefined) requireResourcePrincipal(this.ctx, projectId, normalizeResourcePrincipal(viewer));
    if (resource?.status !== "active" || resource.resource.projectId !== projectId
      || (viewer !== undefined && !canReadResource(resource.resource, viewer))) {
      throw new ResourceError("resource-unavailable", "Resource is unavailable to the requested viewer.");
    }
    const key = this.recovery.key(resourceId, resource.resource.assetGeneration);
    this.recovery.leases.set(key, (this.recovery.leases.get(key) ?? 0) + 1);
    let released = false;
    return { resource: resource.resource, release: () => {
      if (released) return;
      released = true;
      const count = this.recovery.leases.get(key)! - 1;
      if (count === 0) this.recovery.leases.delete(key);
      else this.recovery.leases.set(key, count);
    } };
  }

  private async write(operationId: string, input: PublishResourceInput | ReplaceResourceInput, intake: AssetIntake | AssetCreation, signal?: AbortSignal): Promise<ProjectResource> {
    const replacing = "resourceId" in input;
    const actor = normalizeResourcePrincipal(replacing ? input.actor : input.owner);
    const previous = this.recovery.get(operationId);
    if (previous !== undefined) {
      this.requireOperation(previous, input.projectId, replacing ? "replace" : "create", actor, replacing ? input.resourceId : undefined);
      this.requireRequest(previous, input);
      if (previous.business_result !== "succeeded") throw new ResourceError("invalid-resource", "Operation ended without a committed Resource; use a new operation ID.");
      const result = this.committedResult(previous);
      await this.recovery.recover().catch(() => undefined);
      return result;
    }
    signal?.throwIfAborted();
    const current = replacing ? this.current(input.projectId, input.resourceId, actor, input.expectedRevision) : undefined;
    const filename = normalizeLibraryPath(intake.filename);
    const metadata = replacing ? undefined : validateResourceMetadata({ ...input, entryRef: filename });
    await this.recovery.recover();
    const workspace = await requireResourceWorkspace(this.ctx, input.projectId);
    const source = await intake.receive(workspace);
    signal?.throwIfAborted();
    let operation = this.intent(operationId, input, replacing ? "replace" : "create", current);
    this.ctx.storage.atomic(tx => tx.insertFileOperation(operation));
    this.recovery.active.add(operationId);
    try {
      if (operation.resource_id === null) operation = this.recovery.save({ ...operation, resource_id: randomUUID() });
      const resourceId = createResourceId(operation.resource_id!);
      const generation = operation.target_generation!;
      const extension = posix.extname(filename).slice(1).toLowerCase();
      const entryRef = `versions/${generation}/source${/^[a-z0-9]+$/.test(extension) ? `.${extension}` : ""}`;
      operation = this.recovery.save({ ...operation, target_relpath: `assets/${resourceId}/${entryRef}` });
      const staged = await assetLocation(workspace, operation.staging_relpath!, true);
      await stageAsset(source.path, staged, signal, this.maxFileBytes);
      signal?.throwIfAborted();
      await prepareVersion(workspace, operation.target_relpath!, staged, operationId);
      operation = this.recovery.save({ ...operation, execution_state: "prepared" });
      signal?.throwIfAborted();
      this.ctx.storage.atomic(tx => {
        this.authorize(input.projectId, actor);
        if (replacing) this.current(input.projectId, resourceId, actor, input.expectedRevision);
        const persisted = tx.getFileOperation(operationId);
        if (persisted?.execution_state !== "prepared" || persisted.resource_id !== resourceId) throw new Error("File operation ownership changed before commit.");
        if (replacing) {
          this.append(input.projectId, resourceId, current!.revision, "resource-replaced", { entryRef, assetGeneration: generation, operationId });
        } else {
          const resources = this.store.listStates(input.projectId).filter(state => state.status === "active").map(state => state.resource);
          if (!("choosePath" in intake)) throw new Error("Creation requires a logical path.");
          const libraryPath = normalizeLibraryPath(intake.choosePath(resources));
          if (resources.some(resource => libraryPathKey(resource.libraryPath) === libraryPathKey(libraryPath))) {
            throw new ResourceError("resource-already-exists", "Logical Resource path is already in use.");
          }
          this.append(input.projectId, resourceId, 0, "resource-created", { owner: actor, name: metadata!.name,
            description: metadata!.description, resourceType: metadata!.type, libraryPath, entryRef, assetGeneration: 1, operationId });
        }
        operation = { ...operation, execution_state: "committed", business_result: "succeeded",
          cleanup_targets_json: JSON.stringify(current === undefined ? [] : [this.target(current)]) };
        tx.updateFileOperation(operation);
      });
      return this.store.getState(resourceId)!.resource;
    } catch (error) {
      const persisted = this.recovery.get(operationId)!;
      if (persisted.business_result !== "succeeded") {
        const cancelled = signal?.aborted === true;
        this.recovery.save({ ...persisted, execution_state: "cleanup_pending", business_result: cancelled ? "cancelled" : "failed",
          error_code: error instanceof Error ? error.message : "asset-write-failed" });
      }
      throw error;
    } finally {
      this.recovery.active.delete(operationId);
      await this.recovery.cleanup(operationId).catch(() => undefined);
    }
  }

  private intent(operationId: string, input: PublishResourceInput | DeleteResourceInput, kind: FileOperation["operation_kind"], current?: ProjectResource): FileOperation {
    const now = new Date().toISOString();
    return { operation_id: operationId, project_id: input.projectId, resource_id: current?.id ?? null,
      request_json: this.request(input), operation_kind: kind, execution_state: "staging", business_result: "pending", base_revision: current?.revision ?? 0,
      source_generation: current?.assetGeneration ?? null, target_generation: kind === "delete" ? null : (current?.assetGeneration ?? 0) + 1,
      staging_relpath: kind === "delete" ? null : `staging/resource-intake/${operationId}/source`, target_relpath: null,
      cleanup_targets_json: "[]", error_code: null, created_at: now, updated_at: now };
  }

  private current(projectId: ProjectId, resourceId: ResourceId, actor: ResourcePrincipal, revision: number): ProjectResource {
    const state = this.store.getState(resourceId);
    if (state?.status !== "active" || state.resource.projectId !== projectId) throw new ResourceError("resource-unavailable", "Resource is unavailable.");
    requireResourceOwner(state.resource, actor);
    requireResourceRevision(state.resource, revision);
    return state.resource;
  }

  private authorize(projectId: ProjectId, actor: ResourcePrincipal): void {
    requireActiveResourceProject(this.ctx, projectId);
    requireResourcePrincipal(this.ctx, projectId, normalizeResourcePrincipal(actor));
  }

  private committedResult(operation: FileOperation): ProjectResource {
    const event = this.requireCommitted(operation);
    const state = this.store.getState(createResourceId(operation.resource_id!));
    if (state === undefined || state.status !== "active") {
      throw new ResourceError("resource-unavailable", "Committed Resource is unavailable.");
    }
    if (event.type === "resource-deleted" || state.resource.revision !== event.revision
      || state.resource.assetGeneration !== event.data.assetGeneration) {
      throw new ResourceError("operation-result-stale", "Resource changed after the operation succeeded.");
    }
    return state.resource;
  }

  private requireCommitted(operation: FileOperation): CommittedEvent {
    const event = operationEvent(this.store.getEvents(createProjectId(operation.project_id)), operation.operation_id);
    if (event === undefined || !agreesWithOperation(event, operation)) {
      throw new ResourceError("invalid-history", "Committed operation has no matching Resource event.");
    }
    return event;
  }

  private requireOperation(operation: FileOperation, projectId: ProjectId, kind: FileOperation["operation_kind"], actor: ResourcePrincipal, resourceId?: ResourceId): void {
    if (operation.project_id !== projectId || operation.operation_kind !== kind || (resourceId !== undefined && resourceId !== operation.resource_id)) {
      throw new ResourceError("invalid-resource", "Operation ID belongs to a different request.");
    }
    if (operation.resource_id !== null) {
      const state = this.store.getState(createResourceId(operation.resource_id));
      if (state !== undefined) requireResourceOwner(state.resource, actor);
    }
  }

  private request(input: PublishResourceInput | DeleteResourceInput): string {
    const { operationId: _operationId, ...fields } = input;
    return JSON.stringify(fields, Object.keys(fields).concat("kind", "nodeId").sort());
  }

  private requireRequest(operation: FileOperation, input: PublishResourceInput | DeleteResourceInput): void {
    if (operation.request_json !== this.request(input)) throw new ResourceError("invalid-resource", "Operation ID belongs to different input or actor.");
  }

  private target(resource: ProjectResource): string {
    return `assets/${resource.id}/${resource.entryRef}`;
  }

  private operationId(value?: string): string {
    if (value === undefined) return randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new ResourceError("invalid-resource", "Invalid operation ID.");
    return value;
  }

  private append<T extends ResourceEvent["type"]>(projectId: ProjectId, resourceId: ResourceId, baseRevision: number, type: T, data: Extract<ResourceEvent, { type: T }>["data"]) {
    return this.store.append(createResourceEvent({ projectId, resourceId, baseRevision, type, data,
      sequence: this.store.getEvents(projectId).length + 1 }));
  }
}
