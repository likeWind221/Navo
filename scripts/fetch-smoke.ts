import { FetchCore } from "../src/tools/builtins/fetch/core.js";
import { FetchError } from "../src/tools/builtins/fetch/errors.js";
import { createHttpFetch } from "../src/tools/builtins/fetch/http.js";

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    console.log("No request sent. Run: pnpm exec tsx scripts/fetch-smoke.ts --live");
    return;
  }
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  try {
    const core = new FetchCore(createHttpFetch());
    const result = await core.fetch(
      { url: "https://example.com/" },
      controller.signal,
    );
    console.log(
      `Fetch smoke passed (HTTP ${result.statusCode}, ${result.body.kind}, ${result.body.content.length} complete characters).`,
    );
  } finally {
    process.removeListener("SIGINT", stop);
    controller.abort();
  }
}

void main().catch((error: unknown) => {
  const code = error instanceof FetchError ? error.code : "unknown";
  console.error(`Fetch smoke failed (${code}); check network and proxy configuration. No response content was printed.`);
  process.exitCode = 1;
});
