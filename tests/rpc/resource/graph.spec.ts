import { expect, it } from "vitest";
import { resourceGraphStatusMethod } from "../../../rpc/resource/graph.js";

it("validates the bounded Graph status request and output contract", () => {
  expect(resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: ["r1", "r2"] }))
    .toEqual({ projectId: "p", resourceIds: ["r1", "r2"] });
  expect(() => resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: [" "] })).toThrow();
  expect(() => resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: [] })).toThrow();
  expect(() => resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: ["r1", "r1"] })).toThrow();
  expect(() => resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: ["r1"], extra: true })).toThrow();

  const valid = { projectId: "p", configured: false, resources: [
    { resourceId: "r1", status: "unavailable", assetGeneration: null, errorCode: null, readable: false },
  ] as const };
  expect(resourceGraphStatusMethod.parseOutput(valid)).toEqual(valid);
  expect(() => resourceGraphStatusMethod.parseOutput({ ...valid, resources: [{ ...valid.resources[0], status: "unknown" }] })).toThrow();
  expect(() => resourceGraphStatusMethod.parseOutput({ ...valid, resources: [{ ...valid.resources[0], readable: true }] })).toThrow();
  expect(() => resourceGraphStatusMethod.parseOutput({ ...valid, resources: [{ ...valid.resources[0], status: "failed", assetGeneration: 1, errorCode: null }] })).not.toThrow();
  expect(() => resourceGraphStatusMethod.parseOutput({ ...valid, resources: [{ ...valid.resources[0], status: "active", assetGeneration: 1, readable: false }] })).toThrow();
  expect(() => resourceGraphStatusMethod.parseOutput({ ...valid, extra: true })).toThrow();
  const validator = resourceGraphStatusMethod.createOutputValidator!(resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: ["r1"] }));
  expect(() => validator.end()).toThrow();
  validator.parse(valid);
  expect(() => validator.parse(valid)).toThrow();
  const scoped = resourceGraphStatusMethod.createOutputValidator!(resourceGraphStatusMethod.parseInput({ projectId: "p", resourceIds: ["r1"] }));
  expect(() => scoped.parse({ ...valid, resources: [{ ...valid.resources[0], resourceId: "r2" }] })).toThrow();
});
