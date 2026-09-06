import type { Context } from "cordis";

import { FetchCore } from "./builtins/fetch/core.js";
import { FetchError } from "./builtins/fetch/errors.js";
import type { HttpFetchConfig } from "./builtins/fetch/http.js";
import { createHttpFetch } from "./builtins/fetch/http.js";
import { FetchTool } from "./builtins/fetch/tool.js";
import type { FetchCoreConfig } from "./builtins/fetch/validation.js";
import type { SearchToolConfig } from "./builtins/search/tool.js";
import { SearchTool } from "./builtins/search/tool.js";
import { ToolService } from "./service.js";

/** Trusted configuration for the complete application-level tool layer. */
export interface ToolsPluginConfig {
  readonly search?: SearchToolConfig;
  readonly fetch?: FetchToolsConfig;
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
  });
}
