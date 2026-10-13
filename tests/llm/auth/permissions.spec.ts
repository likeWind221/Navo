import { execFile } from "node:child_process";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { checkPermissions } from "../../../src/llm/auth/chatgpt/permissions.js";
import { ChatGPTStore } from "../../../src/llm/auth/chatgpt/store.js";
import { authFixture } from "./fixture.js";

const execute = promisify(execFile);

it("protects the actual credential file and rejects access granted to other users", async () => {
  const fixture = await authFixture();
  try {
    await fixture.make().login();
    const directory = join(fixture.home, "auth");
    await checkPermissions(directory, true);
    await checkPermissions(join(directory, "chatgpt.json"), false);
    if (process.platform === "win32") {
      await execute("icacls.exe", [directory, "/grant", "*S-1-1-0:(OI)(CI)R"], { windowsHide: true });
    } else { await chmod(directory, 0o755); }
    await expect(new ChatGPTStore(fixture.home).transaction(async state => state.hostId))
      .rejects.toMatchObject({ code: "unsafe-store" });
  } finally { await fixture.close(); }
}, 60_000);
