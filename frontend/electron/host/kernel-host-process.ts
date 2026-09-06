import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { RpcError, StreamRpcClient } from "../../../rpc/index.js";
import type { RpcMethod, RpcStreamOptions } from "../../../rpc/index.js";
import { HostStderrMonitor } from "./host-stderr-monitor.js";
import { StdioRpcClientTransport } from "./stdio-client-transport.js";

const DEFAULT_START_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export interface KernelHostLaunchConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly readyMarker: string;
  readonly secrets?: readonly string[];
  readonly startTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
}

export type HostLogWriter = (line: string) => void;

export class KernelHostProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private client: StreamRpcClient | undefined;
  private startPromise: Promise<StreamRpcClient> | undefined;
  private closePromise: Promise<void> | undefined;
  private exitPromise: Promise<void> | undefined;

  constructor(
    private readonly config: KernelHostLaunchConfig,
    private readonly writeLog: HostLogWriter = (line) => console.error(line),
  ) {}

  start(): Promise<StreamRpcClient> {
    if (this.closePromise !== undefined) {
      return Promise.reject(new RpcError("connection-closed", "Kernel Host is stopping"));
    }
    this.startPromise ??= Promise.resolve().then(() => this.spawnAndWaitUntilReady());
    return this.startPromise;
  }

  async *stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncGenerator<TOutput> {
    const client = await this.start();
    yield* client.stream(method, input, options);
  }

  close(): Promise<void> {
    this.closePromise ??= this.stop();
    return this.closePromise;
  }

  private spawnAndWaitUntilReady(): Promise<StreamRpcClient> {
    const child = spawn(this.config.command, [...this.config.args], {
      cwd: this.config.cwd,
      env: this.config.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    const transport = new StdioRpcClientTransport(child.stdout, child.stdin);
    const client = new StreamRpcClient(transport);
    this.client = client;
    this.exitPromise = new Promise<void>((resolve) => {
      let exited = false;
      const finish = (): void => {
        if (exited) return;
        exited = true;
        resolve();
      };
      child.once("error", finish);
      child.once("exit", finish);
      child.once("close", finish);
    });

    return new Promise<StreamRpcClient>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(
        () => {
          fail(new Error("Kernel Host did not become ready before the startup timeout"));
          child.kill("SIGTERM");
        },
        this.config.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
      );
      const monitor = new HostStderrMonitor({
        readyMarker: this.config.readyMarker,
        ...(this.config.secrets === undefined ? {} : { secrets: this.config.secrets }),
        onReady: () => succeed(),
        onLog: this.writeLog,
      });
      child.stderr.on("data", (chunk: Buffer) => monitor.push(chunk));
      child.stderr.once("end", () => monitor.finish());
      child.once("error", fail);
      child.once("exit", (code, signal) => {
        fail(new Error(`Kernel Host exited before ready (code=${String(code)}, signal=${String(signal)})`));
      });

      function succeed(): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(client);
      }

      function fail(error: Error): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    const dispose = this.client?.dispose().catch(() => undefined) ?? Promise.resolve();
    const exited = this.exitPromise ?? Promise.resolve();
    const graceful = Promise.all([dispose, exited]).then(() => true);
    if (!await settleBefore(graceful, this.config.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)) {
      child.kill("SIGTERM");
      if (!await settleBefore(exited, 1_000)) child.kill("SIGKILL");
      await exited;
      await dispose;
    }
    this.child = undefined;
    this.client = undefined;
  }
}

async function settleBefore(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([operation.then(() => true), timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}
