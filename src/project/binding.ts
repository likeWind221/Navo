import type { Context } from "cordis";

import type { NodeId, ProjectId, SessionId } from "../brand/ids.js";

export type AgentBinding = MainAgentBinding | NodeAgentBinding;

export interface MainAgentBinding {
  readonly kind: "main";
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
}

export interface NodeAgentBinding {
  readonly kind: "node";
  readonly projectId: ProjectId;
  readonly nodeId: NodeId;
  readonly sessionId: SessionId;
}

export class AgentBindingError extends Error {
  constructor(readonly code: AgentBindingErrorCode, message: string) {
    super(message);
    this.name = "AgentBindingError";
  }
}

export type AgentBindingErrorCode =
  | "binding-not-found"
  | "binding-ambiguous"
  | "binding-role-mismatch"
  | "binding-project-mismatch"
  | "binding-node-mismatch";

export function resolveAgentBinding(
  ctx: Context,
  sessionId: SessionId,
): AgentBinding | undefined {
  const project = ctx.projects.getByMainSession(sessionId);
  const node = ctx.nodes.getBySession(sessionId);
  if (project !== undefined && node !== undefined) {
    throw new AgentBindingError(
      "binding-ambiguous",
      `Session '${sessionId}' is owned by both a Project and a Node.`,
    );
  }
  if (project !== undefined) {
    return Object.freeze({
      kind: "main",
      projectId: project.id,
      sessionId,
    });
  }
  if (node !== undefined) {
    return Object.freeze({
      kind: "node",
      projectId: node.node.projectId,
      nodeId: node.node.id,
      sessionId,
    });
  }
  return undefined;
}

export function requireMainBinding(
  ctx: Context,
  sessionId: SessionId | undefined,
  projectId?: ProjectId,
): MainAgentBinding {
  const binding = requireBinding(ctx, sessionId);
  if (binding.kind !== "main") {
    throw new AgentBindingError(
      "binding-role-mismatch",
      `Session '${binding.sessionId}' is not a Main Agent Session.`,
    );
  }
  if (projectId !== undefined && binding.projectId !== projectId) {
    throw new AgentBindingError(
      "binding-project-mismatch",
      `Session '${binding.sessionId}' is not bound to Project '${projectId}'.`,
    );
  }
  return binding;
}

export function requireNodeBinding(
  ctx: Context,
  sessionId: SessionId | undefined,
  nodeId?: NodeId,
): NodeAgentBinding {
  const binding = requireBinding(ctx, sessionId);
  if (binding.kind !== "node") {
    throw new AgentBindingError(
      "binding-role-mismatch",
      `Session '${binding.sessionId}' is not a Node Agent Session.`,
    );
  }
  if (nodeId !== undefined && binding.nodeId !== nodeId) {
    throw new AgentBindingError(
      "binding-node-mismatch",
      `Session '${binding.sessionId}' is not bound to Node '${nodeId}'.`,
    );
  }
  return binding;
}

export function requireNodeProjectBinding(
  ctx: Context,
  sessionId: SessionId | undefined,
  projectId: ProjectId,
  nodeId?: NodeId,
): NodeAgentBinding {
  const binding = requireNodeBinding(ctx, sessionId, nodeId);
  if (binding.projectId !== projectId) {
    throw new AgentBindingError(
      "binding-project-mismatch",
      `Session '${binding.sessionId}' is not bound to Project '${projectId}'.`,
    );
  }
  return binding;
}

export function requireAgentBinding(
  ctx: Context,
  sessionId: SessionId | undefined,
): AgentBinding {
  return requireBinding(ctx, sessionId);
}

function requireBinding(
  ctx: Context,
  sessionId: SessionId | undefined,
): AgentBinding {
  if (sessionId === undefined) {
    throw new AgentBindingError(
      "binding-not-found",
      "Agent capability requires a trusted Session identity.",
    );
  }
  const binding = resolveAgentBinding(ctx, sessionId);
  if (binding === undefined) {
    throw new AgentBindingError(
      "binding-not-found",
      `Session '${sessionId}' has no Project Agent binding.`,
    );
  }
  return binding;
}
