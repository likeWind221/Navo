import { useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/Icon";
import type { WorkspaceNode } from "./Workspace";
import type { MapScene } from "./map/scene";
import styles from "./map/style.module.css";

export function RoadmapMap({ nodes, active, planned, onOpen, children }: {
  readonly nodes: readonly WorkspaceNode[];
  readonly active: string;
  readonly planned: boolean;
  readonly onOpen: (id: string) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<MapScene | null>(null);
  const selected = useRef(active);
  const [failure, setFailure] = useState<string | null>(null);
  selected.current = active;

  useEffect(() => {
    let disposed = false;
    setFailure(null);
    delete viewport.current!.dataset.ready;
    void import("./map/scene").then(({ createMapScene }) => {
      if (disposed) return;
      scene.current = createMapScene(viewport.current!, labels.current!, planned ? nodes : []);
      scene.current.select(selected.current);
    }).catch(error => { if (!disposed) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [nodes, planned]);

  useEffect(() => { scene.current?.select(active); }, [active, planned, nodes]);

  return <section className={styles.mapArea} aria-label="路线地图">
    <div ref={viewport} className={styles.viewport} data-testid="roadmap" tabIndex={0}
      aria-label="三维地图：左键旋转，滚轮缩放，右键平移，方向键平移" />
    <div ref={labels} className={styles.labels}>
      {planned && nodes.map((item, index) => <button key={item.id} data-node-id={item.id} data-testid={`node-${item.id}`} className={styles.node}
        data-selected={active === item.id} data-status={item.status} aria-pressed={active === item.id}
        title={`${item.title} · ${item.status}\n${item.note}`} onClick={() => onOpen(item.id)}>
        <span className={styles.marker}>{item.status === "已完成" ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}</span>
        <span className={styles.label}>{item.title}<small>{item.status}</small></span>
      </button>)}
    </div>
    {!planned && <div className={styles.empty}>{children}</div>}
    {failure !== null && <div className={styles.failure} role="alert">三维地图无法启动：{failure}</div>}
    <div className={styles.controls} aria-label="地图视图控制">
      <button aria-label="放大地图" disabled={failure !== null} onClick={() => scene.current?.zoom(1.2)}><Icon name="plus" /></button>
      <button aria-label="缩小地图" disabled={failure !== null} onClick={() => scene.current?.zoom(1 / 1.2)}><Icon name="minus" /></button>
      <button aria-label="回到工作节点" title="回到工作节点" disabled={failure !== null} onClick={() => scene.current?.recenter()}><Icon name="target" /></button>
    </div>
    {planned && <div className={styles.legend} aria-label="节点状态图例">
      <span><i data-state="done" />已完成</span><span><i data-state="active" />进行中</span><span><i />待开始</span>
    </div>}
    <div className={styles.compass} aria-hidden="true"><small>3D</small><Icon name="guide" /></div>
  </section>;
}
