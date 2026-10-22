import type { Context } from "cordis";
import type { ResourceLibraryInputV1, ResourceLibrarySnapshotV1 } from "../../../rpc/resource.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { ProjectId } from "../../brand/ids.js";
import { createProjectId } from "../../brand/ids.js";
import { StreamEventQueue } from "../turn/queue.js";
import { toResourceFailure } from "./failure.js";
import { describeLibrarySnapshot } from "./view.js";

export function createResourceFollowHandler(
  ctx: Context,
): RpcStreamHandler<ResourceLibraryInputV1, ResourceLibrarySnapshotV1> {
  return async function* (input, signal) {
    const projectId = createProjectId(input.projectId);
    const frames = new StreamEventQueue<ResourceLibrarySnapshotV1>();
    let last: string | undefined;
    let pending = false;
    let chain = Promise.resolve();
    const publish = (): void => {
      pending = false;
      try {
        const snapshot = describeLibrarySnapshot(ctx, projectId, input.path);
        const encoded = JSON.stringify(snapshot);
        if (encoded !== last) {
          last = encoded;
          frames.push(snapshot);
        }
      } catch (error) {
        frames.fail(toResourceFailure(error));
      }
    };
    const schedule = (changed: ProjectId): void => {
      if (changed !== projectId || pending) return;
      pending = true;
      chain = chain.then(publish);
    };
    const disposers = [
      ctx.on("project/changed", schedule),
      ctx.on("resource/content-changed", changed => schedule(changed)),
    ];
    const stop = (): void => frames.end();
    signal.addEventListener("abort", stop, { once: true });
    chain = chain.then(publish);
    try {
      for await (const frame of frames) yield frame;
    } finally {
      signal.removeEventListener("abort", stop);
      for (const dispose of disposers) dispose();
      await chain;
    }
  };
}
