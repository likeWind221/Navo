import type { Context } from "cordis";

import {
  sessionContextFollowMethod,
  sessionContextMethod,
  sessionHistoryMethod,
} from "../../rpc/session.js";
import type {
  SessionContextInputV1,
  SessionContextSnapshotV1,
  SessionHistoryInputV1,
  SessionHistoryV1,
} from "../../rpc/session.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import type { StreamRpcRouter } from "../../rpc/stream/router.js";
import { createSessionId } from "../brand/ids.js";
import { toSessionFailure } from "./session/failure.js";
import { createSessionContextFollowHandler } from "./session/follow.js";
import { readSessionHistory } from "./session/history.js";
import { createSessionContextSnapshot } from "./session/snapshot.js";

export function registerSessionMethods(router: StreamRpcRouter, ctx: Context): () => void {
  const unregister = [
    router.register(sessionContextMethod, unary<SessionContextInputV1, SessionContextSnapshotV1>(
      input => createSessionContextSnapshot(ctx, createSessionId(input.sessionId)),
    )),
    router.register(sessionHistoryMethod, unary<SessionHistoryInputV1, SessionHistoryV1>(
      input => readSessionHistory(ctx, createSessionId(input.sessionId), input),
    )),
    router.register(sessionContextFollowMethod, createSessionContextFollowHandler(ctx)),
  ];
  return () => { for (const dispose of unregister) dispose(); };
}

function unary<TInput, TOutput>(
  run: (input: TInput) => TOutput | Promise<TOutput>,
): RpcStreamHandler<TInput, TOutput> {
  return async function* session(input) {
    let output: TOutput;
    try {
      output = await run(input);
    } catch (error: unknown) {
      throw toSessionFailure(error);
    }
    yield output;
  };
}
