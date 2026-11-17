import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
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
window.addEventListener('error', (event) => showFatal(event.message || 'error de JavaScript'));
window.addEventListener('unhandledrejection', (event) => showFatal(event.reason?.message || 'error al cargar un módulo'));

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#343537', 1);
  container.append(renderer.domElement);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.09;
  orbit.target.set(0, 0.6, 0);
  orbit.minDistance = 1.6;
  orbit.maxDistance = 40;
} catch (error) {
  console.error('Editor 3D startup error:', error);
  showFatal(error?.message || String(error));
  throw error;
}

scene.add(new THREE.HemisphereLight(0xdce9ff, 0x48434a, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(5, 9, 6);
sun.castShadow = true;
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x96999d, 0x606266);
grid.position.y = -0.01;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#343537', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.025;
ground.receiveShadow = true;
scene.add(ground);

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
  refreshList();
  renderProperties();
}
function addObject(kind = 'Cubo', position = [0, 0.65, 0], color = null) {
  const geometry = kind === 'Esfera'
    ? new THREE.SphereGeometry(0.62, 32, 24)
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
    scene.add(model); objects.push(model); select(model); updateStatus(); toast('Modelo importado'); URL.revokeObjectURL(url);
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
function resize() {
  const rect = container.getBoundingClientRect();
  if (!renderer || rect.width < 2 || rect.height < 2) return;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (activeTool !== 'select') return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(objects, true);
  let target = hits[0]?.object || null;
  while (target && !objects.includes(target)) target = target.parent;
  select(target);
});
$('#addCube').addEventListener('click', () => addObject('Cubo'));
$('#addSphere').addEventListener('click', () => addObject('Esfera'));
$('#delete').addEventListener('click', removeSelected);
$('#addMenu').addEventListener('click', () => addObject('Cubo'));
$('#save').addEventListener('click', saveScene);
$('#exportScene').addEventListener('click', exportGlb);
$('#importScene').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { importFile(fileInput.files?.[0]); fileInput.value = ''; });
$('#gridToggle').addEventListener('click', () => { gridVisible = !gridVisible; grid.visible = gridVisible; });
$('#frame').addEventListener('click', () => { orbit.target.set(0, 0.6, 0); camera.position.set(5, 4, 7); orbit.update(); });
$('#undo').addEventListener('click', () => toast('Deshacer todavía no está disponible'));
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));

// Initial layout is sized before the first render, then create a visible object as a startup smoke signal.
resize();
addObject('Cubo');
function frame() { requestAnimationFrame(frame); orbit.update(); renderer.render(scene, camera); }
frame();
