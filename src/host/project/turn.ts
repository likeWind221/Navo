import type { Context } from "cordis";

import type { AgentTurnV2Event } from "../../../rpc/content.js";
import { RpcError } from "../../../rpc/errors.js";
import type { ProjectTurnInput } from "../../../rpc/project.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { TurnEvent } from "../../agent/types.js";
import { createNodeId, createProjectId } from "../../brand/ids.js";
import { StreamEventQueue } from "../turn/queue.js";
import { projectFailure, toProjectFailure } from "./failure.js";

export function createProjectTurnHandler(ctx: Context): RpcStreamHandler<ProjectTurnInput, AgentTurnV2Event> {
  return async function* projectTurn(input, signal) {
    const events = new StreamEventQueue<AgentTurnV2Event>();
    const controller = new AbortController();
    const projectId = createProjectId(input.projectId);
    const turn = {
      projectId,
      text: input.text,
      requestId: input.requestId,
      signal: AbortSignal.any([signal, controller.signal]),
      onEvent(event: TurnEvent) {
        if ("commandId" in event) return false;
        events.push(event);
        return true;
      },
    };
    let execution: Promise<unknown>;
    try {
      if (input.target.kind === "main") {
        execution = ctx.projectRuntime.startMain(turn);
      } else {
        const nodeId = createNodeId(input.target.nodeId);
        if (ctx.projectRuntime.isNodeActive(nodeId)) {
          throw projectFailure("turn-active", "Node already has a Human-started Turn in progress.");
        }
        execution = ctx.nodes.get(nodeId)?.sessionId === undefined
          ? ctx.projectRuntime.startNode({ ...turn, nodeId })
          : ctx.projectRuntime.continueNode({ ...turn, nodeId });
      }
    } catch (error: unknown) {
      throw error instanceof RpcError ? error : toProjectFailure(error);
    }
    const settled = execution.then(
      () => events.end(),
      error => events.fail(toProjectFailure(error)),
    );
    try {
      for await (const event of events) yield event;
    } finally {
      controller.abort();
      await settled;
    }
  };
}
