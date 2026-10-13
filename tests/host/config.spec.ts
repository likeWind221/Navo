import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveKernelHostConfig } from "../../src/host/config.js";

describe("Kernel Host storage config", () => {
  it("stores Navo state under the user home by default", () => {
    expect(resolveKernelHostConfig({}).storage).toEqual({ path: join(homedir(), ".navo", "navo.db") });
  });

  it("accepts a trimmed NAVO_HOME override and rejects a blank one", () => {
    expect(resolveKernelHostConfig({ NAVO_HOME: "  relative-home  " }).storage)
      .toEqual({ path: join(resolve("relative-home"), "navo.db") });
    expect(() => resolveKernelHostConfig({ NAVO_HOME: "  " }))
      .toThrow("NAVO_HOME must be a non-empty path when provided.");
  });
});

describe("Kernel Host subscription configuration", () => {
  it("selects the requested model without Qwen defaults and shares the credential home", () => {
    const config = resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: " gpt-6-luna ",
      NAVO_HOME: " ./subscription-home ", LLM_ACCOUNT_ID: " saved-account " });
    expect(config).toMatchObject({ provider: "openai",
      adapter: { home: resolve("subscription-home"), accountId: "saved-account" },
      agent: { model: { provider: "openai", model: "gpt-6-luna" } } });
    expect(config.agent.model).not.toHaveProperty("maxTokens");
    expect(config.adapter).not.toHaveProperty("baseUrl");
  });

  it("requires an explicit OpenAI model and rejects unsupported configuration", () => {
    expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "unknown" })).toThrow("LLM_PROVIDER");
    expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "openai" })).toThrow("LLM_MODEL");
    for (const name of ["LLM_MAX_TOKENS", "LLM_TEMPERATURE", "LLM_ENABLE_THINKING", "LLM_API_KEY", "LLM_BASE_URL"]) {
      expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-luna", [name]: "value" }))
        .toThrow(name);
    }
    expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-luna", LLM_ACCOUNT_ID: " " }))
      .toThrow("LLM_ACCOUNT_ID");
  });
});
