import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import '../style.css';

const $ = (selector) => document.querySelector(selector);
const container = $('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#343537');
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
camera.position.set(5, 4, 7);
let renderer;
let orbit;
let selected = null;
let serial = 0;
let activeTool = 'select';
let gridVisible = true;
let animationMode = false;
let currentFrame = 0;
let isPlaying = false;
let playTimer = null;
let currentModel = null;
let boneTarget = null;
let activeAnimationTarget = null;
let assetCount = 0;
const keyframes = new Map();
const boneDots = new Map();
const assetObjects = [];
const objects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hint = $('#hint');
const list = $('#objectList');
const props = $('#properties');
const fileInput = $('#fileInput');

function showFatal(message) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:28px 0 0;z-index:99;display:grid;place-items:center;padding:24px;background:#343537;color:#fff;text-align:center;font:14px system-ui';
  box.textContent = `No se pudo iniciar el visor 3D: ${message}`;
  container?.append(box);
}
window.addEventListener('error', (event) => {
  const message = event.message || 'error de JavaScript';
  if (message.includes('ResizeObserver loop')) return;
  console.error('Editor runtime error:', event.error || message);
  if (renderer) toast(`Error del editor: ${message}`);
  else showFatal(message);
});
window.addEventListener('unhandledrejection', (event) => {
  const message = event.reason?.message || String(event.reason || 'error al cargar un módulo');
  console.error('Editor async error:', event.reason);
  if (renderer) toast(`Error del editor: ${message}`);
  else showFatal(message);
});

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor('#343537', 1);
  container.append(renderer.domElement);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.09;
  orbit.target.set(0, 0.6, 0);
  orbit.minDistance = 1.6;
  orbit.maxDistance = 40;
  const gizmo = new TransformControls(camera, renderer.domElement);
  scene.add(gizmo.getHelper());
  gizmo.setSize(0.48);
  gizmo.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value; });
  gizmo.addEventListener('change', () => updateBoneMarkers());
  // Keep Three.js axis handles functional, with distinct high-visibility neon RGB colors.
  gizmo.setColors('#ff1744', '#39ff14', '#00b7ff', '#fff200');
  gizmo.getHelper().traverse((node) => {
    if (!node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      material.depthTest = false;
      material.needsUpdate = true;
    }
    node.renderOrder = 999;
  });
  gizmo.addEventListener('objectChange', () => { renderProperties(); });
  window.editorGizmo = gizmo;
} catch (error) {
  console.error('Editor 3D startup error:', error);
  showFatal(error?.message || String(error));
  throw error;
}

