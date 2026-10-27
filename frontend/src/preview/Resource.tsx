import { useEffect, useMemo } from "react";
import type { ResourceLibraryInputV1, ResourceLibraryItemV1, ResourceLibrarySnapshotV1, UserImportItemV1 } from "../../../rpc/resource.js";
import type { ProjectDetailV1 } from "../../../rpc/project.js";
import type { DesktopResourceApi, DesktopResourceEvent, DesktopResourceResult } from "../../shared/resource.js";
import { WorkspaceShell } from "../workspace/Shell";
import { ProjectWorkspace } from "../workspace/project/Workspace";

const projectA = detail("f72-a", "项目 A · 研究资料", "验证项目 A 的导入与整理操作");
const projectB = detail("f72-b", "项目 B · 研究资料", "验证项目 B 的操作隔离");

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
  importIds(): readonly string[];
}

interface FixtureWindow extends Window { __f71?: { project(id: string): FixtureControls }; __f72?: { project(id: string): FixtureControls } }

function detail(projectId: string, name: string, goal: string): ProjectDetailV1 {
  return { project: { projectId, name, goal, workspaceRoot: `D:/Research/${projectId}`, status: "active", revision: 1, createdAt: "2026-10-20T00:00:00.000Z" }, main: { sessionId: `${projectId}-main`, turnActive: false }, roadmap: null };
}

