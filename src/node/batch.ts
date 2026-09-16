import { randomUUID } from "node:crypto";
import { createEventId } from "../brand/ids.js";
import type { NodeId } from "../brand/ids.js";
import type { NodeEvent, NodeEventDraft } from "./events.js";
import { NodeError } from "./errors.js";
import { immutable, projectNode } from "./projector.js";
import type { NodeSnapshot } from "./model.js";

export class NodeBatch {
  private readonly histories = new Map<NodeId, readonly NodeEvent[]>();
  private readonly originals = new Map<NodeId, readonly NodeEvent[]>();
  private readonly appended: NodeEvent[] = [];
  private closed = false;

  constructor(private readonly read: (id: NodeId) => readonly NodeEvent[]) {}

  get(id: NodeId): NodeSnapshot | undefined {
    return projectNode(id, this.histories.get(id) ?? this.read(id));
  }

  add(draft: NodeEventDraft): NodeSnapshot {
    if (this.closed) throw new NodeError("invalid-state", "Batch is closed.");
    if (!this.originals.has(draft.nodeId)) this.originals.set(draft.nodeId, this.read(draft.nodeId));
    const history = this.histories.get(draft.nodeId) ?? this.originals.get(draft.nodeId)!;
    const event = immutable({
      ...draft, version: 2, id: createEventId(randomUUID()), revision: history.length + 1, timestamp: new Date().toISOString(),
    }) as NodeEvent;
    const next = Object.freeze([...history, event]);
    const snapshot = projectNode(draft.nodeId, next)!;
    this.histories.set(draft.nodeId, next);
    this.appended.push(event);
    return snapshot;
  }

  commit(write: (id: NodeId, history: readonly NodeEvent[]) => void, notify: (event: NodeEvent) => void): void {
    if (this.closed) throw new NodeError("invalid-state", "Batch is closed.");
    for (const [id, history] of this.originals) {
      if (this.read(id) !== history) throw new NodeError("stale-revision", "Node changed during preparation.");
    }
    this.closed = true;
    for (const [id, history] of this.histories) write(id, history);
    for (const event of this.appended) notify(event);
  }
}
