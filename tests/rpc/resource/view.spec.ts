import { describe, expect, it } from "vitest";

import { RpcError } from "../../../rpc/errors.js";
import { resourceViewCopyMethod } from "../../../rpc/resource/view.js";

describe("resource.view-copy.create.v1", () => {
  it("parses the scoped request and trusted Main result", () => {
    const input = { projectId: "project-1", resourceId: "resource-1", expectedRevision: 2 } as const;
    const output = {
      projectId: "project-1", resourceId: "resource-1", name: "report.md", type: "text/markdown",
      revision: 2, assetGeneration: 1, copyPath: "C:\\Users\\user\\AppData\\Local\\Temp\\copy.md",
    } as const;
    expect(resourceViewCopyMethod.parseInput(input)).toEqual(input);
    expect(resourceViewCopyMethod.parseOutput(output)).toEqual(output);
  });

  it("rejects extra fields and invalid revisions", () => {
    expect(() => resourceViewCopyMethod.parseInput({
      projectId: "project-1", resourceId: "resource-1", expectedRevision: 1, actor: "user",
    })).toThrow(RpcError);
    expect(() => resourceViewCopyMethod.parseInput({
      projectId: "project-1", resourceId: "resource-1", expectedRevision: 0,
    })).toThrow(RpcError);
    expect(() => resourceViewCopyMethod.parseOutput({
      projectId: "project-1", resourceId: "resource-1", name: "report.md", type: "text/markdown",
      revision: 1, assetGeneration: 1, copyPath: "copy.md", secret: true,
    })).toThrow(RpcError);
  });
});
