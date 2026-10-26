import type { DesktopResourceEvent } from "../../../../shared/resource.js";

export type PendingFollowEvent = Extract<DesktopResourceEvent, { type: "library-snapshot" | "stream-error" }>;

export interface PendingFollowEvents {
  add(event: PendingFollowEvent, projectId: string, path: string | null): void;
  take(subscriptionId: string): readonly PendingFollowEvent[];
  clear(): void;
}

interface PendingFollowRecord {
  snapshot?: Extract<PendingFollowEvent, { type: "library-snapshot" }>;
  error?: Extract<PendingFollowEvent, { type: "stream-error" }>;
}

export function createPendingFollowEvents(): PendingFollowEvents {
  const events = new Map<string, PendingFollowRecord>();
  return {
    add(event, projectId, path) {
      if (event.type === "library-snapshot" && (event.snapshot.projectId !== projectId || event.snapshot.path !== path)) return;
      const record = events.get(event.subscriptionId) ?? {};
      if (event.type === "library-snapshot") record.snapshot = event;
      else record.error = event;
      events.set(event.subscriptionId, record);
    },
    take(subscriptionId) {
      const record = events.get(subscriptionId);
      if (record === undefined) return [];
      return [record.snapshot, record.error].filter((event): event is PendingFollowEvent => event !== undefined);
    },
    clear() {
      events.clear();
    },
  };
}
