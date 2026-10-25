import type { Context } from "cordis";

import { visibleResourceContext } from "../resource/context.js";
import type { NodeId, SessionId } from "../brand/ids.js";
import { TurnContextBuilder } from "../context/turn.js";
import type { TurnContextSection } from "../context/turn.js";
import { NodeTurnContextBuilder } from "../node/context.js";
import type { NodeFeedback } from "../node/model.js";
import { formatResourceChanges, formatReworkFeedback } from "../node/profile.js";
import { changedFacts, lastObservedFacts } from "../session/reminder.js";
import type { ContextFact } from "../session/types.js";
import { lastEndedTurn } from "./checklist.js";
import { requireAgentBinding } from "./binding.js";
import { ProjectError } from "./errors.js";
import { formatNodeChanges } from "./profile.js";

export function createProjectTurnContext(
  ctx: Context,
  sessionId: SessionId,
  options: ProjectTurnContextOptions = {},
): TurnContextBuilder {
  let catalog: ReturnType<typeof visibleResourceContext> = [];
  let facts: readonly ContextFact[] = [];
  let addedResources: ReturnType<NodeTurnContextBuilder["build"]>["addedResources"] = [];
  return new TurnContextBuilder([
    () => {
      const binding = requireAgentBinding(ctx, sessionId);
      const project = ctx.projects.get(binding.projectId);
      if (project === undefined || project.status !== "active") {
        throw new ProjectError("project-unavailable", "Turn context requires an active owning Project.");
      }
      if (binding.kind === "main") {
        facts = ctx.nodes.getByProject(project.id).map(value => ({
          kind: "node", id: String(value.node.id), label: value.node.objective.title, state: value.status,
        }));
        return [{ kind: "runtime-state", data: {
          goal: project.goal, goalStatus: project.goal === null ? "not yet confirmed" : "recorded",
          status: project.status, nodes: facts.map(fact => ({ id: fact.id, title: fact.label, status: fact.state! })),
        } }];
      }
      const node = ctx.nodes.getBySession(sessionId)!;
      const context = new NodeTurnContextBuilder(ctx).build(node, lastObservedFacts(ctx.sessions, sessionId));
      catalog = [...context.resources];
      facts = context.facts;
      addedResources = context.addedResources;
      return [{ kind: "runtime-state", data: {
        projectGoal: context.projectGoal, projectStatus: project.status,
        objective: { ...context.objective, acceptanceCriteria: [...context.objective.acceptanceCriteria] },
        status: context.status,
        ...(context.reworkFeedback === undefined ? {} : { reworkFeedback: { ...context.reworkFeedback } }),
      } }];
    },
    () => {
      const binding = requireAgentBinding(ctx, sessionId);
      if (binding.kind === "main") catalog = visibleResourceContext(ctx, binding.projectId, { kind: "main" });
      return [{ kind: "resource-catalog", data: catalog.map(resource => ({ ...resource })) }];
    },
    () => {
      const previous = lastObservedFacts(ctx.sessions, sessionId);
      const changes = changedFacts(previous, facts).filter(change => change.fact.kind === "node");
      const binding = requireAgentBinding(ctx, sessionId);
      const sections: TurnContextSection[] = (options.reminders ?? []).map(text => ({ kind: "reminder", text }));
      if (binding.kind === "main" && changes.length > 0) {
        sections.push({ kind: "reminder", text: formatNodeChanges(changes) });
      }
      if (binding.kind === "node" && addedResources.length > 0) {
        sections.push({ kind: "reminder", text: formatResourceChanges(addedResources) });
      }
      if (options.feedback !== undefined) sections.push({ kind: "reminder", text: formatReworkFeedback(options.feedback) });
      if (options.reviewNodeId !== undefined) {
        const node = ctx.nodes.get(options.reviewNodeId)!;
        const turn = node.sessionId === undefined ? undefined : lastEndedTurn(ctx.sessions.getEvents(node.sessionId));
        facts = [...facts, { kind: "review", id: String(node.node.id), label: String(node.revision),
          ...(turn === undefined ? {} : { state: String(turn.turnId) }),
        }];
      }
      if (options.observe !== false && (previous === undefined || JSON.stringify(previous) !== JSON.stringify(facts))) {
        ctx.sessions.append({ type: "context-observed", sessionId, data: { facts } });
      }
      return sections;
    },
  ]);
}

interface ProjectTurnContextOptions {
  readonly observe?: boolean;
  readonly feedback?: NodeFeedback;
  readonly reminders?: readonly string[];
  readonly reviewNodeId?: NodeId;
}
