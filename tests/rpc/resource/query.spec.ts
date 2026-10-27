import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { registerResourceMethods } from "../../../src/host/resource.js";
import { StreamRpcClient, StreamRpcServer } from "../../../rpc/index.js";
import { resourceQueryMethod } from "../../../rpc/resource/query.js";
import { parseResourceQueryInput } from "../../../rpc/resource/query/validation.js";
import { StreamRpcRouter } from "../../../rpc/stream/router.js";
import { createTransportPair } from "../../../rpc/tests/helpers/transport.js";
import { fixture } from "../../resource/assets/helpers.js";

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

it("registers the versioned User query without changing the library browse contract", async () => {
  const { ctx, project, root } = await fixture();
  await writeFile(join(root, "nested.md"), "nested", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "nested.md",
    name: "Nested", description: "Searchable", type: "text/markdown" });
  await ctx.content.idle();
  const router = new StreamRpcRouter();
  const dispose = registerResourceMethods(router, ctx);
  try {
    const method = router.resolve("resource.user-query.v1");
    expect(method).toBeDefined();
    const values = await collect(method!.handler({ projectId: project.id, query: "searchable" }, new AbortController().signal));
    expect(values).toHaveLength(1);
    expect(resourceQueryMethod.parseOutput(values[0])).toMatchObject({
      projectId: project.id,
      query: "searchable",
      resources: [expect.objectContaining({ name: "Nested", index: { status: "waiting-config", errorCode: null } })],
    });
    expect(router.resolve("resource.library.browse.v1")).toBeDefined();
  } finally {
    dispose();
  }
});

it("rejects malformed query input and output frames", () => {
  expect(() => parseResourceQueryInput({ projectId: "p", limit: 0 })).toThrow();
  expect(() => parseResourceQueryInput({ projectId: "p", limit: 101 })).toThrow();
  expect(() => parseResourceQueryInput({ projectId: "p", offset: -1 })).toThrow();
  expect(() => parseResourceQueryInput({ projectId: "p", unknown: true })).toThrow();
  expect(() => parseResourceQueryInput({ projectId: "p", query: "İ".repeat(256) })).toThrow();

  const input = parseResourceQueryInput({ projectId: "p" });
  const valid = { projectId: "p", query: "", folder: null, resources: [], nextOffset: null, changeToken: "{}" };
  const validator = resourceQueryMethod.createOutputValidator!(input);
  expect(() => validator.end()).toThrow();
  expect(validator.parse(valid)).toEqual(valid);
  expect(() => validator.parse(valid)).toThrow();
  expect(() => resourceQueryMethod.parseOutput({ ...valid, resources: [{}] })).toThrow();
});

it("uses the existing transport cancellation semantics before opening a query", async () => {
  const pair = createTransportPair();
  const server = new StreamRpcServer(pair.server, new StreamRpcRouter());
  const serving = server.serve();
  const client = new StreamRpcClient(pair.client, () => "cancel-query");
  const controller = new AbortController();
  controller.abort();
  const consume = async (): Promise<void> => {
    for await (const value of client.stream(resourceQueryMethod, { projectId: "p" }, { signal: controller.signal })) void value;
  };
  await expect(consume()).rejects.toMatchObject({ code: "cancelled" });
  await client.dispose();
  pair.close();
  await serving;
});
