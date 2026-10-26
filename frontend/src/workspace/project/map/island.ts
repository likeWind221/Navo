import * as THREE from "three";
import type { IslandModel } from "./model";
import { createRandom, hexPosition } from "./model";
import { createVegetation } from "./vegetation";

export interface IslandView {
  readonly group: THREE.Group;
  readonly surface: THREE.Group;
  readonly anchor: THREE.Vector3;
  readonly setState: (status: string, selected: boolean) => void;
}

export function createIsland(island: IslandModel): IslandView {
  const group = new THREE.Group();
  group.position.set(island.position.x, island.position.y, island.position.z);
  const surface = new THREE.Group();
  const random = createRandom(island.seed + 13);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  const body = new THREE.InstancedMesh(new THREE.CylinderGeometry(.68, .53, 1, 6), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }), island.tiles.length);
  island.tiles.forEach((tile, index) => {
    const position = hexPosition(tile);
    const distance = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r));
    const depth = 3.05 - distance * .43 + random() * .3;
    transform.position.set(position.x, tile.height - depth / 2, position.z);
    transform.scale.set(1, depth, 1);
    transform.updateMatrix();
    body.setMatrixAt(index, transform.matrix);
    body.setColorAt(index, color.set("#a48762").offsetHSL(0, 0, random() * .1 - .05));
  });
  body.castShadow = true;
  body.receiveShadow = true;
  surface.add(body);
  for (const kind of ["grass", "water", "stone"] as const) {
    const tiles = island.tiles.filter(tile => tile.kind === kind);
    if (tiles.length === 0) continue;
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(.665, .68, .12, 6), new THREE.MeshStandardMaterial({
      color: "#ffffff", roughness: kind === "water" ? .3 : 1, metalness: kind === "water" ? .08 : 0,
    }), tiles.length);
    tiles.forEach((tile, index) => {
      const position = hexPosition(tile);
      transform.position.set(position.x, tile.height + .055, position.z);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      caps.setMatrixAt(index, transform.matrix);
      color.set(kind === "grass" ? ["#8fb86b", "#9bc778", "#84af61"][index % 3]! : kind === "water" ? "#77c9d2" : "#b9b7a2");
      caps.setColorAt(index, color);
    });
    caps.castShadow = true;
    caps.receiveShadow = true;
    surface.add(caps);
  }
  group.add(surface, createVegetation(island.tiles, island.seed));
  addClouds(group, island.seed);
  const marker = new THREE.Group();
  marker.position.y = .43;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.56, .07, 10, 48), new THREE.MeshStandardMaterial({ color: "#fffbed", roughness: .7 }));
  ring.rotation.x = -Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.49, .49, .08, 48), new THREE.MeshStandardMaterial({ roughness: .8 }));
  marker.add(ring, disc);
  group.add(marker);
  return {
    group, surface, anchor: new THREE.Vector3(island.position.x, island.position.y + .43, island.position.z),
    setState: (status, selected) => {
      disc.material.color.set(status === "进行中" ? "#dc846e" : status === "已完成" ? "#4f8976" : status === "已跳过" ? "#a5aaa4" : "#8a9f91");
      ring.material.color.set(selected ? "#ffdab9" : "#fffbed");
      ring.scale.setScalar(selected ? 1.18 : 1);
    },
  };
}

function addClouds(group: THREE.Group, seed: number): void {
  const random = createRandom(seed + 37);
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({
    color: "#ffffff", transparent: true, opacity: .7, depthWrite: false,
  }), 7);
  const transform = new THREE.Object3D();
  for (let index = 0; index < 7; index++) {
    const angle = index * Math.PI * 2 / 7;
    transform.position.set(Math.cos(angle) * 2.2, -3.2 - random() * .4, Math.sin(angle) * 2.1);
    transform.scale.set(1.3 + random() * .7, .45 + random() * .3, 1 + random() * .5);
    transform.updateMatrix();
    clouds.setMatrixAt(index, transform.matrix);
  }
  group.add(clouds);
}
