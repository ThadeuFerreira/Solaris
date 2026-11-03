import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sampleGridElevation, type TerrainGrid } from '../api/openMeteo';
import type { Mounting } from '../model';
import type { LatLng, Point } from './geometry';
import { curvePoints, type Infrastructure } from './infrastructure';
import { DEG, rackPanelHeights, roofSurface, satelliteBounds, satelliteTiles, sceneBounds, toMercator } from './sceneGeometry';

type Bounds = ReturnType<typeof sceneBounds>;

function panelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a4b6c8';
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = '#092754';
  ctx.fillRect(5, 5, 246, 502);
  ctx.strokeStyle = '#668bb7';
  ctx.lineWidth = 1;
  for (let x = 1; x < 6; x++) { ctx.beginPath(); ctx.moveTo(x * 41 + 5, 5); ctx.lineTo(x * 41 + 5, 507); ctx.stroke(); }
  for (let y = 1; y < 12; y++) { ctx.beginPath(); ctx.moveTo(5, y * 42 + 5); ctx.lineTo(251, y * 42 + 5); ctx.stroke(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Dispose world resources once, retaining materials owned by the viewer. */
export function disposeWorld(root: THREE.Object3D, shared: Set<THREE.Material>) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) geometries.add(object.geometry);
    if ('material' in object) {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!(material instanceof THREE.Material) || shared.has(material)) continue;
        materials.add(material);
        if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

export function createSceneViewer(host: HTMLElement, bounds: Bounds, onContextLost: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Cena 3D do projeto solar. Arraste para girar, use a roda para aproximar e o botão direito para deslocar.');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#182331');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, bounds.radiusM * 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.015;
  controls.minDistance = 2;
  controls.maxDistance = bounds.radiusM * 12;
  controls.listenToKeyEvents(renderer.domElement);
  const hemi = new THREE.HemisphereLight('#e5f1ff', '#5c6045', 1.7);
  const sun = new THREE.DirectionalLight('#fff3db', 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowExtent = Math.max(10, bounds.siteRadiusM * 1.3);
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 0.1, far: bounds.radiusM * 12 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.0001;
  scene.add(hemi, sun, sun.target);

  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#657956', roughness: 1, side: THREE.DoubleSide });
  const cells = panelTexture();
  const cellMaterial = new THREE.MeshStandardMaterial({ map: cells, roughness: 0.48, metalness: 0.15 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: '#9aa6b2', roughness: 0.5, metalness: 0.5 });
  const shared = new Set<THREE.Material>([groundMaterial, cellMaterial, frameMaterial]);
  let pending = 0;
  let disposed = false;
  const render = () => {
    if (disposed || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      controls.update();
      renderer.render(scene, camera);
    });
  };
  controls.addEventListener('change', render);
  const resetCamera = (top = false) => {
    const distance = Math.max(12, bounds.siteRadiusM * 3.4);
    controls.target.set(0, 0, 0);
    camera.position.set(top ? 0 : distance * 0.65, top ? distance : distance * 0.72, top ? 0.01 : distance * 0.85);
    controls.update();
    render();
  };
  resetCamera();
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    render();
  });
  resize.observe(host);
  const contextLost = (event: Event) => { event.preventDefault(); onContextLost(); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);

  return {
    scene, sun, hemi, render, groundMaterial, cellMaterial, frameMaterial, shared, resetCamera,
    rotate(angle: number) {
      camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(controls.target);
      controls.update();
      render();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(pending);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      groundMaterial.map?.dispose();
      shared.forEach((material) => material.dispose());
      cells.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

export type SceneViewer = ReturnType<typeof createSceneViewer>;

export async function loadSatellite(bounds: Bounds, viewer: SceneViewer, signal: AbortSignal) {
  const tiles = satelliteTiles(satelliteBounds(bounds.frame, bounds.radiusM));
  const mosaic = document.createElement('canvas');
  mosaic.width = tiles.columns * 256;
  mosaic.height = tiles.rows * 256;
  const context = mosaic.getContext('2d')!;
  await Promise.all(Array.from({ length: tiles.columns * tiles.rows }, async (_, i) => {
    const col = i % tiles.columns, row = Math.floor(i / tiles.columns);
    const x = ((tiles.x0 + col) % tiles.count + tiles.count) % tiles.count;
    const y = Math.max(0, Math.min(tiles.count - 1, tiles.y0 + row));
    const response = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tiles.zoom}/${y}/${x}`, { signal });
    if (!response.ok) throw new Error('Imagem de satélite indisponível');
    const url = URL.createObjectURL(await response.blob());
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      signal.throwIfAborted();
      context.drawImage(image, col * 256, row * 256, 256, 256);
    } finally {
      URL.revokeObjectURL(url);
    }
  }));
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const crop = tiles.crop;
  canvas.getContext('2d')!.drawImage(mosaic, crop.x, crop.y, crop.width, crop.height, 0, 0, 1024, 1024);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  viewer.groundMaterial.map = texture;
  viewer.groundMaterial.color.set('#ffffff');
  viewer.groundMaterial.needsUpdate = true;
  viewer.render();
}

function surfaceGeometry(points: THREE.Vector3[], indices: number[], uv?: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => p.toArray()), 3));
  if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function label(text: string, size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#122031dc';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffe5a5';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 42);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(size * 4, size, 1);
  return sprite;
}

export interface SceneWorldInput {
  bounds: Bounds;
  grid: TerrainGrid;
  exaggeration: number;
  polygon: LatLng[];
  panels: LatLng[][];
  tiltDeg: number;
  azimuthDeg: number;
  mounting: Mounting;
  infrastructure: Infrastructure[];
}

export function buildSceneWorld(viewer: SceneViewer, input: SceneWorldInput) {
  const { bounds, grid, exaggeration, polygon, panels, tiltDeg, azimuthDeg, mounting, infrastructure } = input;
  const { frame, radiusM } = bounds;
  const world = new THREE.Group();
  const ground = (p: Point) => (sampleGridElevation(grid, p.x, p.y) - grid.centerElevationM) * exaggeration;
  const at = (p: Point, offset = 0) => new THREE.Vector3(p.x, ground(p) + offset, -p.y);
  const bbox = satelliteBounds(frame, radiusM);
  const points: THREE.Vector3[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const segments = 72;
  for (let iy = 0; iy <= segments; iy++) {
    for (let ix = 0; ix <= segments; ix++) {
      const p = { x: -radiusM + ix / segments * radiusM * 2, y: -radiusM + iy / segments * radiusM * 2 };
      points.push(at(p));
      const merc = toMercator(frame.toLatLng(p));
      uv.push((merc.x - bbox.west) / (bbox.east - bbox.west), (merc.y - bbox.south) / (bbox.north - bbox.south));
      if (ix < segments && iy < segments) {
        const a = iy * (segments + 1) + ix;
        indices.push(a, a + 1, a + segments + 2, a, a + segments + 2, a + segments + 1);
      }
    }
  }
  const terrain = new THREE.Mesh(surfaceGeometry(points, indices, uv), viewer.groundMaterial);
  terrain.receiveShadow = true;
  world.add(terrain);

  const localPolygon = polygon.map(frame.toLocal);
  const roof = roofSurface(localPolygon, ground, tiltDeg, azimuthDeg);
  if (mounting === 'flush') {
    const roofPoints = localPolygon.map((p) => new THREE.Vector3(p.x, roof(p), -p.y));
    const triangles = THREE.ShapeUtils.triangulateShape(localPolygon.map((p) => new THREE.Vector2(p.x, -p.y)), []);
    const roofMesh = new THREE.Mesh(surfaceGeometry(roofPoints, triangles.flat()), new THREE.MeshStandardMaterial({ color: '#666e72', side: THREE.DoubleSide, roughness: 0.95 }));
    roofMesh.receiveShadow = true;
    roofMesh.castShadow = true;
    world.add(roofMesh);
  }

  const boundaryPoints: THREE.Vector3[] = [];
  for (let i = 0; i < localPolygon.length; i++) {
    const p = localPolygon[i], q = localPolygon[(i + 1) % localPolygon.length];
    for (let j = 0; j < 16; j++) {
      const r = { x: p.x + (q.x - p.x) * j / 16, y: p.y + (q.y - p.y) * j / 16 };
      boundaryPoints.push(new THREE.Vector3(r.x, (mounting === 'flush' ? roof(r) : ground(r)) + 0.08, -r.y));
    }
  }
  world.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(boundaryPoints), new THREE.LineBasicMaterial({ color: '#ffd166' })));

  if (panels.length) {
    const modules = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), [viewer.frameMaterial, viewer.frameMaterial, viewer.cellMaterial, viewer.frameMaterial, viewer.frameMaterial, viewer.frameMaterial], panels.length);
    modules.castShadow = true;
    modules.receiveShadow = true;
    const legs = mounting === 'rack' ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), viewer.frameMaterial, panels.length * 4) : null;
    if (legs) { legs.castShadow = true; legs.receiveShadow = true; }
    const az = azimuthDeg * DEG, tilt = tiltDeg * DEG;
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(Math.cos(az), 0, Math.sin(az)),
      new THREE.Vector3(Math.sin(az) * Math.sin(tilt), Math.cos(tilt), -Math.cos(az) * Math.sin(tilt)),
      new THREE.Vector3(-Math.sin(az) * Math.cos(tilt), Math.sin(tilt), Math.cos(az) * Math.cos(tilt)),
    );
    const rotation = new THREE.Quaternion().setFromRotationMatrix(basis);
    const transform = new THREE.Matrix4();
    panels.forEach((panel, i) => {
      const corners = panel.map(frame.toLocal);
      const heights = mounting === 'rack' ? rackPanelHeights(corners, ground, tiltDeg, azimuthDeg) : corners.map((p) => roof(p) + 0.08);
      const center = new THREE.Vector3(corners.reduce((s, p) => s + p.x, 0) / 4, heights.reduce((s, h) => s + h, 0) / 4, -corners.reduce((s, p) => s + p.y, 0) / 4);
      const width = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const depth = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y, heights[3] - heights[0]);
      transform.compose(center, rotation, new THREE.Vector3(width, 0.045, depth));
      modules.setMatrixAt(i, transform);
      if (legs) corners.forEach((p, j) => {
        const foot = ground(p), height = Math.max(0.05, heights[j] - foot);
        transform.compose(new THREE.Vector3(p.x, foot + height / 2, -p.y), new THREE.Quaternion(), new THREE.Vector3(0.055, height, 0.055));
        legs.setMatrixAt(i * 4 + j, transform);
      });
    });
    modules.instanceMatrix.needsUpdate = true;
    modules.computeBoundingSphere();
    world.add(modules);
    if (legs) { legs.instanceMatrix.needsUpdate = true; legs.computeBoundingSphere(); world.add(legs); }
  }

  const equipmentMaterial = new THREE.MeshStandardMaterial({ color: '#b6c6c4', roughness: 0.7, metalness: 0.25 });
  const rectifierMaterial = new THREE.MeshStandardMaterial({ color: '#408fb9', roughness: 0.65 });
  const poleMaterial = new THREE.MeshStandardMaterial({ color: '#9ca7ac', roughness: 0.9 });
  const box = (p: Point, width: number, height: number, depth: number, material: THREE.Material, offset = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.copy(at(p, height / 2 + offset));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
    return mesh;
  };
  for (const item of infrastructure) {
    if (item.type === 'road') {
      const path = curvePoints(...item.points, 64).map(frame.toLocal);
      const roadPoints: THREE.Vector3[] = [], roadIndices: number[] = [];
      path.forEach((p, i) => {
        const before = path[Math.max(0, i - 1)], after = path[Math.min(path.length - 1, i + 1)];
        const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
        const dx = -(after.y - before.y) / length * item.width / 2, dy = (after.x - before.x) / length * item.width / 2;
        roadPoints.push(at({ x: p.x + dx, y: p.y + dy }, 0.06), at({ x: p.x - dx, y: p.y - dy }, 0.06));
        if (i < path.length - 1) { const a = i * 2; roadIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      });
      const road = new THREE.Mesh(surfaceGeometry(roadPoints, roadIndices), new THREE.MeshStandardMaterial({ color: '#a79c86', roughness: 1, side: THREE.DoubleSide }));
      road.receiveShadow = true;
      world.add(road);
      continue;
    }
    const p = frame.toLocal(item.center);
    const height = item.type === 'pole' ? 8 : item.type === 'transformer' ? 1.8 : 1.3;
    if (item.type === 'pole') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, height, 8), poleMaterial);
      pole.position.copy(at(p, height / 2));
      pole.castShadow = true;
      world.add(pole);
      box(p, Math.max(1.5, item.width), 0.15, 0.18, poleMaterial, height - 0.6);
    } else {
      box(p, item.width, 0.15, item.length, poleMaterial);
      box(p, item.width * 0.82, height, item.length * 0.82, item.type === 'transformer' ? equipmentMaterial : rectifierMaterial, 0.15);
    }
    const caption = label(item.type === 'pole' ? 'Poste / torre' : item.type === 'transformer' ? 'Transformador' : 'Retificador', Math.max(0.6, Math.min(2, bounds.siteRadiusM / 30)));
    caption.position.copy(at(p, height + 0.9));
    world.add(caption);
  }
  const northPoint = { x: -radiusM * 0.75, y: radiusM * 0.5 };
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), at(northPoint, 0.3), radiusM * 0.18, '#ffd166', radiusM * 0.05, radiusM * 0.025);
  world.add(arrow);
  const north = label('N', Math.max(0.7, radiusM / 30));
  north.position.copy(at({ x: northPoint.x, y: northPoint.y + radiusM * 0.23 }, 0.5));
  world.add(north);
  viewer.scene.add(world);
  viewer.render();
  const retainedMaterials = new Set([...viewer.shared, equipmentMaterial, rectifierMaterial, poleMaterial]);
  return () => {
    viewer.scene.remove(world);
    disposeWorld(world, retainedMaterials);
    equipmentMaterial.dispose();
    rectifierMaterial.dispose();
    poleMaterial.dispose();
    viewer.render();
  };
}
