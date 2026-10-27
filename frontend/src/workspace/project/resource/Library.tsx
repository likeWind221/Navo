import { useEffect, useRef, useState } from "react";
import type { ResourceLibraryItemV1, UserImportSourceV1 } from "../../../../../rpc/resource.js";
import type { DesktopResourceApi, DesktopResourceFailure } from "../../../../shared/resource.js";
import { Icon } from "../../../ui/Icon.js";
import { ownerLabel, resourceStatus } from "./model.js";
import { useResourceLibrary } from "./hook.js";
import { resourceFailureMessage } from "./failure.js";
import type { ResourceOperation, ResourceOperationsModel } from "./operations.js";
import styles from "./style.module.css";

type ResourceTarget = {
  readonly resourceId: string;
  readonly revision: number;
  readonly name: string;
  readonly description: string;
  readonly folder: string;
};

export function ResourceLibrary({ api, projectId, operations, onClose }: {
  readonly api: DesktopResourceApi;
  readonly projectId: string;
  readonly operations: ResourceOperationsModel;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const library = useResourceLibrary(api, projectId);
  const currentPath = library.path;
  const selected = library.selected;
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<DesktopResourceFailure | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderDialog, setFolderDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTarget, setEditTarget] = useState<ResourceTarget | null>(null);
  const [moveDialog, setMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveResourceTarget, setMoveResourceTarget] = useState<ResourceTarget | null>(null);
  const [deleteFolderDialog, setDeleteFolderDialog] = useState<{ path: string; recursive: boolean } | null>(null);
  const [deleteResourceDialog, setDeleteResourceDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResourceTarget | null>(null);
  const focusReturn = useRef<HTMLElement | null>(null);

  useEffect(() => { setSelectedDirectory(null); }, [currentPath]);

  const setFailure = (result: { readonly type: "failed"; readonly failure: DesktopResourceFailure } | { readonly type: "ok" }): void => {
    setActionFailure(result.type === "failed" ? result.failure : null);
  };
  const pathFor = (name: string): string => currentPath === null ? name : `${currentPath}/${name}`;
  const resourceFolder = (item: ResourceLibraryItemV1): string => {
    const separator = item.libraryPath.lastIndexOf("/");
    return separator < 0 ? "" : item.libraryPath.slice(0, separator);
  };
  const snapshotResource = (item: ResourceLibraryItemV1): ResourceTarget => ({
    resourceId: item.resourceId,
    revision: item.revision,
    name: item.name,
    description: item.description,
    folder: resourceFolder(item),
  });
  const rememberFocus = (): void => {
    focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = (): void => {
    const target = focusReturn.current;
    focusReturn.current = null;
    requestAnimationFrame(() => target?.focus());
  };
  const importSources = async (kind: "files" | "directory"): Promise<void> => {
    setActionFailure(null);
    const result = await (kind === "files" ? api.chooseFiles() : api.chooseDirectory());
    if (result.type === "failed") { setActionFailure(result.failure); return; }
    if (result.value.length > 0) await operations.startImport(result.value);
  };
  const submitFolder = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    setFailure(await operations.createFolder({ projectId, path: pathFor(name) }));
    setFolderDialog(false); setFolderName(""); restoreFocus();
  };
  const submitEdit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (editTarget === null) return;
    const name = editName.trim();
    const changes = { ...(name === editTarget.name ? {} : { name }), ...(editDescription === editTarget.description ? {} : { description: editDescription }) };
    if (Object.keys(changes).length === 0) { setEditDialog(false); setEditTarget(null); restoreFocus(); return; }
    const result = await operations.update({ projectId, resourceId: editTarget.resourceId, expectedRevision: editTarget.revision, ...changes });
    setFailure(result); if (result.type === "ok") { setEditDialog(false); setEditTarget(null); restoreFocus(); }
  };
  const submitMove = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (moveResourceTarget === null) return;
    const target = moveTarget.trim();
    if (target === moveResourceTarget.folder) { setMoveDialog(false); setMoveResourceTarget(null); restoreFocus(); return; }
    const result = await operations.update({ projectId, resourceId: moveResourceTarget.resourceId, expectedRevision: moveResourceTarget.revision, folder: target });
    setFailure(result); if (result.type === "ok") { setMoveDialog(false); setMoveResourceTarget(null); restoreFocus(); }
  };
  const submitMoveFolder = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (selectedDirectory === null) return;
    const target = moveTarget.trim();
    if (target === selectedDirectory) { setMoveDialog(false); return; }
    const result = await operations.organizeFolder({ projectId, path: selectedDirectory, targetPath: target });
    setFailure(result); if (result.type === "ok") { setMoveDialog(false); setSelectedDirectory(null); restoreFocus(); }
  };
  const deleteFolder = async (): Promise<void> => {
    if (deleteFolderDialog === null) return;
    const result = await operations.deleteFolder({ projectId, path: deleteFolderDialog.path, recursive: deleteFolderDialog.recursive });
    setFailure(result);
    if (result.type === "ok" && result.value.status === "confirmation-required") {
      setDeleteFolderDialog({ path: deleteFolderDialog.path, recursive: true });
    } else if (result.type === "ok") {
      setDeleteFolderDialog(null); setSelectedDirectory(null); restoreFocus();
    }
  };
  const deleteResource = async (): Promise<void> => {
    if (deleteTarget === null) return;
    const result = await operations.deleteResource({ projectId, resourceId: deleteTarget.resourceId, expectedRevision: deleteTarget.revision });
    setFailure(result); if (result.type === "ok") { setDeleteResourceDialog(false); setDeleteTarget(null); restoreFocus(); }
  };
  const replaceResource = async (): Promise<void> => {
    const target = selected === null ? null : snapshotResource(selected);
    if (target === null) return;
    setActionFailure(null);
    const source = await api.chooseReplacement();
    if (source.type === "failed") { setActionFailure(source.failure); return; }
    if (source.value === null) return;
    setFailure(await operations.replace({ projectId, resourceId: target.resourceId, expectedRevision: target.revision, sourcePath: source.value }));
  };

  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (dialog.current?.closest("[inert]") !== null) return;
      const nested = Array.from(dialog.current?.querySelectorAll("dialog[open]") ?? []);
      if (nested.length > 0) {
        event.preventDefault();
        nested.at(-1)?.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
        return;
      }
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function cancel(event: React.SyntheticEvent<HTMLDialogElement>): void {
    event.preventDefault();
    onClose();
  }

  return <dialog ref={dialog} open className={styles.library} aria-label="资料库" onCancel={cancel}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>PROJECT LIBRARY</span><h2>资料库</h2></div>
      <button ref={closeButton} type="button" className={styles.close} aria-label="关闭资料库" onClick={onClose}><Icon name="close" /></button>
    </header>
    <nav className={styles.breadcrumbs} aria-label="资料库路径">
      <button type="button" onClick={() => library.openDirectory(null)}>根目录</button>
      {(currentPath ?? "").split("/").filter(Boolean).map((part, index, parts) => {
        const path = parts.slice(0, index + 1).join("/");
        return <span key={path}><i>/</i><button type="button" onClick={() => library.openDirectory(path)}>{part}</button></span>;
      })}
    </nav>
    {library.status === "loading" && library.snapshot === null && <p className={styles.status} role="status">正在读取资料库……</p>}
    {library.failure !== null && <div className={styles.failure} role="alert"><span>{resourceFailureMessage(library.failure)}</span><button type="button" onClick={library.retry}>重试</button></div>}
    {actionFailure !== null && <div className={styles.failure} role="alert"><span>{resourceFailureMessage(actionFailure)}</span><button type="button" onClick={() => setActionFailure(null)}>知道了</button></div>}
    {library.snapshot !== null && <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <button type="button" onClick={library.goUp} disabled={currentPath === null}>返回上级</button>
          <button type="button" onClick={() => void importSources("files")} disabled={operations.busy}>导入文件</button>
          <button type="button" onClick={() => void importSources("directory")} disabled={operations.busy}>导入目录</button>
          <button type="button" onClick={() => { rememberFocus(); setFolderDialog(true); }} disabled={operations.busy}><Icon name="plus" />新建文件夹</button>
        </div>
        <span>{library.snapshot.directories.length} 个文件夹 · {library.snapshot.resources.length} 份资料</span>
      </div>
      <p className={styles.importHint}>文件放入资料库根目录；目录按其内部相对路径导入，导入后可移动。</p>
      {operations.operations.length > 0 && <OperationList operations={operations.operations} onCancel={operations.cancel} />}
      {library.snapshot.directories.length === 0 && library.snapshot.resources.length === 0
        ? <p className={styles.empty}>当前目录为空</p>
        : <div className={styles.content}>
          <div className={styles.items} aria-label="资料库内容">
            {library.snapshot.directories.map(directory => <div className={styles.directoryRow} key={directory.path}>
              <button type="button" className={`${styles.directory} ${selectedDirectory === directory.path ? styles.selected : ""}`} onClick={() => library.openDirectory(directory.path)}>
                <Icon name="folder" /><span>{directory.path.split("/").at(-1)}</span>{directory.explicit && <small>文件夹</small>}
              </button>
              <button type="button" className={styles.itemAction} aria-label={`操作文件夹 ${directory.path}`} onClick={() => { library.select(null); setSelectedDirectory(directory.path); }}>操作</button>
            </div>)}
            {library.snapshot.resources.map(resource => {
              const state = resourceStatus(resource);
              return <button type="button" className={`${styles.resource} ${selected?.resourceId === resource.resourceId ? styles.selected : ""}`} key={resource.resourceId} aria-pressed={selected?.resourceId === resource.resourceId} onClick={() => { setSelectedDirectory(null); library.select(resource.resourceId); }}>
                <span className={`${styles.dot} ${styles[state.tone]}`} /><span><strong>{resource.name}</strong><small>{resource.type} · {state.label}</small></span>
              </button>;
            })}
          </div>
          {selected !== null && <ResourceInfo item={selected} busy={operations.busy} onEdit={() => { rememberFocus(); setEditTarget(snapshotResource(selected)); setEditName(selected.name); setEditDescription(selected.description); setEditDialog(true); }} onMove={() => { rememberFocus(); setMoveResourceTarget(snapshotResource(selected)); setMoveTarget(resourceFolder(selected)); setMoveDialog(true); }} onReplace={() => void replaceResource()} onDelete={() => { rememberFocus(); setDeleteTarget(snapshotResource(selected)); setDeleteResourceDialog(true); }} />}
        </div>}
    </>}
    {selectedDirectory !== null && <div className={styles.directoryActions} role="group" aria-label={`文件夹操作 ${selectedDirectory}`}>
      <strong>{selectedDirectory}</strong>
      <button type="button" disabled={operations.busy} onClick={() => { rememberFocus(); setMoveTarget(selectedDirectory); setMoveDialog(true); }}>移动</button>
      <button type="button" disabled={operations.busy} onClick={() => { rememberFocus(); setDeleteFolderDialog({ path: selectedDirectory, recursive: false }); }}>删除</button>
      <button type="button" onClick={() => setSelectedDirectory(null)}>取消选择</button>
    </div>}
    <ActionDialog open={folderDialog} title="新建文件夹" value={folderName} label="文件夹名称" submitLabel="创建" onChange={setFolderName} onClose={() => { setFolderDialog(false); restoreFocus(); }} onSubmit={submitFolder} />
    {editTarget !== null && <ActionDialog open={editDialog} title="编辑资料信息" value={editName} secondaryValue={editDescription} label="资料名称" secondaryLabel="描述" submitLabel="保存" onChange={setEditName} onSecondaryChange={setEditDescription} onClose={() => { setEditDialog(false); setEditTarget(null); restoreFocus(); }} onSubmit={submitEdit} />}
    {moveResourceTarget !== null && <ActionDialog open={moveDialog && selectedDirectory === null} title="移动资料" value={moveTarget} label="目标文件夹（空白为根目录）" submitLabel="移动" onChange={setMoveTarget} onClose={() => { setMoveDialog(false); setMoveResourceTarget(null); restoreFocus(); }} onSubmit={submitMove} />}
    {selectedDirectory !== null && <ActionDialog open={moveDialog} title="移动文件夹" value={moveTarget} label="目标文件夹（空白为根目录）" submitLabel="移动" onChange={setMoveTarget} onClose={() => { setMoveDialog(false); restoreFocus(); }} onSubmit={submitMoveFolder} />}
    <ConfirmDialog open={deleteFolderDialog !== null} title={deleteFolderDialog?.recursive ? "确认递归删除" : "删除文件夹"} message={deleteFolderDialog?.recursive ? "文件夹中已有资料或子目录，确认递归删除？已成功删除的资料不会恢复。" : "先检查文件夹内容，非空目录会再次要求确认。"} confirmLabel={deleteFolderDialog?.recursive ? "确认删除" : "继续"} onClose={() => { setDeleteFolderDialog(null); restoreFocus(); }} onConfirm={() => void deleteFolder()} />
    <ConfirmDialog open={deleteResourceDialog} title="删除资料" message="确认删除当前资料？已删除资料不会恢复。" confirmLabel="确认删除" onClose={() => { setDeleteResourceDialog(false); setDeleteTarget(null); restoreFocus(); }} onConfirm={() => void deleteResource()} />
  </dialog>;
}

