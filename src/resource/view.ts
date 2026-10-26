import { mkdtemp, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";

import type { ProjectResource, ResourceEntryTarget } from "./model.js";
import { ASSET_LIMITS, stageAsset } from "./assets.js";

export interface ResourceViewCopy {
  readonly projectId: string;
  readonly resourceId: string;
  readonly name: string;
  readonly type: string;
  readonly revision: number;
  readonly assetGeneration: number;
  readonly copyPath: string;
}

export async function copyResourceView(
  resource: ProjectResource,
  target: ResourceEntryTarget,
  signal: AbortSignal,
): Promise<ResourceViewCopy> {
  const directory = await mkdtemp(join(tmpdir(), "navo-resource-view-"));
  const extension = extname(target.path).replace(/[^a-zA-Z0-9.]/g, "");
  const copyPath = join(directory, `${String(resource.id)}${extension}`);
  try {
    await stageAsset(target.path, copyPath, signal, ASSET_LIMITS.maxFileBytes);
    signal.throwIfAborted();
    return Object.freeze({
      projectId: String(resource.projectId),
      resourceId: String(resource.id),
      name: resource.name,
      type: resource.type,
      revision: resource.revision,
      assetGeneration: resource.assetGeneration,
      copyPath,
    });
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
