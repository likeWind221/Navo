import type { TurnEvent } from "../../agent/types.js";
import type { ProjectId } from "../../brand/ids.js";
import type { AutoRunSnapshot, AutoRunTarget } from "../autorun.js";

export interface AutoRunObservedTurn {
  readonly runId: string;
  readonly target: AutoRunTarget;
  readonly sessionId: string;
  readonly turnId: string;
}

export type AutoRunObservationEvent =
  | { readonly type: "snapshot"; readonly snapshot: AutoRunSnapshot | null }
  | { readonly type: "run-started"; readonly snapshot: AutoRunSnapshot }
  | { readonly type: "target-started"; readonly runId: string; readonly target: AutoRunTarget }
  | { readonly type: "turn-baseline"; readonly turn: AutoRunObservedTurn }
  | { readonly type: "turn-event"; readonly runId: string; readonly target: AutoRunTarget; readonly event: TurnEvent }
  | { readonly type: "pause-requested"; readonly runId: string }
  | { readonly type: "closed" };

export type AutoRunObservationListener = (event: AutoRunObservationEvent) => void;

export class AutoRunObserver {
  private readonly listeners = new Map<ProjectId, Set<AutoRunObservationListener>>();

  subscribe(projectId: ProjectId, snapshot: AutoRunSnapshot | null,
    activeTurn: AutoRunObservedTurn | undefined, pauseRequested: boolean,
    listener: AutoRunObservationListener): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set<AutoRunObservationListener>();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    listener({ type: "snapshot", snapshot });
    if (pauseRequested && snapshot !== null) listener({ type: "pause-requested", runId: snapshot.runId });
    if (activeTurn !== undefined) listener({ type: "turn-baseline", turn: activeTurn });
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  emit(projectId: ProjectId, event: AutoRunObservationEvent): void {
    for (const listener of this.listeners.get(projectId) ?? []) listener(event);
  }

  close(): void {
    for (const listeners of this.listeners.values()) {
      for (const listener of listeners) listener({ type: "closed" });
    }
    this.listeners.clear();
  }
}
