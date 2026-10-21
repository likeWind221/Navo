import { Context } from "cordis";

import { AgentRuntime } from "./agent/runtime.js";
import type { AgentRuntimeLimits, TurnModelConfig } from "./agent/types.js";
import type { SessionId } from "./brand/ids.js";
import { CompactCommand } from "./command/compact.js";
import { SessionContextResolver } from "./command/context.js";
import { CommandService } from "./command/service.js";
import { LLMService } from "./llm/service.js";
import { MailboxStore } from "./mailbox/store.js";
import type { NodePluginConfig } from "./node/plugin.js";
import { NodePlugin } from "./node/plugin.js";
import { resolveAgentBinding } from "./project/binding.js";
import { ProjectRuntime } from "./project/runtime.js";
import { AutoRunService } from "./project/autorun.js";
import { MainSessionService } from "./project/session.js";
import { ContentProcessor } from "./resource/content.js";
import { ResourceService, ResourceRecovery, type ResourceConfig } from "./resource/service.js";
import { SessionStore } from "./session/store.js";
import { SessionError } from "./session/errors.js";
import { StorageService } from "./storage/database.js";
import type { StorageConfig } from "./storage/database.js";
import { ProjectStore } from "./project/store.js";
import { RoadmapStore } from "./roadmap/store.js";
import { FileError } from "./tools/builtins/file/errors.js";
import { createFileEnvironment } from "./tools/builtins/file/path.js";
import type { FileEnvironment } from "./tools/builtins/file/path.js";
import { ReadMailboxTool } from "./tools/builtins/mailbox/read.js";
import { SendToMainTool } from "./tools/builtins/mailbox/send.js";
import { SubmitCompletionTool } from "./tools/builtins/node/submit.js";
import { SubmitReviewTool } from "./tools/builtins/project/review.js";
import { ReadNodeTurnTool } from "./tools/builtins/project/turnlog.js";
import { ReviewService } from "./project/review.js";
import { SetProjectGoalTool } from "./tools/builtins/project/goal.js";
import { RoadmapToolsPlugin } from "./tools/builtins/roadmap/plugin.js";
import { ResourceToolsPlugin } from "./tools/builtins/resource/plugin.js";
import type { ToolsPluginConfig } from "./tools/plugin.js";
import { ToolsPlugin } from "./tools/plugin.js";
import { WorkspaceError } from "./workspace/errors.js";
import { ProjectWorkspaceStore } from "./workspace/store.js";

export interface NavoAppConfig {
  readonly storage: StorageConfig;
  readonly resources?: ResourceConfig;
  readonly runtime?: Partial<AgentRuntimeLimits>;
  readonly tools?: ToolsPluginConfig;
  readonly node: NodePluginConfig;
  readonly agent?: {
    readonly model: TurnModelConfig;
    readonly systemPrompt?: string;
    readonly toolNames?: readonly string[];
  };
}

export async function NavoApp(
  ctx: Context,
  config: NavoAppConfig,
): Promise<void> {
  await ctx.plugin(StorageService, config.storage);
  let resolveSessionProject: ((sessionId: SessionId) => string | null) | undefined;
  ctx.inject(["projects", "nodes"], scope => {
    resolveSessionProject = sessionId => resolveAgentBinding(scope, sessionId)?.projectId ?? null;
    return () => { resolveSessionProject = undefined; };
  });
  await Promise.all([
    ctx.plugin(SessionStore, { persistence: true, resolveProjectId: (sessionId: SessionId) => {
      if (resolveSessionProject === undefined) {
        throw new SessionError("persistence-unavailable", "Session ownership is unavailable.");
      }
      return resolveSessionProject(sessionId);
    } }),
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
      let workspace;
      try {
        workspace = await bindingCtx.projectWorkspaces.require(binding.projectId);
      } catch (error: unknown) {
        if (error instanceof WorkspaceError) throw new FileError("path-not-allowed", error.message);
        throw error;
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
  await ctx.plugin(ResourceService, config.resources);
  await ctx.plugin(ResourceRecovery);
  await ctx.plugin(ContentProcessor);
  await ctx.plugin(ResourceToolsPlugin);
  await ctx.plugin(SendToMainTool);
  await ctx.plugin(SubmitCompletionTool);
  await ctx.plugin(ReadMailboxTool);
  await ctx.plugin(ReviewService);
  await ctx.plugin(SubmitReviewTool);
  await ctx.plugin(ReadNodeTurnTool);
  await ctx.plugin(MainSessionService, { model: config.node.session.model });
  await ctx.plugin(SessionContextResolver, config.agent === undefined ? {} : { agent: config.agent });
  await ctx.plugin(CompactCommand);
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(ProjectRuntime);
  await ctx.plugin(AutoRunService);
  await ctx.plugin(RoadmapToolsPlugin);
  await ctx.plugin(SetProjectGoalTool);
}

export async function createApp(
  config: NavoAppConfig,
): Promise<Context> {
  const ctx = new Context();
  try {
    await ctx.plugin(NavoApp, config);
    ctx.content.start();
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
