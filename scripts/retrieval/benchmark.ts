import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture, publish, cleanup } from "../../tests/resource/graph/fixture.js";
import type { ResourceRetrieval } from "../../src/resource/retrieval.js";

type Results = readonly { chunks: readonly { rank: number; chunkId: string }[] }[];

const baselinePath = process.argv[2];
if (!baselinePath) throw new Error("Provide the baseline retrieval module path.");
const { ResourceRetrieval: Baseline } = await import(pathToFileURL(resolve(baselinePath)).href) as {
  ResourceRetrieval: typeof ResourceRetrieval;
};
const { ctx, project, workspace } = await fixture(undefined, { persistent: true });
try {
  for (let index = 0; index < 12; index++) {
    const body = Array.from({ length: 12 }, (_, section) =>
      `Section ${section} ${"evidence context ".repeat(35)}`).join("\n\n");
    await publish(ctx, project.id, workspace, `doc${index}.md`, body);
  }
  const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "evidence",
    mode: "vector" as const, vectorTopK: 100, topK: 10 };
  const before = () => Baseline.prototype.search.call(ctx.retrieval, request);
  const after = () => ctx.retrieval.search(request);
  if (JSON.stringify(ids(await before())) !== JSON.stringify(ids(await after()))) throw new Error("Result mismatch.");

  const atomic = ctx.storage.atomic.bind(ctx.storage);
  let transactions = 0;
  ctx.storage.atomic = work => { transactions++; return atomic(work); };
  await before();
  const oldTransactions = transactions;
  transactions = 0;
  await after();
  const newTransactions = transactions;
  ctx.storage.atomic = atomic;

  for (let index = 0; index < 20; index++) { await before(); await after(); }
  const oldTimes: number[] = [];
  const newTimes: number[] = [];
  for (let index = 0; index < 200; index++) {
    if (index % 2) { await measure(after, newTimes); await measure(before, oldTimes); }
    else { await measure(before, oldTimes); await measure(after, newTimes); }
  }
  console.log(JSON.stringify({ resources: 12, vectorCandidates: 100, topK: 10, warmupPairs: 20,
    measuredPairs: 200, oldTransactions, newTransactions, before: stats(oldTimes), after: stats(newTimes) }, null, 2));
} finally { await cleanup(); }

function ids(groups: Results): readonly string[] {
  return groups.flatMap(group => group.chunks).sort((a, b) => a.rank - b.rank).map(chunk => chunk.chunkId);
}

async function measure(run: () => Promise<unknown>, times: number[]): Promise<void> {
  const start = performance.now();
  await run();
  times.push(performance.now() - start);
}

function stats(times: number[]): { medianMs: number | undefined; p95Ms: number | undefined } {
  times.sort((a, b) => a - b);
  return { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * 0.95) - 1] };
}
