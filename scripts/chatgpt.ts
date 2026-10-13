import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ChatGPTAuth, ChatGPTAuthError } from "../src/llm/auth/chatgpt.js";

const execute = promisify(execFile);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("ChatGPT command cancelled.")));

async function openBrowser(url: string): Promise<void> {
  if (process.platform === "win32") {
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Start-Process '${url.replaceAll("'", "''")}'`], { windowsHide: true });
  } else {
    await execute(process.platform === "darwin" ? "open" : "xdg-open", [url]);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  let accountId: string | undefined;
  let newAccount = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--account" && args[index + 1] && accountId === undefined) accountId = args[++index];
    else if (arg === "--new" && !newAccount) newAccount = true;
    else throw new Error("Usage: pnpm chatgpt login [--new | --account ID] | accounts | models [--account ID] | logout [--account ID]");
  }
  if (newAccount && command !== "login") throw new Error("--new is only supported by login.");
  if (command === "accounts" && accountId) throw new Error("accounts lists all registrations.");
  const auth = new ChatGPTAuth({ openBrowser });
  const signal = controller.signal;
  if (command === "login") {
    console.log("Continue with ChatGPT in your browser. Press Ctrl+C to cancel.");
    const account = await auth.login({ newAccount, signal, ...(accountId === undefined ? {} : { accountId }) });
    console.log(JSON.stringify(account, null, 2));
  } else if (command === "accounts") {
    console.log(JSON.stringify(await auth.accounts(), null, 2));
  } else if (command === "models") {
    console.log(JSON.stringify(await auth.models(accountId, signal), null, 2));
  } else if (command === "logout") {
    const { revoked } = await auth.logout(accountId, signal);
    console.log(revoked ? "Signed out locally; remote session revocation confirmed."
      : "No local credential session remains; remote revocation was not attempted.");
  } else {
    throw new Error("Usage: pnpm chatgpt login [--new | --account ID] | accounts | models [--account ID] | logout [--account ID]");
  }
}

void main().catch(error => {
  if (controller.signal.aborted) console.error("ChatGPT command cancelled.");
  else if (error instanceof ChatGPTAuthError) console.error(`${error.code}: ${error.message}`);
  else console.error("ChatGPT command failed. Check command arguments, local permissions, and network connectivity.");
  process.exitCode = 1;
});