function OperationList({ operations, onCancel }: { readonly operations: readonly ResourceOperation[]; readonly onCancel: (id: string) => void }): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const latest = operations.at(-1);
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [latest?.id, latest?.status, latest?.items.length]);
  return <div ref={list} className={styles.operations} aria-label="资料操作进度">
    {operations.slice(-4).map(operation => <div className={styles.operation} key={operation.id}>
      <div className={styles.operationHeader}><strong>{operation.label}</strong><span>{operationLabel(operation)}</span>{(operation.status === "starting" || operation.status === "running") && operation.kind !== "folder-create" && operation.kind !== "folder-organize" && operation.kind !== "resource-update" && <button type="button" onClick={() => onCancel(operation.id)}>取消</button>}</div>
      {operation.items.length > 0 && <ul>{operation.items.map((item, index) => <li key={`${operation.id}-${index}`}><span>{item.relativePath}</span><small>{importItemLabel(item)}</small></li>)}</ul>}
      {operation.failure !== null && <p role="alert">{resourceFailureMessage(operation.failure)}</p>}
      {operation.deleteResult?.status === "partial" && <p role="alert">已删除 {operation.deleteResult.deleted.length} 项，{operation.deleteResult.failed.length} 项失败。</p>}
    </div>)}
  </div>;
}

