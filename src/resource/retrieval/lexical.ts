import { DatabaseSync } from "node:sqlite";
import type { ActiveChunkRecord } from "../../storage/indexing.js";
import type { RankedChunk } from "./types.js";
import { ResourceIndexError } from "../index/errors.js";

export function keywordSearch(chunks: Iterable<ActiveChunkRecord>, query: string, limit: number, signal?: AbortSignal): readonly RankedChunk[] {
  const terms = [...new Set(tokenize(query, false))];
  if (terms.length > 128) throw new ResourceIndexError("invalid-query", "Keyword retrieval supports at most 128 distinct terms.");
  if (terms.length === 0) return [];
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE corpus USING fts5(chunk_id UNINDEXED, tokens, tokenize = 'unicode61')");
    const insert = db.prepare("INSERT INTO corpus (chunk_id, tokens) VALUES (?, ?)");
    db.exec("BEGIN");
    for (const chunk of chunks) {
      signal?.throwIfAborted();
      insert.run(chunk.chunk_id, tokenize(chunk.embedding_text, true).join(" "));
    }
    db.exec("COMMIT");
    const expression = terms.map(term => `"${term}"`).join(" OR ");
    return db.prepare("SELECT chunk_id FROM corpus WHERE corpus MATCH ? ORDER BY bm25(corpus), chunk_id LIMIT ?")
      .all(expression, limit).map(row => ({ chunkId: row.chunk_id as string, route: "keyword", paths: [] }));
  } finally {
    db.close();
  }
}

function tokenize(value: string, document: boolean): string[] {
  const tokens: string[] = [];
  for (const word of value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    for (const part of word.split(/(\p{Script=Han}+)/u).filter(Boolean)) {
      if (!/^\p{Script=Han}+$/u.test(part)) tokens.push(part);
      else {
        const characters = [...part];
        if (document || characters.length === 1) tokens.push(...characters);
        for (let index = 0; index + 1 < characters.length; index++) tokens.push(characters[index]! + characters[index + 1]!);
      }
    }
  }
  return tokens;
}
