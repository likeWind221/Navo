import type { ProjectId } from "../brand/ids.js";
import type { Node } from "../node/model.js";
import type { RoadmapEvent } from "./events.js";
import { RoadmapError } from "./errors.js";
import { buildRoadmapGraph } from "./graph.js";
import { bypassLegacyNodes, lastLegacyEvent } from "./legacy.js";
import type { RoadmapDefinition, RoadmapSnapshot } from "./model.js";
import { applyRoadmapChanges } from "./mutation.js";

export function projectRoadmap(
  projectId: ProjectId,
  history: readonly RoadmapEvent[],
  catalog: readonly Pick<Node, "id" | "projectId" | "requirement">[],
  legacy: ReadonlySet<string> = new Set(),
): RoadmapSnapshot | undefined {
  let current: RoadmapSnapshot | undefined;
  let replayed: RoadmapDefinition | undefined;
  const ids = new Set<string>();
  const legacyUntil = lastLegacyEvent(history, legacy);
  for (const [index, event] of history.entries()) {
    if (!event || event.version !== 1 || event.projectId !== projectId
      || typeof event.id !== "string" || !event.id.trim() || ids.has(event.id)
      || !Number.isSafeInteger(event.revision) || event.revision !== (current?.revision ?? 0) + 1
      || event.baseRevision !== (current?.revision ?? 0)
      || typeof event.reason !== "string" || !event.reason.trim()
      || typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) {
      throw new RoadmapError("invalid-event-stream", "Invalid roadmap event header");
    }
    ids.add(event.id);
    if (event.type === "roadmap-created") {
      if (replayed || event.definition.projectId !== projectId) throw new RoadmapError("invalid-event-stream", "Invalid roadmap creation");
      replayed = event.definition;
    } else if (event.type === "roadmap-changed" && replayed) {
      replayed = applyRoadmapChanges(replayed, event.changes);
    } else {
      throw new RoadmapError("invalid-event-stream", "Roadmap must be created before changes");
    }
    const definition = bypassLegacyNodes(replayed, legacy);
    if (index >= legacyUntil) replayed = definition;
    current = Object.freeze({ revision: event.revision, graph: buildRoadmapGraph(definition, catalog) });
  }
  return current;
}