function ResourceInfo({ item, busy, onEdit, onMove, onReplace, onDelete }: { readonly item: ResourceLibraryItemV1; readonly busy: boolean; readonly onEdit: () => void; readonly onMove: () => void; readonly onReplace: () => void; readonly onDelete: () => void }): React.JSX.Element {
  const state = resourceStatus(item);
  return <aside className={styles.info} aria-label={`资料信息：${item.name}`}>
    <span className={styles.eyebrow}>RESOURCE DETAILS</span><h3>{item.name}</h3>
    <dl>
      <dt>类型</dt><dd>{item.type}</dd>
      <dt>创建者</dt><dd>{ownerLabel(item)}</dd>
      <dt>位置</dt><dd>{item.libraryPath || "根目录"}</dd>
      <dt>版本</dt><dd>{item.revision}</dd>
      <dt>描述</dt><dd>{item.description || "暂无描述"}</dd>
      <dt>加入时间</dt><dd>{formatTime(item.createdAt)}</dd>
      <dt>更新时间</dt><dd>{formatTime(item.updatedAt)}</dd>
      <dt>正文状态</dt><dd><span className={`${styles.dot} ${styles[state.tone]}`} />{state.label}</dd>
      {item.content?.status === "failed" && <><dt>失败原因</dt><dd>{item.content.errorMessage ?? "正文处理失败"}</dd></>}
    </dl>
    <div className={styles.infoActions}>
      <button type="button" disabled={busy} onClick={onEdit}>编辑</button><button type="button" disabled={busy} onClick={onMove}>移动</button>
      <button type="button" disabled={busy} onClick={onReplace}>替换</button><button type="button" disabled={busy} onClick={onDelete}>删除</button>
    </div>
  </aside>;
}

