import type { IconName } from "../../../ui/Icon.js";
import type { AssistantToolBlock } from "../conversation.js";
import { toolProcessLabel } from "../process.js";

export interface ToolPresentation {
  readonly icon: IconName;
  readonly label: string;
  readonly result: { readonly title: string; readonly command: string | null; readonly text: string; readonly exitCode: string | null } | null;
}

export function toolPresentation(block: AssistantToolBlock): ToolPresentation {
  const name = block.toolName.trim().toLowerCase();
  const icons: Readonly<Record<string, IconName>> = {
    web_search: "globe", web_fetch: "globe", shell: "terminal", read: "book", edit: "pen", write: "pen",
  };
  const command = name === "shell" ? shellCommand(block.arguments) : null;
  const label = command === null ? toolProcessLabel(block.toolName) : `执行Shell : ${command}`;
  const text = block.detail || block.summary;
  const hasResult = text.length > 0 || block.failure !== null;
  const expandable = hasResult && name !== "read" && name !== "edit" && name !== "write";
  const exit = name === "shell" ? /(?:^|\n)\[exit code: (-?\d+)\]\s*$/.exec(text) : null;
  return {
    icon: icons[name] ?? "tool",
    label,
    result: expandable ? {
      title: name === "shell" ? "Shell" : `${block.toolName} 结果`,
      command,
      text: exit === null ? text : text.slice(0, exit.index).trimEnd(),
      exitCode: exit?.[1] ?? null,
    } : null,
  };
}

function shellCommand(argumentsText: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(argumentsText);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || !("command" in value)
    || typeof value.command !== "string" || value.command.trim().length === 0) return null;
  return value.command;
}
