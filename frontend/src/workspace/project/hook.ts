import { useCallback, useEffect, useReducer, useRef } from "react";

import type { ProjectCreateInput, ProjectSummaryV1 } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectFailure, DesktopProjectResult } from "../../../shared/project.js";

export interface ProjectsModel {
  readonly state: ProjectListState;
  reload(): Promise<void>;
  create(input: ProjectCreateInput): Promise<DesktopProjectResult<ProjectSummaryV1>>;
}

export interface ProjectListState {
  readonly status: "loading" | "ready" | "failed";
  readonly projects: readonly ProjectSummaryV1[];
  readonly failure: DesktopProjectFailure | null;
}

export type ProjectListAction =
  | { readonly type: "loading" }
  | { readonly type: "loaded"; readonly projects: readonly ProjectSummaryV1[] }
  | { readonly type: "failed"; readonly failure: DesktopProjectFailure }
  | { readonly type: "created"; readonly project: ProjectSummaryV1 };

export const initialProjectListState: ProjectListState = { status: "loading", projects: [], failure: null };

export const missingBridge: DesktopProjectFailure = { code: "bridge-closed", message: "Desktop project bridge is missing" };

export function projectListReducer(state: ProjectListState, action: ProjectListAction): ProjectListState {
  switch (action.type) {
    case "loading":
      return { ...state, status: "loading", failure: null };
    case "loaded":
      return { status: "ready", projects: action.projects, failure: null };
    case "failed":
      return { ...state, status: "failed", failure: action.failure };
    case "created":
      return {
        ...state,
        projects: state.projects.some(project => project.projectId === action.project.projectId)
          ? state.projects.map(project => project.projectId === action.project.projectId ? action.project : project)
          : [...state.projects, action.project],
      };
  }
}

export function useProjects(api: DesktopProjectApi | undefined = window.desktop?.project): ProjectsModel {
  const [state, dispatch] = useReducer(projectListReducer, initialProjectListState);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (api === undefined) {
      dispatch({ type: "failed", failure: missingBridge });
      return;
    }
    dispatch({ type: "loading" });
    const result = await api.list();
    if (current !== generation.current) return;
    dispatch(result.type === "ok"
      ? { type: "loaded", projects: result.value.projects }
      : { type: "failed", failure: result.failure });
  }, [api]);

  const create = useCallback(async (input: ProjectCreateInput): Promise<DesktopProjectResult<ProjectSummaryV1>> => {
    if (api === undefined) return { type: "failed", failure: missingBridge };
    const result = await api.create(input);
    if (result.type === "ok") {
      dispatch({ type: "created", project: result.value });
      void reload();
    }
    return result;
  }, [api, reload]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return { state, reload, create };
}
