import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ResourceDeleteInputV1,
  ResourceDeleteResultV1,
  ResourceFolderCreateInputV1,
  ResourceFolderDeleteInputV1,
  ResourceFolderDeleteResultV1,
  ResourceFolderOrganizeInputV1,
  ResourceLibraryItemV1,
  ResourceReplaceInputV1,
  ResourceUpdateInputV1,
  UserImportItemV1,
  UserImportSourceV1,
} from "../../../../../rpc/resource.js";
import type {
  DesktopResourceApi,
  DesktopResourceEvent,
  DesktopResourceFailure,
  DesktopResourceResult,
  DesktopResourceStreamHandle,
} from "../../../../shared/resource.js";

export type ResourceOperationKind = "import" | "folder-create" | "folder-organize" | "folder-delete" | "resource-update" | "resource-replace" | "resource-delete";
export type ResourceOperationStatus = "starting" | "running" | "cancelling" | "completed" | "cancelled" | "failed" | "partial" | "confirmation-required";

export interface ResourceOperation {
  readonly id: string;
  readonly kind: ResourceOperationKind;
  readonly label: string;
  readonly status: ResourceOperationStatus;
  readonly subscriptionId: string | null;
  readonly items: readonly UserImportItemV1[];
  readonly failure: DesktopResourceFailure | null;
  readonly deleteResult: ResourceFolderDeleteResultV1 | null;
}

export interface ResourceOperationsModel {
  readonly operations: readonly ResourceOperation[];
  readonly busy: boolean;
  startImport(sources: readonly UserImportSourceV1[]): Promise<DesktopResourceResult<DesktopResourceStreamHandle>>;
  createFolder(input: ResourceFolderCreateInputV1): Promise<DesktopResourceResult<unknown>>;
  organizeFolder(input: ResourceFolderOrganizeInputV1): Promise<DesktopResourceResult<unknown>>;
  update(input: ResourceUpdateInputV1): Promise<DesktopResourceResult<ResourceLibraryItemV1>>;
  replace(input: Omit<ResourceReplaceInputV1, "operationId">): Promise<DesktopResourceResult<ResourceLibraryItemV1>>;
  deleteResource(input: Omit<ResourceDeleteInputV1, "operationId">): Promise<DesktopResourceResult<ResourceDeleteResultV1>>;
  deleteFolder(input: Omit<ResourceFolderDeleteInputV1, "operationId">): Promise<DesktopResourceResult<ResourceFolderDeleteResultV1>>;
  cancel(operationId: string): void;
}

type OperationPatch = Partial<Omit<ResourceOperation, "id" | "kind" | "label">>;

const unsupported: DesktopResourceFailure = { code: "bridge-closed", message: "Resource bridge is closed" };

export function applyResourceOperationEvent(operation: ResourceOperation, event: DesktopResourceEvent): ResourceOperation {
  if (operation.subscriptionId !== event.subscriptionId) return operation;
  if (operation.status === "completed" || operation.status === "cancelled" || operation.status === "failed" || operation.status === "partial") return operation;
  if (event.type === "import-item") {
    return { ...operation, items: [...operation.items, event.item], status: "running" };
  }
  if (event.type === "stream-complete") {
    const partial = operation.items.some(item => item.status === "failed" || item.status === "cancelled");
    return { ...operation, status: event.status === "cancelled" ? "cancelled" : partial ? "partial" : "completed" };
  }
  if (event.type === "stream-error") return { ...operation, status: "failed", failure: event.failure };
  return operation;
}

