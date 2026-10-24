import { randomUUID } from "node:crypto";
import type { Context } from "cordis";
import { createProjectId, createResourceId } from "../../brand/ids.js";
import type { GraphBuildRecord } from "../../storage/graph.js";
import type { ResourceIndexBuildRecord } from "../../storage/indexing.js";
import { CHUNKER_VERSION } from "../index/chunker.js";

export class GraphStore {
  constructor(private readonly ctx: Context, private readonly pipelineVersion: string | undefined) {}

  sources(): readonly ResourceIndexBuildRecord[] {
    return this.ctx.storage.atomic(tx => tx.listIndexBuilds("active")).filter(source => {
      const resource = this.ctx.resources.get(createProjectId(source.project_id), createResourceId(source.resource_id));
      const content = this.ctx.content.read(createProjectId(source.project_id), createResourceId(source.resource_id));
      return resource?.assetGeneration === source.source_asset_generation && content?.source_asset_generation === source.source_asset_generation
        && source.chunker_version === CHUNKER_VERSION;
    });
  }

  current(build: GraphBuildRecord): boolean {
    return (this.pipelineVersion === undefined || build.pipeline_version === this.pipelineVersion)
      && this.sources().some(source => source.build_id === build.source_build_id && source.project_id === build.project_id
        && source.resource_id === build.resource_id && source.source_asset_generation === build.source_asset_generation);
  }

  reconcile(): void {
    const sources = new Set(this.sources().map(source => source.build_id));
    this.ctx.storage.atomic(tx => {
      for (const build of tx.listGraphBuilds()) {
        if (build.status !== "superseded" && (!sources.has(build.source_build_id)
          || (this.pipelineVersion !== undefined && build.pipeline_version !== this.pipelineVersion))) tx.supersedeGraphBuild(build.build_id);
      }
    });
  }

  next(): GraphBuildRecord | undefined {
    this.reconcile();
    return this.ctx.storage.atomic(tx => {
      const builds = tx.listGraphBuilds();
      const pending = builds.find(build => build.status === "building");
      if (pending !== undefined) return pending;
      for (const source of this.sources()) {
        if (builds.some(build => build.source_build_id === source.build_id && build.pipeline_version === this.pipelineVersion
          && build.status !== "superseded")) continue;
        const build: GraphBuildRecord = { build_id: randomUUID(), project_id: source.project_id, resource_id: source.resource_id,
          source_asset_generation: source.source_asset_generation, source_build_id: source.build_id,
          pipeline_version: this.pipelineVersion!, status: "building", next_ordinal: 0, error_code: null };
        tx.createGraphBuild(build);
        return build;
      }
      return undefined;
    });
  }
}
