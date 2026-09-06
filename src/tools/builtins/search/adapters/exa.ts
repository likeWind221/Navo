import { SearchError } from "../errors.js";
import type { SearchAdapter, SearchRequest, SearchResult } from "../types.js";
import { normalizeSearchRequest, SEARCH_LIMITS } from "../validation.js";
import { mapExaResponse, readExaResponse } from "./exa-response.js";

/** Direct HTTP adapter; install explicitly after supplying trusted credentials. */
export class ExaSearchAdapter implements SearchAdapter {
  readonly id = "exa";
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: ExaSearchAdapterOptions, fetchImplementation: typeof fetch = fetch) {
    const key = options.apiKey;
    if (typeof key !== "string" || !key.trim() || !/^[\x21-\x7e]+$/.test(key.trim())) {
      throw new SearchError("invalid-config", "Exa API key must be non-empty printable ASCII.");
    }
    this.#apiKey = key.trim();
    this.#fetch = fetchImplementation;
  }

  /** The service owns deadlines; this adapter honors its signal through body reading. */
  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    if (signal?.aborted) throw aborted();
    const input = normalizeSearchRequest(request);
    try {
      const response = await this.#fetch("https://api.exa.ai/search", {
        method: "POST",
        redirect: "error",
        headers: {
          "x-api-key": this.#apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          query: input.query,
          type: "auto",
          numResults: input.maxResults,
          contents: { highlights: { maxCharacters: SEARCH_LIMITS.summaryLength } },
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      const payload = await readExaResponse(response, signal);
      if (signal?.aborted) throw aborted();
      return mapExaResponse(payload, input.maxResults);
    } catch (error: unknown) {
      if (signal?.aborted) throw aborted();
      if (error instanceof SearchError) throw error;
      // Never retain raw fetch errors: proxies/custom transports may echo credentials.
      throw new SearchError("request-failed", "Exa HTTP request or response read failed.");
    }
  }
}

export interface ExaSearchAdapterOptions {
  /** Not read from Pi, environment variables, tool arguments, or local files. */
  readonly apiKey: string;
}

function aborted(): SearchError {
  return new SearchError("aborted", "Exa search was cancelled.");
}
