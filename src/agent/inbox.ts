import type { SessionId } from "../brand/ids.js";
import type { RunTurnInput, TurnResult } from "./types.js";

type TurnHandler = () => Promise<TurnResult>;
type CommandHandler = () => Promise<void>;

interface TurnEnvelope {
  readonly kind: "turn";
  readonly input: RunTurnInput;
  readonly handle: TurnHandler;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
}

interface CommandEnvelope {
  readonly kind: "command";
  readonly handle: CommandHandler;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
}

type WorkEnvelope = TurnEnvelope | CommandEnvelope;

/** Routes submitted work to the single driver that owns its Session. */
export class AgentInbox {
  private readonly actors = new Map<SessionId, SessionActor>();

  send(input: RunTurnInput, handle: TurnHandler): Promise<TurnResult> {
    return this.actor(input.sessionId).send(input, handle);
  }

  sendCommand(
    sessionId: SessionId,
    handle: CommandHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.actor(sessionId).sendCommand(handle, signal);
  }

  private actor(sessionId: SessionId): SessionActor {
    let actor = this.actors.get(sessionId);
    if (!actor) {
      actor = new SessionActor(sessionId, idleActor => {
        if (this.actors.get(sessionId) === idleActor) this.actors.delete(sessionId);
      });
      this.actors.set(sessionId, actor);
    }
    return actor;
  }
}

/** Minimal single-writer Actor with one active driver. */
class SessionActor {
  private readonly inbox: WorkEnvelope[] = [];
  private driving = false;

  constructor(
    private readonly sessionId: SessionId,
    private readonly onIdle: (actor: SessionActor) => void,
  ) {}

  send(input: RunTurnInput, handle: TurnHandler): Promise<TurnResult> {
    if (input.sessionId !== this.sessionId) {
      throw new TypeError("A Session Actor cannot accept another Session's Turn.");
    }
    const deferred = Promise.withResolvers<TurnResult>();
    this.inbox.push({
      kind: "turn",
      input,
      handle,
      resolve: value => deferred.resolve(value as TurnResult),
      reject: deferred.reject,
      cleanup: () => undefined,
    });
    this.wake();
    return deferred.promise;
  }

  sendCommand(handle: CommandHandler, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(abortError());
    const deferred = Promise.withResolvers<void>();
    let cleanup = (): void => undefined;
    const envelope: CommandEnvelope = {
      kind: "command",
      handle,
      resolve: value => deferred.resolve(value as void),
      reject: deferred.reject,
      cleanup: () => cleanup(),
    };
    const onAbort = (): void => {
      const index = this.inbox.indexOf(envelope);
      if (index < 0) return;
      this.inbox.splice(index, 1);
      envelope.reject(abortError());
      cleanup();
    };
    cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    const firstTurn = this.inbox.findIndex(item => item.kind === "turn");
    if (firstTurn < 0) this.inbox.push(envelope);
    else this.inbox.splice(firstTurn, 0, envelope);
    this.wake();
    return deferred.promise;
  }

  private wake(): void {
    if (this.driving) return;
    this.driving = true;
    void this.drive();
  }

  private async drive(): Promise<void> {
    while (true) {
      const envelope = this.inbox.shift();
      if (!envelope) {
        this.driving = false;
        this.onIdle(this);
        return;
      }
      try {
        envelope.resolve(await envelope.handle());
      } catch (error: unknown) {
        envelope.reject(error);
      } finally {
        envelope.cleanup();
      }
    }
  }
}

function abortError(): DOMException {
  return new DOMException("Command was cancelled.", "AbortError");
}
