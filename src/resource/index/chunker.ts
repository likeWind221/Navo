import type { ContentPage } from "../content/extraction.js";

export interface ChunkerConfig {
  readonly targetChars: number;
  readonly maxChars: number;
  readonly overlapChars: number;
}

export interface ChunkInput {
  readonly text: string;
  readonly type: string;
  readonly pageMap?: readonly ContentPage[];
}

export interface TextChunk {
  readonly ordinal: number;
  readonly text: string;
  readonly embeddingText: string;
  readonly startOffsetUtf16: number;
  readonly endOffsetUtf16: number;
  readonly headingPath: readonly string[];
  readonly structure: ChunkStructure;
  readonly pages: readonly number[];
}

export type ChunkStructure = "heading" | "paragraph" | "list" | "code" | "table" | "mixed";

export const CHUNKER_VERSION = "structured-v1";
export const CHUNKER_CONFIG: ChunkerConfig = Object.freeze({ targetChars: 1200, maxChars: 1600, overlapChars: 150 });

interface Block {
  readonly start: number;
  readonly end: number;
  readonly headingPath: readonly string[];
  readonly structure: ChunkStructure;
  readonly context?: string;
}

export function chunkText(input: ChunkInput, config: ChunkerConfig = CHUNKER_CONFIG): readonly TextChunk[] {
  validateConfig(config);
  if (!input.text.trim()) return Object.freeze([]);
  const blocks = identifyBlocks(input.text, /markdown/i.test(input.type));
  const pieces = blocks.flatMap(block => splitBlock(input.text, block, config));
  const base = combine(input.text, pieces, config.targetChars);
  return Object.freeze(base.map((chunk, index) => buildChunk(input, overlap(input.text, base, index, config), index)));
}

