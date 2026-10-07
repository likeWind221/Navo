import type { Context } from "cordis";

import { RpcError } from "../../../rpc/errors.js";
import type { ProjectFollowV1, ProjectRefInput } from "../../../rpc/project.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { ProjectId } from "../../brand/ids.js";
import { StreamEventQueue } from "../turn/queue.js";
import { toProjectFailure } from "./failure.js";
import { getProject, requireProject } from "./view.js";

export function createProjectFollowHandler(ctx: Context): RpcStreamHandler<ProjectRefInput, ProjectFollowV1> {
  return async function* projectFollow(input, signal) {
    const projectId = requireProject(ctx, input.projectId).id;
    const frames = new StreamEventQueue<ProjectFollowV1>();
    let last: string | undefined;
    let pending = false;
    let chain = Promise.resolve();

    const publish = async (): Promise<void> => {
      pending = false;
      try {
        const frame = await snapshot(ctx, projectId);
        const encoded = JSON.stringify(frame);
        if (encoded === last) return;
        last = encoded;
        frames.push(frame);
      } catch (error: unknown) {
        frames.fail(error instanceof RpcError ? error : toProjectFailure(error));
      }
    };
    const schedule = (changed: ProjectId | undefined): void => {
      if (changed !== projectId || pending) return;
      pending = true;
      chain = chain.then(publish);
    };
    const disposers = [
      ctx.on("project/changed", schedule),
      ctx.on("node/event", event => schedule(ctx.nodes.get(event.nodeId)?.node.projectId)),
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

async function snapshot(ctx: Context, projectId: ProjectId): Promise<ProjectFollowV1> {
  return {
    detail: await getProject(ctx, projectId),
    mailboxSequence: ctx.mailbox.getHistory(projectId).length,
    resourceRevision: ctx.resources.getEvents(projectId).length,
  };
}