function resource(resourceId: string, name: string, libraryPath: string, status: ResourceLibraryItemV1["content"]): ResourceLibraryItemV1 {
  return { resourceId, owner: { kind: "user" }, name, description: "F7.2 受控资料条目", type: "text/markdown", libraryPath,
    access: { kind: "private" }, revision: 1, assetGeneration: 1, createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z", content: status };
}

function createFixture(project: ProjectDetailV1): { api: DesktopResourceApi; controls: FixtureControls } {
  const root: ResourceLibraryItemV1[] = [resource(`${project.project.projectId}-root`, "项目说明.md", "项目说明.md", { status: "ready", errorCode: null, errorMessage: null, updatedAt: "2026-10-21T00:00:00.000Z" }),
    resource(`${project.project.projectId}-failed`, "失败记录.md", "失败记录.md", { status: "failed", errorCode: "parse", errorMessage: "正文解析失败，请稍后重试", updatedAt: "2026-10-21T00:00:00.000Z" }),
    resource(`${project.project.projectId}-metadata`, "仅元数据.md", "仅元数据.md", { status: "metadata_only", errorCode: null, errorMessage: null, updatedAt: "2026-10-21T00:00:00.000Z" }),
    resource(`${project.project.projectId}-unknown`, "尚未处理.md", "尚未处理.md", null)];
  const nested: ResourceLibraryItemV1[] = [resource(`${project.project.projectId}-nested`, "研究笔记.md", "notes/研究笔记.md", { status: "ready", errorCode: null, errorMessage: null, updatedAt: "2026-10-21T00:00:00.000Z" })];
  let directories = [{ path: "notes", explicit: true }, { path: "empty", explicit: true }];
  const listeners = new Set<(event: DesktopResourceEvent) => void>();
  const active = new Set<string>();
  const imports = new Map<string, { cancelled: boolean }>();
  const importRequests = new Map<string, { subscriptionId: string; state: { cancelled: boolean } }>();
  const cancelled: string[] = [];
  const importIds: string[] = [];
  let sequence = 0;
  let startDelay = 20;
  let earlyError = false;
  let currentPath: string | null = null;
  let followSubscriptionId = "";
  const emit = (event: DesktopResourceEvent): void => { listeners.forEach(listener => listener(event)); };
  const currentSnapshot = (): ResourceLibrarySnapshotV1 => ({ projectId: project.project.projectId, path: currentPath,
    directories: currentPath === null ? directories : [], resources: currentPath === "notes" ? nested : currentPath === "empty" ? [] : root });
  const emitCurrent = (): void => { if (followSubscriptionId) emit({ type: "library-snapshot", subscriptionId: followSubscriptionId, snapshot: currentSnapshot() }); };
  const allResources = (): ResourceLibraryItemV1[] => [...root, ...nested];
  const findResource = (resourceId: string): ResourceLibraryItemV1 | undefined => allResources().find(item => item.resourceId === resourceId);
  const unavailable = <T,>(): Promise<DesktopResourceResult<T>> => Promise.resolve({ type: "failed", failure: { code: "internal", message: "受控资料库操作不可用" } });
  const controls: FixtureControls = {
    emitSnapshot(value) { if (followSubscriptionId) emit({ type: "library-snapshot", subscriptionId: followSubscriptionId, snapshot: value }); },
    emitError(message) { if (followSubscriptionId) emit({ type: "stream-error", subscriptionId: followSubscriptionId, failure: { code: "internal", message } }); },
    setStartDelay(milliseconds) { startDelay = milliseconds; }, setEarlyError(value) { earlyError = value; },
    update(resourceId, name) { const rename = (items: ResourceLibraryItemV1[]) => { const index = items.findIndex(item => item.resourceId === resourceId); const current = index < 0 ? undefined : items[index]; if (current !== undefined) items[index] = { ...current, name, revision: current.revision + 1 }; }; rename(root); rename(nested); emitCurrent(); },
    remove(resourceId) { const remove = (items: ResourceLibraryItemV1[]) => { const index = items.findIndex(item => item.resourceId === resourceId); if (index >= 0) items.splice(index, 1); }; remove(root); remove(nested); emitCurrent(); },
    activeCount: () => active.size, cancelledIds: () => cancelled, listenerCount: () => listeners.size, importIds: () => importIds,
  };
  const api: DesktopResourceApi = {
    browse: unavailable,
    createFolder: async input => { directories = [...directories, { path: input.path, explicit: true }]; emitCurrent(); return { type: "ok", value: directories.at(-1)! }; },
    organizeFolder: async input => { const source = input.path; const change = (value: string) => input.targetPath + value.slice(source.length); directories = directories.map(folder => folder.path === source ? { ...folder, path: input.targetPath } : folder); const move = (items: ResourceLibraryItemV1[]) => items.forEach((item, index) => { if (item.libraryPath === source || item.libraryPath.startsWith(`${source}/`)) items[index] = { ...item, libraryPath: change(item.libraryPath), revision: item.revision + 1 }; }); move(root); move(nested); emitCurrent(); return { type: "ok", value: { path: input.targetPath, explicit: true } }; },
    deleteFolder: async input => { const found = directories.find(folder => folder.path === input.path); if (!found) return { type: "failed", failure: { code: "folder-unavailable", message: "目录不存在" } }; const children = allResources().filter(item => item.libraryPath === input.path || item.libraryPath.startsWith(`${input.path}/`)); if (!input.recursive && children.length) return { type: "ok", value: { status: "confirmation-required", deleted: [], failed: [] } }; const deleted = children.map(item => item.resourceId); for (const id of deleted) controls.remove(id); directories = directories.filter(folder => folder.path !== input.path && !folder.path.startsWith(`${input.path}/`)); emitCurrent(); return { type: "ok", value: { status: "deleted", deleted, failed: [] } }; },
    update: async input => { const item = findResource(input.resourceId); if (!item) return { type: "failed", failure: { code: "resource-unavailable", message: "资料不存在" } }; if (item.revision !== input.expectedRevision) return { type: "failed", failure: { code: "revision-conflict", message: "资料版本已变化" } }; const update = (items: ResourceLibraryItemV1[]): ResourceLibraryItemV1 | undefined => { const index = items.findIndex(value => value.resourceId === input.resourceId); const current = index < 0 ? undefined : items[index]; if (current === undefined) return undefined; const name = input.name ?? current.name; const next = { ...current, ...(input.name === undefined ? {} : { name }), ...(input.folder === undefined ? {} : { libraryPath: input.folder ? `${input.folder}/${name}` : name }), ...(input.description === undefined ? {} : { description: input.description }), revision: current.revision + 1 }; items[index] = next; return next; }; const next = update(root) ?? update(nested)!; emitCurrent(); return { type: "ok", value: next }; },
    replace: async input => { const item = findResource(input.resourceId); if (!item) return { type: "failed", failure: { code: "resource-unavailable", message: "资料不存在" } }; if (item.revision !== input.expectedRevision) return { type: "failed", failure: { code: "revision-conflict", message: "资料版本已变化" } }; const replace = (items: ResourceLibraryItemV1[]): ResourceLibraryItemV1 | undefined => { const index = items.findIndex(value => value.resourceId === input.resourceId); const current = index < 0 ? undefined : items[index]; if (current === undefined) return undefined; const next = { ...current, content: { status: "pending" as const, errorCode: null, errorMessage: null, updatedAt: new Date().toISOString() }, revision: current.revision + 1 }; items[index] = next; return next; }; const next = replace(root) ?? replace(nested)!; emitCurrent(); return { type: "ok", value: next }; },
    delete: async input => { const item = findResource(input.resourceId); if (!item) return { type: "failed", failure: { code: "resource-unavailable", message: "资料不存在" } }; if (item.revision !== input.expectedRevision) return { type: "failed", failure: { code: "revision-conflict", message: "资料版本已变化" } }; controls.remove(input.resourceId); return { type: "ok", value: { resourceId: input.resourceId, deleted: true } }; },
    startImport: async input => { const source = input.sources[0]; if (source === undefined) return { type: "failed", failure: { code: "invalid-input", message: "没有选择资料" } }; const subscriptionId = `${project.project.projectId}-import-${++sequence}`; const state = { cancelled: false }; imports.set(subscriptionId, state); importRequests.set(input.requestId, { subscriptionId, state }); active.add(subscriptionId); importIds.push(subscriptionId); const name = source.kind === "directory" ? "导入目录/笔记.md" : (source.path.split(/[\\/]/).at(-1) ?? "导入资料.md"); const item = resource(`${project.project.projectId}-import-${sequence}`, name, name, { status: "ready", errorCode: null, errorMessage: null, updatedAt: new Date().toISOString() }); setTimeout(() => { if (state.cancelled) return; root.push(item); emit({ type: "import-item", subscriptionId, item: { status: "saved", name: item.name, relativePath: name, resourceId: item.resourceId, libraryPath: item.libraryPath, contentStatus: "ready" } }); emitCurrent(); }, 2); if (earlyError) setTimeout(() => { if (!state.cancelled) emit({ type: "stream-error", subscriptionId, failure: { code: "internal", message: "受控导入失败" } }); }, 3); setTimeout(() => { if (state.cancelled) return; emit({ type: "stream-complete", subscriptionId, status: "completed" }); active.delete(subscriptionId); imports.delete(subscriptionId); importRequests.delete(input.requestId); }, startDelay + 10); await new Promise(resolve => setTimeout(resolve, startDelay)); return { type: "ok", value: { subscriptionId } }; },
    startFollow: async input => { const subscriptionId = `${project.project.projectId}-follow-${++sequence}`; currentPath = input.path; followSubscriptionId = subscriptionId; active.add(subscriptionId); setTimeout(() => emit({ type: "library-snapshot", subscriptionId, snapshot: currentSnapshot() }), 10); if (earlyError) setTimeout(() => emit({ type: "stream-error", subscriptionId, failure: { code: "internal", message: "订阅在回执前断开" } }), 15); await new Promise(resolve => setTimeout(resolve, startDelay)); return { type: "ok", value: { subscriptionId } }; },
    cancel: async operationId => { const request = importRequests.get(operationId); const importState = imports.get(operationId) ?? request?.state; const subscriptionId = request?.subscriptionId ?? operationId; if (importState) { importState.cancelled = true; imports.delete(subscriptionId); importRequests.delete(operationId); active.delete(subscriptionId); cancelled.push(operationId); emit({ type: "stream-complete", subscriptionId, status: "cancelled" }); return { type: "ok", value: null }; } active.delete(operationId); cancelled.push(operationId); if (operationId === followSubscriptionId) followSubscriptionId = ""; return { type: "ok", value: null }; },
    chooseFiles: async () => ({ type: "ok", value: [{ kind: "file", path: "/fixture/导入笔记.md" }] }),
    chooseDirectory: async () => ({ type: "ok", value: [{ kind: "directory", path: "/fixture/研究目录" }] }),
    chooseReplacement: async () => ({ type: "ok", value: "/fixture/替换内容.md" }),
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { api, controls };
}

export default function ResourcePreview(): React.JSX.Element {
  const fixtures = useMemo(() => ({ a: createFixture(projectA), b: createFixture(projectB) }), []);
  useEffect(() => { const target = window as FixtureWindow; const controls = { project: (id: string) => fixtures[id as "a" | "b"].controls }; target.__f71 = controls; target.__f72 = controls; return () => { delete target.__f71; delete target.__f72; }; }, [fixtures]);
  return <div data-ready="true"><WorkspaceShell initialSection="project" openRequest={{ id: projectA.project.projectId }} entries={[
    { id: projectA.project.projectId, kind: "project", title: projectA.project.name, content: <ProjectWorkspace detail={projectA} resource={fixtures.a.api} /> },
    { id: projectB.project.projectId, kind: "project", title: projectB.project.name, content: <ProjectWorkspace detail={projectB} resource={fixtures.b.api} /> },
  ]} /></div>;
}
