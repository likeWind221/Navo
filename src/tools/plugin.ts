import type { Context } from "cordis";

import type { SearchAdapter, SearchServiceConfig } from "./builtins/search/types.js";
import { SearchService } from "./builtins/search/service.js";
import { SearchTool } from "./builtins/search/tool.js";
import { ToolService } from "./service.js";

/** Trusted configuration for the complete application-level tool layer. */
export interface ToolsPluginConfig {
  readonly search?: SearchToolsConfig;
}

/** Search execution settings plus the optional host-supplied provider. */
export interface SearchToolsConfig extends SearchServiceConfig {
  readonly adapter?: SearchAdapter;
}

/** Mounts the tool registry and its provider-neutral built-in capabilities. */
export async function ToolsPlugin(
  ctx: Context,
  config: ToolsPluginConfig = {},
): Promise<void> {
  const search = config.search ?? {};
  await ctx.plugin(ToolService);
  await ctx.plugin(SearchService, {
    ...(search.defaultProvider === undefined
      ? {}
      : { defaultProvider: search.defaultProvider }),
    ...(search.timeoutMs === undefined ? {} : { timeoutMs: search.timeoutMs }),
  });
  if (search.adapter !== undefined) {
    const adapter = search.adapter;
    await ctx.inject(["search"], (searchContext) =>
      searchContext.search.registerAdapter(adapter));
  }
  await ctx.plugin(SearchTool);
}