function identifyBlocks(text: string, markdown: boolean): readonly Block[] {
  const lines = lineRanges(text);
  const blocks: Block[] = [];
  const headings: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const raw = text.slice(line.start, line.contentEnd);
    const fence = markdown ? /^\s*(```|~~~)([^\r\n]*)$/.exec(raw) : null;
    if (fence !== null) {
      let endIndex = index + 1;
      const marker = fence[1]!;
      while (endIndex < lines.length && !new RegExp(`^\\s*${escapeRegex(marker)}\\s*$`).test(text.slice(lines[endIndex]!.start, lines[endIndex]!.contentEnd))) endIndex++;
      if (endIndex < lines.length) endIndex++;
      blocks.push(block(line.start, lines[endIndex - 1]!.end, headings, "code", fence[2]?.trim() || undefined));
      index = endIndex;
      continue;
    }
    const heading = markdown ? /^(#{1,6})(?:\s+|$)(.*)$/.exec(raw) : null;
    if (heading !== null) {
      const level = heading[1]!.length;
      headings.splice(level - 1);
      headings[level - 1] = heading[2]!.trim();
      blocks.push(block(line.start, line.end, headings, "heading"));
      index++;
      continue;
    }
    if (markdown && isTableStart(lines, index, text)) {
      const start = index;
      index += 2;
      while (index < lines.length && isTableLine(text.slice(lines[index]!.start, lines[index]!.contentEnd))) index++;
      const header = text.slice(lines[start]!.start, lines[start]!.contentEnd).trim();
      blocks.push(block(lines[start]!.start, lines[index - 1]!.end, headings, "table", header));
      continue;
    }
    if (markdown && /^\s*(?:[-+*]|\d+[.)])\s+/.test(raw)) {
      const start = index++;
      while (index < lines.length) {
        const candidate = text.slice(lines[index]!.start, lines[index]!.contentEnd);
        if (!candidate.trim() || /^\s*(?:[-+*]|\d+[.)])\s+/.test(candidate) || /^\s{2,}\S/.test(candidate)) index++;
        else break;
      }
      blocks.push(block(lines[start]!.start, lines[index - 1]!.end, headings, "list"));
      continue;
    }
    const start = index++;
    const blank = !raw.trim();
    while (index < lines.length) {
      const candidate = text.slice(lines[index]!.start, lines[index]!.contentEnd);
      if ((!candidate.trim()) !== blank || (markdown && isSpecial(lines, index, text))) break;
      index++;
    }
    blocks.push(block(lines[start]!.start, lines[index - 1]!.end, headings, "paragraph"));
  }
  return blocks;
}

function splitBlock(text: string, source: Block, config: ChunkerConfig): readonly Block[] {
  const result: Block[] = [];
  let start = source.start;
  while (codePointLength(text, start, source.end) > config.targetChars) {
    const target = advance(text, start, config.targetChars);
    const hard = advance(text, start, config.maxChars);
    const limit = Math.min(hard, source.end);
    const cut = preferredCut(text, start, Math.min(target, limit), limit, source.structure);
    result.push({ ...source, start, end: cut });
    start = cut;
  }
  if (start < source.end) result.push({ ...source, start, end: source.end });
  return result;
}

function combine(text: string, pieces: readonly Block[], target: number): readonly Block[] {
  const result: Block[] = [];
  for (const piece of pieces) {
    const previous = result.at(-1);
    const crossesHeading = previous !== undefined && !samePath(previous.headingPath, piece.headingPath);
    if (previous === undefined || crossesHeading || codePointLength(text, previous.start, piece.end) > target) {
      result.push(piece);
      continue;
    }
    result[result.length - 1] = {
      start: previous.start,
      end: piece.end,
      headingPath: previous.headingPath,
      structure: previous.structure === piece.structure ? previous.structure : "mixed",
      ...((previous.context ?? piece.context) === undefined ? {} : { context: previous.context ?? piece.context }),
    };
  }
  return result;
}

function overlap(text: string, chunks: readonly Block[], index: number, config: ChunkerConfig): Block {
  const current = chunks[index]!;
  const previous = chunks[index - 1];
  if (previous === undefined || previous.structure === "code" || previous.structure === "table"
    || current.structure === "code" || current.structure === "table" || !samePath(previous.headingPath, current.headingPath)) return current;
  const room = config.maxChars - codePointLength(text, current.start, current.end);
  const wanted = Math.min(config.overlapChars, room, codePointLength(text, previous.start, previous.end));
  if (wanted <= 0) return current;
  const approximate = retreat(text, current.start, wanted);
  const start = forwardBoundary(text, approximate, current.start) ?? approximate;
  return { ...current, start };
}

function buildChunk(input: ChunkInput, source: Block, ordinal: number): TextChunk {
  const text = input.text.slice(source.start, source.end);
  const prefix = [source.headingPath.length === 0 ? "" : `Heading: ${source.headingPath.join(" > ")}`,
    source.structure === "table" && source.context ? `Table header: ${source.context}` : "",
    source.structure === "code" && source.context ? `Code language: ${source.context}` : ""].filter(Boolean).join("\n");
  const pages = (input.pageMap ?? []).filter(page => page.end > source.start && page.start < source.end).map(page => page.page);
  return Object.freeze({ ordinal, text, embeddingText: prefix ? `${prefix}\n\n${text}` : text,
    startOffsetUtf16: source.start, endOffsetUtf16: source.end,
    headingPath: Object.freeze([...source.headingPath]), structure: source.structure,
    pages: Object.freeze([...new Set(pages)]) });
}

function preferredCut(text: string, start: number, target: number, limit: number, structure: Block["structure"]): number {
  const window = text.slice(start, limit);
  const targetRelative = target - start;
  const expressions = structure === "code" || structure === "table"
    ? [/\n/g]
    : [/[。！？!?](?:["'”’）\]]*)(?:\s+|$)|\.(?:["'”’）\]]*)(?:\s+|$)/gu, /[；;：:]\s*/gu, /[，,]\s*/gu, /\n/g];
  for (const [priority, expression] of expressions.entries()) {
    let chosen: number | undefined;
    for (const match of window.matchAll(expression)) {
      const end = match.index + match[0].length;
      if (priority === 0 && match[0].startsWith(".") && abbreviation(window.slice(0, match.index))) continue;
      if (end <= targetRelative && end >= Math.floor(targetRelative / 2)) chosen = end;
    }
    if (chosen !== undefined) return start + chosen;
  }
  return target;
}

function abbreviation(prefix: string): boolean {
  return /(?:\b(?:e\.g|i\.e|mr|mrs|ms|dr|prof|sr|jr|vs|etc)|\b[A-Z])$/i.test(prefix);
}

function forwardBoundary(text: string, start: number, end: number): number | undefined {
  const match = /[。！？.!?；;：:,，]\s*/u.exec(text.slice(start, end));
  return match?.index === undefined ? undefined : start + match.index + match[0].length;
}

function lineRanges(text: string): readonly { start: number; contentEnd: number; end: number }[] {
  const result: { start: number; contentEnd: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const contentEnd = newline < 0 ? text.length : newline;
    const end = newline < 0 ? text.length : newline + 1;
    result.push({ start, contentEnd, end });
    start = end;
  }
  return result;
}

function isSpecial(lines: readonly { start: number; contentEnd: number }[], index: number, text: string): boolean {
  const value = text.slice(lines[index]!.start, lines[index]!.contentEnd);
  return /^\s*(?:#{1,6}(?:\s+|$)|```|~~~|(?:[-+*]|\d+[.)])\s+)/.test(value) || isTableStart(lines, index, text);
}

function isTableStart(lines: readonly { start: number; contentEnd: number }[], index: number, text: string): boolean {
  if (index + 1 >= lines.length || !isTableLine(text.slice(lines[index]!.start, lines[index]!.contentEnd))) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(text.slice(lines[index + 1]!.start, lines[index + 1]!.contentEnd));
}

function isTableLine(value: string): boolean { return value.includes("|") && Boolean(value.trim()); }
function block(start: number, end: number, headings: readonly string[], structure: Block["structure"], context?: string): Block {
  return { start, end, headingPath: Object.freeze([...headings.filter(Boolean)]), structure, ...(context === undefined ? {} : { context }) };
}
function samePath(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function codePointLength(text: string, start: number, end: number): number { return [...text.slice(start, end)].length; }
function advance(text: string, start: number, count: number): number { let offset = start; for (const char of text.slice(start)) { if (count-- <= 0) break; offset += char.length; } return offset; }
function retreat(text: string, end: number, count: number): number { const chars = [...text.slice(0, end)]; return chars.slice(0, Math.max(0, chars.length - count)).join("").length; }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function validateConfig(config: ChunkerConfig): void {
  if (!Number.isSafeInteger(config.targetChars) || !Number.isSafeInteger(config.maxChars) || !Number.isSafeInteger(config.overlapChars)
    || config.targetChars < 1 || config.maxChars < config.targetChars || config.overlapChars < 0 || config.overlapChars >= config.maxChars) {
    throw new TypeError("Chunker limits are invalid.");
  }
}
