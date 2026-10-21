import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/types/src/display/api.js";
import type { ContentExtraction, ContentLimits, ContentPage } from "./extraction.js";
import { normalizeText, requireBody } from "./extraction.js";
import { ContentError, contentFailure } from "./errors.js";

export type PdfLoader = (bytes: Uint8Array) => PDFDocumentLoadingTask;

const loadPdf: PdfLoader = data => getDocument({ data, useSystemFonts: false,
  disableFontFace: true, stopAtErrors: true, verbosity: 0 });

export async function extractPdf(bytes: Uint8Array, signal: AbortSignal, limits: ContentLimits,
  load: PdfLoader = loadPdf): Promise<ContentExtraction> {
  signal.throwIfAborted();
  const task = load(bytes);
  let destruction: Promise<void> | undefined;
  const destroy = (): Promise<void> => destruction ??= task.destroy();
  let rejectAbort: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = (): void => {
    rejectAbort(signal.reason);
    void destroy().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const document = await Promise.race([task.promise, aborted]);
    if (document.numPages > limits.maxPages) throw new ContentError("page_limit_exceeded");
    const parts: string[] = [];
    const pageMap: ContentPage[] = [];
    let offset = 0;
    let bodyBytes = 0;
    for (let number = 1; number <= document.numPages; number++) {
      signal.throwIfAborted();
      const page = await Promise.race([document.getPage(number), aborted]);
      try {
        const content = await Promise.race([page.getTextContent(), aborted]);
        const items: string[] = [];
        let pageBytes = 0;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const text = item.str + (item.hasEOL ? "\n" : "");
          pageBytes += Buffer.byteLength(text, "utf8");
          if (bodyBytes + pageBytes > limits.maxBodyBytes) throw new ContentError("content_limit_exceeded");
          items.push(text);
        }
        const text = normalizeText(items.join(""));
        if (number > 1) { parts.push("\n\n"); offset += 2; bodyBytes += 2; }
        bodyBytes += Buffer.byteLength(text, "utf8");
        if (bodyBytes > limits.maxBodyBytes) throw new ContentError("content_limit_exceeded");
        pageMap.push({ page: number, start: offset, end: offset + text.length });
        parts.push(text);
        offset += text.length;
      } finally {
        page.cleanup();
      }
    }
    signal.throwIfAborted();
    const body = parts.join("");
    requireBody(body, limits.maxBodyBytes);
    return { status: "ready", body, pageMap, extractorVersion: "pdfjs-6.4.299-v1" };
  } catch (error) {
    throw signal.aborted || error instanceof ContentError ? contentFailure(error, signal) : new ContentError("pdf_parse_failed");
  } finally {
    signal.removeEventListener("abort", abort);
    await destroy();
  }
}
