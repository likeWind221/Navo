import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import styles from "./navigation/style.module.css";

export type WorkspaceEntry = { id: string; title: string; kind: "project" | "session"; content: ReactNode };

export function WorkspaceShell({ children, entries }: {
  children?: ReactNode;
  entries?: WorkspaceEntry[];
}): React.JSX.Element {
  const items = entries ?? [{ id: "current", title: "当前会话", kind: "session", content: children }];
  const [opened, setOpened] = useState<string[]>(() => items.slice(0, 1).map(item => item.id));
  const [active, setActive] = useState<string | null>(() => items[0]?.id ?? null);
  const [section, setSection] = useState<"project" | "session">("session");
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 600px)").matches);
  const prefix = useId();

  function open(id: string): void {
    setOpened(previous => previous.includes(id) ? previous : [...previous, id]);
    setActive(id);
    if (window.matchMedia("(max-width: 600px)").matches) setExpanded(false);
  }

  function close(id: string): void {
    const index = opened.indexOf(id);
    const next = opened.filter(value => value !== id);
    setOpened(next);
    if (active === id) setActive(next[Math.min(index, next.length - 1)] ?? null);
  }

  return <div className={styles.shell}>
    <header className={styles.header}>
      <button className={styles.brandButton} aria-label={expanded ? "收起侧栏" : "展开侧栏"} aria-expanded={expanded} aria-controls={`${prefix}-sidebar`} onClick={() => setExpanded(!expanded)}>
        <span className={styles.brand}>NAVO<span>.</span></span>
        <span className={styles.sidebarIcon} data-open={expanded}><Icon name="sidebar" /></span>
      </button>
      <nav className={styles.tabs} aria-label="已打开的标签页">
        {opened.map(id => {
          const item = items.find(entry => entry.id === id);
          return item && <div key={id} className={styles.tab} data-active={active === id}>
            <button aria-current={active === id ? "page" : undefined} aria-controls={`${prefix}-${id}`} onClick={() => setActive(id)} title={item.title}>
              <EntryIcon kind={item.kind} /><span>{item.title}</span>
            </button>
            <button aria-label={`关闭 ${item.title}`} onClick={() => close(id)}><Icon name="close" /></button>
          </div>;
        })}
      </nav>
    </header>
    <div className={styles.body}>
      <aside id={`${prefix}-sidebar`} className={styles.sidebar} data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className={styles.inner}>
          <div className={styles.switch} data-section={section} aria-label="侧栏视图">
            <button aria-pressed={section === "project"} onClick={() => setSection("project")}>项目</button>
            <button aria-pressed={section === "session"} onClick={() => setSection("session")}>会话</button>
          </div>
          <button className={styles.create} disabled title="将在后续项目与会话接入中开放"><Icon name="plus" /><span key={section}>新增{section === "project" ? "项目" : "会话"}</span></button>
          <nav key={section} className={styles.list} aria-label={section === "project" ? "项目列表" : "会话列表"}>
            {items.filter(item => item.kind === section).map(item => <button key={item.id} className={styles.entry} title={item.title} aria-current={active === item.id ? "page" : undefined} onClick={() => open(item.id)}><EntryIcon kind={item.kind} /><span>{item.title}</span></button>)}
            {!items.some(item => item.kind === section) && <p className={styles.empty}>暂无{section === "project" ? "项目" : "会话"}</p>}
          </nav>
          <button className={styles.settings} disabled title="设置功能尚未接入"><Icon name="settings" />设置</button>
        </div>
      </aside>
      <main className={styles.main}>
        {items.map(item => <section key={item.id} id={`${prefix}-${item.id}`} className={styles.panel} data-active={active === item.id} aria-label={item.title} aria-hidden={active !== item.id} inert={active !== item.id}>{item.content}</section>)}
        {active === null && <div className={styles.placeholder}>从侧栏打开一个项目或会话</div>}
      </main>
    </div>
  </div>;
}

function EntryIcon({ kind }: { kind: WorkspaceEntry["kind"] }): React.JSX.Element {
  return <Icon name={kind === "project" ? "folder" : "chat"} />;
}
