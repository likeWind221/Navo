import type { Context } from "cordis";

import type {
  OrdinarySessionCreateInputV1,
  OrdinarySessionEntryV1,
  OrdinarySessionListInputV1,
  OrdinarySessionListV1,
  OrdinarySessionMutationInputV1,
} from "../../../rpc/session.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import { createSessionId } from "../../brand/ids.js";
import { toSessionFailure } from "./failure.js";

export function createSessionCreateHandler(ctx: Context): RpcStreamHandler<OrdinarySessionCreateInputV1, OrdinarySessionEntryV1> {
  return unary(input => ctx.sessionDirectory.create(input.title));
}

export function createSessionListHandler(ctx: Context): RpcStreamHandler<OrdinarySessionListInputV1, OrdinarySessionListV1> {
  return unary(input => ctx.sessionDirectory.list(input));
}

export function createSessionRenameHandler(ctx: Context): RpcStreamHandler<OrdinarySessionMutationInputV1, OrdinarySessionEntryV1> {
  return unary(input => ctx.sessionDirectory.rename(createSessionId(input.sessionId), input.title!, input.expectedRevision));
}

export function createSessionArchiveHandler(ctx: Context): RpcStreamHandler<OrdinarySessionMutationInputV1, OrdinarySessionEntryV1> {
  return unary(input => ctx.sessionDirectory.archive(createSessionId(input.sessionId), input.expectedRevision));
}

export function createSessionRestoreHandler(ctx: Context): RpcStreamHandler<OrdinarySessionMutationInputV1, OrdinarySessionEntryV1> {
  return unary(input => ctx.sessionDirectory.restore(createSessionId(input.sessionId), input.expectedRevision));
}

function unary<TInput, TOutput>(run: (input: TInput) => TOutput): RpcStreamHandler<TInput, TOutput> {
  return async function* ordinarySession(input, signal) {
    try {
      signal.throwIfAborted();
      yield run(input);
    } catch (error: unknown) {
      throw toSessionFailure(error);
    }
  };
}
