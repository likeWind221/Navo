import * as THREE from "three";
import type { WorkspaceNode } from "../Workspace";
import { elevation } from "./terrain";

export function createRoute(nodes: readonly WorkspaceNode[]): {
  group: THREE.Group;
  anchors: ReadonlyMap<string, THREE.Vector3>;
  select: (id: string) => void;
} {
  const group = new THREE.Group();
  const anchors = new Map<string, THREE.Vector3>();
  const rings = new Map<string, THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>>();
  nodes.forEach(node => {
    const x = (node.x + 110 - 630) / 42;
    const z = (node.y + 280 - 450) / 35;
    const anchor = new THREE.Vector3(x, Math.max(elevation(x, z), .1) + .18, z);
    anchors.set(node.id, anchor);
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.56, .075, 10, 48), new THREE.MeshStandardMaterial({ color: "#fffbed", roughness: .7 }));
    ring.rotation.x = -Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(.49, .49, .09, 48), new THREE.MeshStandardMaterial({
      color: node.status === "进行中" ? "#dc846e" : node.status === "已完成" ? "#4f8976" : "#8a9f91", roughness: .85,
    }));
    marker.add(ring, disc);
    marker.position.copy(anchor);
    marker.castShadow = true;
    group.add(marker);
    rings.set(node.id, ring);
  });
  const links = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]];
  const material = new THREE.MeshStandardMaterial({ color: "#fff4cb", roughness: .8 });
  links.forEach(([from, to]) => {
    const start = anchors.get(nodes[from!]?.id ?? "");
    const end = anchors.get(nodes[to!]?.id ?? "");
    if (!start || !end) return;
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 48; index++) {
      const t = index / 48;
      const x = THREE.MathUtils.lerp(start.x, end.x, t);
      const z = THREE.MathUtils.lerp(start.z, end.z, t * t * (3 - 2 * t));
      points.push(new THREE.Vector3(x, Math.max(.12, elevation(x, z)) + .1, z));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const track = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, .06, 6, false), material);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.15, .4, 3), material);
    arrow.position.copy(curve.getPoint(.68));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(.68));
    group.add(track, arrow);
  });
  return { group, anchors, select: id => {
    rings.forEach((ring, nodeId) => {
      ring.material.color.set(nodeId === id ? "#ffdebc" : "#fffbed");
      ring.scale.setScalar(nodeId === id ? 1.16 : 1);
    });
  } };
}
