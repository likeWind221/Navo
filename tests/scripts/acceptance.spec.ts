import { describe, expect, it } from "vitest";

import {
  createAcceptanceEnvironment,
  REAL_ACCEPTANCE_MODEL,
  resolveAcceptanceHostConfig,
} from "../../scripts/acceptance.js";

describe("real acceptance model selection", () => {
  it("pins the ChatGPT subscription provider and removes incompatible Qwen settings", () => {
    const environment = createAcceptanceEnvironment({
      LLM_PROVIDER: "qwen",
      LLM_MODEL: "qwen3.8-27b",
      LLM_BASE_URL: "http://localhost/v1",
      LLM_API_KEY: "secret",
      LLM_MAX_TOKENS: "4096",
      LLM_TEMPERATURE: "0.5",
      LLM_ENABLE_THINKING: "true",
      LLM_ACCOUNT_ID: "account",
      NAVO_HOME: "./acceptance-home",
    });

    expect(environment).toMatchObject({
      LLM_PROVIDER: "openai",
      LLM_MODEL: REAL_ACCEPTANCE_MODEL,
      LLM_ACCOUNT_ID: "account",
      NAVO_HOME: "./acceptance-home",
    });
    expect(environment).not.toHaveProperty("LLM_BASE_URL");
    expect(environment).not.toHaveProperty("LLM_API_KEY");
    expect(environment).not.toHaveProperty("LLM_MAX_TOKENS");
    expect(environment).not.toHaveProperty("LLM_TEMPERATURE");
    expect(environment).not.toHaveProperty("LLM_ENABLE_THINKING");
  });

  it("resolves an OpenAI Host config without changing account or home selection", () => {
    expect(resolveAcceptanceHostConfig({
      LLM_ACCOUNT_ID: "account",
      NAVO_HOME: "./acceptance-home",
    })).toMatchObject({
      provider: "openai",
      adapter: { accountId: "account" },
      agent: { model: { provider: "openai", model: REAL_ACCEPTANCE_MODEL } },
    });
  });

  it("lets a script select another subscription model", () => {
    expect(createAcceptanceEnvironment({}, "gpt-6-sol")).toMatchObject({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-sol" });
    expect(resolveAcceptanceHostConfig({}, "gpt-6-sol")).toMatchObject({
      agent: { model: { provider: "openai", model: "gpt-6-sol" } },
    });
  });
});
