import { Service } from "cordis";
import type { Context } from "cordis";

import { SearchError } from "./errors.js";
import { assertSearchActive, executeSearch } from "./execution.js";
import { normalizeSearchRequest, resolveSearchTimeout } from "./validation.js";
import type {
  SearchAdapter,
  SearchAdapterRegistration,
  SearchServiceConfig,
  SearchRequest,
  SearchResult,
} from "./types.js";

declare module "cordis" {
  interface Context {
    search: SearchService;
  }
}

/** Provider-neutral search gateway with bounded, cancellation-aware execution. */
export class SearchService extends Service {
  private readonly adapters = new Map<string, SearchAdapter>();
  private readonly defaultProvider: string | undefined;
  private readonly timeoutMs: number;

  constructor(ctx: Context, config: SearchServiceConfig = {}) {
    const defaultProvider = config.defaultProvider;
    if (defaultProvider !== undefined && !isValidId(defaultProvider)) {
      throw new SearchError("invalid-config", "Default search provider ID is invalid.");
    }
    const timeoutMs = resolveSearchTimeout(config.timeoutMs);
    super(ctx, "search");
    // Capture the scalar instead of retaining mutable caller configuration.
    this.defaultProvider = defaultProvider;
    this.timeoutMs = timeoutMs;
  }

  /** Each caller owns its operation; unloading that caller cancels its wait. */
  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    assertSearchActive(signal ? [signal] : []);
    const normalized = normalizeSearchRequest(request);
    const adapter = this.resolveAdapter();
    const scope = new AbortController();
    const dispose = this.ctx.effect(() => function cancelSearch() {
      scope.abort();
    }, "search.execute");
    try {
      return await executeSearch(adapter, normalized, this.timeoutMs,
        signal ? [signal, scope.signal] : [scope.signal]);
    } finally {
      await dispose();
    }
  }

  /** Registration is owned by the calling Cordis fiber, not the service fiber. */
  registerAdapter(adapter: SearchAdapter): SearchAdapterRegistration {
    if (!adapter || !isValidId(adapter.id) || typeof adapter.search !== "function") {
      throw new SearchError("invalid-adapter", "Search adapter needs an ID and search method.");
    }
    const id = adapter.id;
    if (this.adapters.has(id)) {
      throw new SearchError(
        "adapter-already-registered",
        `Search adapter '${id}' is already registered.`,
      );
    }

    const adapters = this.adapters;
    const dispose = this.ctx.effect(function* register() {
      adapters.set(id, adapter);
      yield function unregister() {
        if (adapters.get(id) === adapter) adapters.delete(id);
      };
    }, "search.registerAdapter");
    return function disposeRegistration() {
      void dispose();
    };
  }

  /** Trusted backend API; not exposed as a model-selectable provider argument. */
  resolveAdapter(): SearchAdapter {
    if (this.defaultProvider !== undefined) {
      const adapter = this.adapters.get(this.defaultProvider);
      if (!adapter) {
        throw new SearchError(
          "adapter-not-found",
          `Configured search adapter '${this.defaultProvider}' is not registered.`,
        );
      }
      return adapter;
    }
    if (this.adapters.size === 0) {
      throw new SearchError("provider-unavailable", "No search adapter is registered.");
    }
    if (this.adapters.size > 1) {
      throw new SearchError("provider-ambiguous", "Multiple search adapters need a default.");
    }
    return this.adapters.values().next().value!;
  }
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
