import type { ProjectId } from "../brand/ids.js";
import type { Node } from "../node/model.js";
import type { RoadmapEvent } from "./events.js";
import { RoadmapError } from "./errors.js";
import { buildRoadmapGraph } from "./graph.js";
import type { RoadmapSnapshot } from "./model.js";
import { applyRoadmapChanges } from "./mutation.js";

export function projectRoadmap(
  projectId: ProjectId,
  history: readonly RoadmapEvent[],
  catalog: readonly Pick<Node, "id" | "projectId" | "requirement">[],
): RoadmapSnapshot | undefined {
  let current: RoadmapSnapshot | undefined;
  const ids = new Set<string>();
  for (const event of history) {
    if (!event || event.version !== 1 || event.projectId !== projectId
      || typeof event.id !== "string" || !event.id.trim() || ids.has(event.id)
      || !Number.isSafeInteger(event.revision) || event.revision !== (current?.revision ?? 0) + 1
      || event.baseRevision !== (current?.revision ?? 0)
      || typeof event.reason !== "string" || !event.reason.trim()
      || typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) {
      throw new RoadmapError("invalid-event-stream", "Invalid roadmap event header");
    }
    ids.add(event.id);
    let candidate;
    if (event.type === "roadmap-created") {
      if (current || event.definition.projectId !== projectId) throw new RoadmapError("invalid-event-stream", "Invalid roadmap creation");
      candidate = {
        definition: event.definition,
      };
    } else if (event.type === "roadmap-changed" && current) {
      candidate = { definition: applyRoadmapChanges(current, event.changes) };
    } else {
      throw new RoadmapError("invalid-event-stream", "Roadmap must be created before changes");
    }
    const graph = buildRoadmapGraph(candidate.definition, catalog);
    current = Object.freeze({
      revision: event.revision, graph,
    });
  }
  return current;
}
