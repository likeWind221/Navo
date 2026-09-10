import { FileError } from "../errors.js";
import { FILE_LIMITS, type FileLine, type ReadResult } from "../types.js";

export async function buildReadWindow(
  chunks: AsyncIterable<Uint8Array>,
  path: string,
  startLine: number,
  maxLines: number,
  signal: AbortSignal,
): Promise<ReadResult> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const lines: FileLine[] = [];
  const budget = FILE_LIMITS.maxOutputCharacters - JSON.stringify(path).length - 256;
  let used = 0;
  let totalLines = 0;
  let pending = "";
  let length = 0;
  let last = "";
  let stopped = false;

  function finishLine(newline: boolean): void {
    totalLines++;
    if (!stopped && totalLines >= startLine && lines.length < maxLines) {
      const textLength = length - (newline && last === "\r" ? 1 : 0);
      const cost = `${totalLines}: `.length + textLength + 1;
      if (used + cost > budget) {
        if (lines.length === 0) {
          throw new FileError("output-too-large", "The first requested line exceeds the output budget.");
        }
        stopped = true;
      } else {
        lines.push({ line: totalLines, text: pending.slice(0, textLength) });
        used += cost;
      }
    }
    pending = "";
    length = 0;
    last = "";
  }

  function consume(text: string): void {
    if (text.includes("\0")) throw new FileError("invalid-text", "Text contains NUL.");
    let offset = 0;
    while (offset < text.length) {
      const end = text.indexOf("\n", offset);
      const fragment = text.slice(offset, end === -1 ? text.length : end);
      length += fragment.length;
      if (fragment.length) last = fragment.at(-1)!;
      if (!stopped && totalLines + 1 >= startLine && lines.length < maxLines) {
        pending += fragment.slice(0, Math.max(0, budget + 1 - pending.length));
      }
      if (end === -1) break;
      finishLine(true);
      offset = end + 1;
    }
  }

  function decode(bytes?: Uint8Array): string {
    try {
      return decoder.decode(bytes, { stream: bytes !== undefined });
    } catch (error) {
      throw new FileError("invalid-text", "Invalid UTF-8 sequence.", { cause: error });
    }
  }

  for await (const chunk of chunks) {
    signal.throwIfAborted();
    consume(decode(chunk));
  }
  consume(decode());
  signal.throwIfAborted();
  if (length > 0) finishLine(false);
  if (startLine > Math.max(1, totalLines)) {
    throw new FileError("invalid-request", "startLine exceeds the file's line count.");
  }
  const endLine = lines.at(-1)?.line ?? 0;
  return { path, startLine, totalLines, lines, nextLine: endLine < totalLines ? endLine + 1 : null };
}

export function formatReadResult(result: ReadResult): string {
  const header = `File: ${JSON.stringify(result.path)}\nLines: ${result.totalLines}\n`;
  const body = result.lines.map(({ line, text }) => `${line}: ${text}\n`).join("");
  const footer = result.nextLine === null
    ? "[End of file]"
    : `[Continue with startLine=${result.nextLine}]`;
  return header + body + footer;
}
