import type { SessionId } from "../../../brand/ids.js";
import type { ReadResult } from "./types.js";

interface ReadCoverage {
  totalLines: number;
  readonly ranges: Array<{ start: number; endExclusive: number }>;
}

/** Session-local knowledge that a canonical file has been fully observed. */
export class FileObservationStore {
  readonly #fullBySession = new Map<SessionId, Set<string>>();
  readonly #coverageBySession = new Map<SessionId, Map<string, ReadCoverage>>();

  observeRead(sessionId: SessionId, result: ReadResult): void {
    if (this.hasObserved(sessionId, result.path)) return;

    let byPath = this.#coverageBySession.get(sessionId);
    if (!byPath) {
      byPath = new Map<string, ReadCoverage>();
      this.#coverageBySession.set(sessionId, byPath);
    }

    let coverage = byPath.get(result.path);
    if (!coverage || coverage.totalLines !== result.totalLines) {
      coverage = { totalLines: result.totalLines, ranges: [] };
      byPath.set(result.path, coverage);
    }

    if (result.totalLines === 0) {
      this.observeWhole(sessionId, result.path);
      return;
    }

    const endExclusive = result.nextLine ?? result.totalLines + 1;
    coverage.ranges.push({ start: result.startLine, endExclusive });
    mergeRanges(coverage.ranges);
    if (coverage.ranges.length === 1
      && coverage.ranges[0]?.start === 1
      && coverage.ranges[0].endExclusive >= result.totalLines + 1) {
      this.observeWhole(sessionId, result.path);
    }
  }

  observeWhole(sessionId: SessionId, targetPath: string): void {
    let observed = this.#fullBySession.get(sessionId);
    if (!observed) {
      observed = new Set<string>();
      this.#fullBySession.set(sessionId, observed);
    }
    observed.add(targetPath);
    this.#coverageBySession.get(sessionId)?.delete(targetPath);
  }

  hasObserved(sessionId: SessionId, targetPath: string): boolean {
    return this.#fullBySession.get(sessionId)?.has(targetPath) ?? false;
  }

  clearSession(sessionId: SessionId): void {
    this.#fullBySession.delete(sessionId);
    this.#coverageBySession.delete(sessionId);
  }
}

function mergeRanges(ranges: Array<{ start: number; endExclusive: number }>): void {
  ranges.sort((left, right) => left.start - right.start);
  let write = 0;
  for (const range of ranges) {
    const previous = ranges[write - 1];
    if (previous && range.start <= previous.endExclusive) {
      previous.endExclusive = Math.max(previous.endExclusive, range.endExclusive);
      continue;
    }
    ranges[write] = range;
    write += 1;
  }
  ranges.length = write;
}
