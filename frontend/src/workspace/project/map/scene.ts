import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WorkspaceNode } from "../Workspace";
import { createTerrain } from "./terrain";
import { createRoute } from "./route";

export interface MapScene {
  zoom: (factor: number) => void;
  recenter: () => void;
  select: (id: string) => void;
  dispose: () => void;
}

export function createMapScene(container: HTMLDivElement, labels: HTMLDivElement, nodes: readonly WorkspaceNode[]): MapScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-label", "可旋转的三维山川沙盘");
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e7eee7");
  scene.fog = new THREE.Fog("#e7eee7", 52, 100);
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 150);
  const offset = new THREE.Vector3(22, 24, 30);
  const initialTarget = new THREE.Vector3(0, .5, -1);
  camera.position.copy(initialTarget).add(offset);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(initialTarget);
  controls.minPolarAngle = .25;
  controls.maxPolarAngle = 1.2;
  controls.minZoom = .65;
  controls.maxZoom = 2.4;
  controls.enableDamping = false;
  controls.listenToKeyEvents(container);
  controls.update();
  scene.add(new THREE.HemisphereLight("#f6fbef", "#6a8475", 1.8));
  const sunlight = new THREE.DirectionalLight("#fff1d9", 2.6);
  sunlight.position.set(-12, 28, 16);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -24;
  sunlight.shadow.camera.right = 24;
  sunlight.shadow.camera.top = 24;
  sunlight.shadow.camera.bottom = -24;
  sunlight.shadow.normalBias = .035;
  sunlight.shadow.bias = -.0002;
  scene.add(sunlight);
  const terrain = createTerrain();
  const route = createRoute(nodes);
  scene.add(terrain, route.group);
  const projected = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let selected = "main";
  let width = 0;
  let height = 0;

  function draw(): void {
    renderer.render(scene, camera);
    route.anchors.forEach((point, id) => {
      const button = labels.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
      projected.copy(point).add(new THREE.Vector3(0, .14, 0)).project(camera);
      let visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
      if (visible) {
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const hit = raycaster.intersectObject(terrain.children[0]!, false)[0];
        visible = !hit || hit.distance + .5 >= raycaster.ray.origin.distanceTo(point);
      }
      button.hidden = !visible;
      button.style.transform = `translate(-50%, -50%) translate(${(projected.x + 1) * width / 2}px, ${(1 - projected.y) * height / 2}px)`;
    });
    container.dataset.ready = "true";
  }

  function resize(): void {
    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    width = bounds.width;
    height = bounds.height;
    const halfHeight = Math.max(13, 16.5 * height / width);
    camera.left = -halfHeight * width / height;
    camera.right = halfHeight * width / height;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    draw();
  }

  controls.addEventListener("change", draw);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  return {
    zoom: factor => {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
      draw();
    },
    recenter: () => {
      const current = nodes.find(node => node.status === "进行中");
      const target = route.anchors.get(selected) ?? (current ? route.anchors.get(current.id) : undefined) ?? initialTarget;
      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
      draw();
    },
    select: id => { selected = id; route.select(id); draw(); },
    dispose: () => {
      observer.disconnect();
      controls.removeEventListener("change", draw);
      controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object instanceof THREE.InstancedMesh) object.dispose();
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      sunlight.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
