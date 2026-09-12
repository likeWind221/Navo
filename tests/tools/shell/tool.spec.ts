import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionId, ToolCallId } from "../../../src/brand/ids.js";
import type { JsonObject } from "../../../src/llm/types.js";
import { createShellTool } from "../../../src/tools/builtins/shell/tool.js";
import { createToolTestKit } from "../../helpers/tools.js";

const kit = createToolTestKit();
afterEach(() => kit.dispose());

const tool = createShellTool({ resolveFileEnvironment: () => ({ cwd: tmpdir() }) });
const signal = new AbortController().signal;

function run(args: JsonObject, activeSignal: AbortSignal = signal) {
  return tool.execute(args, {
    callId: "shell-call" as ToolCallId,
    sessionId: "session" as SessionId,
    signal: activeSignal,
  });
}

describe("shell tool contract", () => {
  it("publishes a schema the tool service accepts", async () => {
    const ctx = await kit.createContext();
    ctx.tools.register(tool);

    const schema = ctx.tools.schemas()[0]!;
    expect(schema.name).toBe("shell");
    expect(schema.parameters).toMatchObject({
      required: ["command"],
      additionalProperties: false,
    });
    expect(schema.description).toContain("exit code");
    expect(schema.description).toContain("fresh process");
  });

  it("rejects malformed arguments and missing sessions", async () => {
    for (const args of [
      {},
      { command: "   " },
      { command: "node --version", extra: true },
      { command: "node --version", timeoutMs: 0 },
      { command: "node --version", timeoutMs: 1.5 },
      { command: "node --version", timeoutMs: 600_001 },
      { command: "node --version", timeoutMs: null },
    ]) {
      await expect(run(args)).rejects.toMatchObject({
        modelMessage: "Shell tool parameters are invalid. Provide a non-empty command and a timeout within the supported range.",
      });
    }

    await expect(tool.execute({ command: "node --version" }, {
      callId: "shell-call" as ToolCallId,
      signal,
    })).rejects.toMatchObject({ modelMessage: "Shell tools require an active Session." });
  });

  it("reports a clean exit with no output", async () => {
    await expect(run({ command: "node -e \"process.exit(0)\"" }))
      .resolves.toEqual({ content: "(no output)" });
  });

  it("reports non-zero exits as markers instead of failures", async () => {
    await expect(run({ command: "node -e \"process.exit(3)\"" }))
      .resolves.toEqual({ content: "(no output)\n[exit code: 3]" });
  });

  it("marks stderr apart from stdout", async () => {
    const stderr = await run({ command: "node -e \"process.stderr.write('boom')\"" });
    expect(stderr.content).toContain("[stderr]\nboom");
  });

  it("flags truncated streams", async () => {
    const huge = await run({ command: "node -e \"process.stdout.write('a'.repeat(100000))\"" });
    expect(huge.content).toContain("[output truncated");
  });

  it("reports cancellation through the tool boundary", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run({ command: "node --version" }, controller.signal))
      .rejects.toMatchObject({ modelMessage: "The command was cancelled." });
  });
});