scene.add(new THREE.HemisphereLight(0xdce9ff, 0x48434a, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(5, 9, 6);
sun.castShadow = false; // Mobile-friendly default: avoid expensive dynamic shadow maps.
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x96999d, 0x606266);
grid.position.y = -0.01;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#343537', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.025;
ground.receiveShadow = true;
scene.add(ground);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.9)); // Lower-resolution post FX for mobile GPUs.
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.35, 0.88);
composer.addPass(bloomPass);
const lightPostPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.018 }, vignette: { value: 0.18 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float time;uniform float grain;uniform float vignette;varying vec2 vUv;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+time*17.0)*43758.5453);}void main(){vec4 c=texture2D(tDiffuse,vUv);float n=(hash(gl_FragCoord.xy)-0.5)*grain;float v=1.0-vignette*smoothstep(0.28,0.78,distance(vUv,vec2(0.5)));c.rgb=c.rgb*v+n;gl_FragColor=c;}`
});
composer.addPass(lightPostPass);
composer.addPass(new OutputPass());
let postEnabled = false;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
}
function updateStatus() {
  $('#status').textContent = `${objects.length} objeto${objects.length === 1 ? '' : 's'}`;
}
function addAsset(kind) {
  if (kind === 'point' || kind === 'directional') {
    const liveLights = assetObjects.filter((asset) => asset.isPointLight || asset.isDirectionalLight).length;
    if (liveLights >= 4) { toast('Límite móvil: usa hasta 4 luces locales'); return; }
  }
  const suffix = ++assetCount;
  if (kind === 'cube' || kind === 'sphere' || kind === 'plane') {
    const name = kind === 'cube' ? 'Cubo' : kind === 'sphere' ? 'Esfera' : 'Plano';
    const geometry = kind === 'cube' ? new THREE.BoxGeometry(1.15, 1.15, 1.15) : kind === 'sphere' ? new THREE.SphereGeometry(0.62, 24, 16) : new THREE.PlaneGeometry(1.5, 1.5);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#dedfe1', roughness: 0.62, metalness: 0.02 }));
    mesh.name = `${name} ${suffix}`;
    mesh.position.set(0, kind === 'plane' ? 0.2 : 0.65, 0);
    mesh.userData.kind = name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); objects.push(mesh); select(mesh); rebuildTimeline(); updateStatus();
    return;
  }
  let object;
  if (kind === 'camera') {
    object = new THREE.PerspectiveCamera(50, camera.aspect, 0.1, 100);
    object.position.set(3, 2.5, 4);
    object.name = `Cámara ${suffix}`;
    object.userData.kind = 'Cámara';
    const helper = new THREE.CameraHelper(object);
    object.userData.helper = helper;
    scene.add(helper);
  } else if (kind === 'point') {
    object = new THREE.PointLight(0xffffff, 2.2, 10, 2);
    object.position.set(1.5, 2.2, 1.5);
    object.name = `Luz puntual ${suffix}`;
    object.castShadow = false;
    object.userData.kind = 'Luz puntual';
    const helper = new THREE.PointLightHelper(object, 0.14, '#59dfff');
    object.userData.helper = helper;
    scene.add(helper);
    object.userData.helper.update();
  } else if (kind === 'directional') {
    object = new THREE.DirectionalLight(0xffffff, 1.2);
    object.position.set(3, 5, 2);
    object.name = `Luz direccional ${suffix}`;
    object.castShadow = false;
    object.userData.kind = 'Luz direccional';
    const helper = new THREE.DirectionalLightHelper(object, 0.35, '#59dfff');
    object.userData.helper = helper;
    scene.add(helper);
    object.userData.helper.update();
  } else if (kind === 'ambient') {
    object = new THREE.HemisphereLight(0xe1efff, 0x51505a, 0.7);
    object.name = `Luz ambiente ${suffix}`;
    object.userData.kind = 'Luz ambiente';
  }
  if (!object) return;
  object.userData.asset = true;
  scene.add(object);
  assetObjects.push(object);
  objects.push(object);
  select(object);
  rebuildTimeline();
  updateStatus();
  toast(`${object.userData.kind} agregada`);
}
function refreshList() {
  list.replaceChildren();
  for (const object of objects) {
    const row = document.createElement('button');
    row.className = `object-row${object === selected ? ' selected' : ''}`;
    row.dataset.key = object.uuid;
    const icon = document.createElement('span');
    icon.textContent = object.userData.kind === 'Esfera' ? '◉' : object.userData.kind === 'Modelo' ? '◈' : '⬡';
    const name = document.createElement('span');
    name.textContent = object.name;
    row.append(icon, name);
    row.addEventListener('click', () => select(object));
    list.append(row);
  }
}
function safeName(value) {
  return String(value || 'Objeto').replace(/[<>&"']/g, '').slice(0, 50) || 'Objeto';
}
function select(object) {
  selected = object;
  if (window.editorGizmo) {
    const target = animationMode && boneTarget ? boneTarget : object;
    if (target && animationMode) {
      window.editorGizmo.attach(target);
      window.editorGizmo.setMode(activeTool === 'select' ? 'rotate' : activeTool);
    } else if (target) {
      window.editorGizmo.attach(target);
      window.editorGizmo.setMode(activeTool === 'select' ? 'translate' : activeTool);
    } else window.editorGizmo.detach();
  }
  refreshList();
  renderProperties();
  refreshBoneList();
}
function addObject(kind = 'Cubo', position = [0, 0.65, 0], color = null) {
  const geometry = kind === 'Esfera' ? new THREE.SphereGeometry(0.62, 24, 16)
    : kind === 'Plano' ? new THREE.PlaneGeometry(1.5, 1.5)
    : new THREE.BoxGeometry(1.15, 1.15, 1.15);
  const material = new THREE.MeshStandardMaterial({
    color: color || (kind === 'Esfera' ? '#66c8ff' : '#e5e5e5'),
    roughness: 0.55,
    metalness: 0.03
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${kind} ${++serial}`;
  mesh.position.fromArray(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = kind;
  scene.add(mesh);
  objects.push(mesh);
  select(mesh);
  updateStatus();
  return mesh;
}
function field(label, axis, value, kind) {
  return `<label class="value-row"><span>${label}</span><input type="number" step="0.1" data-axis="${axis}" data-kind="${kind}" value="${Number(value).toFixed(2)}"></label>`;
}
function renderProperties() {
  if (!selected) {
    props.textContent = 'Selecciona un objeto';
    return;
  }
  const p = selected.position;
  const r = selected.rotation;
  const s = selected.scale;
  props.innerHTML = `<label class="prop-label">Nombre<input id="objectName" type="text" maxlength="50"></label>
    <label class="prop-label">Color<input id="objectColor" type="color"></label>
    <div class="section-label">POSICIÓN</div>${field('X', 0, p.x, 'position')}${field('Y', 1, p.y, 'position')}${field('Z', 2, p.z, 'position')}
    <div class="section-label">ROTACIÓN</div>${field('X', 0, THREE.MathUtils.radToDeg(r.x), 'rotation')}${field('Y', 1, THREE.MathUtils.radToDeg(r.y), 'rotation')}${field('Z', 2, THREE.MathUtils.radToDeg(r.z), 'rotation')}
    <div class="section-label">ESCALA</div>${field('X', 0, s.x, 'scale')}${field('Y', 1, s.y, 'scale')}${field('Z', 2, s.z, 'scale')}`;
  const nameInput = $('#objectName');
  nameInput.value = selected.name;
  nameInput.addEventListener('change', () => { selected.name = safeName(nameInput.value); refreshList(); });
  const colorInput = $('#objectColor');
  colorInput.value = `#${selected.material?.color?.getHexString?.() || 'ffffff'}`;
  colorInput.addEventListener('input', () => selected.material?.color?.set(colorInput.value));
  props.querySelectorAll('[data-axis]').forEach((input) => input.addEventListener('change', () => {
    const axis = Number(input.dataset.axis);
    const value = Number(input.value) || 0;
    if (input.dataset.kind === 'position') selected.position.setComponent(axis, value);
    if (input.dataset.kind === 'rotation') selected.rotation.setComponent(axis, THREE.MathUtils.degToRad(value));
    if (input.dataset.kind === 'scale') selected.scale.setComponent(axis, Math.max(0.01, value));
  }));
}
function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  const messages = { select: 'Toca un objeto para seleccionarlo · arrastra para orbitar', translate: 'Selecciona y arrastra el objeto para moverlo', rotate: 'Selecciona y arrastra para rotar el objeto', scale: 'Selecciona y arrastra para cambiar su escala' };
  hint.textContent = messages[tool] || messages.select;
}
function removeSelected() {
  if (!selected) return;
  scene.remove(selected);
  objects.splice(objects.indexOf(selected), 1);
  selected = null;
  refreshList();
  renderProperties();
  updateStatus();
}
function snapshot() {
  return { format: 'editor-3d-scene', version: 1, objects: objects.map((object) => ({
    name: object.name, kind: object.userData.kind || 'Cubo', position: object.position.toArray(),
    rotation: object.rotation.toArray(), scale: object.scale.toArray(),
    color: `#${object.material?.color?.getHexString?.() || 'ffffff'}`
  })) };
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function saveScene() {
  download('mi-escena-3d.json', JSON.stringify(snapshot(), null, 2), 'application/json');
  toast('Escena guardada');
}
function loadScene(data) {
  if (data?.format !== 'editor-3d-scene' || !Array.isArray(data.objects)) throw new Error('Archivo de escena no válido');
  for (const object of [...objects]) scene.remove(object);
  objects.length = 0; selected = null;
  for (const item of data.objects.slice(0, 300)) {
    const object = addObject(item.kind === 'Esfera' ? 'Esfera' : 'Cubo', Array.isArray(item.position) ? item.position : [0, 0.65, 0], item.color);
    object.name = safeName(item.name);
    object.rotation.fromArray(Array.isArray(item.rotation) ? item.rotation : [0, 0, 0]);
    object.scale.fromArray(Array.isArray(item.scale) ? item.scale : [1, 1, 1]);
  }
  refreshList(); renderProperties(); updateStatus(); toast('Escena importada');
}
function importFile(file) {
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.json')) {
    file.text().then((text) => loadScene(JSON.parse(text))).catch((error) => toast(error.message || 'No se pudo abrir la escena'));
    return;
  }
  const url = URL.createObjectURL(file);
  new GLTFLoader().load(url, (gltf) => {
    const model = gltf.scene;
    model.name = safeName(file.name.replace(/\.(glb|gltf)$/i, ''));
    model.userData.kind = 'Modelo';
    model.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    scene.add(model); objects.push(model); currentModel = model; boneTarget = null; select(model); makeBoneMarkers(model); rebuildTimeline(); updateStatus(); toast(allBones().length ? `Modelo importado · ${allBones().length} huesos` : 'Modelo importado · sin armature'); URL.revokeObjectURL(url);
  }, undefined, () => { URL.revokeObjectURL(url); toast('No se pudo importar el modelo'); });
}
function exportGlb() {
  const root = new THREE.Group();
  for (const object of objects) root.add(object.clone());
  new GLTFExporter().parse(root, (result) => {
    if (result instanceof ArrayBuffer) download('escena-3d.glb', result, 'model/gltf-binary');
    else download('escena-3d.gltf', JSON.stringify(result), 'model/gltf+json');
    toast('Exportación lista');
  }, (error) => { console.error(error); toast('No se pudo exportar'); }, { binary: true });
}
function allBones() {
  const found = [];
  currentModel?.traverse((node) => { if (node.isBone) found.push(node); });
  return found;
}
function updateBoneMarkers() {
  if (!currentModel) return;
  camera.updateMatrixWorld();
  currentModel.updateMatrixWorld(true);
  const worldPosition = new THREE.Vector3();
  const height = Math.max(1, container.clientHeight);
  for (const [bone, marker] of boneDots) {
    marker.visible = animationMode;
    if (!animationMode) continue;
    bone.getWorldPosition(worldPosition);
    marker.position.copy(worldPosition);
    const distance = Math.max(0.1, camera.position.distanceTo(worldPosition));
    const radius = THREE.MathUtils.clamp(2.8 * 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / height, 0.006, 0.04);
    marker.scale.setScalar(radius);
    marker.material.color.set(bone === boneTarget ? '#fff4c2' : '#e8f3f7');
  }
}
function refreshGizmoEmissive() {
  const helper = window.editorGizmo?.getHelper();
  if (!helper) return;
  const axisColors = { X: '#ff1744', Y: '#39ff14', Z: '#00b7ff' };
  helper.traverse((node) => {
    if (!node.material || !node.name) return;
    const axis = node.name[0];
    if (!axisColors[axis]) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (material.color) material.color.set(axisColors[axis]);
      if (material.emissive) material.emissive.set(axisColors[axis]);
      if ('emissiveIntensity' in material) material.emissiveIntensity = 0.6;
      material.needsUpdate = true;
    }
  });
}
function makeBoneMarkers(model) {
  for (const marker of boneDots.values()) scene.remove(marker);
  boneDots.clear();
  model.updateMatrixWorld(true);
  const bones = [];
  model.traverse((node) => { if (node.isBone) bones.push(node); });
  const geometry = new THREE.SphereGeometry(1, 10, 8);
  bones.forEach((bone) => {
    const material = new THREE.MeshBasicMaterial({ color: '#e8f3f7', depthTest: false, depthWrite: false, toneMapped: false });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = `Bone handle: ${bone.name || 'Bone'}`;
    marker.userData.boneHandleTarget = bone;
    marker.renderOrder = 1001;
    marker.visible = animationMode;
    scene.add(marker);
    boneDots.set(bone, marker);
  });
  refreshBoneList();
  updateBoneMarkers();
}
function selectBone(bone) {
  boneTarget = bone;
  activeAnimationTarget = bone;
  window.editorGizmo?.attach(bone);
  window.editorGizmo?.setMode(activeTool === 'select' ? 'rotate' : activeTool);
  $('#timelineTrackName').textContent = bone.name || 'Bone';
  if (!animationMode) toggleAnimationMode();
  rebuildTimeline();
  document.querySelectorAll('.anim-track').forEach((track) => track.classList.toggle('selected', track.dataset.uuid === bone.uuid));
  refreshBoneList();
  updateBoneMarkers();
}
function makeAnimTrack(node, title) {
  const track = document.createElement('div');
  track.className = 'anim-track';
  track.dataset.uuid = node.uuid;
  track.innerHTML = `<span class="track-label"></span>`;
  track.querySelector('.track-label').textContent = title;
  track.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.key-dot')) return;
    activeAnimationTarget = node;
    if (node.isBone) selectBone(node);
    else {
      selected = node;
      $('#timelineTrackName').textContent = node.name;
      window.editorGizmo?.attach(node);
      window.editorGizmo?.setMode('translate');
      document.querySelectorAll('.anim-track').forEach((item) => item.classList.toggle('selected', item === track));
    }
    if (event.offsetX > track.clientWidth * 0.2) {
      const bounds = track.getBoundingClientRect();
      setFrame(Math.round(THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * 120));
    }
  });
  $('#timelineRuler').append(track);
}
function rebuildTimeline() {
  const ruler = $('#timelineRuler');
  ruler.replaceChildren();
  const cursor = document.createElement('i');
  cursor.id = 'timelineCursor';
  ruler.append(cursor);
  for (const frame of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]) {
    const tick = document.createElement('span');
    tick.className = 'ruler-tick';
    tick.style.left = `${frame / 120 * 100}%`;
    tick.textContent = String(frame);
    ruler.append(tick);
  }
  const animatedIds = new Set();
  for (const pose of keyframes.values()) for (const uuid of pose.keys()) animatedIds.add(uuid);
  const target = activeAnimationTarget || boneTarget || selected;
  const trackTargets = new Map();
  for (const node of [...objects, ...allBones()]) if (animatedIds.has(node.uuid)) trackTargets.set(node.uuid, node);
  if (target) trackTargets.set(target.uuid, target);
  if (!trackTargets.size && !currentModel && objects.length) trackTargets.set(objects[0].uuid, objects[0]);
  for (const node of trackTargets.values()) makeAnimTrack(node, node.name || (node.isBone ? 'Hueso' : 'Objeto'));
  updateKeyMarkers();
  updateFrameControls();
}
function updateKeyMarkers() {
  document.querySelectorAll('.anim-track').forEach((track) => {
    track.querySelectorAll('.key-dot').forEach((marker) => marker.remove());
    for (const [frame, pose] of keyframes) {
      if (!pose.has(track.dataset.uuid)) continue;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'key-dot';
      marker.style.left = `${(frame / 120) * 100}%`;
      marker.title = `Ir al fotograma ${frame}`;
      marker.setAttribute('aria-label', `Keyframe ${frame}`);
      marker.addEventListener('click', (event) => { event.stopPropagation(); setFrame(frame); });
      track.append(marker);
    }
  });
}
function refreshBoneList() {
  const panel = $('#boneList');
  if (!panel) return;
  panel.replaceChildren();
  const bones = allBones();
  if (!currentModel || bones.length === 0) {
    panel.textContent = 'Sin esqueleto';
    return;
  }
  for (const bone of bones) {
    const row = document.createElement('div');
    row.className = `bone-row${bone === boneTarget ? ' selected' : ''}`;
    const pick = document.createElement('button');
    pick.textContent = `● ${bone.name || 'Hueso'}`;
    pick.addEventListener('click', () => selectBone(bone));
    row.append(pick);
    panel.append(row);
  }
}
function toggleAnimationMode() {
  animationMode = !animationMode;
  document.body.classList.toggle('animating', animationMode);
  $('#animationPanel').hidden = !animationMode;
  $('#animationTimeline').hidden = !animationMode;
  $('#animMode').innerHTML = animationMode ? 'Animation <span>⌄</span>' : 'Object Mode <span>⌄</span>';
  if (animationMode) {
    if (currentModel && !boneTarget) boneTarget = allBones()[0] || null;
    activeAnimationTarget = boneTarget || selected;
    if (boneTarget) { window.editorGizmo?.attach(boneTarget); window.editorGizmo?.setMode('rotate'); }
    rebuildTimeline();
    if (currentModel) refreshBoneList();
    updateBoneMarkers();
    hint.textContent = 'Modo animación · manipula el hueso y agrega keyframes';
  } else {
    boneTarget = null;
    if (selected && activeTool !== 'select') { window.editorGizmo?.attach(selected); window.editorGizmo?.setMode(activeTool); }
    else window.editorGizmo?.detach();
    for (const marker of boneDots.values()) marker.visible = false;
    hint.textContent = 'Arrastra para orbitar · pellizca para acercar';
  }
}
function vectorValues(value, fallback, size) {
  if (Array.isArray(value) && value.length >= size && value.slice(0, size).every(Number.isFinite)) return value.slice(0, size);
  if (value && typeof value.toArray === 'function') {
    const result = value.toArray();
    if (Array.isArray(result) && result.length >= size && result.slice(0, size).every(Number.isFinite)) return result.slice(0, size);
  }
  return fallback.slice();
}
function readTransform(node) {
  return {
    position: vectorValues(node?.position, [0, 0, 0], 3),
    quaternion: vectorValues(node?.quaternion, [0, 0, 0, 1], 4),
    scale: vectorValues(node?.scale, [1, 1, 1], 3)
  };
}
function writeTransform(node, state) {
  if (!node || !state) return;
  const safe = readTransform({ position: state.position, quaternion: state.quaternion, scale: state.scale });
  node.position.fromArray(safe.position);
  node.quaternion.fromArray(safe.quaternion).normalize();
  node.scale.fromArray(safe.scale);
}
function captureKeyframe() {
  const frame = Math.max(0, Math.min(120, Number($('#frameNumber').value) || currentFrame));
  currentFrame = frame;
  const target = activeAnimationTarget || boneTarget || selected;
  if (!target) { toast('Selecciona un objeto o hueso'); return; }
  const pose = keyframes.get(frame) || new Map();
  pose.set(target.uuid, readTransform(target));
  keyframes.set(frame, pose);
  rebuildTimeline();
  updateFrameControls();
  toast(`Keyframe de ${target.name || 'objeto'} · fotograma ${frame}`);
}
function poseAt(frame, pose) {
  for (const object of objects) if (pose.has(object.uuid)) writeTransform(object, pose.get(object.uuid));
  for (const bone of allBones()) if (pose.has(bone.uuid)) writeTransform(bone, pose.get(bone.uuid));
  updateBoneMarkers();
}
function updateFrameControls() {
  $('#frameRange').value = String(currentFrame);
  $('#frameNumber').value = String(currentFrame);
  const cursor = $('#timelineCursor');
  if (cursor) cursor.style.left = `${(currentFrame / 120) * 100}%`;
  updateKeyMarkers();
}
function interpolatePose(frame) {
  const animatedNodes = new Map();
  for (const pose of keyframes.values()) for (const [uuid] of pose) animatedNodes.set(uuid, true);
  const nodes = new Map([...objects, ...allBones()].map((node) => [node.uuid, node]));
  for (const uuid of animatedNodes.keys()) {
    const node = nodes.get(uuid);
    if (!node) continue;
    const available = [...keyframes.entries()].filter(([, pose]) => pose.has(uuid)).sort((a, b) => a[0] - b[0]);
    if (!available.length) continue;
    let before = available.filter(([at]) => at <= frame).at(-1);
    let after = available.find(([at]) => at >= frame);
    before ||= available[0];
    after ||= available.at(-1);
    const [f0, start] = before, [f1, end] = after;
    const t = f0 === f1 ? 0 : THREE.MathUtils.clamp((frame - f0) / (f1 - f0), 0, 1);
    const from = readTransform({ position: start.position, quaternion: start.quaternion, scale: start.scale });
    const to = readTransform({ position: end.position, quaternion: end.quaternion, scale: end.scale });
    node.position.lerpVectors(new THREE.Vector3(...from.position), new THREE.Vector3(...to.position), t);
    node.scale.lerpVectors(new THREE.Vector3(...from.scale), new THREE.Vector3(...to.scale), t);
    node.quaternion.copy(new THREE.Quaternion(...from.quaternion)).slerp(new THREE.Quaternion(...to.quaternion), t).normalize();
  }
  updateBoneMarkers();
}
function setFrame(frame) {
  currentFrame = Math.max(0, Math.min(120, Number(frame) || 0));
  interpolatePose(currentFrame);
  updateFrameControls();
}
function togglePlayback() {
  isPlaying = !isPlaying;
  $('#playAnimation').textContent = isPlaying ? '❚❚' : '▶';
  clearInterval(playTimer);
  if (isPlaying) playTimer = setInterval(() => {
    currentFrame = currentFrame >= 120 ? 0 : currentFrame + 1;
    interpolatePose(currentFrame);
    updateFrameControls();
  }, 40);
}
function resize() {
  const rect = container.getBoundingClientRect();
  if (!renderer || rect.width < 2 || rect.height < 2) return;
  renderer.setSize(rect.width, rect.height, false);
  composer.setSize(rect.width, rect.height);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
let resizeObserverFrame = 0;
new ResizeObserver(() => {
  if (resizeObserverFrame) return;
  resizeObserverFrame = requestAnimationFrame(() => {
    resizeObserverFrame = 0;
    resize();
  });
}).observe(container);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (window.editorGizmo?.axis || window.editorGizmo?.dragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (animationMode) {
    const bounds = container.getBoundingClientRect();
    let targetBone = null, nearest = 22;
    for (const bone of boneDots.keys()) {
      const screen = bone.getWorldPosition(new THREE.Vector3()).project(camera);
      if (screen.z < -1 || screen.z > 1) continue;
      const sx = bounds.left + (screen.x * 0.5 + 0.5) * bounds.width;
      const sy = bounds.top + (-screen.y * 0.5 + 0.5) * bounds.height;
      const distance = Math.hypot(event.clientX - sx, event.clientY - sy);
      if (distance < nearest) { nearest = distance; targetBone = bone; }
    }
    if (targetBone) selectBone(targetBone);
    else if (!currentModel && activeTool === 'select') {
      const hits = raycaster.intersectObjects(objects, true);
      const hit = hits[0]?.object;
      if (hit) { let target = hit; while (target && !objects.includes(target)) target = target.parent; if (target) { selected = target; activeAnimationTarget = target; window.editorGizmo?.attach(target); window.editorGizmo?.setMode('translate'); $('#timelineTrackName').textContent = target.name; rebuildTimeline(); } }
    }
    return;
  }
  if (activeTool !== 'select') return;
  const hits = raycaster.intersectObjects(objects, true);
  let target = hits[0]?.object || null;
  while (target && !objects.includes(target)) target = target.parent;
  select(target);
});
$('#addCube').addEventListener('click', () => addObject('Cubo'));
$('#addSphere').addEventListener('click', () => addObject('Esfera'));
$('#delete').addEventListener('click', removeSelected);
$('#addMenu')?.addEventListener('click', () => addObject('Cubo'));
$('#save').addEventListener('click', saveScene);
$('#exportScene').addEventListener('click', exportGlb);
$('#importScene').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { importFile(fileInput.files?.[0]); fileInput.value = ''; });
$('#gridToggle').addEventListener('click', () => { gridVisible = !gridVisible; grid.visible = gridVisible; });
$('#frame').addEventListener('click', () => { orbit.target.set(0, 0.6, 0); camera.position.set(5, 4, 7); orbit.update(); });
$('#undo').addEventListener('click', () => toast('Deshacer todavía no está disponible'));
$('#animMode').addEventListener('click', toggleAnimationMode);
$('#assetsToggle').addEventListener('click', () => { $('#assetsPanel').hidden = !$('#assetsPanel').hidden; });
$('#assetsClose').addEventListener('click', () => { $('#assetsPanel').hidden = true; });
document.querySelectorAll('[data-asset]').forEach((button) => button.addEventListener('click', () => addAsset(button.dataset.asset)));
$('#addKeyframe').addEventListener('click', () => {
  if (!animationMode) { animationMode = true; document.body.classList.add('animating'); $('#animationPanel').hidden = false; $('#animationTimeline').hidden = false; $('#animMode').innerHTML = 'Animation <span>⌄</span>'; }
  if (!activeAnimationTarget) activeAnimationTarget = boneTarget || selected;
  if (!activeAnimationTarget && currentModel) { boneTarget = allBones()[0] || null; activeAnimationTarget = boneTarget; }
  rebuildTimeline();
  captureKeyframe();
});
$('#playAnimation').addEventListener('click', togglePlayback);
$('#frameRange').addEventListener('input', (event) => setFrame(event.target.value));
$('#frameNumber').addEventListener('change', (event) => setFrame(event.target.value));
$('#prevFrame').addEventListener('click', () => setFrame(currentFrame - 1));
$('#nextFrame').addEventListener('click', () => setFrame(currentFrame + 1));
$('#addBoneTrack').addEventListener('click', () => {
  const bones = allBones();
  if (!bones.length) { toast('Importa primero un GLB con esqueleto'); return; }
  if (!boneTarget) boneTarget = bones[0];
  window.editorGizmo?.attach(boneTarget);
  window.editorGizmo?.setMode('rotate');
  refreshBoneList();
  toast(`Pista de hueso: ${boneTarget.name || 'Hueso'}`);
});
$('#postToggle').addEventListener('click', (event) => {
  postEnabled = !postEnabled;
  event.currentTarget.classList.toggle('active', postEnabled);
  bloomPass.enabled = postEnabled;
  lightPostPass.enabled = postEnabled;
  toast(postEnabled ? 'Postprocesado liviano activado' : 'Postprocesado desactivado');
});
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => {
  setTool(button.dataset.tool);
  if (animationMode && boneTarget) {
    window.editorGizmo?.attach(boneTarget);
    window.editorGizmo?.setMode(button.dataset.tool === 'select' ? 'rotate' : button.dataset.tool);
  } else if (selected && button.dataset.tool !== 'select') {
    window.editorGizmo?.attach(selected);
    window.editorGizmo?.setMode(button.dataset.tool);
  } else window.editorGizmo?.detach();
}));

// Initial layout is sized before the first render, then create a visible object as a startup smoke signal.
resize();
addObject('Cubo');
function frame() {
  requestAnimationFrame(frame);
  orbit.update();
  lightPostPass.uniforms.time.value += 0.016;
  if (postEnabled) composer.render();
  else renderer.render(scene, camera);
}
frame();
