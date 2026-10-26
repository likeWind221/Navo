import { expect, it } from "vitest";
import { registerResourceMethods } from "../../../src/host/resource.js";
import { toResourceFailure } from "../../../src/host/resource/failure.js";
import { ResourceError } from "../../../src/resource/errors.js";
import { resourceSearchMethod } from "../../../rpc/resource/search.js";
import { StreamRpcRouter } from "../../../rpc/stream/router.js";
import { fixture } from "../../resource/assets/helpers.js";

it("registers and serves the User semantic search contract", async () => {
  const { ctx, project } = await fixture();
  const router = new StreamRpcRouter();
  const dispose = registerResourceMethods(router, ctx);
  try {
    expect(router.resolve(resourceSearchMethod.name)).toBeDefined();
    const values: unknown[] = [];
    for await (const value of router.resolve(resourceSearchMethod.name)!.handler(
      { projectId: project.id, query: "q" }, new AbortController().signal)) values.push(value);
    expect(resourceSearchMethod.parseOutput(values[0])).toMatchObject({ status: "no-results", projectId: project.id });
  } finally {
    dispose();
  }
});

it("preserves search lifecycle failure codes across the Host boundary", () => {
  expect(toResourceFailure(new ResourceError("search-expired", "expired")).failure?.code).toBe("search-expired");
  expect(toResourceFailure(new ResourceError("search-changed", "changed")).failure?.code).toBe("search-changed");
});
