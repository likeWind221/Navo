import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CONTENT_LIMITS, extractContent } from "../../../src/resource/content/extraction.js";
import { extractPdf, type PdfLoader } from "../../../src/resource/content/pdf.js";
import { samplePdf } from "./pdf.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function file(name: string, text: string | Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "navo-extract-"));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

it.each(["txt", "md", "markdown"])("normalizes UTF-8 BOM/newlines and retains %s syntax", async extension => {
  const path = await file(`source.${extension}`, "\uFEFF# 中文\r\n**text**\rEnd\n");
  expect(await extractContent(path, new AbortController().signal, CONTENT_LIMITS)).toEqual({
    status: "ready", body: "# 中文\n**text**\nEnd\n", pageMap: [], extractorVersion: "utf8-v1",
  });
});

it("distinguishes unsupported formats, empty text, corrupt PDF and input/body limits", async () => {
  const signal = new AbortController().signal;
  expect(await extractContent(await file("source.png", "image"), signal, CONTENT_LIMITS)).toEqual({ status: "metadata_only" });
  await expect(extractContent(await file("source.txt", " \r\n"), signal, CONTENT_LIMITS)).rejects.toMatchObject({ code: "empty_content" });
  await expect(extractContent(await file("source.pdf", "broken"), signal, CONTENT_LIMITS)).rejects.toMatchObject({ code: "pdf_parse_failed" });
  const path = await file("source.md", "中文");
  await expect(extractContent(path, signal, { ...CONTENT_LIMITS, maxBodyBytes: 5 })).rejects.toMatchObject({ code: "content_limit_exceeded" });
  expect((await extractContent(path, signal, { ...CONTENT_LIMITS, maxBodyBytes: 6 })).status).toBe("ready");
  await expect(extractContent(path, signal, { ...CONTENT_LIMITS, maxInputBytes: 5 })).rejects.toMatchObject({ code: "input_limit_exceeded" });
});

it("extracts real multi-page PDF with blank pages and exact final UTF-16 ranges", async () => {
  const result = await extractPdf(samplePdf(["First", "", "Last"]), new AbortController().signal, CONTENT_LIMITS);
  expect(result).toMatchObject({ status: "ready", body: "First\n\n\n\nLast", pageMap: [
    { page: 1, start: 0, end: 5 }, { page: 2, start: 7, end: 7 }, { page: 3, start: 9, end: 13 },
  ] });
  await expect(extractPdf(samplePdf([""]), new AbortController().signal, CONTENT_LIMITS)).rejects.toMatchObject({ code: "empty_content" });
  await expect(extractPdf(samplePdf(["a", "b"]), new AbortController().signal, { ...CONTENT_LIMITS, maxPages: 1 })).rejects.toMatchObject({ code: "page_limit_exceeded" });
  await expect(extractPdf(samplePdf(["abc"]), new AbortController().signal, { ...CONTENT_LIMITS, maxBodyBytes: 2 })).rejects.toMatchObject({ code: "content_limit_exceeded" });
});

it("accepts the configured 2000-page boundary and rejects the next PDF page", { timeout: 15000 }, async () => {
  const pages = Array.from({ length: CONTENT_LIMITS.maxPages }, () => "A");
  const result = await extractPdf(samplePdf(pages), new AbortController().signal, CONTENT_LIMITS);
  expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.pageMap).toHaveLength(CONTENT_LIMITS.maxPages);
  await expect(extractPdf(samplePdf([...pages, "A"]), new AbortController().signal, CONTENT_LIMITS))
    .rejects.toMatchObject({ code: "page_limit_exceeded" });
});

function pdfDouble(pages: readonly (() => Promise<unknown>)[]) {
  const cleanups = pages.map(() => vi.fn(() => true));
  const getPage = vi.fn(async (number: number) => ({ getTextContent: pages[number - 1], cleanup: cleanups[number - 1] }));
  const destroy = vi.fn(async () => {});
  const load = (() => ({ promise: Promise.resolve({ numPages: pages.length, getPage }), destroy })) as unknown as PdfLoader;
  return { load, destroy, cleanups, getPage };
}

it("normalizes each PDF page before mapping, honors EOL, preserves empty pages and awaits cleanup", async () => {
  const pdf = pdfDouble([
    async () => ({ items: [{ str: "\uFEFF😀\r\nA", hasEOL: true }] }),
    async () => ({ items: [] }),
    async () => ({ items: [{ str: "B", hasEOL: false }] }),
  ]);
  const result = await extractPdf(new Uint8Array(), new AbortController().signal, CONTENT_LIMITS, pdf.load);
  expect(result).toMatchObject({ body: "😀\nA\n\n\n\n\nB", pageMap: [
    { page: 1, start: 0, end: 5 }, { page: 2, start: 7, end: 7 }, { page: 3, start: 9, end: 10 },
  ] });
  expect(pdf.getPage.mock.calls).toEqual([[1], [2], [3]]);
  for (const cleanup of pdf.cleanups) expect(cleanup).toHaveBeenCalledOnce();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});

it("discards partial output and cleans page/document after a later page fails", async () => {
  const pdf = pdfDouble([async () => ({ items: [{ str: "ok" }] }), async () => { throw Error("private path"); }]);
  await expect(extractPdf(new Uint8Array(), new AbortController().signal, CONTENT_LIMITS, pdf.load)).rejects.toMatchObject({ code: "pdf_parse_failed", message: "pdf_parse_failed" });
  for (const cleanup of pdf.cleanups) expect(cleanup).toHaveBeenCalledOnce();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});

it.each(["cancelled", "timeout"])("destroys an active PDF on %s and waits for document cleanup", async code => {
  const entered = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const pdf = pdfDouble([() => { entered.resolve(); return new Promise(() => {}); }]);
  pdf.destroy.mockImplementation(() => cleanup.promise);
  const controller = new AbortController();
  const running = extractPdf(new Uint8Array(), controller.signal, CONTENT_LIMITS, pdf.load);
  const settled = vi.fn();
  const assertion = expect(running.finally(settled)).rejects.toMatchObject({ code });
  await entered.promise;
  controller.abort(code === "timeout" ? new DOMException("timeout", "TimeoutError") : undefined);
  await vi.waitFor(() => expect(pdf.destroy).toHaveBeenCalledOnce());
  expect(settled).not.toHaveBeenCalled();
  cleanup.resolve();
  await assertion;
  expect(pdf.cleanups[0]).toHaveBeenCalledOnce();
});
