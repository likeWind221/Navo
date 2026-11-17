import { useEffect, useRef, useState } from "react";
import type { DesktopProjectFailure } from "../../../shared/project.js";
import { stateSymbols } from "./map/model";
import { Icon } from "../../ui/Icon";
import type { MapGraph } from "./map/model";
import type { MapScene } from "./map/scene";
import styles from "./map/style.module.css";

const emptyGraph: MapGraph = { nodes: [], edges: [] };

export function RoadmapMap({ graph, active, planned, onOpen, children, failure: followFailure, onReconnect }: {
  readonly graph: MapGraph;
  readonly active: string;
  readonly planned: boolean;
  readonly onOpen: (id: string) => void;
  readonly failure?: DesktopProjectFailure | null;
  readonly onReconnect?: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<MapScene | null>(null);
  const latest = useRef({ graph, active, planned });
  const [failure, setFailure] = useState<string | null>(null);
  latest.current = { graph, active, planned };

  useEffect(() => {
    let disposed = false;
    void import("./map/scene").then(({ createMapScene }) => {
      if (disposed) return;
      scene.current = createMapScene(viewport.current!, labels.current!);
      scene.current.update(latest.current.planned ? latest.current.graph : emptyGraph);
      scene.current.select(latest.current.active);
    }).catch(error => { if (!disposed) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => { scene.current?.update(planned ? graph : emptyGraph); }, [graph, planned]);
  useEffect(() => { scene.current?.select(active); }, [active]);

  return <section className={styles.mapArea} aria-label="六边形浮空岛路线地图">
    <div ref={viewport} className={styles.viewport} data-testid="roadmap" tabIndex={0}
      aria-label="三维地图：左键旋转，滚轮缩放，右键平移，方向键平移" />
    <div ref={labels} className={styles.labels}>
      {planned && graph.nodes.map((item, index) => <button key={item.id} data-node-id={item.id} data-testid={`node-${item.id}`} className={styles.node}
        hidden data-selected={active === item.id} data-status={item.status} aria-pressed={active === item.id}
        aria-label={`${item.title}，${item.status}，${item.requirement === "optional" ? "可选" : "必选"}`} title={`${item.title} · ${item.status}\n${item.note}`} onClick={() => onOpen(item.id)}>
        <span className={styles.marker}>{item.status === "已完成" ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}</span>
        <span className={styles.label}>{item.requirement === "optional" && <em>可选</em>}{item.title}<small>{stateSymbols[item.status]} {item.status}</small></span>
      </button>)}
    </div>
    {followFailure && <div className={styles.disconnected} role="alert"><div><strong>路线更新已中断</strong><span>正在显示上次同步的路线，状态可能已变化。</span></div><button onClick={onReconnect}>重新连接</button></div>}
    {!planned && <div className={styles.empty}>{children}</div>}
    {failure !== null && <div className={styles.failure} role="alert">三维地图无法启动：{failure}</div>}
    <div className={styles.controls} aria-label="地图视图控制">
      <button aria-label="放大地图" disabled={failure !== null} onClick={() => scene.current?.zoom(1.2)}><Icon name="plus" /></button>
      <button aria-label="缩小地图" disabled={failure !== null} onClick={() => scene.current?.zoom(1 / 1.2)}><Icon name="minus" /></button>
      <button aria-label="适应全部岛屿" title="适应全部岛屿" disabled={failure !== null} onClick={() => scene.current?.fit()}><Icon name="maximize" /></button>
      <button aria-label="回到工作节点" title="回到工作节点" disabled={failure !== null} onClick={() => scene.current?.recenter()}><Icon name="target" /></button>
    </div>
    {planned && <div className={styles.legend} aria-label="节点状态图例">
      {Object.entries(stateSymbols).map(([status, symbol]) => <span key={status} data-status={status}>{symbol} {status}</span>)}
    </div>}
    <div className={styles.compass} aria-hidden="true"><small>SKY ISLANDS</small><Icon name="guide" /></div>
  </section>;
}