export function useResourceOperations(api: DesktopResourceApi | undefined, projectId: string): ResourceOperationsModel {
  const [operations, setOperations] = useState<readonly ResourceOperation[]>([]);
  const operationsRef = useRef<readonly ResourceOperation[]>([]);
  const pendingRef = useRef(new Map<string, readonly DesktopResourceEvent[]>());
  const sequence = useRef(0);
  const mountedRef = useRef(false);
  const ownerGenerationRef = useRef(0);

  const commit = useCallback((update: (current: readonly ResourceOperation[]) => readonly ResourceOperation[]): void => {
    const next = update(operationsRef.current);
    operationsRef.current = next;
    setOperations(next);
  }, []);

  const patch = useCallback((id: string, value: OperationPatch): void => {
    commit(current => current.map(operation => operation.id === id ? { ...operation, ...value } : operation));
  }, [commit]);

  const create = useCallback((kind: ResourceOperationKind, label: string): ResourceOperation => {
    sequence.current += 1;
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${sequence.current}`;
    return { id: `f72-${kind}-${suffix}`, kind, label, status: "starting", subscriptionId: null, items: [], failure: null, deleteResult: null };
  }, []);

  useEffect(() => {
    operationsRef.current = [];
    setOperations([]);
    if (api === undefined) return;
    const ownerGeneration = ++ownerGenerationRef.current;
    mountedRef.current = true;
    let disposed = false;
    const applyEvent = (operation: ResourceOperation, event: DesktopResourceEvent): void => {
      const next = applyResourceOperationEvent(operation, event);
      if (next !== operation) commit(current => current.map(value => value.id === operation.id ? next : value));
    };
    const removeListener = api.onEvent(event => {
      if (disposed || (event.type !== "import-item" && event.type !== "stream-complete" && event.type !== "stream-error")) return;
      const operation = operationsRef.current.find(value => value.subscriptionId === event.subscriptionId);
      if (operation !== undefined) {
        applyEvent(operation, event);
        return;
      }
      const awaitingStart = operationsRef.current.some(value => value.kind === "import"
        && (value.status === "starting" || value.status === "cancelling") && value.subscriptionId === null);
      if (!awaitingStart) return;
      const events = pendingRef.current.get(event.subscriptionId) ?? [];
      pendingRef.current.set(event.subscriptionId, [...events, event]);
    });
    return () => {
      disposed = true;
      mountedRef.current = false;
      removeListener();
      pendingRef.current.clear();
      for (const operation of operationsRef.current) {
        if (operation.status === "starting" || operation.status === "running" || operation.status === "cancelling") {
          const id = operation.subscriptionId ?? operation.id;
          void api.cancel(id);
        }
      }
    };
  }, [api, commit, projectId]);

  const startImport = useCallback(async (sources: readonly UserImportSourceV1[]): Promise<DesktopResourceResult<DesktopResourceStreamHandle>> => {
    if (api === undefined) return { type: "failed", failure: unsupported };
    const ownerGeneration = ownerGenerationRef.current;
    const operation = create("import", sources.some(source => source.kind === "directory") ? "导入目录" : "导入资料");
    commit(current => [...current, operation]);
    const result = await api.startImport({ projectId, requestId: operation.id, sources });
    if (!mountedRef.current || ownerGenerationRef.current !== ownerGeneration) {
      if (result.type === "ok") void api.cancel(result.value.subscriptionId);
      pendingRef.current.clear();
      return result;
    }
    if (result.type === "failed") {
      patch(operation.id, { status: result.failure.code === "cancelled" ? "cancelled" : "failed", failure: result.failure });
      return result;
    }
    const requestedCancel = operationsRef.current.find(value => value.id === operation.id)?.status === "cancelling";
    patch(operation.id, { status: requestedCancel ? "cancelling" : "running", subscriptionId: result.value.subscriptionId });
    const events = pendingRef.current.get(result.value.subscriptionId) ?? [];
    pendingRef.current.delete(result.value.subscriptionId);
    const current = operationsRef.current.find(value => value.id === operation.id);
    if (current !== undefined) events.forEach(event => applyPending(current.id, event));
    if (requestedCancel) void api.cancel(result.value.subscriptionId);
    return result;
  }, [api, commit, create, projectId, patch]);

  const applyPending = useCallback((id: string, event: DesktopResourceEvent): void => {
    const operation = operationsRef.current.find(value => value.id === id);
    if (operation === undefined) return;
    const next = applyResourceOperationEvent(operation, event);
    if (next !== operation) commit(current => current.map(value => value.id === id ? next : value));
  }, [commit]);

  const unary = useCallback(async <T,>(kind: ResourceOperationKind, label: string, action: (operationId: string) => Promise<DesktopResourceResult<T>>,
    success?: (value: T) => OperationPatch): Promise<DesktopResourceResult<T>> => {
    if (api === undefined) return { type: "failed", failure: unsupported };
    const operation = create(kind, label);
    const running = { ...operation, status: "running" as const, subscriptionId: operation.id };
    commit(current => [...current, running]);
    const result = await action(operation.id);
    if (result.type === "failed") patch(operation.id, { status: result.failure.code === "cancelled" ? "cancelled" : "failed", failure: result.failure });
    else patch(operation.id, success?.(result.value) ?? { status: "completed" });
    return result;
  }, [api, commit, create, patch]);

  const createFolder = useCallback((input: ResourceFolderCreateInputV1) => unary("folder-create", `新建文件夹：${input.path}`, () => api!.createFolder(input)), [api, unary]);
  const organizeFolder = useCallback((input: ResourceFolderOrganizeInputV1) => unary("folder-organize", `移动文件夹：${input.path}`, () => api!.organizeFolder(input)), [api, unary]);
  const update = useCallback((input: ResourceUpdateInputV1) => unary("resource-update", "更新资料信息", () => api!.update(input)), [api, unary]);
  const replace = useCallback((input: Omit<ResourceReplaceInputV1, "operationId">) => unary("resource-replace", "替换资料", operationId => api!.replace({ ...input, operationId })), [api, unary]);
  const deleteResource = useCallback((input: Omit<ResourceDeleteInputV1, "operationId">) => unary("resource-delete", "删除资料", operationId => api!.delete({ ...input, operationId })), [api, unary]);
  const deleteFolder = useCallback((input: Omit<ResourceFolderDeleteInputV1, "operationId">) => unary("folder-delete", input.recursive ? "递归删除文件夹" : "检查文件夹删除",
    operationId => api!.deleteFolder({ ...input, operationId }), result => ({
      status: result.status === "confirmation-required" ? "confirmation-required" : result.status === "partial" ? "partial" : result.status === "cancelled" ? "cancelled" : "completed",
      deleteResult: result,
    })), [api, unary]);

  const cancel = useCallback((operationId: string): void => {
    const operation = operationsRef.current.find(value => value.id === operationId);
    if (operation === undefined || (operation.status !== "starting" && operation.status !== "running")) return;
    patch(operationId, { status: "cancelling" });
    if (api !== undefined) void api.cancel(operation.subscriptionId ?? operation.id);
  }, [api, patch]);

  const busy = operations.some(operation => operation.status === "starting" || operation.status === "running" || operation.status === "cancelling");
  return { operations, busy, startImport, createFolder, organizeFolder, update, replace, deleteResource, deleteFolder, cancel };
}
