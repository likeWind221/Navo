import { Context } from "cordis";

import { AgentRuntime } from "./agent/runtime.js";
import type { AgentRuntimeLimits } from "./agent/types.js";
import type { SessionId } from "./brand/ids.js";
import { CommandService } from "./command/service.js";
import { LLMService } from "./llm/service.js";
import { MailboxStore } from "./mailbox/store.js";
import type { NodePluginConfig } from "./node/plugin.js";
import { NodePlugin } from "./node/plugin.js";
import { resolveAgentBinding } from "./project/binding.js";
import { MainSessionService } from "./project/session.js";
import { ResourceService } from "./resource/service.js";
import { SessionStore } from "./session/store.js";
import { ProjectStore } from "./project/store.js";
import { RoadmapStore } from "./roadmap/store.js";
import { FileError } from "./tools/builtins/file/errors.js";
import { createFileEnvironment } from "./tools/builtins/file/path.js";
import type { FileEnvironment } from "./tools/builtins/file/path.js";
import { ReadMailboxTool } from "./tools/builtins/mailbox/read.js";
import { SendToMainTool } from "./tools/builtins/mailbox/send.js";
import { RoadmapToolsPlugin } from "./tools/builtins/roadmap/plugin.js";
import { ResourceToolsPlugin } from "./tools/builtins/resource/plugin.js";
import type { ToolsPluginConfig } from "./tools/plugin.js";
import { ToolsPlugin } from "./tools/plugin.js";
import { ProjectWorkspaceStore } from "./workspace/store.js";

export interface NavoAppConfig {
  readonly runtime?: Partial<AgentRuntimeLimits>;
  readonly tools?: ToolsPluginConfig;
  readonly node: NodePluginConfig;
}

export async function NavoApp(
  ctx: Context,
  config: NavoAppConfig,
): Promise<void> {
  await Promise.all([
    ctx.plugin(SessionStore),
    ctx.plugin(ProjectStore),
    ctx.plugin(LLMService),
  ]);
  await ctx.plugin(ProjectWorkspaceStore);

  let resolveProjectFileEnvironment:
    | ((sessionId: SessionId) => Promise<FileEnvironment | undefined>)
    | undefined;
  ctx.inject(["projects", "nodes", "projectWorkspaces"], (bindingCtx) => {
    resolveProjectFileEnvironment = async (sessionId) => {
      const binding = resolveAgentBinding(bindingCtx, sessionId);
      if (binding === undefined) return undefined;
      const workspace = await bindingCtx.projectWorkspaces.get(binding.projectId);
      if (workspace === undefined) {
        throw new FileError(
          "path-not-allowed",
          "Project Agent Session has no bound Project Workspace.",
        );
      }
      return createFileEnvironment(workspace.root, workspace.root, [workspace.navoRoot]);
    };
    return () => {
      resolveProjectFileEnvironment = undefined;
    };
  });

  await ctx.plugin(
    ToolsPlugin,
    projectAwareToolsConfig(config.tools, async (sessionId) =>
      resolveProjectFileEnvironment?.(sessionId)),
  );
  await ctx.plugin(AgentRuntime, config.runtime);
  await ctx.plugin(CommandService);
  await ctx.plugin(NodePlugin, config.node);
  await ctx.plugin(MailboxStore);
  await ctx.plugin(ResourceService);
  await ctx.plugin(ResourceToolsPlugin);
  await ctx.plugin(SendToMainTool);
  await ctx.plugin(ReadMailboxTool);
  await ctx.plugin(MainSessionService, { model: config.node.session.model });
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
}

export async function createApp(
  config: NavoAppConfig,
): Promise<Context> {
  const ctx = new Context();
  try {
    await ctx.plugin(NavoApp, config);
    return ctx;
  } catch (error: unknown) {
    await ctx.fiber.dispose();
    throw error;
  }
}

function projectAwareToolsConfig(
  config: ToolsPluginConfig | undefined,
  resolveProjectFileEnvironment: (
    sessionId: SessionId,
  ) => Promise<FileEnvironment | undefined>,
): ToolsPluginConfig | undefined {
  const file = config?.file;
  if (file === undefined) return config;

  return {
    ...config,
    file: {
      ...file,
      async resolveFileEnvironment(sessionId) {
        const projectEnvironment = await resolveProjectFileEnvironment(sessionId);
        return projectEnvironment ?? file.resolveFileEnvironment(sessionId);
      },
    },
  };
}
