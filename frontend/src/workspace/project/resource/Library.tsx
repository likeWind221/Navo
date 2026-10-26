import { useEffect, useRef } from "react";
import type { DesktopResourceApi } from "../../../../shared/resource.js";
import { Icon } from "../../../ui/Icon.js";
import { ownerLabel, resourceStatus } from "./model.js";
import { useResourceLibrary } from "./hook.js";
import { resourceFailureMessage } from "./failure.js";
import styles from "./style.module.css";

export function ResourceLibrary({ api, projectId, onClose }: {
  readonly api: DesktopResourceApi;
  readonly projectId: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const library = useResourceLibrary(api, projectId);
  const currentPath = library.path;
  const selected = library.selected;

  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (dialog.current?.closest("[inert]") !== null) return;
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

  return <dialog ref={dialog} open className={styles.library} aria-label="资料库" onCancel={cancel} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }}>
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
    {library.snapshot !== null && <>
      <div className={styles.toolbar}>
        <button type="button" onClick={library.goUp} disabled={currentPath === null}>返回上级</button>
        <span>{library.snapshot.directories.length} 个文件夹 · {library.snapshot.resources.length} 份资料</span>
      </div>
      {library.snapshot.directories.length === 0 && library.snapshot.resources.length === 0
        ? <p className={styles.empty}>当前目录为空</p>
        : <div className={styles.content}>
          <div className={styles.items} aria-label="资料库内容">
            {library.snapshot.directories.map(directory => <button type="button" className={styles.directory} key={directory.path} onClick={() => library.openDirectory(directory.path)}>
                <Icon name="folder" /><span>{directory.path.split("/").at(-1)}</span>{directory.explicit && <small>文件夹</small>}
            </button>)}
            {library.snapshot.resources.map(resource => {
              const state = resourceStatus(resource);
              return <button type="button" className={`${styles.resource} ${selected?.resourceId === resource.resourceId ? styles.selected : ""}`} key={resource.resourceId} aria-pressed={selected?.resourceId === resource.resourceId} onClick={() => library.select(resource.resourceId)}>
                <span className={`${styles.dot} ${styles[state.tone]}`} /><span><strong>{resource.name}</strong><small>{resource.type} · {state.label}</small></span>
              </button>;
            })}
          </div>
          {selected !== null && <ResourceInfo item={selected} />}
        </div>}
    </>}
  </dialog>;
}

function ResourceInfo({ item }: { readonly item: import("../../../../../rpc/resource.js").ResourceLibraryItemV1 }): React.JSX.Element {
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
  </aside>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
