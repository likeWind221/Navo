import * as THREE from "three";

type Tree = { x: number; z: number; y: number; scale: number };

export function createVegetation(heightAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const pines: Tree[] = [];
  const crowns: Tree[] = [];
  const grass: Tree[] = [];
  let seed = 2026;
  const sample = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < 5200; index++) {
    const x = sample() * 30 - 15;
    const z = sample() * 24 - 12;
    const y = heightAt(x, z);
    if (y < .24 || y > 3.05) continue;
    const grove = Math.sin(x * .7 + z * .3) + Math.cos(z * .8);
    const tree = { x, z, y, scale: .65 + sample() * .65 };
    if (index > 1300 || grove < .1 || (z > -3 && z < 5.6 && x > -11.4 && x < 11.6 && sample() > .16)) {
      if (index % 2) grass.push({ ...tree, scale: .55 + sample() * .6 });
    } else if (index % 3 === 0) crowns.push(tree);
    else pines.push(tree);
  }
  addPines(group, pines);
  addCrowns(group, crowns);
  addGrass(group, grass);
  return group;
}

function addPines(group: THREE.Group, trees: readonly Tree[]): void {
  const material = new THREE.MeshToonMaterial({ color: "#ffffff" });
  const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(.36, 1, 8), material, trees.length * 3);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  trees.forEach((tree, index) => {
    for (let layer = 0; layer < 3; layer++) {
      const size = tree.scale * (1 - layer * .22);
      transform.position.set(tree.x, tree.y + tree.scale * (.52 + layer * .27), tree.z);
      transform.scale.set(size, tree.scale * .78, size);
      transform.rotation.y = index * 2.4;
      transform.updateMatrix();
      foliage.setMatrixAt(index * 3 + layer, transform.matrix);
      foliage.setColorAt(index * 3 + layer, color.set(["#356d45", "#42834e", "#669c58"][layer]!));
    }
  });
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  group.add(foliage, trunks(trees));
}

function addCrowns(group: THREE.Group, trees: readonly Tree[]): void {
  const foliage = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.6, 1), new THREE.MeshToonMaterial({ color: "#ffffff" }), trees.length * 3);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  trees.forEach((tree, index) => {
    for (let layer = 0; layer < 3; layer++) {
      transform.position.set(tree.x + Math.sin(layer * 2.4) * .24 * tree.scale, tree.y + (1.03 + layer * .15) * tree.scale, tree.z + Math.cos(layer * 2.4) * .22 * tree.scale);
      transform.scale.set(tree.scale * .8, tree.scale * .77, tree.scale * .8);
      transform.rotation.set(index * .7, index * 2.4, layer * .5);
      transform.updateMatrix();
      foliage.setMatrixAt(index * 3 + layer, transform.matrix);
      foliage.setColorAt(index * 3 + layer, color.set(["#44864b", "#71a653", "#62984c"][layer]!));
    }
  });
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  group.add(foliage, trunks(trees));
}

function trunks(trees: readonly Tree[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.045, .085, .72, 6), new THREE.MeshToonMaterial({ color: "#7e7852" }), trees.length);
  const transform = new THREE.Object3D();
  trees.forEach((tree, index) => {
    transform.position.set(tree.x, tree.y + tree.scale * .34, tree.z);
    transform.scale.setScalar(tree.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.castShadow = true;
  return mesh;
}

function addGrass(group: THREE.Group, grass: readonly Tree[]): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -.07, 0, 0, .035, .32, .06, .035, 0, 0,
    0, 0, -.055, .055, .25, -.025, 0, 0, .055,
    -.04, 0, -.03, -.095, .22, .025, .04, 0, .03,
  ], 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshToonMaterial({ color: "#78a653", side: THREE.DoubleSide }), grass.length);
  const transform = new THREE.Object3D();
  grass.forEach((blade, index) => {
    transform.position.set(blade.x, blade.y, blade.z);
    transform.rotation.y = index * 2.4;
    transform.scale.setScalar(blade.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  group.add(mesh);
}
