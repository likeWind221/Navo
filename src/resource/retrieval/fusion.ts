import type { RankedChunk, RelationPath, RetrievalRoute } from "./types.js";

export interface FusedChunk {
  readonly chunkId: string;
  score: number;
  readonly matches: RetrievalRoute[];
  readonly paths: RelationPath[];
}

export function fuseRanks(lists: readonly (readonly RankedChunk[])[]): readonly FusedChunk[] {
  const chunks = new Map<string, FusedChunk>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const item of list) {
      const chunk = chunks.get(item.chunkId) ?? { chunkId: item.chunkId, score: 0, matches: [], paths: [] };
      if (!seen.has(item.chunkId)) {
        seen.add(item.chunkId);
        chunk.score += 1 / (60 + seen.size);
      }
      if (!chunk.matches.includes(item.route)) chunk.matches.push(item.route);
      for (const path of item.paths) if (!chunk.paths.includes(path)) chunk.paths.push(path);
      chunks.set(item.chunkId, chunk);
    }
  }
  return [...chunks.values()].sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
}
