import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { ResourceId } from "../brand/ids.js";
import type { ProjectWorkspace } from "../workspace/model.js";
import { ResourceError } from "./errors.js";
import {
  ensureResourceRoot,
  resolveResourcePublishSource,
} from "./path.js";

export interface PublishedResourceContent {
  readonly root: string;
  readonly entryRef: string;
}

export async function publishResourceContent(
  workspace: ProjectWorkspace,
  resourceId: ResourceId,
  sourceRef: string,
  signal?: AbortSignal,
): Promise<PublishedResourceContent> {
  signal?.throwIfAborted();
  const source = await resolveResourcePublishSource(workspace, sourceRef);
  signal?.throwIfAborted();
  const root = await ensureResourceRoot(workspace, resourceId);
  const target = join(root, source.entryRef);

  try {
    await pipeline(
      createReadStream(source.path),
      createWriteStream(target, { flags: "wx" }),
      ...(signal === undefined ? [] : [{ signal }]),
    );
    signal?.throwIfAborted();
    return Object.freeze({ root, entryRef: source.entryRef });
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof ResourceError) throw error;
    throw new ResourceError(
      "resource-content-unavailable",
      "Resource content could not be published.",
      { cause: error },
    );
  }
}

export async function discardPublishedResourceContent(
  root: string,
): Promise<void> {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}
