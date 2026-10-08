import type { ProjectCreateInput } from "../../../../rpc/project.js";
import {
  PROJECT_GOAL_MAX_CHARS,
  PROJECT_NAME_MAX_CHARS,
  PROJECT_WORKSPACE_ROOT_MAX_CHARS,
} from "../../../../rpc/project.js";

export interface ProjectDraft {
  readonly name: string;
  readonly goal: string;
  readonly workspaceRoot: string | null;
}

export type DraftCheck =
  | { readonly type: "ready"; readonly input: ProjectCreateInput }
  | { readonly type: "problem"; readonly message: string };

export const emptyDraft: ProjectDraft = { name: "", goal: "", workspaceRoot: null };

export function checkDraft(draft: ProjectDraft): DraftCheck {
  const name = draft.name.trim();
  if (!name) return problem("请填写项目名称。");
  if (name.length > PROJECT_NAME_MAX_CHARS) return problem(`项目名称不能超过 ${PROJECT_NAME_MAX_CHARS} 个字符。`);
  if (!draft.goal.trim()) return problem("请填写项目目标。");
  if (draft.goal.length > PROJECT_GOAL_MAX_CHARS) return problem(`项目目标不能超过 ${PROJECT_GOAL_MAX_CHARS} 个字符。`);
  const workspaceRoot = draft.workspaceRoot;
  if (workspaceRoot === null || !workspaceRoot.trim()) return problem("请选择工作目录。");
  if (workspaceRoot.length > PROJECT_WORKSPACE_ROOT_MAX_CHARS) return problem("工作目录路径过长，请选择其他目录。");
  return { type: "ready", input: { name, goal: draft.goal, workspaceRoot } };
}

function problem(message: string): DraftCheck {
  return { type: "problem", message };
}
