import { describe, expect, it } from "vitest";
import { chunkText } from "../../../src/resource/index/chunker.js";

describe("resource Chunker", () => {
  it("keeps deterministic UTF-16 source ranges, headings, emoji and complete coverage", () => {
    const text = "# 标题 😀\n\n第一句。第二句！\n\n## Child\nEnglish sentence. Next one?\n";
    const first = chunkText({ text, type: "text/markdown" }, { targetChars: 18, maxChars: 24, overlapChars: 4 });
    const second = chunkText({ text, type: "text/markdown" }, { targetChars: 18, maxChars: 24, overlapChars: 4 });
    expect(first).toEqual(second);
    expect(first.every(chunk => chunk.text === text.slice(chunk.startOffsetUtf16, chunk.endOffsetUtf16))).toBe(true);
    expect(first.every(chunk => [...chunk.text].length <= 24)).toBe(true);
    expect(first.some(chunk => chunk.headingPath.includes("标题 😀"))).toBe(true);
    expect(covered(text.length, first.map(chunk => [chunk.startOffsetUtf16, chunk.endOffsetUtf16]))).toBe(true);
  });

  it("splits long prose, list, code and table without bypassing the hard limit", () => {
    const text = ["# H", "", `Paragraph ${"word, ".repeat(80)}`, "", `- ${"item；".repeat(60)}`,
      "", "```ts", `const value = '${"x".repeat(90)}'`, "```", "", "| A | B |", "|---|---|",
      `| ${"cell".repeat(40)} | value |`].join("\n");
    const chunks = chunkText({ text, type: "text/markdown" }, { targetChars: 50, maxChars: 60, overlapChars: 8 });
    expect(chunks.every(chunk => [...chunk.text].length <= 60)).toBe(true);
    expect(chunks.some(chunk => chunk.structure === "code")).toBe(true);
    expect(chunks.some(chunk => chunk.structure === "table")).toBe(true);
    expect(covered(text.length, chunks.map(chunk => [chunk.startOffsetUtf16, chunk.endOffsetUtf16]))).toBe(true);
  });

  it("maps overlapping PDF ranges to every intersecting page and handles blank text", () => {
    const text = "a".repeat(20) + "b".repeat(20);
    const chunks = chunkText({ text, type: "application/pdf", pageMap: [
      { page: 1, start: 0, end: 20 }, { page: 2, start: 20, end: 40 },
    ] }, { targetChars: 24, maxChars: 30, overlapChars: 6 });
    expect(chunks[1]?.pages).toEqual([1, 2]);
    expect(chunkText({ text: " \n\n", type: "text/plain" })).toEqual([]);
  });
});

function covered(length: number, ranges: readonly (readonly number[])[]): boolean {
  let end = 0;
  for (const [start, nextEnd] of ranges) {
    if (start === undefined || nextEnd === undefined || start > end || nextEnd < end) return false;
    end = Math.max(end, nextEnd);
  }
  return end === length;
}
