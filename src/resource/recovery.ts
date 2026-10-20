import { stat } from "node:fs/promises";
import { createProjectId, createResourceId } from "../brand/ids.js";
import type { Context } from "cordis";
import type { FileOperation } from "../storage/operations.js";
import { assetLocation, pruneVersion, removeAsset, removeVersion, versionOwner } from "./assets.js";
import { agreesWithOperation, operationEvent } from "./commit.js";
import type { ResourceStore } from "./store.js";

export class AssetRecovery {
  readonly active = new Set<string>();
  readonly leases = new Map<string, number>();
  private readonly cleaning = new Map<string, Promise<void>>();

  constructor(private readonly ctx: Context, private readonly store: ResourceStore) {}

  get(operationId: string): FileOperation | undefined {
    return this.ctx.storage.atomic(tx => tx.getFileOperation(operationId));
  }

  save(operation: FileOperation): FileOperation {
    const updated = { ...operation, updated_at: new Date().toISOString() };
    this.ctx.storage.atomic(tx => tx.updateFileOperation(updated));
    return updated;
  }

  async recover(): Promise<void> {
    const pending = this.ctx.storage.atomic(tx => tx.pendingFileOperations());
    for (const operation of pending) {
      if (this.active.has(operation.operation_id)) continue;
      await this.cleanup(operation.operation_id);
    }
  }

  cleanup(operationId: string): Promise<void> {
    const running = this.cleaning.get(operationId);
    if (running !== undefined) return running;
    const task = this.performCleanup(operationId).finally(() => this.cleaning.delete(operationId));
    this.cleaning.set(operationId, task);
    return task;
  }

  key(resourceId: string, generation: number): string {
    return `${resourceId}:${generation}`;
  }

  private async performCleanup(operationId: string): Promise<void> {
    let operation = this.get(operationId)!;
    if (["completed", "failed", "cancelled"].includes(operation.execution_state)) return;
    const projectId = createProjectId(operation.project_id);
    try {
      const committed = operationEvent(this.store.getEvents(projectId), operationId);
      if (committed !== undefined) {
        if (!agreesWithOperation(committed, operation) || operation.business_result !== "succeeded") {
          throw new Error("Resource event and operation commit disagree.");
        }
      } else if (operation.business_result === "succeeded") {
        throw new Error("Committed operation has no authoritative Resource event.");
      }
      const workspace = await this.ctx.projectWorkspaces.require(projectId);
      if (committed !== undefined && operation.target_relpath !== null) {
        const state = this.store.getState(createResourceId(operation.resource_id!));
        if (state?.status === "active" && state.resource.assetGeneration === operation.target_generation) {
          if (!(await stat(await assetLocation(workspace, operation.target_relpath))).isFile()) throw new Error("Committed asset is unavailable.");
        }
      }
      let targets = JSON.parse(operation.cleanup_targets_json) as string[];
      if (committed === undefined && operation.target_relpath !== null) targets.push(operation.target_relpath);
      if (operation.staging_relpath !== null) targets.push(operation.staging_relpath);
      targets = [...new Set(targets)];
      operation = this.save({ ...operation, execution_state: "cleanup_pending",
        business_result: committed !== undefined ? "succeeded" : operation.business_result === "cancelled" ? "cancelled" : "failed",
        cleanup_targets_json: JSON.stringify(targets) });
      const remaining: string[] = [];
      for (const target of targets) {
        if (target === operation.staging_relpath) {
          if (target !== `staging/resource-intake/${operationId}/source`) throw new Error("Invalid staging cleanup target.");
          await removeAsset(workspace, target);
          continue;
        }
        const match = /^assets\/([^/]+)\/versions\/([1-9][0-9]*)\/source(?:\.[a-z0-9]+)?$/.exec(target);
        if (match === null || match[1] !== operation.resource_id) throw new Error("Invalid version cleanup target.");
        const generation = Number(match[2]);
        if (generation !== operation.source_generation && generation !== operation.target_generation) throw new Error("Cleanup generation does not belong to this operation.");
        const current = this.store.getState(createResourceId(match[1]!));
        if ((current?.status === "active" && current.resource.assetGeneration === generation)
          || (this.leases.get(this.key(match[1]!, generation)) ?? 0) > 0) {
          remaining.push(target);
          continue;
        }
        const ownerId = await versionOwner(workspace, target);
        if (ownerId !== undefined) {
          if (committed === undefined && target === operation.target_relpath && ownerId !== operationId) continue;
          const owner = this.get(ownerId);
          if (owner?.target_relpath !== target || owner.resource_id !== operation.resource_id
            || owner.project_id !== operation.project_id) throw new Error("Asset ownership does not match its operation.");
          await removeVersion(workspace, target);
        } else await pruneVersion(workspace, target);
      }
      const terminal = operation.business_result === "succeeded" ? "completed" : operation.business_result === "cancelled" ? "cancelled" : "failed";
      this.save({ ...operation, cleanup_targets_json: JSON.stringify(remaining),
        execution_state: remaining.length === 0 ? terminal : "cleanup_pending",
        error_code: operation.business_result === "succeeded" ? null : operation.error_code });
    } catch (error) {
      this.save({ ...operation, execution_state: "cleanup_pending",
        error_code: error instanceof Error ? error.message : "cleanup-failed" });
    }
  }
}
