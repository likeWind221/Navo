import {
  agentTurnMethod,
  isAgentTurnTerminal,
  parseAgentTurnInput,
  RpcError,
} from "../../../rpc/index.js";
import type {
  AgentTurnInput,
  RpcMethod,
  RpcStreamOptions,
} from "../../../rpc/index.js";
import type {
  DesktopAgentFailure,
  DesktopAgentTurnUpdate,
} from "../../src/agent/desktop-agent-contract.js";

export interface AgentTurnHost {
  stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncIterable<TOutput>;
}

export interface AgentTurnTarget {
  readonly ownerId: number;
  isDestroyed(): boolean;
  send(update: DesktopAgentTurnUpdate): void;
}

interface ActiveTurn {
  readonly requestId: string;
  readonly target: AgentTurnTarget;
  readonly controller: AbortController;
  timedOut: boolean;
  readonly timeout: NodeJS.Timeout;
}

export class AgentTurnController {
  private active: ActiveTurn | undefined;
  private disposed = false;

  constructor(
    private readonly host: AgentTurnHost,
    private readonly timeoutMs = 120_000,
  ) {}

  start(target: AgentTurnTarget, candidate: unknown): DesktopAgentFailure | null {
    if (this.disposed) return failure("bridge-closed", "Agent 桥接已关闭，请重启窗口");
    if (this.active !== undefined) return failure("turn-in-progress", "Agent 正在生成，请等待完成或点击停止");
    let input: AgentTurnInput;
    try {
      input = parseAgentTurnInput(candidate);
    } catch {
      return failure("invalid-input", "消息内容无效，请重新输入");
    }
    const controller = new AbortController();
    const turn: ActiveTurn = {
      requestId: input.requestId,
      target,
      controller,
      timedOut: false,
      timeout: setTimeout(() => {
        turn.timedOut = true;
        controller.abort("Agent turn timed out");
      }, this.timeoutMs),
    };
    this.active = turn;
    void this.run(turn, input);
    return null;
  }

  cancel(ownerId: number, requestId: string): void {
    const turn = this.active;
    if (turn === undefined || turn.target.ownerId !== ownerId || turn.requestId !== requestId) return;
    turn.controller.abort("Renderer cancelled the Agent turn");
  }

  cancelOwner(ownerId: number): void {
    const turn = this.active;
    if (turn?.target.ownerId === ownerId) turn.controller.abort("Renderer was destroyed");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.controller.abort("Agent bridge was disposed");
  }

  private async run(turn: ActiveTurn, input: AgentTurnInput): Promise<void> {
    let terminalPublished = false;
    try {
      for await (const event of this.host.stream(agentTurnMethod, input, { signal: turn.controller.signal })) {
        this.publish(turn, { type: "event", requestId: turn.requestId, event });
        if (isAgentTurnTerminal(event)) terminalPublished = true;
      }
    } catch (error: unknown) {
      if (terminalPublished) {
        return;
      } else if (turn.timedOut) {
        this.publish(turn, {
          type: "bridge-error",
          requestId: turn.requestId,
          failure: failure("turn-timeout", "Agent 响应超时，请重试"),
        });
      } else if (error instanceof RpcError && error.code === "cancelled") {
        this.publish(turn, { type: "event", requestId: turn.requestId, event: { type: "cancelled" } });
      } else {
        this.publish(turn, {
          type: "bridge-error",
          requestId: turn.requestId,
          failure: toDesktopFailure(error),
        });
      }
    } finally {
      clearTimeout(turn.timeout);
      if (this.active === turn) this.active = undefined;
    }
  }

  private publish(turn: ActiveTurn, update: DesktopAgentTurnUpdate): void {
    if (this.active !== turn || turn.target.isDestroyed()) return;
    turn.target.send(update);
  }
}

function toDesktopFailure(error: unknown): DesktopAgentFailure {
  if (error instanceof RpcError) {
    return { code: error.code, message: safeRpcMessage(error) };
  }
  return failure("host-unavailable", "Agent 服务暂不可用，请稍后重试");
}

function safeRpcMessage(error: RpcError): string {
  if (error.code === "remote-error") return "Agent 请求在 Host 中失败";
  if (error.code === "connection-closed") return "Agent 连接意外中断";
  return "Agent 请求失败";
}

function failure(code: string, message: string): DesktopAgentFailure {
  return { code, message };
}
