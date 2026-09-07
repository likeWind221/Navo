export type RpcClientFrame = RpcOpenFrame | RpcCancelFrame;

export type RpcServerFrame = RpcItemFrame | RpcEndFrame | RpcErrorFrame;

export interface RpcMethod<TInput, TOutput> {
  readonly name: string;
  readonly parseInput: (value: unknown) => TInput;
  readonly parseOutput: (value: unknown) => TOutput;
  readonly createOutputValidator?: (input: TInput) => RpcOutputValidator<TOutput>;
}

export interface RpcOutputValidator<TOutput> {
  parse(value: unknown): TOutput;
  end(): void;
}

export interface RpcFailure {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const RPC_PROTOCOL_VERSION = 1 as const;
export const RPC_MAX_FRAME_CHARS = 1_048_576;
export const RPC_MAX_ID_CHARS = 128;
export const RPC_MAX_METHOD_CHARS = 128;

export interface RpcOpenFrame {
  readonly version: typeof RPC_PROTOCOL_VERSION;
  readonly type: "open";
  readonly id: string;
  readonly method: string;
  readonly params: unknown;
}

export interface RpcCancelFrame {
  readonly version: typeof RPC_PROTOCOL_VERSION;
  readonly type: "cancel";
  readonly id: string;
}

export interface RpcItemFrame {
  readonly version: typeof RPC_PROTOCOL_VERSION;
  readonly type: "item";
  readonly id: string;
  readonly value: unknown;
}

export interface RpcEndFrame {
  readonly version: typeof RPC_PROTOCOL_VERSION;
  readonly type: "end";
  readonly id: string;
}

export interface RpcErrorFrame {
  readonly version: typeof RPC_PROTOCOL_VERSION;
  readonly type: "error";
  readonly id: string;
  readonly error: RpcFailure;
}
