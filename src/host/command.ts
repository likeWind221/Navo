import type { Context } from "cordis";

import type { CommandEvent } from "../../shared/content.js";
import type { SessionCommandInput } from "../../rpc/command.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import { createSessionId } from "../brand/ids.js";
import { StreamEventQueue } from "./turn/queue.js";

export function createSessionCommandHandler(
  ctx: Context,
): RpcStreamHandler<SessionCommandInput, CommandEvent> {
  return async function* sessionCommand(input, signal) {
    const events = new StreamEventQueue<CommandEvent>();
    const execution = ctx.commands.execute({
      sessionId: createSessionId(input.sessionId),
      commandId: input.commandId,
      name: input.name,
      args: input.args,
    }, event => events.push(event), signal).then(
      () => events.end(),
      error => events.fail(error),
    );
    try {
      for await (const event of events) yield event;
    } finally {
      await execution;
    }
  };
}
