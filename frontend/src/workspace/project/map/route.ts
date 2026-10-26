import * as THREE from "three";
import type { MapEdge } from "./model";

export function createRoutes(edges: readonly MapEdge[], anchors: ReadonlyMap<string, THREE.Vector3>): THREE.Group {
  const group = new THREE.Group();
  if (edges.length === 0) return group;
  const material = new THREE.MeshStandardMaterial({ color: "#d5b778", roughness: .8, emissive: "#5a4020", emissiveIntensity: .15 });
  edges.forEach(edge => {
    const start = anchors.get(edge.from);
    const end = anchors.get(edge.to);
    if (!start || !end) return;
    const direction = end.clone().sub(start).normalize();
    const from = start.clone().addScaledVector(direction, .8);
    const to = end.clone().addScaledVector(direction, -.8);
    const distance = from.distanceTo(to);
    const curve = new THREE.CubicBezierCurve3(from,
      from.clone().addScaledVector(direction, distance * .3).add(new THREE.Vector3(0, 1.1, 0)),
      to.clone().addScaledVector(direction, -distance * .3).add(new THREE.Vector3(0, 1.1, 0)), to);
    const track = new THREE.Mesh(new THREE.TubeGeometry(curve, 44, .075, 5, false), material);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.2, .48, 3), material);
    arrow.position.copy(curve.getPoint(.64));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(.64));
    group.add(track, arrow);
  });
  return group;
}
