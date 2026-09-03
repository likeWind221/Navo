import type { SessionId } from "../brand/ids.js";
import type { RunTurnInput, TurnResult } from "./types.js";

type TurnHandler = () => Promise<TurnResult>;

interface TurnEnvelope {
  readonly input: RunTurnInput;
  readonly handle: TurnHandler;
  readonly resolve: (result: TurnResult) => void;
  readonly reject: (error: unknown) => void;
}

/** Routes each submitted Turn to the single driver that owns its Session. */
export class AgentInbox {
  private readonly actors = new Map<SessionId, SessionActor>();

  send(input: RunTurnInput, handle: TurnHandler): Promise<TurnResult> {
    let actor = this.actors.get(input.sessionId);
    if (!actor) {
      actor = new SessionActor(
        input.sessionId,
        (idleActor) => {
          if (this.actors.get(input.sessionId) === idleActor) {
            this.actors.delete(input.sessionId);
          }
        },
      );
      this.actors.set(input.sessionId, actor);
    }
    return actor.send(input, handle);
  }
}

/** Minimal single-writer Actor: one FIFO Inbox and one active driver. */
class SessionActor {
  private readonly inbox: TurnEnvelope[] = [];
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
      input,
      handle,
      resolve: deferred.resolve,
      reject: deferred.reject,
    });
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
      }
    }
  }
}
