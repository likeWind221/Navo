import { open } from "node:fs/promises";
import { extname } from "node:path";
import { ContentError, contentFailure } from "./errors.js";

export type ContentExtraction =
  | { readonly status: "metadata_only" }
  | { readonly status: "ready"; readonly body: string; readonly pageMap: readonly ContentPage[]; readonly extractorVersion: string };

export interface ContentPage {
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

export interface ContentLimits {
  readonly maxPages: number;
  readonly maxBodyBytes: number;
  readonly maxInputBytes: number;
  readonly timeoutMs: number;
}

export const CONTENT_LIMITS: ContentLimits = Object.freeze({
  maxPages: 2000,
  maxBodyBytes: 16 * 1024 * 1024,
  maxInputBytes: 100 * 1024 * 1024,
  timeoutMs: 120_000,
});

export type ContentExtractor = (path: string, signal: AbortSignal, limits: ContentLimits) => Promise<ContentExtraction>;

export const extractContent: ContentExtractor = async (path, signal, limits) => {
  const extension = extname(path).toLowerCase();
  signal.throwIfAborted();
  if (![".md", ".markdown", ".txt", ".pdf"].includes(extension)) return { status: "metadata_only" };
  try {
    const bytes = await readInput(path, signal, limits.maxInputBytes);
    signal.throwIfAborted();
    if (extension === ".pdf") {
      const { extractPdf } = await import("./pdf.js");
      return await extractPdf(bytes, signal, limits);
    }
    const body = normalizeText(new TextDecoder("utf-8").decode(bytes));
    requireBody(body, limits.maxBodyBytes);
    return { status: "ready", body, pageMap: [], extractorVersion: "utf8-v1" };
  } catch (error) {
    throw contentFailure(error, signal);
  }
};

export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function requireBody(body: string, maxBytes: number): void {
  if (Buffer.byteLength(body, "utf8") > maxBytes) throw new ContentError("content_limit_exceeded");
  if (!body.trim()) throw new ContentError("empty_content");
}

async function readInput(path: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    if (size > maxBytes) throw new ContentError("input_limit_exceeded");
    return new Uint8Array(await file.readFile({ signal }));
  } finally {
    await file.close();
  }
}
