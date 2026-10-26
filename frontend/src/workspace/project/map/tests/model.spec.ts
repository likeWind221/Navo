import { describe, expect, it } from "vitest";
import { layoutIslands } from "../model";
import type { MapGraph, MapNode } from "../model";

const node = (id: string): MapNode => ({ id, title: id, note: "任务", status: "待解锁" });
const graph = (ids: readonly string[]): MapGraph => ({ nodes: ids.map(node), edges: [] });

describe("floating island generation", () => {
  it("creates one connected hex island per node and no islands for an empty roadmap", () => {
    expect(layoutIslands(graph([]), new Map()).size).toBe(0);
    const islands = layoutIslands(graph(["a", "b", "c"]), new Map());
    expect(islands.size).toBe(3);
    for (const island of islands.values()) {
      const cells = new Set(island.tiles.map(tile => `${tile.q},${tile.r}`));
      const visited = new Set(["0,0"]);
      const queue = [{ q: 0, r: 0 }];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]) {
          const next = { q: current.q + dq!, r: current.r + dr! };
          const key = `${next.q},${next.r}`;
          if (cells.has(key) && !visited.has(key)) { visited.add(key); queue.push(next); }
        }
      }
      expect(visited.size).toBe(island.tiles.length);
      expect(island.tiles.every(tile => Number.isFinite(tile.height))).toBe(true);
    }
  });

  it("keeps terrain reproducible across reloads and node ordering", () => {
    const first = layoutIslands(graph(["alpha", "beta", "gamma"]), new Map());
    const second = layoutIslands(graph(["gamma", "alpha", "beta"]), new Map());
    for (const [id, island] of first) {
      expect(second.get(id)?.tiles).toEqual(island.tiles);
      expect(second.get(id)?.position).toEqual(island.position);
    }
    expect(first.get("alpha")?.tiles).not.toEqual(first.get("beta")?.tiles);
  });

  it("preserves existing positions and terrain when a dependent node is added", () => {
    const first = layoutIslands(graph(["parent"]), new Map());
    const next = layoutIslands({ nodes: [node("parent"), node("child")], edges: [{ from: "parent", to: "child" }] }, first);
    expect(next.get("parent")?.position).toEqual(first.get("parent")?.position);
    expect(next.get("parent")?.tiles).toBe(first.get("parent")?.tiles);
    const parent = next.get("parent")!.position;
    const child = next.get("child")!.position;
    expect(Math.hypot(parent.x - child.x, parent.z - child.z)).toBeCloseTo(11);
  });

  it("removes only the deleted island and updates metadata without replacing terrain", () => {
    const first = layoutIslands(graph(["a", "b", "c"]), new Map());
    const next = layoutIslands({ nodes: [{ ...node("a"), title: "新标题", status: "进行中" }, node("c")], edges: [] }, first);
    expect(next.has("b")).toBe(false);
    expect(next.get("a")?.node.title).toBe("新标题");
    expect(next.get("a")?.tiles).toBe(first.get("a")?.tiles);
    expect(next.get("c")?.position).toEqual(first.get("c")?.position);
  });

  it("adds many nodes without overlapping islands or moving existing ones", () => {
    let islands = layoutIslands(graph([]), new Map());
    for (let count = 1; count <= 36; count++) {
      const previous = islands;
      islands = layoutIslands(graph(Array.from({ length: count }, (_, index) => `node-${index}`)), previous);
      for (const [id, island] of previous) expect(islands.get(id)?.position).toEqual(island.position);
      const positions = Array.from(islands.values(), island => island.position);
      for (let left = 0; left < positions.length; left++) {
        for (let right = left + 1; right < positions.length; right++) {
          expect(Math.hypot(positions[left]!.x - positions[right]!.x, positions[left]!.z - positions[right]!.z)).toBeGreaterThan(10.9);
        }
      }
    }
  });
});
