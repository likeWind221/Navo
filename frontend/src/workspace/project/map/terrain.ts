import * as THREE from "three";
import { createVegetation } from "./vegetation";

export function createTerrain(): THREE.Group {
  const world = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(34, 28, 200, 164);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const height = elevation(x, z);
    positions.setY(index, height);
    const variation = Math.sin(x * 2.1 + z * 1.7) * .025;
    if (height < .16) color.set("#c6ccb0");
    else if (height > 4.6) color.set("#f1eee3");
    else if (height > 3) color.set("#a2a794").lerp(new THREE.Color("#dfdfcf"), (height - 3) / 2.8);
    else color.set("#70a257").lerp(new THREE.Color("#48764e"), Math.min(1, height / 2.5));
    color.offsetHSL(0, variation, variation);
    color.toArray(colors, index * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }));
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  world.add(terrain);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({
    color: "#55b8c1", roughness: .32, metalness: .12,
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = .07;
  water.receiveShadow = true;
  world.add(water);
  const ripples = new THREE.MeshBasicMaterial({ color: "#b9e8da", transparent: true, opacity: .55 });
  for (let index = 0; index < 16; index++) {
    const z = index * 1.3 - 10;
    const points = Array.from({ length: 12 }, (_, step) => {
      const depth = z + step * .045;
      return new THREE.Vector3(riverCenter(depth) + Math.sin(index * 2.4) * .32, .085, depth);
    });
    world.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, .018, 4, false), ripples));
  }
  world.add(createVegetation(elevation));
  addRocks(world);
  addBridge(world, 1.1);
  addBridge(world, -5.2);
  return world;
}

export function elevation(x: number, z: number): number {
  const boundary = Math.sqrt((x / 16) ** 2 + (z / 12.8) ** 2) + .035 * Math.sin(x * .8 + z * .5);
  const coast = THREE.MathUtils.smoothstep(boundary, .79, 1);
  const meadow = .48 + .18 * Math.sin(x * .5) * Math.cos(z * .48);
  const peaks = peak(x, z, -3, -7.3, 5.2, 2.5) + peak(x, z, 3.2, -8, 4.7, 2.2)
    + peak(x, z, -10.3, -3.3, 2.7, 2.6) + peak(x, z, 10, -4, 2.1, 2.7);
  const detail = .13 * Math.sin(x * 2.4 + z * .8) * Math.sin(z * 1.8) * Math.min(1, peaks);
  const land = meadow + peaks + detail;
  const channel = 1 - THREE.MathUtils.smoothstep(Math.abs(x - riverCenter(z)), .62, 1.18);
  return THREE.MathUtils.lerp(land * (1 - channel) - .21 * channel, -.45, coast);
}

function peak(x: number, z: number, cx: number, cz: number, height: number, width: number): number {
  const distance = Math.hypot(x - cx, z - cz) / width;
  return height * Math.exp(-Math.pow(distance, 1.35) * 1.15) * (1 + .12 * Math.sin(x * 3 + z * 2));
}

function riverCenter(z: number): number {
  return 2.6 * Math.sin(z * .27) + 1.5;
}

function addRocks(world: THREE.Group): void {
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: "#b6b9a6", roughness: 1, flatShading: true }), 85);
  const transform = new THREE.Object3D();
  for (let index = 0; index < 85; index++) {
    const z = Math.sin(index * 5.9) * 10.6;
    const x = riverCenter(z) + (index % 2 ? 1 : -1) * (1.3 + (index % 5) * .18);
    transform.position.set(x, Math.max(.04, elevation(x, z)) + .04, z);
    transform.scale.set(.16 + (index % 3) * .09, .18 + (index % 4) * .08, .2);
    transform.rotation.set(index, index * .7, index * .3);
    transform.updateMatrix();
    rocks.setMatrixAt(index, transform.matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  world.add(rocks);
}

function addBridge(world: THREE.Group, z: number): void {
  const center = riverCenter(z);
  const material = new THREE.MeshStandardMaterial({ color: "#c6b798", roughness: .95 });
  const bridge = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, .14, .72), material);
  deck.position.set(center, .67, z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, .07, .08), material);
    rail.position.set(center, 1.04, z + side * .32);
    rail.castShadow = true;
    bridge.add(rail);
    for (let post = 0; post < 7; post++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.065, .4, .065), material);
      mesh.position.set(center - 1.7 + post * .57, .84, z + side * .32);
      mesh.castShadow = true;
      bridge.add(mesh);
    }
  }
  world.add(bridge);
}
