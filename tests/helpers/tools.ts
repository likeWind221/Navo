import { Context } from "cordis";

import { createToolCallId } from "../../src/brand/ids.js";
import type { ToolCallContentBlock } from "../../src/llm/types.js";
import { ToolService } from "../../src/tools/service.js";

export function toolCall(
  id: string,
  name: string,
  arguments_: unknown,
): ToolCallContentBlock {
  return {
    type: "tool-call",
    id: createToolCallId(id),
    name,
    arguments: typeof arguments_ === "string"
      ? arguments_
      : JSON.stringify(arguments_),
  };
}

export interface ToolTestKit {
  readonly createContext: () => Promise<Context>;
  readonly track: (ctx: Context) => void;
  readonly dispose: () => Promise<void>;
}

export function createToolTestKit(): ToolTestKit {
  const contexts = new Set<Context>();
  return {
    async createContext(): Promise<Context> {
      const ctx = new Context();
      contexts.add(ctx);
      await ctx.plugin(ToolService);
      return ctx;
    },
    track(ctx: Context): void {
      contexts.add(ctx);
    },
    async dispose(): Promise<void> {
      await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
      contexts.clear();
    },
  };
}
