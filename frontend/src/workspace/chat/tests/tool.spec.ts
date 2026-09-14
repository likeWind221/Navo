import { describe, expect, it } from "vitest";
import type { AssistantToolBlock } from "../conversation.js";
import { toolPresentation } from "../process/tool.js";

describe("tool presentation", () => {
  it.each([
    ["web_search", "globe", true], ["web_fetch", "globe", true], ["shell", "terminal", true],
    ["read", "book", false], ["edit", "pen", false], ["write", "pen", false], ["custom", "tool", true],
  ] as const)("maps %s to its icon and result policy", (name, icon, expandable) => {
    const view = toolPresentation(tool(name));
    expect(view.icon).toBe(icon);
    expect(view.result !== null).toBe(expandable);
  });

  it("shows only the shell command from validated complete JSON", () => {
    const view = toolPresentation({ ...tool("Shell"), arguments: '{"command":"echo hello","timeoutMs":3000}' });
    expect(view.label).toBe("执行Shell : echo hello");
    expect(view.result?.command).toBe("echo hello");
    expect(view.label).not.toContain("timeoutMs");
    for (const argumentsText of ['{"command":"echo', '{"command":12}', '{}', 'null']) {
      expect(toolPresentation({ ...tool("shell"), arguments: argumentsText }).label).toBe("执行Shell");
    }
  });

  it("prefers the full result and preserves nonzero exit information without inventing zero", () => {
    const view = toolPresentation({ ...tool("shell"), summary: "short", detail: "output\n[exit code: 1]" });
    expect(view.result).toEqual({ title: "Shell", command: null, text: "output", exitCode: "1" });
    expect(toolPresentation(tool("shell")).result?.exitCode).toBeNull();
    expect(toolPresentation({ ...tool("shell"), detail: "", summary: "summary only" }).result?.text).toBe("summary only");
    expect(toolPresentation({ ...tool("web_fetch"), detail: "[exit code: 1]" }).result?.text).toBe("[exit code: 1]");
  });

  it("does not offer expansion before a result exists", () => {
    expect(toolPresentation({ ...tool("shell"), status: "running", detail: "", summary: "" }).result).toBeNull();
  });
});

function tool(toolName: string): AssistantToolBlock {
  return { id: toolName, kind: "tool-call", toolName, toolCallId: toolName, arguments: "{}",
    startedAt: 0, endedAt: 1_000, status: "succeeded", summary: "summary", detail: "output", failure: null };
}
