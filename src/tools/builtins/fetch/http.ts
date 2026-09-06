import { FetchError } from "./errors.js";
import { publicFetchNetwork } from "./network.js";
import { isSameOrigin, validateFetchUrl } from "./policy.js";
import { readFetchResponse } from "./response.js";
import type { FetchRequest, FetchResult } from "./types.js";

export const HTTP_FETCH_DEFAULTS = Object.freeze({
  maxResponseBytes: 5 * 1024 * 1024,
  maxDecodedCharacters: 100_000,
  maxRedirects: 5,
  userAgent: "skillworld/0.0.0",
});

export interface HttpFetchConfig {
  readonly maxResponseBytes?: number;
  readonly maxDecodedCharacters?: number;
  readonly maxRedirects?: number;
  readonly userAgent?: string;
}

interface ResolvedHttpFetchConfig {
  readonly maxResponseBytes: number;
  readonly maxDecodedCharacters: number;
  readonly maxRedirects: number;
  readonly userAgent: string;
}

/** Construct the anonymous HTTP operation consumed by FetchCore. */
export function createHttpFetch(
  config: HttpFetchConfig = {},
): (request: FetchRequest, signal: AbortSignal) => Promise<FetchResult> {
  const limits = resolveHttpFetchConfig(config);
  return async (request, signal) => {
    let current = validateFetchUrl(request.url);
    let redirects = 0;
    for (;;) {
      const addresses = await publicFetchNetwork.resolve(current.hostname, signal);
      const pinned = await publicFetchNetwork.request(
        current,
        addresses,
        {
          "user-agent": limits.userAgent,
          accept: "text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9",
        },
        signal,
      );
      try {
        if (!isRedirectStatus(pinned.response.status)) {
          return await readFetchResponse(pinned.response, current, limits, signal);
        }
        if (redirects >= limits.maxRedirects) {
          await pinned.response.body?.cancel();
          throw new FetchError(
            "redirect-blocked",
            `Fetch exceeded ${limits.maxRedirects} redirects.`,
          );
        }
        const location = pinned.response.headers.get("location");
        if (location === null) {
          await pinned.response.body?.cancel();
          throw new FetchError(
            "network-failed",
            `HTTP ${pinned.response.status} redirect omitted Location.`,
          );
        }
        let target: URL;
        try {
          target = validateFetchUrl(new URL(location, current).toString());
        } catch (error: unknown) {
          await pinned.response.body?.cancel();
          throw error;
        }
        if (!isSameOrigin(current, target)) {
          await pinned.response.body?.cancel();
          throw new FetchError(
            "redirect-blocked",
            `Cross-origin redirect from '${current.origin}' to '${target.origin}'.`,
          );
        }
        await pinned.response.body?.cancel();
        current = target;
        redirects += 1;
      } finally {
        await pinned.close();
      }
    }
  };
}

function resolveHttpFetchConfig(
  value: HttpFetchConfig,
): ResolvedHttpFetchConfig {
  const maxResponseBytes = positiveInteger(
    value.maxResponseBytes,
    HTTP_FETCH_DEFAULTS.maxResponseBytes,
    50 * 1024 * 1024,
    "maxResponseBytes",
  );
  const maxDecodedCharacters = positiveInteger(
    value.maxDecodedCharacters,
    HTTP_FETCH_DEFAULTS.maxDecodedCharacters,
    1_000_000,
    "maxDecodedCharacters",
  );
  const maxRedirects = nonNegativeInteger(
    value.maxRedirects,
    HTTP_FETCH_DEFAULTS.maxRedirects,
    10,
    "maxRedirects",
  );
  const userAgent = value.userAgent ?? HTTP_FETCH_DEFAULTS.userAgent;
  if (!userAgent.trim() || userAgent.length > 256 || /[^\x20-\x7e]/.test(userAgent)) {
    throw new FetchError("invalid-config", "Fetch userAgent is invalid.");
  }
  return Object.freeze({
    maxResponseBytes,
    maxDecodedCharacters,
    maxRedirects,
    userAgent,
  });
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw new FetchError("invalid-config", `Fetch ${name} is outside its range.`);
  }
  return result;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 0 || result > maximum) {
    throw new FetchError("invalid-config", `Fetch ${name} is outside its range.`);
  }
  return result;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 ||
    status === 307 || status === 308;
}
