import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

import { agentTurnV2Method, encodeNdjson, NdjsonDecoder, parseRpcServerFrame, StreamRpcClient } from "../rpc/index.js";
import type { AgentTurnV2Event, RpcClientFrame, RpcClientTransport } from "../rpc/index.js";
import { ChatGPTAuth } from "../src/llm/auth/chatgpt.js";
import { ChatGPTStore } from "../src/llm/auth/chatgpt/store.js";
import { ChatGPTTokens } from "../src/llm/auth/chatgpt/token.js";
import {
  createAcceptanceEnvironment,
  REAL_ACCEPTANCE_MODEL,
  resolveAcceptanceHostConfig,
} from "./acceptance.js";

async function main(): Promise<void> {
  const config = resolveAcceptanceHostConfig({ ...process.env, LLM_PROVIDER: "openai" });
  assert(config.provider === "openai");
  const environment = createAcceptanceEnvironment({ ...process.env, LLM_PROVIDER: "openai" });
  const auth = new ChatGPTAuth({
    home: config.adapter.home,
    openBrowser: async () => { throw new Error("Run pnpm chatgpt login first."); },
  });
  assert((await auth.models(config.adapter.accountId)).some(model => model.slug === REAL_ACCEPTANCE_MODEL));
  const sessionId = `subscription-${randomUUID()}`;
  if (!process.argv.includes("--restart")) await withHost(environment, async client => {
    const text = await turn(client, sessionId, "Do not use tools. Return only this exact string without punctuation or additional text:\nNAVO-TEXT-OK");
    assert.equal(answer(text).trim(), "NAVO-TEXT-OK");
    const tool = await turn(client, sessionId,
      "Use only the read tool to read package.json in the current working directory. Then reply exactly: PACKAGE: followed by its name field. Do not use any other tool.");
    assert(tool.some(event => event.type === "content-started" && event.kind === "tool-call" && event.toolName === "read"));
    assert(!tool.some(event => event.type === "content-started" && event.kind === "tool-call" && event.toolName !== "read"));
    assert(tool.some(event => event.type === "tool-result" && event.status === "succeeded"));
    assert.match(answer(tool), /PACKAGE:\s*navo/);
    console.log("PASS: real Host text and read-tool continuation.");

    const controller = new AbortController();
    let published = false;
    const textBlocks = new Set<string>();
    try {
      for await (const event of client.stream(agentTurnV2Method, {
        sessionId: `cancel-${randomUUID()}`, requestId: randomUUID(),
        text: "Do not use tools. Write the integers from 1 to 10000, one integer per line.",
      }, { signal: controller.signal })) {
        if (event.type === "content-started" && event.kind === "text") {
          textBlocks.add(`${event.messageId}:${event.contentIndex}`);
        }
        if (event.type === "content-delta" && textBlocks.has(`${event.messageId}:${event.contentIndex}`)) {
          published = true; controller.abort();
        }
        if (event.type === "turn-failed") throw new Error(event.failure.code);
      }
      throw new Error("Expected RPC cancellation.");
    } catch (error) {
      assert(published);
      assert(error !== null && typeof error === "object" && "code" in error && error.code === "cancelled");
    }
    const next = await turn(client, `after-cancel-${randomUUID()}`, "Do not use tools. Return only this exact string without punctuation or additional text:\nNAVO-CANCEL-OK");
    assert.equal(answer(next).trim(), "NAVO-CANCEL-OK");
    console.log("PASS: live-stream cancellation and subsequent turn.");
  });

  await withHost(environment, async client => {
    const restarted = await turn(client, `restart-${randomUUID()}`, "Do not use tools. Return only this exact string without punctuation or additional text:\nNAVO-RESTART-OK");
    assert.equal(answer(restarted).trim(), "NAVO-RESTART-OK");
  });
  console.log("PASS: new Host process reuses saved credentials.");

  if (process.argv.includes("--refresh")) {
    await new ChatGPTStore(config.adapter.home).transaction(async state => {
      const account = state.accounts.find(entry => entry.id === (config.adapter.accountId ?? state.activeId));
      assert(account?.credentials);
      account.credentials = await new ChatGPTTokens(fetch).refresh(account, AbortSignal.timeout(30_000));
    });
    await withHost(environment, async client => {
      const refreshed = await turn(client, `refresh-${randomUUID()}`, "Do not use tools. Return only this exact string without punctuation or additional text:\nNAVO-REFRESH-OK");
      assert.equal(answer(refreshed).trim(), "NAVO-REFRESH-OK");
    });
    console.log("PASS: real token rotation and inference in a new Host process.");
  }
}

async function turn(client: StreamRpcClient, sessionId: string, text: string): Promise<AgentTurnV2Event[]> {
  const events: AgentTurnV2Event[] = [];
  for await (const event of client.stream(agentTurnV2Method, {
    sessionId, requestId: randomUUID(), text,
  }, { signal: AbortSignal.timeout(120_000) })) {
    events.push(event);
    if (event.type === "turn-failed") throw new Error(`Real turn failed: ${event.failure.code}: ${event.failure.message}`);
  }
  assert.equal(events.at(-1)?.type, "turn-completed");
  return events;
}

function answer(events: AgentTurnV2Event[]): string {
  const textBlocks = new Map<string, string>();
  let lastMessage = "";
  for (const event of events) {
    if (event.type === "content-started" && event.kind === "text") {
      lastMessage = event.messageId;
      textBlocks.set(`${event.messageId}:${event.contentIndex}`, "");
    }
    if (event.type === "content-delta") {
      const key = `${event.messageId}:${event.contentIndex}`;
      if (textBlocks.has(key)) textBlocks.set(key, textBlocks.get(key)! + event.delta);
    }
  }
  return [...textBlocks].filter(([key]) => key.startsWith(`${lastMessage}:`)).map(([, text]) => text).join("");
}

async function withHost(
  environment: NodeJS.ProcessEnv,
  use: (client: StreamRpcClient) => Promise<void>,
): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/host/main.ts"], {
    cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  child.stderr.on("data", () => undefined);
  const client = new StreamRpcClient(new HostTransport(child));
  try {
    await use(client);
  } finally {
    await client.dispose();
    const [code] = await exited;
    assert.equal(code, 0);
  }
}

class HostTransport implements RpcClientTransport {
  readonly incoming: AsyncIterable<unknown>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.incoming = readFrames(child);
  }

  send(frame: RpcClientFrame): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(encodeNdjson(frame), error => error ? reject(error) : resolve());
    });
  }

  close(): Promise<void> {
    return new Promise(resolve => this.child.stdin.end(resolve));
  }
}

async function* readFrames(child: ChildProcessWithoutNullStreams): AsyncGenerator<unknown> {
  const decoder = new NdjsonDecoder(parseRpcServerFrame);
  for await (const chunk of child.stdout) {
    for (const frame of decoder.push(chunk as Uint8Array)) yield frame;
  }
  for (const frame of decoder.finish()) yield frame;
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Subscription acceptance failed.");
  process.exitCode = 1;
});
