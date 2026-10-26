import { useEffect, useMemo } from "react";
import type { ResourceLibraryInputV1, ResourceLibraryItemV1, ResourceLibrarySnapshotV1 } from "../../../rpc/resource.js";
import type { ProjectDetailV1 } from "../../../rpc/project.js";
import type { DesktopResourceApi, DesktopResourceEvent, DesktopResourceResult } from "../../shared/resource.js";
import { WorkspaceShell } from "../workspace/Shell";
import { ProjectWorkspace } from "../workspace/project/Workspace";

const projectA = detail("f71-a", "项目 A · 研究资料", "验证项目 A 的目录与选中状态");
const projectB = detail("f71-b", "项目 B · 研究资料", "验证项目 B 的隔离订阅与失败恢复");

interface FixtureControls {
  emitSnapshot(snapshot: ResourceLibrarySnapshotV1): void;
  emitError(message: string): void;
  setStartDelay(milliseconds: number): void;
  setEarlyError(value: boolean): void;
  update(resourceId: string, name: string): void;
  remove(resourceId: string): void;
  activeCount(): number;
  cancelledIds(): readonly string[];
  listenerCount(): number;
}

interface FixtureWindow extends Window { __f71?: { project(id: string): FixtureControls } }

function detail(projectId: string, name: string, goal: string): ProjectDetailV1 {
  return { project: {
    projectId, name, goal, workspaceRoot: `D:/Research/${projectId}`, status: "active", revision: 1,
    createdAt: "2026-10-20T00:00:00.000Z",
  }, main: { sessionId: `${projectId}-main`, turnActive: false }, roadmap: null };
}

function resource(resourceId: string, name: string, libraryPath: string, status: ResourceLibraryItemV1["content"]): ResourceLibraryItemV1 {
  return {
    resourceId, owner: { kind: "main" }, name, description: "F7.1 只读资料条目", type: "text/markdown", libraryPath,
    access: { kind: "private" }, revision: 1, assetGeneration: 1,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z", content: status,
  };
}

function createFixture(project: ProjectDetailV1): { api: DesktopResourceApi; controls: FixtureControls } {
  const root = [
    resource(`${project.project.projectId}-root`, "项目说明.md", "项目说明.md", { status: "ready", errorCode: null, errorMessage: null, updatedAt: "2026-10-21T00:00:00.000Z" }),
    resource(`${project.project.projectId}-metadata`, "来源记录.md", "来源记录.md", { status: "metadata_only", errorCode: null, errorMessage: null, updatedAt: "2026-10-21T00:00:00.000Z" }),
    resource(`${project.project.projectId}-failed`, "失败记录.md", "失败记录.md", { status: "failed", errorCode: "parse", errorMessage: "正文解析失败，请稍后重试", updatedAt: "2026-10-21T00:00:00.000Z" }),
    resource(`${project.project.projectId}-pending`, "待处理记录.md", "待处理记录.md", null),
  ];
  const nested = [resource(`${project.project.projectId}-nested`, "研究笔记.md", "notes/研究笔记.md", { status: "ready", errorCode: null, errorMessage: null, updatedAt: "2026-10-21T00:00:00.000Z" })];
  const directories = [{ path: "notes", explicit: true }, { path: "empty", explicit: true }];
  const listeners = new Set<(event: DesktopResourceEvent) => void>();
  const active = new Set<string>();
  const cancelled: string[] = [];
  let sequence = 0;
  let startDelay = 30;
  let earlyError = false;
  let currentPath: string | null = null;
  let activeSubscriptionId = "";
  const emit = (event: DesktopResourceEvent): void => { listeners.forEach(listener => listener(event)); };
  const currentSnapshot = (): ResourceLibrarySnapshotV1 => ({
    projectId: project.project.projectId, path: currentPath,
    directories: currentPath === null ? directories : [], resources: currentPath === "notes" ? nested : currentPath === "empty" ? [] : root,
  });
  const unavailable = <T,>(): Promise<DesktopResourceResult<T>> => Promise.resolve({ type: "failed", failure: { code: "internal", message: "受控资料库只开放浏览与订阅" } });
  const controls: FixtureControls = {
    emitSnapshot(value) { if (activeSubscriptionId) emit({ type: "library-snapshot", subscriptionId: activeSubscriptionId, snapshot: value }); },
    emitError(message) { if (activeSubscriptionId) emit({ type: "stream-error", subscriptionId: activeSubscriptionId, failure: { code: "internal", message } }); },
    setStartDelay(milliseconds) { startDelay = milliseconds; },
    setEarlyError(value) { earlyError = value; },
    update(resourceId, name) {
      const updateIn = (items: ResourceLibraryItemV1[]): void => {
        const index = items.findIndex(value => value.resourceId === resourceId);
        const item = items[index];
        if (item) items[index] = { ...item, name, revision: item.revision + 1, updatedAt: "2026-10-22T00:00:00.000Z" };
      };
      updateIn(root); updateIn(nested);
      if (activeSubscriptionId) emit({ type: "library-snapshot", subscriptionId: activeSubscriptionId, snapshot: currentSnapshot() });
    },
    remove(resourceId) {
      const removeFrom = (items: ResourceLibraryItemV1[]): void => { const index = items.findIndex(value => value.resourceId === resourceId); if (index >= 0) items.splice(index, 1); };
      removeFrom(root); removeFrom(nested);
      if (activeSubscriptionId) emit({ type: "library-snapshot", subscriptionId: activeSubscriptionId, snapshot: currentSnapshot() });
    },
    activeCount: () => active.size, cancelledIds: () => cancelled, listenerCount: () => listeners.size,
  };
  const api: DesktopResourceApi = {
    browse: unavailable, createFolder: unavailable, organizeFolder: unavailable, deleteFolder: unavailable, update: unavailable,
    replace: unavailable, delete: unavailable, startImport: unavailable, chooseFiles: unavailable, chooseDirectory: unavailable, chooseReplacement: unavailable,
    cancel: async operationId => { active.delete(operationId); cancelled.push(operationId); return { type: "ok", value: null }; },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    startFollow: async (input: ResourceLibraryInputV1) => {
      const subscriptionId = `${project.project.projectId}-follow-${++sequence}`;
      currentPath = input.path; activeSubscriptionId = subscriptionId; active.add(subscriptionId);
      setTimeout(() => emit({ type: "library-snapshot", subscriptionId, snapshot: currentSnapshot() }), 10);
      if (earlyError) setTimeout(() => emit({ type: "stream-error", subscriptionId, failure: { code: "internal", message: "订阅在回执前断开" } }), 15);
      await new Promise(resolve => setTimeout(resolve, startDelay));
      return { type: "ok", value: { subscriptionId } };
    },
  };
  return { api, controls };
}

export default function ResourcePreview(): React.JSX.Element {
  const fixtures = useMemo(() => ({ a: createFixture(projectA), b: createFixture(projectB) }), []);
  useEffect(() => {
    const target = window as FixtureWindow;
    target.__f71 = { project: id => fixtures[id as "a" | "b"].controls };
    return () => { delete target.__f71; };
  }, [fixtures]);
  return <div data-ready="true"><WorkspaceShell initialSection="project" openRequest={{ id: projectA.project.projectId }} entries={[
    { id: projectA.project.projectId, kind: "project", title: projectA.project.name, content: <ProjectWorkspace detail={projectA} resource={fixtures.a.api} /> },
    { id: projectB.project.projectId, kind: "project", title: projectB.project.name, content: <ProjectWorkspace detail={projectB} resource={fixtures.b.api} /> },
  ]} /></div>;
}
