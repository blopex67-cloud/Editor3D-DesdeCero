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
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import { Capacitor, registerPlugin } from '@capacitor/core';
const NativeRenderExport = registerPlugin('RenderExport');
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
let importedMixer = null;
let importedClips = [];
let importedAnimationAction = null;
let activeCamera = camera;
let viewCameraObject = null;
let cameraMode = false;
let currentProjectId = null;
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
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
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
  gizmo.setSize(1.18);
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
  gizmo.addEventListener('objectChange', () => { renderProperties(); updateBoneMarkers(); if (gizmo.object?.userData.helper) gizmo.object.userData.helper.update(); scheduleProjectSave(); });
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
const sceneRenderPass = new RenderPass(scene, camera);
composer.addPass(sceneRenderPass);
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
  $('#status').textContent = `${currentProjectId ? (projectList().find((p) => p.id === currentProjectId)?.name || 'Proyecto') + ' · ' : ''}${objects.length} objeto${objects.length === 1 ? '' : 's'}`;
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
    scene.add(mesh); objects.push(mesh); select(mesh); rebuildTimeline(); updateStatus(); saveCurrentProject();
    return;
  }
  let object;
  if (kind === 'camera') {
    object = new THREE.PerspectiveCamera(50, camera.aspect, 0.1, 100);
    object.position.set(3, 2.5, 4);
    object.lookAt(0, 0.6, 0);
    object.name = `Cámara ${suffix}`;
    object.userData.kind = 'Cámara';
    object.userData.helper = new THREE.CameraHelper(object);
    scene.add(object.userData.helper);
    viewCameraObject = object;
    $('#enterCamera').hidden = false;
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
  if (object.isCamera) { viewCameraObject = object; $('#enterCamera').hidden = false; }
  rebuildTimeline();
  updateStatus();
  saveCurrentProject();
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
  saveCurrentProject();
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
  const cameraAction = selected.isCamera ? `<button id="selectedCameraView">Mirar por esta cámara</button>` : '';
  const renderMaterial = selected.material;
  const emission = renderMaterial?.emissive ? `<div class="section-label">EMISIÓN</div><label class="prop-label">Color emisión<input id="emissionColor" type="color"></label><label class="prop-label">Intensidad<input id="emissionIntensity" type="number" min="0" max="10" step="0.1" value="${renderMaterial.emissiveIntensity || 0}"></label>` : '';
  props.innerHTML = `${cameraAction}<label class="prop-label">Nombre<input id="objectName" type="text" maxlength="50"></label>
    <label class="prop-label">Color<input id="objectColor" type="color"></label>
    ${emission}<div class="section-label">POSICIÓN</div>${field('X', 0, p.x, 'position')}${field('Y', 1, p.y, 'position')}${field('Z', 2, p.z, 'position')}
    <div class="section-label">ROTACIÓN</div>${field('X', 0, THREE.MathUtils.radToDeg(r.x), 'rotation')}${field('Y', 1, THREE.MathUtils.radToDeg(r.y), 'rotation')}${field('Z', 2, THREE.MathUtils.radToDeg(r.z), 'rotation')}
    <div class="section-label">ESCALA</div>${field('X', 0, s.x, 'scale')}${field('Y', 1, s.y, 'scale')}${field('Z', 2, s.z, 'scale')}`;
  const nameInput = $('#objectName');
  nameInput.value = selected.name;
  nameInput.addEventListener('change', () => { selected.name = safeName(nameInput.value); refreshList(); saveCurrentProject(); });
  const colorInput = $('#objectColor');
  colorInput.value = `#${selected.material?.color?.getHexString?.() || 'ffffff'}`;
  colorInput.addEventListener('input', () => { selected.material?.color?.set(colorInput.value); scheduleProjectSave(); });
  if (selected.material?.emissive) {
    $('#emissionColor').value = `#${selected.material.emissive.getHexString()}`;
    $('#emissionColor').addEventListener('input', (event) => selected.material?.emissive?.set(event.target.value));
    $('#emissionIntensity').addEventListener('input', (event) => { if (selected.material) selected.material.emissiveIntensity = Math.max(0, Number(event.target.value) || 0); });
  }
  $('#selectedCameraView')?.addEventListener('click', () => enterCameraView(selected));
  props.querySelectorAll('[data-axis]').forEach((input) => input.addEventListener('change', () => {
    const axis = Number(input.dataset.axis);
    const value = Number(input.value) || 0;
    if (input.dataset.kind === 'position') selected.position.setComponent(axis, value);
    if (input.dataset.kind === 'rotation') selected.rotation.setComponent(axis, THREE.MathUtils.degToRad(value));
    if (input.dataset.kind === 'scale') selected.scale.setComponent(axis, Math.max(0.01, value));
    if (selected.isCamera && selected.userData.helper) selected.userData.helper.update();
    if (selected.userData.helper?.update) selected.userData.helper.update();
    saveCurrentProject();
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
  if (selected.userData.helper) scene.remove(selected.userData.helper);
  objects.splice(objects.indexOf(selected), 1);
  if (selected === viewCameraObject) viewCameraObject = objects.find((item) => item.isCamera) || null;
  selected = null;
  $('#enterCamera').hidden = !viewCameraObject;
  refreshList();
  renderProperties();
  updateStatus();
  saveCurrentProject();
}
function snapshot() {
  return { format: 'editor-3d-scene', version: 3, objects: objects.filter((object) => object.userData.kind !== 'Modelo').map((object) => ({
    name: object.name, kind: object.userData.kind || 'Cubo', position: object.position.toArray(),
    rotation: object.rotation.toArray(), scale: object.scale.toArray(),
    color: `#${object.material?.color?.getHexString?.() || object.color?.getHexString?.() || 'ffffff'}`,
    intensity: object.intensity, distance: object.distance, angle: object.angle, penumbra: object.penumbra,
    fov: object.fov, near: object.near, far: object.far
  })) };
}
function projectList() { try { return JSON.parse(localStorage.getItem('editor3d:projects') || '[]'); } catch { return []; } }
function writeProjectList(items) { localStorage.setItem('editor3d:projects', JSON.stringify(items)); }
let projectSaveTimer = null;
function scheduleProjectSave() { clearTimeout(projectSaveTimer); projectSaveTimer = setTimeout(saveCurrentProject, 350); }
function saveCurrentProject() {
  if (!currentProjectId) return;
  const projects = projectList();
  const project = projects.find((item) => item.id === currentProjectId);
  if (!project) return;
  project.scene = snapshot(); project.updatedAt = Date.now();
  writeProjectList(projects); renderProjectCards();
}
function renderProjectCards() {
  const grid = $('#projectGrid'), empty = $('#emptyProjects');
  if (!grid) return;
  grid.replaceChildren();
  const projects = projectList();
  empty.hidden = projects.length > 0;
  for (const project of projects) {
    const card = document.createElement('button'); card.className = 'project-card';
    const preview = document.createElement('span'); preview.className = 'project-preview'; preview.textContent = '⬡';
    const title = document.createElement('b'); title.textContent = project.name;
    const date = document.createElement('small'); date.textContent = `Editado ${new Date(project.updatedAt || project.createdAt).toLocaleDateString()}`;
    card.append(preview, title, date); card.addEventListener('click', () => openProject(project.id)); grid.append(card);
  }
}
function openProject(id) {
  const project = projectList().find((item) => item.id === id);
  if (!project) return;
  currentProjectId = id;
  localStorage.setItem('editor3d:last-project', id);
  $('#projectHome').hidden = true; $('#app').hidden = false;
  if (project.scene) loadScene(project.scene);
  else addObject('Cubo');
  if (!objects.length) addObject('Cubo');
  $('#home').title = project.name; updateStatus();
}
function createProject() {
  const dialog = $('#projectDialog'); dialog.hidden = false;
  const input = $('#projectNameInput'); input.value = ''; input.focus();
}
function confirmCreateProject() {
  const name = ($('#projectNameInput').value || '').trim();
  if (!name) { $('#projectNameInput').focus(); return; }
  const item = { id: `p-${Date.now()}`, name: safeName(name), createdAt: Date.now(), updatedAt: Date.now(), scene: { format: 'editor-3d-scene', version: 2, objects: [] } };
  const projects = projectList(); projects.unshift(item); writeProjectList(projects); $('#projectDialog').hidden = true; renderProjectCards(); openProject(item.id);
}
function returnToProjects() { saveCurrentProject(); $('#app').hidden = true; $('#projectHome').hidden = false; renderProjectCards(); }
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function openRenderDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('editor3d-storage', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storeRenderFolder(handle) {
  try { const db = await openRenderDb(); await new Promise((resolve, reject) => { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(handle, 'render-folder'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch {}
}
async function restoreRenderFolder() {
  try { const db = await openRenderDb(); return await new Promise((resolve, reject) => { const req = db.transaction('handles').objectStore('handles').get('render-folder'); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); } catch { return null; }
}
async function blobToBase64(blob) {
  return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
async function saveBlobToChosenFolder(name, blob) {
  if (Capacitor.isNativePlatform()) {
    const data = await blobToBase64(blob);
    await NativeRenderExport.saveFile({ name, mimeType: blob.type || 'application/octet-stream', data });
    toast(`Guardado en carpeta elegida: ${name}`); return;
  }
  if (!renderFolderHandle) throw new Error('Elige una carpeta de exportación primero');
  let permission = await renderFolderHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') permission = await renderFolderHandle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('El navegador no concedió permiso de escritura');
  const handle = await renderFolderHandle.getFileHandle(name, { create: true });
  const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
  localStorage.setItem('editor3d:render-folder-name', renderFolderHandle.name || 'Carpeta elegida');
  $('#renderPath').value = renderFolderHandle.name || 'Carpeta elegida'; toast(`Guardado: ${name}`);
}
function readRenderFolderName() { return localStorage.getItem('editor3d:render-folder-name') || ''; }
async function loadNativeRenderFolder() {
  if (!Capacitor.isNativePlatform()) return;
  try { const result = await NativeRenderExport.getFolder(); if (result.displayName) { localStorage.setItem('editor3d:render-folder-name', result.displayName); $('#renderPath').value = result.displayName; } } catch {}
}
function renderSize() {
  const mode = $('#renderResolution').value;
  if (mode === '1080') return [1920, 1080];
  if (mode === '720') return [1280, 720];
  return [Math.max(2, container.clientWidth & ~1), Math.max(2, container.clientHeight & ~1)];
}
function captureRenderFrame(width, height) {
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize);
  const oldRatio = renderer.getPixelRatio();
  const renderCamera = cameraMode ? activeCamera : camera;
  const oldAspect = renderCamera.aspect;
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  composer.setPixelRatio(1); composer.setSize(width, height);
  renderCamera.aspect = width / height; renderCamera.updateProjectionMatrix();
  sceneRenderPass.camera = renderCamera;
  if (postEnabled) composer.render(); else renderer.render(scene, renderCamera);
  const canvas = renderer.domElement;
  const blobUrl = canvas.toDataURL('image/png');
  renderer.setPixelRatio(oldRatio); renderer.setSize(oldSize.x, oldSize.y, false);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.9)); composer.setSize(oldSize.x, oldSize.y);
  renderCamera.aspect = oldAspect; renderCamera.updateProjectionMatrix();
  sceneRenderPass.camera = cameraMode ? activeCamera : camera;
  return blobUrl;
}
async function exportPng() {
  const [width, height] = renderSize();
  try {
    const dataUrl = captureRenderFrame(width, height);
    const blob = await (await fetch(dataUrl)).blob();
    if (Capacitor.isNativePlatform() || renderFolderHandle) {
      try { await saveBlobToChosenFolder(`render-${Date.now()}.png`, blob); $('#renderStatus').textContent = 'PNG guardado en la carpeta elegida.'; return; } catch (error) { $('#renderStatus').textContent = error.message || 'No se pudo usar la carpeta elegida.'; }
    }
    download(`render-${Date.now()}.png`, blob, 'image/png');
    $('#renderStatus').textContent = 'PNG exportado a Descargas. Si tu Android no permite elegir carpeta en esta WebView, usa el selector de archivos del sistema.';
  } catch (error) { toast(`No se pudo exportar PNG: ${error.message || error}`); }
}
async function exportMp4() {
  const duration = Math.max(1, Math.min(30, Number($('#renderDuration').value) || 5));
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    toast('Este WebView no ofrece codificación H.264 MP4.');
    $('#renderStatus').textContent = 'No se generó MP4: este WebView no incluye WebCodecs H.264. PNG funciona; MP4 requiere un Android/WebView compatible.';
    return;
  }
  const [width, height] = renderSize();
  const config = { codec: 'avc1.42001f', width, height, bitrate: 6000000, framerate: 24 };
  const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) { $('#renderStatus').textContent = 'El dispositivo no ofrece H.264 para MP4 en este WebView; no se guardó un video con extensión incorrecta.'; toast('Codificador MP4 no disponible'); return; }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(renderer.domElement, { codec: 'avc', quality: new Quality({ bitrate: 6000000 }) });
  output.addVideoTrack(videoSource, { frameRate: 24 });
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize); const oldRatio = renderer.getPixelRatio(); const renderCamera = cameraMode ? activeCamera : camera; const oldAspect = renderCamera.aspect;
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); composer.setPixelRatio(1); composer.setSize(width, height); renderCamera.aspect = width / height; renderCamera.updateProjectionMatrix();
  sceneRenderPass.camera = renderCamera;
  $('#renderStatus').textContent = `Renderizando MP4 · ${duration} s…`;
  try {
    await output.start();
    const total = duration * 24;
    for (let index = 0; index < total; index++) {
      if (keyframes.size) interpolatePose(Math.round(index / Math.max(1, total - 1) * 120));
      else if (importedMixer && importedAnimationAction) importedMixer.setTime(index / 24);
      if (postEnabled) composer.render(); else renderer.render(scene, renderCamera);
      await videoSource.add(index / 24, 1 / 24);
      if (index % 6 === 0) { $('#renderStatus').textContent = `Renderizando MP4 · ${Math.floor(index / total * 100)}%`; await new Promise((resolve) => requestAnimationFrame(resolve)); }
    }
    await output.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' }); const name = `render-${Date.now()}.mp4`;
    if (renderFolderHandle) { try { await saveBlobToChosenFolder(name, blob); } catch (error) { download(name, blob, 'video/mp4'); $('#renderStatus').textContent = `${error.message || 'Carpeta inaccesible'} · MP4 descargado a Descargas.`; } }
    else download(name, blob, 'video/mp4');
    $('#renderStatus').textContent = 'MP4 H.264 exportado.'; toast('Render MP4 listo');
  } catch (error) { console.error(error); toast(`No se pudo renderizar MP4: ${error.message || error}`); $('#renderStatus').textContent = `Falló la exportación MP4: ${error.message || error}`; }
  finally { renderer.setPixelRatio(oldRatio); renderer.setSize(oldSize.x, oldSize.y, false); composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.9)); composer.setSize(oldSize.x, oldSize.y); renderCamera.aspect = oldAspect; renderCamera.updateProjectionMatrix(); sceneRenderPass.camera = cameraMode ? activeCamera : camera; if (keyframes.size) interpolatePose(currentFrame); }
}
let renderFolderHandle = null;
async function chooseRenderFolder() {
  if (Capacitor.isNativePlatform()) {
    try { const result = await NativeRenderExport.chooseFolder(); const name = result.displayName || 'Carpeta elegida'; localStorage.setItem('editor3d:render-folder-name', name); $('#renderPath').value = name; $('#renderStatus').textContent = 'La app tiene permiso persistente para exportar PNG y MP4 en esta carpeta.'; return; }
    catch (error) { if (!String(error?.message || error).includes('canceled')) { $('#renderStatus').textContent = `No se pudo elegir carpeta: ${error.message || error}`; toast('Falló el selector de carpeta'); } return; }
  }
  if (window.showDirectoryPicker) {
    try { renderFolderHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); await storeRenderFolder(renderFolderHandle); const name = renderFolderHandle.name || 'Carpeta elegida'; localStorage.setItem('editor3d:render-folder-name', name); $('#renderPath').value = name; $('#renderStatus').textContent = 'Carpeta recordada; Android puede volver a pedir permiso al exportar.'; return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  $('#renderStatus').textContent = 'Este navegador no admite elegir una carpeta; el archivo exportado se descargará a Descargas.';
  toast('Elige carpeta no está disponible en este navegador');
}
function saveScene() {
  download('mi-escena-3d.json', JSON.stringify(snapshot(), null, 2), 'application/json');
  toast('Escena guardada');
}
function loadScene(data) {
  if (data?.format !== 'editor-3d-scene' || !Array.isArray(data.objects)) throw new Error('Archivo de escena no válido');
  for (const object of [...objects]) { scene.remove(object); if (object.userData.helper) scene.remove(object.userData.helper); }
  for (const marker of boneDots.values()) scene.remove(marker);
  boneDots.clear(); objects.length = 0; assetObjects.length = 0; selected = null; currentModel = null; boneTarget = null; importedMixer = null; importedClips = []; importedAnimationAction = null; viewCameraObject = null; $('#animationPanel').querySelector('.clip-box')?.remove();
  $('#enterCamera').hidden = true; if (cameraMode) exitCameraView();
  for (const item of data.objects.slice(0, 300)) {
    let object;
    if (item.kind === 'Cámara') { addAsset('camera'); object = objects.at(-1); }
    else if (item.kind === 'Luz puntual') { addAsset('point'); object = objects.at(-1); }
    else if (item.kind === 'Luz direccional') { addAsset('directional'); object = objects.at(-1); }
    else if (item.kind === 'Luz ambiente') { addAsset('ambient'); object = objects.at(-1); }
    else object = addObject(item.kind === 'Esfera' ? 'Esfera' : item.kind === 'Plano' ? 'Plano' : 'Cubo', Array.isArray(item.position) ? item.position : [0, 0.65, 0], item.color);
    object.name = safeName(item.name);
    object.position.fromArray(Array.isArray(item.position) ? item.position : [0, 0.65, 0]);
    object.rotation.fromArray(Array.isArray(item.rotation) ? item.rotation : [0, 0, 0]);
    object.scale.fromArray(Array.isArray(item.scale) ? item.scale : [1, 1, 1]);
    if (object.isLight) { object.intensity = item.intensity ?? object.intensity; if ('distance' in object) object.distance = item.distance ?? object.distance; if ('angle' in object) object.angle = item.angle ?? object.angle; if ('penumbra' in object) object.penumbra = item.penumbra ?? object.penumbra; }
    if (object.isCamera) { object.fov = item.fov || object.fov; object.near = item.near || object.near; object.far = item.far || object.far; object.updateProjectionMatrix(); object.userData.helper?.update(); viewCameraObject = object; }
  }
  if (viewCameraObject) $('#enterCamera').hidden = false;
  refreshList(); renderProperties(); updateStatus(); saveCurrentProject(); toast('Escena importada');
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
    if (importedAnimationAction) { importedAnimationAction.stop(); importedAnimationAction = null; }
    scene.add(model); objects.push(model); currentModel = model; boneTarget = null; select(model); makeBoneMarkers(model);
    importedClips = gltf.animations || [];
    importedMixer = importedClips.length ? new THREE.AnimationMixer(model) : null;
    if (importedMixer) {
      $('#animationPanel').querySelector('.clip-box')?.remove();
      const clipBox = document.createElement('div'); clipBox.className = 'clip-box';
      const clipTitle = document.createElement('span'); clipTitle.textContent = 'ANIMACIONES DEL MODELO'; clipBox.append(clipTitle);
      importedClips.forEach((clip, index) => {
        const play = document.createElement('button'); play.textContent = `▶ ${clip.name || `Clip ${index + 1}`}`;
        play.addEventListener('click', () => {
          importedMixer.stopAllAction();
          importedAnimationAction = importedMixer.clipAction(clip); importedAnimationAction.reset().play();
          $('#animMode').dataset.clip = 'playing'; toast(`Reproduciendo ${clip.name || `Clip ${index + 1}`}`);
        }); clipBox.append(play);
      });
      const own = document.createElement('button'); own.textContent = '✎ Crear animación propia';
      own.addEventListener('click', () => stopImportedClipPreservingPose()); clipBox.append(own);
      $('#animationPanel').append(clipBox);
    }
    rebuildTimeline(); updateStatus(); toast(allBones().length ? `Modelo importado · ${allBones().length} huesos · ${importedClips.length} clips` : 'Modelo importado · sin armature'); URL.revokeObjectURL(url);
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
function stopImportedClipPreservingPose() {
  if (importedMixer) {
    const bones = allBones();
    const saved = new Map(bones.map((bone) => [bone.uuid, readTransform(bone)]));
    importedMixer.stopAllAction(); importedAnimationAction = null; importedMixer.setTime(0);
    for (const bone of bones) writeTransform(bone, saved.get(bone.uuid));
    currentModel?.updateMatrixWorld(true); updateBoneMarkers();
  }
  if (currentModel) { animationMode = true; document.body.classList.add('animating'); $('#animationPanel').hidden = false; $('#animationTimeline').hidden = false; $('#animMode').innerHTML = 'Animation <span>⌄</span>'; }
  activeAnimationTarget = boneTarget || allBones()[0] || selected;
  if (activeAnimationTarget?.isBone) { boneTarget = activeAnimationTarget; window.editorGizmo?.attach(boneTarget); window.editorGizmo?.setMode('rotate'); }
  rebuildTimeline(); toast('Clip detenido · edición manual');
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
  if (importedAnimationAction) stopImportedClipPreservingPose();
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
  if (animationMode && importedAnimationAction) stopImportedClipPreservingPose();
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
  const inputFrame = Number($('#frameNumber').value);
  const frame = Math.max(0, Math.min(120, Number.isFinite(inputFrame) ? inputFrame : currentFrame));
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
  const aspect = rect.width / rect.height;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  for (const object of objects) if (object.isCamera) { object.aspect = aspect; object.updateProjectionMatrix(); object.userData.helper?.update(); }
  if (cameraMode && activeCamera) { activeCamera.aspect = aspect; activeCamera.updateProjectionMatrix(); }
}
function enterCameraView(selectedCamera = viewCameraObject) {
  if (!selectedCamera?.isCamera) { toast('Selecciona una cámara en la jerarquía'); return; }
  activeCamera = selectedCamera;
  cameraMode = true;
  sceneRenderPass.camera = activeCamera;
  $('#enterCamera').hidden = true;
  $('#exitCamera').hidden = false;
  orbit.enabled = false;
  $('#hint').textContent = `Vista de ${selectedCamera.name} · Pulsa Salir para volver`;
  toast(`Mirando por ${selectedCamera.name}`);
}
function exitCameraView() {
  cameraMode = false;
  activeCamera = camera;
  sceneRenderPass.camera = camera;
  $('#enterCamera').hidden = !viewCameraObject;
  $('#exitCamera').hidden = true;
  orbit.enabled = true;
  $('#hint').textContent = 'Arrastra para orbitar · pellizca para acercar';
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
$('#createProject').addEventListener('click', createProject);
$('#createProjectEmpty').addEventListener('click', createProject);
$('#confirmProject').addEventListener('click', confirmCreateProject);
$('#cancelProject').addEventListener('click', () => { $('#projectDialog').hidden = true; });
$('#projectNameInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmCreateProject(); if (event.key === 'Escape') $('#projectDialog').hidden = true; });
$('#openProjects').addEventListener('click', returnToProjects);
$('#home').addEventListener('click', returnToProjects);
$('#enterCamera').addEventListener('click', () => enterCameraView(selected?.isCamera ? selected : viewCameraObject));
$('#exitCamera').addEventListener('click', exitCameraView);
$('#selectCameraView').addEventListener('click', () => { const cameras = objects.filter((item) => item.isCamera); if (!cameras.length) { toast('Añade una cámara desde Assets'); return; } const index = cameras.indexOf(viewCameraObject); viewCameraObject = cameras[(index + 1) % cameras.length]; toast(`Cámara activa: ${viewCameraObject.name}`); });
$('#renderOpen').addEventListener('click', async () => { $('#renderPanel').hidden = !$('#renderPanel').hidden; $('#renderPath').value = readRenderFolderName(); if (Capacitor.isNativePlatform()) await loadNativeRenderFolder(); else if (!renderFolderHandle) renderFolderHandle = await restoreRenderFolder(); });
$('#renderClose').addEventListener('click', () => { $('#renderPanel').hidden = true; });
$('#chooseRenderPath').addEventListener('click', chooseRenderFolder);
$('#renderFormat').addEventListener('change', (event) => { $('#startRender').textContent = event.target.value === 'png' ? 'Exportar PNG' : 'Exportar MP4'; $('#renderDuration').hidden = event.target.value !== 'mp4'; });
$('#startRender').addEventListener('click', () => $('#renderFormat').value === 'png' ? exportPng() : exportMp4());
$('#addCube').addEventListener('click', () => addObject('Cubo'));
$('#addSphere').addEventListener('click', () => addObject('Esfera'));
$('#delete').addEventListener('click', removeSelected);
$('#addMenu')?.addEventListener('click', () => addObject('Cubo'));
$('#save').addEventListener('click', () => { saveCurrentProject(); saveScene(); });
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
  if (importedAnimationAction) stopImportedClipPreservingPose();
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

// Open the project library first; the editor initializes only after the user opens/creates a project.
resize();
renderProjectCards();
function frame() {
  requestAnimationFrame(frame);
  orbit.update();
  lightPostPass.uniforms.time.value += 0.016;
  if (importedMixer && importedAnimationAction) importedMixer.update(1 / 60);
  if (postEnabled) { sceneRenderPass.camera = cameraMode ? activeCamera : camera; composer.render(); }
  else renderer.render(scene, cameraMode ? activeCamera : camera);
}
frame();
