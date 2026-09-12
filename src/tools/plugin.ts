import type { Context } from "cordis";

import type { SessionId } from "../brand/ids.js";
import { FetchCore } from "./builtins/fetch/core.js";
import { FetchError } from "./builtins/fetch/errors.js";
import type { HttpFetchConfig } from "./builtins/fetch/http.js";
import { createHttpFetch } from "./builtins/fetch/http.js";
import { FetchTool } from "./builtins/fetch/tool.js";
import type { FetchCoreConfig } from "./builtins/fetch/validation.js";
import { createEditTool } from "./builtins/file/edit.js";
import { FileError } from "./builtins/file/errors.js";
import { FileObservationStore } from "./builtins/file/observation.js";
import type { FileEnvironment } from "./builtins/file/path.js";
import { createReadTool } from "./builtins/file/read.js";
import { createWriteTool } from "./builtins/file/write.js";
import type { SearchToolConfig } from "./builtins/search/tool.js";
import { SearchTool } from "./builtins/search/tool.js";
import type { ShellKind } from "./builtins/shell/types.js";
import { createShellTool } from "./builtins/shell/tool.js";
import { ToolService } from "./service.js";
import type { ToolDefinition } from "./types.js";

/** Trusted configuration for the complete application-level tool layer. */
export interface ToolsPluginConfig {
  readonly search?: SearchToolConfig;
  readonly fetch?: FetchToolsConfig;
  /** Omit to keep host filesystem capabilities entirely unregistered. */
  readonly file?: FileToolsConfig;
}

/** Trusted host bridge from one Session to its fixed file execution environment. */
export interface FileToolsConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
  readonly shell?: {
    readonly kind?: ShellKind;
    readonly path?: string;
  };
}

/** Trusted construction config for the built-in text Fetch capability. */
export interface FetchToolsConfig {
  /** Test or host override; production omission constructs the safe HTTP Core. */
  readonly core?: FetchCore;
  readonly coreConfig?: FetchCoreConfig;
  readonly http?: HttpFetchConfig;
  readonly maxOutputCharacters?: number;
}

/** Mounts the tool registry and its provider-neutral built-in capabilities. */
export async function ToolsPlugin(
  ctx: Context,
  config: ToolsPluginConfig = {},
): Promise<void> {
  await ctx.plugin(ToolService);
  await ctx.plugin(SearchTool, config.search);

  const file = normalizeFileConfig(config.file);
  if (file) registerFileTools(ctx, file);

  const fetch = config.fetch ?? {};
  if (fetch.core !== undefined &&
      (fetch.coreConfig !== undefined || fetch.http !== undefined)) {
    throw new FetchError(
      "invalid-config",
      "Custom FetchCore cannot be combined with Core or HTTP construction config.",
    );
  }
  const core = fetch.core ?? new FetchCore(
    createHttpFetch(fetch.http),
    fetch.coreConfig,
  );
  await ctx.plugin(FetchTool, {
    core,
    ...(fetch.maxOutputCharacters === undefined
      ? {}
      : { maxOutputCharacters: fetch.maxOutputCharacters }),
    ...(file === undefined
      ? {}
      : { spill: { resolveFileEnvironment: file.resolveFileEnvironment } }),
  });
}

function normalizeFileConfig(config: FileToolsConfig | undefined): FileToolsConfig | undefined {
  if (config === undefined) return undefined;
  if (typeof config.resolveFileEnvironment !== "function") {
    throw new FileError("invalid-config", "File tools require resolveFileEnvironment.");
  }
  return config;
}

function registerFileTools(ctx: Context, config: FileToolsConfig): void {
  const observations = new FileObservationStore();
  const definitions: readonly ToolDefinition[] = [
    createReadTool({
      resolveFileEnvironment: config.resolveFileEnvironment,
      observations,
    }),
    createShellTool({
      resolveFileEnvironment: config.resolveFileEnvironment,
      ...config.shell,
    }),
    createEditTool({ resolveFileEnvironment: config.resolveFileEnvironment }),
    createWriteTool({
      resolveFileEnvironment: config.resolveFileEnvironment,
      observations,
    }),
  ];

  ctx.effect(() => {
    const unregister: Array<() => void> = [];
    try {
      for (const definition of definitions) unregister.push(ctx.tools.register(definition));
    } catch (error: unknown) {
      for (const dispose of unregister.reverse()) dispose();
      throw error;
    }
    return () => {
      for (const dispose of unregister.reverse()) dispose();
    };
  }, "file.tools");
}
