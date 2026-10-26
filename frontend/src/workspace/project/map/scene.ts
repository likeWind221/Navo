import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createIsland } from "./island";
import type { IslandView } from "./island";
import { layoutIslands } from "./model";
import type { IslandModel, MapGraph } from "./model";
import { createRoutes } from "./route";

export interface MapScene {
  update: (graph: MapGraph) => void;
  zoom: (factor: number) => void;
  recenter: () => void;
  fit: () => void;
  select: (id: string) => void;
  dispose: () => void;
}

export function createMapScene(container: HTMLDivElement, labels: HTMLDivElement): MapScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-label", "可旋转的六边形浮空群岛");
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e7eff5", 100, 220);
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 300);
  camera.position.set(22, 26, 32);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minPolarAngle = .25;
  controls.maxPolarAngle = 1.2;
  controls.minZoom = .5;
  controls.maxZoom = 3.2;
  controls.enableDamping = false;
  controls.listenToKeyEvents(container);
  controls.update();
  scene.add(new THREE.HemisphereLight("#f5fbff", "#a5a78e", 2));
  const sunlight = new THREE.DirectionalLight("#fff1da", 2.7);
  sunlight.position.set(-20, 35, 24);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -70;
  sunlight.shadow.camera.right = 70;
  sunlight.shadow.camera.top = 70;
  sunlight.shadow.camera.bottom = -70;
  sunlight.shadow.camera.far = 180;
  sunlight.shadow.normalBias = .025;
  scene.add(sunlight, sunlight.target);
  const views = new Map<string, IslandView>();
  let models: ReadonlyMap<string, IslandModel> = new Map();
  let routes = new THREE.Group();
  let surfaces: THREE.Object3D[] = [];
  let selected = "main";
  let extent = 13;
  let frame = { x: 13, y: 13 };
  let width = 0;
  let height = 0;
  const projected = new THREE.Vector3();
  const screen = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function draw(): void {
    renderer.render(scene, camera);
    labels.querySelectorAll<HTMLElement>("[data-node-id]").forEach(button => {
      const anchor = views.get(button.dataset.nodeId!)?.anchor;
      if (!anchor) { button.hidden = true; return; }
      projected.copy(anchor);
      projected.y += .14;
      projected.project(camera);
      let visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
      if (visible) {
        screen.set(projected.x, projected.y);
        raycaster.setFromCamera(screen, camera);
        const hit = raycaster.intersectObjects(surfaces, true)[0];
        visible = !hit || hit.distance + .4 >= raycaster.ray.origin.distanceTo(anchor);
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
    const halfHeight = Math.max(frame.y, frame.x * height / width) * 1.08;
    camera.left = -halfHeight * width / height;
    camera.right = halfHeight * width / height;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    draw();
  }

  function fit(): void {
    const bounds = new THREE.Box3();
    views.forEach(view => bounds.expandByObject(view.group));
    const target = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.isEmpty() ? new THREE.Sphere(target, 13) : bounds.getBoundingSphere(new THREE.Sphere());
    extent = Math.max(7, sphere.radius);
    sunlight.target.position.copy(target);
    sunlight.position.copy(target).addScaledVector(new THREE.Vector3(-.4, .8, .5).normalize(), extent * 2 + 45);
    sunlight.shadow.camera.left = -extent * 1.5;
    sunlight.shadow.camera.right = extent * 1.5;
    sunlight.shadow.camera.top = extent * 1.5;
    sunlight.shadow.camera.bottom = -extent * 1.5;
    sunlight.shadow.camera.far = extent * 5 + 100;
    sunlight.shadow.camera.updateProjectionMatrix();
    const direction = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, extent * 2 + 30);
    camera.far = Math.max(300, extent * 6 + 100);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
    camera.updateMatrixWorld(true);
    const projectedBounds = new THREE.Box3();
    views.forEach(view => {
      const box = new THREE.Box3().setFromObject(view.group);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        projectedBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      }
    });
    const size = projectedBounds.isEmpty() ? new THREE.Vector3(26, 26, 0) : projectedBounds.getSize(new THREE.Vector3());
    frame = { x: size.x / 2 + 1.1, y: size.y / 2 + 1.1 };
    resize();
  }

  function select(id: string): void {
    selected = id;
    views.forEach((view, nodeId) => view.setState(models.get(nodeId)!.node.status, nodeId === selected));
    draw();
  }

  function update(graph: MapGraph): void {
    const changed = graph.nodes.length !== models.size || graph.nodes.some(node => !models.has(node.id));
    const next = layoutIslands(graph, models);
    views.forEach((view, id) => {
      if (next.has(id)) return;
      scene.remove(view.group);
      disposeGroup(view.group);
      views.delete(id);
    });
    next.forEach((model, id) => {
      if (views.has(id)) return;
      const view = createIsland(model);
      views.set(id, view);
      scene.add(view.group);
    });
    models = next;
    surfaces = Array.from(views.values(), view => view.surface);
    scene.remove(routes);
    disposeGroup(routes);
    routes = createRoutes(graph.edges, new Map(Array.from(views, ([id, view]) => [id, view.anchor])));
    scene.add(routes);
    if (changed) fit();
    select(selected);
  }

  controls.addEventListener("change", draw);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  return {
    update, fit, select,
    zoom: factor => {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
      draw();
    },
    recenter: () => {
      const working = Array.from(models.values()).find(model => model.node.status === "进行中");
      const anchor = views.get(selected)?.anchor ?? (working ? views.get(working.node.id)?.anchor : undefined);
      if (!anchor) { fit(); return; }
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(anchor);
      camera.position.copy(anchor).add(offset);
      controls.update();
      draw();
    },
    dispose: () => {
      observer.disconnect();
      controls.removeEventListener("change", draw);
      controls.dispose();
      views.forEach(view => disposeGroup(view.group));
      disposeGroup(routes);
      sunlight.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
