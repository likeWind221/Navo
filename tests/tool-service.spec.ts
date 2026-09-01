import { afterEach, describe, expect, it } from "vitest";

import type { JsonObject } from "../src/llm/types.js";
import { TEST_TOOL_NAMES, TestTools } from "../src/tools/test-tools.js";
import {
  createToolTestKit,
  toolCall,
} from "./helpers/tools.js";

const kit = createToolTestKit();
afterEach(() => kit.dispose());
const signal = new AbortController().signal;

describe("ToolService registration and schemas", () => {
  it("loads test tools only through the explicit plugin and unloads them", async () => {
    const ctx = await kit.createContext();
    expect(ctx.tools.schemas()).toEqual([]);

    const owner = await ctx.plugin(TestTools);
    expect(ctx.tools.schemas().map((schema) => schema.name)).toEqual([
      TEST_TOOL_NAMES.echo,
      TEST_TOOL_NAMES.fail,
      TEST_TOOL_NAMES.delay,
    ]);

    await owner.dispose();
    expect(ctx.tools.schemas()).toEqual([]);
  });

  it("exposes a frozen schema snapshot without execute", async () => {
    const ctx = await kit.createContext();
    const parameters = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    };
    ctx.tools.register({
      name: "snapshot",
      description: "snapshot test",
      parameters,
      execute: async () => "ok",
    });
    parameters.properties.text.type = "integer";

    const schemas = ctx.tools.schemas();
    const schema = schemas[0]!;
    expect(schema.parameters).toMatchObject({
      properties: { text: { type: "string" } },
    });
    expect(Object.isFrozen(schemas)).toBe(true);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.parameters)).toBe(true);
    expect("execute" in schema).toBe(false);
  });

  it("rejects invalid definitions and duplicate names", async () => {
    const ctx = await kit.createContext();
    const definition = {
      name: "echo",
      parameters: { type: "object", properties: {} },
      execute: async () => "ok",
    } as const;
    ctx.tools.register(definition);

    expect(() => ctx.tools.register(definition)).toThrow(
      expect.objectContaining({ code: "tool-already-registered" }),
    );
    expect(() => ctx.tools.register({
      ...definition,
      name: "unsupported",
      parameters: {
        type: "object",
        properties: { text: { type: "string", minLength: 1 } },
      } as unknown as JsonObject,
    })).toThrow(expect.objectContaining({ code: "invalid-tool-definition" }));
  });

  it("disposes idempotently without deleting a later registration", async () => {
    const ctx = await kit.createContext();
    const first = ctx.tools.register({
      name: "replaceable",
      parameters: { type: "object", properties: {} },
      execute: async () => "first",
    });
    first();
    ctx.tools.register({
      name: "replaceable",
      parameters: { type: "object", properties: {} },
      execute: async () => "second",
    });
    first();

    const result = await ctx.tools.execute(
      toolCall("replacement", "replaceable", {}),
      signal,
    );
    expect(result.block.content).toEqual([{ type: "text", text: "second" }]);
  });
});

describe("ToolService execution results", () => {
  it("executes echo and preserves the authoritative call id", async () => {
    const ctx = await kit.createContext();
    await ctx.plugin(TestTools);
    const call = toolCall("echo-call", TEST_TOOL_NAMES.echo, { text: "hello" });

    const result = await ctx.tools.execute(call, signal);

    expect(result).toEqual({
      kind: "success",
      block: {
        type: "tool-result",
        toolCallId: call.id,
        content: [{ type: "text", text: "hello" }],
        isError: false,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.block)).toBe(true);
  });

  it.each([
    {
      label: "unknown tool",
      call: toolCall("unknown", "missing", {}),
      code: "unknown-tool",
    },
    {
      label: "malformed JSON",
      call: toolCall("json", TEST_TOOL_NAMES.echo, "{"),
      code: "invalid-arguments",
    },
    {
      label: "missing required argument",
      call: toolCall("required", TEST_TOOL_NAMES.echo, {}),
      code: "invalid-arguments",
    },
    {
      label: "wrong argument type",
      call: toolCall("type", TEST_TOOL_NAMES.echo, { text: 7 }),
      code: "invalid-arguments",
    },
    {
      label: "additional argument",
      call: toolCall("extra", TEST_TOOL_NAMES.echo, { text: "x", extra: true }),
      code: "invalid-arguments",
    },
  ] as const)("normalizes $label", async ({ call, code }) => {
    const ctx = await kit.createContext();
    await ctx.plugin(TestTools);

    const result = await ctx.tools.execute(call, signal);

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") throw new Error("expected failure");
    expect(result.failure.code).toBe(code);
    expect(result.block.toolCallId).toBe(call.id);
    expect(result.block.isError).toBe(true);
    expect(result.block.content[0]).toMatchObject({ type: "text" });
  });

  it("normalizes business exceptions and invalid outputs", async () => {
    const ctx = await kit.createContext();
    await ctx.plugin(TestTools);
    ctx.tools.register({
      name: "bad_output",
      parameters: { type: "object", properties: {} },
      execute: async () => [{ type: "text", text: 7 }] as never,
    });

    const failed = await ctx.tools.execute(
      toolCall("failed", TEST_TOOL_NAMES.fail, {}),
      signal,
    );
    const invalidOutput = await ctx.tools.execute(
      toolCall("output", "bad_output", {}),
      signal,
    );

    expect(failed).toMatchObject({
      kind: "failure",
      failure: { code: "tool-failed", message: "Test tool failed." },
    });
    expect(invalidOutput).toMatchObject({
      kind: "failure",
      failure: {
        code: "tool-failed",
        message: "Tool output block at index 0 must be a text block.",
      },
    });
  });
});
