import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/**/*.spec.ts", "electron/**/*.spec.ts", "src/**/*.spec.{ts,tsx}"],
    testTimeout: 10_000,
  },
});
