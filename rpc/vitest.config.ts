import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["rpc/tests/**/*.spec.ts", "rpc/content/tests/**/*.spec.ts", "rpc/stream/tests/**/*.spec.ts", "rpc/notification/tests/**/*.spec.ts"],
  },
});
