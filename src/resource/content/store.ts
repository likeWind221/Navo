import type { ProjectId, ResourceId } from "../../brand/ids.js";
import { createProjectId, createResourceId } from "../../brand/ids.js";
import type { StorageService } from "../../storage/database.js";
import type { ResourceContentRecord } from "../../storage/content.js";
import type { ProjectStore } from "../../project/store.js";
import type { ResourceService } from "../service.js";
import type { ContentExtraction } from "./extraction.js";
import type { ContentError } from "./errors.js";

export class ResourceContentStore {
  constructor(private readonly storage: StorageService, private readonly resources: ResourceService,
    private readonly projects: ProjectStore) {}

  get(projectId: ProjectId, resourceId: ResourceId): ResourceContentRecord | undefined {
    const resource = this.resources.get(projectId, resourceId);
    if (resource === undefined) return undefined;
    const row = this.storage.atomic(tx => tx.getResourceContent(projectId, resourceId));
    return row?.source_asset_generation === resource.assetGeneration ? row : undefined;
  }

  ensure(projectId: ProjectId, resourceId: ResourceId, retry = false): boolean {
    const resource = this.resources.get(projectId, resourceId);
    if (resource === undefined) return false;
    return this.storage.atomic(tx => {
      const row = tx.getResourceContent(projectId, resourceId);
      if (row === undefined || row.source_asset_generation !== resource.assetGeneration
        || (retry && (row.status === "failed" || row.status === "metadata_only"))) {
        tx.putResourceContent(pendingContent(projectId, resourceId, resource.assetGeneration));
        return true;
      }
      return false;
    });
  }

  reconcile(): void {
    for (const project of this.projects.list()) {
      for (const resource of this.resources.listByProject(project.id)) {
        this.ensure(project.id, resource.id);
      }
    }
    this.storage.atomic(tx => {
      for (const row of tx.listResourceContent()) {
        const projectId = createProjectId(row.project_id);
        const resourceId = createResourceId(row.resource_id);
        if (this.projects.get(projectId) === undefined) {
          if (!this.storage.recovery.failures.some(failure => failure.kind === "project" && failure.projectId === projectId)) {
            tx.deleteResourceContent(projectId, resourceId);
          }
          continue;
        }
        const resource = this.resources.get(projectId, resourceId);
        if (resource === undefined) tx.deleteResourceContent(projectId, resourceId);
        else if (row.status === "processing") tx.putResourceContent(pendingContent(projectId, resourceId, resource.assetGeneration));
      }
    });
  }

  pending(): readonly ResourceContentRecord[] {
    return this.storage.atomic(tx => tx.listResourceContent()).filter(row => row.status === "pending" && this.projects.get(createProjectId(row.project_id)) !== undefined);
  }

  claim(row: ResourceContentRecord, attemptId: string): boolean {
    return this.storage.atomic(tx => tx.claimResourceContent(row.project_id, row.resource_id, row.source_asset_generation, attemptId));
  }

  finish(row: ResourceContentRecord, attemptId: string, result: ContentExtraction | ContentError | "shutdown"): boolean {
    return this.storage.atomic(tx => {
      if (result !== "shutdown") {
        const resource = this.resources.get(createProjectId(row.project_id), createResourceId(row.resource_id));
        if (resource?.assetGeneration !== row.source_asset_generation) return false;
      }
      const base = pendingContent(row.project_id, row.resource_id, row.source_asset_generation);
      const record: ResourceContentRecord = result === "shutdown" ? base
        : "code" in result ? { ...base, status: "failed", error_code: result.code, error_message: result.message.slice(0, 1000) }
          : result.status === "metadata_only" ? { ...base, status: "metadata_only" }
            : { ...base, status: "ready", body: result.body, page_map_json: JSON.stringify(result.pageMap), extractor_version: result.extractorVersion };
      return tx.finishResourceContent(record, attemptId);
    });
  }
}

export function pendingContent(projectId: string, resourceId: string, generation: number): ResourceContentRecord {
  return { project_id: projectId, resource_id: resourceId, source_asset_generation: generation, status: "pending",
    body: null, page_map_json: null, extractor_version: null, processing_attempt_id: null, error_code: null,
    error_message: null, updated_at: new Date().toISOString() };
}
