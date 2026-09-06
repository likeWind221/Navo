import { TextDecoder } from "node:util";

import type { Response } from "undici";

import { FetchError } from "./errors.js";
import type { FetchBody, FetchResult } from "./types.js";

export interface FetchResponseLimits {
  readonly maxResponseBytes: number;
  readonly maxDecodedCharacters: number;
}

type ResponseKind = "html" | "markdown" | "plain";

/** Classify the exact text formats supported by the first Fetch slice. */
export function classifyFetchContentType(value: string | null): ResponseKind {
  const mime = (value ?? "").replace(/;.*$/s, "").trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime === "text/plain") return "plain";
  throw new FetchError(
    "unsupported-content-type",
    `Fetch response type '${mime || "missing"}' is unsupported.`,
  );
}

/** Resolve a declared charset before consuming the response stream. */
export function decoderForContentType(value: string | null): TextDecoder {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(value ?? "");
  const charset = match?.[1]?.trim().toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset);
  } catch (error: unknown) {
    throw new FetchError(
      "unsupported-charset",
      `Fetch response declared unsupported charset '${charset}'.`,
      { cause: error },
    );
  }
}

/** Read, decode, and classify one final response within transport budgets. */
export async function readFetchResponse(
  response: Response,
  finalUrl: URL,
  limits: FetchResponseLimits,
  signal: AbortSignal,
): Promise<FetchResult> {
  const contentType = response.headers.get("content-type");
  let kind: ResponseKind;
  let decoder: TextDecoder;
  try {
    kind = classifyFetchContentType(contentType);
    decoder = decoderForContentType(contentType);
  } catch (error: unknown) {
    await response.body?.cancel();
    throw error;
  }
  const body = await readCappedBody(response, limits.maxResponseBytes, signal);
  const decoded = decoder.decode(body.bytes);
  if (decoded.length > limits.maxDecodedCharacters) {
    throw new FetchError(
      "response-too-large",
      `Fetch decoded ${decoded.length} characters; maximum is ${limits.maxDecodedCharacters}.`,
    );
  }
  return Object.freeze({
    url: finalUrl.toString(),
    statusCode: response.status,
    body: responseBody(kind, decoded),
  });
}

interface CappedBody {
  readonly bytes: Uint8Array;
}

async function readCappedBody(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<CappedBody> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maximum) {
      await response.body?.cancel();
      throw new FetchError(
        "response-too-large",
        `Fetch response declares ${length} bytes; maximum is ${maximum}.`,
      );
    }
  }
  if (response.body === null) {
    return { bytes: new Uint8Array(0) };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximum - total;
      if (value.byteLength > remaining) {
        throw new FetchError(
          "response-too-large",
          `Fetch response exceeded ${maximum} bytes.`,
        );
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new FetchError("aborted", "Fetch response reading was cancelled.", {
        cause: error,
      });
    }
    if (error instanceof FetchError) throw error;
    throw new FetchError("network-failed", "Fetch response stream failed.", {
      cause: error,
    });
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

function responseBody(kind: ResponseKind, content: string): FetchBody {
  if (kind === "html") return Object.freeze({ kind, content });
  return Object.freeze({ kind: "text", format: kind, content });
}
