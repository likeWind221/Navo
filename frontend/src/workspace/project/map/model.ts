export interface MapGraph {
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
}

export interface IslandModel {
  readonly node: MapNode;
  readonly seed: number;
  readonly slot: Hex;
  readonly tiles: readonly HexTile[];
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

export interface MapNode {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly status: string;
}

export interface MapEdge {
  readonly from: string;
  readonly to: string;
}

export interface HexTile extends Hex {
  readonly height: number;
  readonly kind: "grass" | "water" | "stone";
}

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export function layoutIslands(graph: MapGraph, previous: ReadonlyMap<string, IslandModel>): ReadonlyMap<string, IslandModel> {
  const islands = new Map<string, IslandModel>();
  graph.nodes.forEach(node => {
    const retained = previous.get(node.id);
    if (retained) islands.set(node.id, { ...retained, node });
  });
  const occupied = new Set(Array.from(islands.values(), island => key(island.slot)));
  const pending = graph.nodes.filter(node => !islands.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
  pending.forEach(node => {
    const seed = seedFor(node.id);
    const parents = graph.edges.filter(edge => edge.to === node.id).flatMap(edge => {
      const parent = islands.get(edge.from);
      return parent ? [parent.slot] : [];
    });
    const origin = parents.length === 0 ? { q: 0, r: 0 } : {
      q: Math.round(parents.reduce((sum, parent) => sum + parent.q, 0) / parents.length),
      r: Math.round(parents.reduce((sum, parent) => sum + parent.r, 0) / parents.length),
    };
    const slot = freeSlot(origin, occupied, seed);
    occupied.add(key(slot));
    islands.set(node.id, {
      node, seed, slot, tiles: generateTiles(seed),
      position: { x: 11 * (slot.q + slot.r / 2), y: (seed % 4) * .3, z: 11 * Math.sqrt(3) / 2 * slot.r },
    });
  });
  return islands;
}

export function hexPosition(hex: Hex): { x: number; z: number } {
  return { x: .68 * Math.sqrt(3) * (hex.q + hex.r / 2), z: .68 * 1.5 * hex.r };
}

export function createRandom(seed: number): () => number {
  let value = seed;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

function seedFor(id: string): number {
  let seed = 17;
  for (let index = 0; index < id.length; index++) seed = (Math.imul(seed, 31) + id.charCodeAt(index)) >>> 0;
  return seed;
}

function generateTiles(seed: number): readonly HexTile[] {
  const random = createRandom(seed);
  const tiles: HexTile[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const distance = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (distance > 3 || (distance === 3 && random() < .42)) continue;
      const meadow = distance <= 1;
      const pond = !meadow && q === (seed % 2 ? 1 : -1) && r === (seed % 2 ? 1 : -1);
      const stone = !meadow && !pond && seed % 3 === 0 && q > 1 && r < 1;
      tiles.push({
        q, r, kind: pond ? "water" : stone ? "stone" : "grass",
        height: meadow ? .18 : pond ? .09 : .18 + Math.floor(random() * (stone ? 7 : 3)) * .13,
      });
    }
  }
  return tiles;
}

function freeSlot(origin: Hex, occupied: ReadonlySet<string>, seed: number): Hex {
  for (let radius = 0; ; radius++) {
    const ring: Hex[] = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === radius) ring.push({ q: q + origin.q, r: r + origin.r });
      }
    }
    for (let index = 0; index < ring.length; index++) {
      const candidate = ring[(index + seed) % ring.length]!;
      if (!occupied.has(key(candidate))) return candidate;
    }
  }
}

function key(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}