function ActionDialog({ open, title, value, secondaryValue, label, secondaryLabel, submitLabel, onChange, onSecondaryChange, onClose, onSubmit }: {
  readonly open: boolean; readonly title: string; readonly value: string; readonly secondaryValue?: string; readonly label: string; readonly secondaryLabel?: string;
  readonly submitLabel: string; readonly onChange: (value: string) => void; readonly onSecondaryChange?: (value: string) => void; readonly onClose: () => void; readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}): React.JSX.Element | null {
  if (!open) return null;
  return <ModalDialog title={title} onClose={onClose}>
    <form method="dialog" onSubmit={onSubmit}><h3>{title}</h3><label>{label}<input autoFocus value={value} onChange={event => onChange(event.target.value)} /></label>
      {secondaryValue !== undefined && onSecondaryChange !== undefined && secondaryLabel !== undefined && <label>{secondaryLabel}<textarea value={secondaryValue} onChange={event => onSecondaryChange(event.target.value)} /></label>}
      <div><button type="button" onClick={onClose}>取消</button><button type="submit">{submitLabel}</button></div>
    </form>
  </ModalDialog>;
}

function ConfirmDialog({ open, title, message, confirmLabel, onClose, onConfirm }: { readonly open: boolean; readonly title: string; readonly message: string; readonly confirmLabel: string; readonly onClose: () => void; readonly onConfirm: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return <ModalDialog title={title} onClose={onClose}><form method="dialog" onSubmit={event => { event.preventDefault(); onConfirm(); }}><h3>{title}</h3><p>{message}</p><div><button type="button" onClick={onClose}>取消</button><button type="submit">{confirmLabel}</button></div></form></ModalDialog>;
}

function ModalDialog({ title, onClose, children }: { readonly title: string; readonly onClose: () => void; readonly children: React.ReactNode }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node !== null && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  return <dialog ref={dialog} className={styles.actionDialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}

function operationLabel(operation: ResourceOperation): string {
  return { starting: "准备中", running: "进行中", cancelling: "取消中", completed: "已完成", cancelled: "已取消", failed: "失败", partial: "部分完成", "confirmation-required": "等待确认" }[operation.status];
}

function importItemLabel(item: import("../../../../../rpc/resource.js").UserImportItemV1): string {
  if (item.status === "saved") {
    const contentLabel = item.contentStatus === null ? "状态待更新" : {
      pending: "等待处理", processing: "处理中", ready: "正文就绪", metadata_only: "仅元数据", failed: "处理失败",
    }[item.contentStatus];
    return `已保存 · ${contentLabel}`;
  }
  if (item.status === "failed") return `失败 · ${item.message}`;
  return "已取消";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
