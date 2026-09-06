import { FetchError } from "./errors.js";

export const FETCH_URL_MAX_LENGTH = 2_048;

/** Parse one absolute URL and enforce policy that needs no network access. */
export function validateFetchUrl(input: string): URL {
  if (input.length > FETCH_URL_MAX_LENGTH) {
    throw new FetchError("invalid-url", "Fetch URL exceeds 2,048 characters.");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch (error: unknown) {
    throw new FetchError("invalid-url", "Fetch URL could not be parsed.", {
      cause: error,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError(
      "invalid-url",
      `Fetch URL uses unsupported protocol '${url.protocol}'.`,
    );
  }
  if (url.username || url.password) {
    throw new FetchError("blocked-url", "Credentials in Fetch URLs are blocked.");
  }
  return url;
}

/** Compare origins after WHATWG URL normalization, including effective ports. */
export function isSameOrigin(first: URL, second: URL): boolean {
  return first.protocol === second.protocol &&
    first.hostname === second.hostname &&
    first.port === second.port;
}
