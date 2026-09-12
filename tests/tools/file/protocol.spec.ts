import { describe, expect, it } from "vitest";

import { FileError } from "../../../src/tools/builtins/file/errors.js";
import { FILE_TOOL_SCHEMAS } from "../../../src/tools/builtins/file/types.js";
import { parseToolArguments } from "../../../src/tools/schema.js";
import { toolCall } from "../../helpers/tools.js";

describe("file tool path protocol", () => {
  it("accepts relative and absolute file-environment paths", () => {
    const cases = [
      { name: "read", args: { path: "notes/a.txt" } },
      { name: "read", args: { path: "C:\\work\\notes\\a.txt" } },
      { name: "write", args: { path: "/work/notes/a.txt", content: "x" } },
      { name: "edit", args: { path: "notes/a.txt", oldText: "a", newText: "b" } },
    ] as const;

    for (const [index, input] of cases.entries()) {
      const parsed = parseToolArguments(
        toolCall(`path-${index}`, input.name, input.args),
        FILE_TOOL_SCHEMAS[input.name].parameters,
      );
      expect(parsed.kind).toBe("success");
    }
  });

  it("keeps create/overwrite selection out of model arguments", () => {
    const parsed = parseToolArguments(
      toolCall("write-mode", "write", {
        path: "notes/a.txt",
        content: "x",
        mode: "overwrite",
      }),
      FILE_TOOL_SCHEMAS.write.parameters,
    );

    expect(parsed.kind).toBe("failure");
  });

  it("keeps session identity and workspace roots out of model arguments", () => {
    const parsed = parseToolArguments(
      toolCall("hidden-context", "read", {
        path: "/work/notes/a.txt",
        sessionId: "session-a",
        workspaceRoot: "/work",
      }),
      FILE_TOOL_SCHEMAS.read.parameters,
    );

    expect(parsed.kind).toBe("failure");
  });

  it("describes paths by file-environment semantics", () => {
    const schemaText = JSON.stringify(FILE_TOOL_SCHEMAS);

    expect(schemaText).toContain("absolute paths are allowed");
    expect(schemaText).not.toContain("no absolute paths");
    expect(FILE_TOOL_SCHEMAS).not.toHaveProperty("find");
  });

  it("uses file-environment model messages for path failures", () => {
    expect(new FileError("invalid-path", "invalid").modelMessage)
      .toBe("Use a valid path in the current Session file environment.");
    expect(new FileError("path-not-allowed", "denied").modelMessage)
      .toBe("The requested path is not available in the current file environment.");
  });
});
