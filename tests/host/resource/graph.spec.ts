import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { registerResourceMethods } from "../../../src/host/resource.js";
import { resourceGraphStatusMethod } from "../../../rpc/resource/graph.js";
import { StreamRpcRouter } from "../../../rpc/stream/router.js";
import { fixture } from "../../resource/assets/helpers.js";
import { cleanup as cleanupGraph, fixture as graphFixture, publish as publishGraph } from "../../resource/graph/fixture.js";

afterEach(cleanupGraph);

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

it("reports only User-visible current Graph facts and preserves requested order", async () => {
  const { ctx, project, root } = await fixture();
  await writeFile(join(root, "graph.md"), "graph source", "utf8");
  const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "graph.md",
    name: "Graph", description: "Graph", type: "text/markdown" });
  await ctx.content.idle();
  const router = new StreamRpcRouter();
  const dispose = registerResourceMethods(router, ctx);
  try {
    const method = router.resolve("resource.graph-status.v1");
    expect(method).toBeDefined();
    const values = await collect(method!.handler({ projectId: project.id, resourceIds: ["missing", resource.id] }, new AbortController().signal));
    expect(resourceGraphStatusMethod.parseOutput(values[0])).toMatchObject({
      projectId: project.id, configured: false,
      resources: [
        { resourceId: "missing", status: "unavailable", assetGeneration: null, readable: false },
        { resourceId: resource.id, status: "absent", assetGeneration: resource.assetGeneration, readable: false },
      ],
    });
  } finally {
    dispose();
  }
});

it("exposes a current active Graph build without exposing graph entities", async () => {
  const { ctx, project, workspace } = await graphFixture();
  const resource = await publishGraph(ctx, project.id, workspace);
  const router = new StreamRpcRouter();
  const dispose = registerResourceMethods(router, ctx);
  try {
    const method = router.resolve("resource.graph-status.v1")!;
    const values = await collect(method.handler({ projectId: project.id, resourceIds: [resource.id] }, new AbortController().signal));
    expect(resourceGraphStatusMethod.parseOutput(values[0])).toMatchObject({
      configured: true,
      resources: [{ resourceId: resource.id, status: "active", assetGeneration: resource.assetGeneration, readable: true, errorCode: null }],
    });
    expect(values[0]).not.toHaveProperty("entities");
  } finally {
    dispose();
  }
});
