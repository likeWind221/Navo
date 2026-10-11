import { describe, it } from "vitest";

import { resolveShellProfile } from "../../../src/tools/builtins/shell/profile.js";
import { runShellCommand } from "../../../src/tools/builtins/shell/execution.js";

const profile = resolveShellProfile({});
const node = (script: string) => profile.kind === "powershell" ? `node -e "${script}"` : `node -e '${script}'`;
const env = { cwd: process.cwd() } as Parameters<typeof runShellCommand>[0];

async function cancelOnce(delay: number, load: number): Promise<string> {
  const loads = Array.from({ length: load }, () => runShellCommand(env,
    { command: node("let s=Date.now();while(Date.now()-s<400){}"), timeoutMs: 30_000 },
    new AbortController().signal, profile));
  const controller = new AbortController();
  const start = Date.now();
  setTimeout(() => controller.abort(), delay);
  const result = await Promise.race([
    runShellCommand(env, { command: node("setTimeout(() => {}, 60000)"), timeoutMs: 30_000 }, controller.signal, profile)
      .then(r => `done aborted=${r.aborted} exit=${r.exitCode}`),
    new Promise<string>(resolve => setTimeout(() => resolve("HANG>12s"), 12_000)),
  ]);
  await Promise.allSettled(loads);
  return `${result} ${Date.now() - start}ms`;
}

describe("shell cancellation diagnostics", () => {
  it("sweeps cancellation timing under load", { timeout: 600_000 }, async () => {
    for (const load of [0, 2, 4]) {
      for (const delay of [50, 100, 150, 200, 250, 300, 400]) {
        process.stderr.write(`[shell-diag-case] load=${load} delay=${delay} -> ${await cancelOnce(delay, load)}\n`);
      }
    }
  });
});
