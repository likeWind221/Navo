import type { CommandAnchor, CommandEvent } from "../../shared/content.js";
import type { SessionId } from "../brand/ids.js";

export type CommandMode = "sidecar" | "queued";

export interface CommandInput {
  readonly sessionId: SessionId;
  readonly commandId: string;
  readonly name: string;
  readonly args: string;
}

export interface CommandContext {
  readonly sessionId: SessionId;
  readonly commandId: string;
  readonly name: string;
  readonly args: string;
  readonly anchor: CommandAnchor;
  readonly signal: AbortSignal;
}

export interface CommandDefinition {
  readonly name: string;
  readonly mode: CommandMode;
  readonly parseArgs?: (args: string) => void;
  readonly execute: (context: CommandContext) => Promise<string | void> | string | void;
}

export type CommandEventHandler = (event: CommandEvent) => void | Promise<void>;
