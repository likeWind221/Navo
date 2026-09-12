import type { SessionId } from "../../../brand/ids.js";
import type { ReadResult } from "./types.js";
import type { FileVersion } from "./version.js";

interface ReadCoverage {
  readonly version: FileVersion;
  totalLines: number;
  readonly ranges: Array<{ start: number; endExclusive: number }>;
}

/** Session-local knowledge of the exact file version fully shown to the model. */
export class FileObservationStore {
  readonly #fullBySession = new Map<SessionId, Map<string, FileVersion>>();
  readonly #coverageBySession = new Map<SessionId, Map<string, ReadCoverage>>();

  observeRead(sessionId: SessionId, result: ReadResult, version: FileVersion): void {
    const full = this.#fullBySession.get(sessionId);
    if (full?.get(result.path) === version) return;
    full?.delete(result.path);

    let byPath = this.#coverageBySession.get(sessionId);
    if (!byPath) {
      byPath = new Map<string, ReadCoverage>();
      this.#coverageBySession.set(sessionId, byPath);
    }

    let coverage = byPath.get(result.path);
    if (!coverage || coverage.version !== version || coverage.totalLines !== result.totalLines) {
      coverage = { version, totalLines: result.totalLines, ranges: [] };
      byPath.set(result.path, coverage);
    }

    if (result.totalLines === 0) {
      this.observeWhole(sessionId, result.path, version);
      return;
    }

    const endExclusive = result.nextLine ?? result.totalLines + 1;
    coverage.ranges.push({ start: result.startLine, endExclusive });
    mergeRanges(coverage.ranges);
    if (coverage.ranges.length === 1
      && coverage.ranges[0]?.start === 1
      && coverage.ranges[0].endExclusive >= result.totalLines + 1) {
      this.observeWhole(sessionId, result.path, version);
    }
  }

  observeWhole(sessionId: SessionId, targetPath: string, version?: FileVersion): void {
    if (version === undefined) {
      this.forget(sessionId, targetPath);
      return;
    }
    let observed = this.#fullBySession.get(sessionId);
    if (!observed) {
      observed = new Map<string, FileVersion>();
      this.#fullBySession.set(sessionId, observed);
    }
    observed.set(targetPath, version);
    this.#coverageBySession.get(sessionId)?.delete(targetPath);
  }

  getObservedVersion(sessionId: SessionId, targetPath: string): FileVersion | undefined {
    return this.#fullBySession.get(sessionId)?.get(targetPath);
  }

  hasObserved(sessionId: SessionId, targetPath: string): boolean {
    return this.getObservedVersion(sessionId, targetPath) !== undefined;
  }

  forget(sessionId: SessionId, targetPath: string): void {
    this.#fullBySession.get(sessionId)?.delete(targetPath);
    this.#coverageBySession.get(sessionId)?.delete(targetPath);
  }

  clearSession(sessionId: SessionId): void {
    this.#fullBySession.delete(sessionId);
    this.#coverageBySession.delete(sessionId);
  }

  clearAll(): void {
    this.#fullBySession.clear();
    this.#coverageBySession.clear();
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
