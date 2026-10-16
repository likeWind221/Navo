import { describe, expect, it } from "vitest";

import {
  projectAutoRunGetMethod,
  projectAutoRunStartMethod,
} from "../../../../rpc/project.js";
import { RpcError } from "../../../../rpc/errors.js";
import { createProjectHandlers } from "./handler.js";

describe("desktop project AutoRun handlers", () => {
  it("forwards AutoRun start through the Kernel Host", async () => {
    const calls: string[] = [];
    const host = {
      async *stream(method: typeof projectAutoRunStartMethod, input: { projectId: string }) {
        calls.push(method.name);
        expect(input).toEqual({ projectId: "project-1" });
        yield {
          runId: "run-1",
          projectId: "project-1",
          status: "running",
          nodeTurns: 0,
          mainTurns: 0,
          currentTarget: { kind: "node", nodeId: "node-1" },
          reason: null,
        };
      },
    };
    const handlers = createProjectHandlers(host);
    await expect(handlers.autoRunStart({ projectId: "project-1" })).resolves.toMatchObject({
      type: "ok",
      value: { runId: "run-1", status: "running" },
    });
    expect(calls).toEqual([projectAutoRunStartMethod.name]);
  });

  it("returns null when no AutoRun exists", async () => {
    const host = {
      async *stream(method: typeof projectAutoRunGetMethod) {
        expect(method.name).toBe(projectAutoRunGetMethod.name);
        yield null;
      },
    };
    const handlers = createProjectHandlers(host);
    await expect(handlers.autoRunGet({ projectId: "project-1" })).resolves.toEqual({
      type: "ok",
      value: null,
    });
  });

  it("rejects malformed AutoRun input before contacting the Host", async () => {
    let called = false;
    const host = {
      async *stream() {
        called = true;
        yield null;
      },
    };
    const handlers = createProjectHandlers(host);
    await expect(handlers.autoRunStart({ projectId: "" })).resolves.toMatchObject({
      type: "failed",
      failure: { code: "invalid-input" },
    });
    expect(called).toBe(false);
  });

  it("maps AutoRun remote failures to stable desktop failures", async () => {
    const host = {
      async *stream() {
        throw new RpcError("remote-error", "AutoRun already active", {
          failure: { code: "auto-run-active", message: "AutoRun already active", details: {} },
        });
        yield null;
      },
    };
    const handlers = createProjectHandlers(host);
    await expect(handlers.autoRunStart({ projectId: "project-1" })).resolves.toEqual({
      type: "failed",
      failure: { code: "auto-run-active", message: "AutoRun already active" },
    });
  });
});
