import type { Context } from "cordis";
import type { ProjectId } from "../brand/ids.js";
import type { ResourcePrincipal } from "./model.js";

export function visibleResourceContext(ctx: Context, projectId: ProjectId, viewer: Exclude<ResourcePrincipal, { kind: "user" }>) {
  return ctx.resources.listVisible(projectId, viewer).map(resource => Object.freeze({
    id: resource.id,
    name: resource.name,
    description: resource.description,
    type: resource.type,
    revision: resource.revision,
    ownedByCurrentAgent: resource.owner.kind === viewer.kind
      && (resource.owner.kind === "main" || (viewer.kind === "node" && resource.owner.nodeId === viewer.nodeId)),
  }));
}
