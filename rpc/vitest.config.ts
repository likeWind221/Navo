import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["rpc/tests/**/*.spec.ts"],
  },
});
