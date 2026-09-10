import type { DesktopAgentFailure } from "../../../shared/agent.js";

export interface ParsedCommand {
  readonly name: string;
  readonly args: string;
}

export interface InvalidCommand {
  readonly name: string;
  readonly failure: DesktopAgentFailure;
}

export type CommandCandidate = ParsedCommand | InvalidCommand | null;

export function parseCommand(candidate: string): CommandCandidate {
  const text = candidate.trim();
  if (!text.startsWith("/")) return null;
  const body = text.slice(1);
  const separator = body.search(/\s/);
  const name = separator === -1 ? body : body.slice(0, separator);
  if (name.length === 0) return invalid("command", "invalid-command", "\u547d\u4ee4\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return invalid(name, "invalid-command", "\u547d\u4ee4\u540d\u79f0\u53ea\u80fd\u4f7f\u7528\u5c0f\u5199\u5b57\u6bcd\u3001\u6570\u5b57\u548c\u8fde\u5b57\u7b26");
  }
  return { name, args: separator === -1 ? "" : body.slice(separator).trim() };
}

function invalid(name: string, code: string, message: string): InvalidCommand {
  return { name, failure: { code, message } };
}
