import { expect, it } from "vitest";

import { RpcError } from "../../../rpc/errors.js";
import { resourceContentRetryMethod } from "../../../rpc/resource/content.js";

it("validates the content retry request and accepted result", () => {
  const input = { projectId: "project-1", resourceId: "resource-1", expectedRevision: 3 } as const;
  const result = {
    projectId: "project-1", resourceId: "resource-1", revision: 3, assetGeneration: 2,
    status: "accepted", contentStatus: "pending",
  } as const;
  expect(resourceContentRetryMethod.parseInput(input)).toEqual(input);
  expect(resourceContentRetryMethod.parseOutput(result)).toEqual(result);
});

it("rejects malformed input and non-accepted output states", () => {
  expect(() => resourceContentRetryMethod.parseInput({
    projectId: "project-1", resourceId: "resource-1", expectedRevision: 3, expectedAssetGeneration: 2,
  })).toThrow(RpcError);
  expect(() => resourceContentRetryMethod.parseInput({
    projectId: "project-1", resourceId: "resource-1", expectedRevision: 0,
  })).toThrow(RpcError);
  expect(() => resourceContentRetryMethod.parseOutput({
    projectId: "project-1", resourceId: "resource-1", revision: 3, assetGeneration: 2,
    status: "ready", contentStatus: "ready",
  })).toThrow(RpcError);
});
