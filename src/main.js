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
const keyframes = new Map();
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
  gizmo.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value; });
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

const composer = new EffectComposer(renderer);
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
    if (target && activeTool !== 'select') {
      window.editorGizmo.attach(target);
      window.editorGizmo.setMode(activeTool);
    } else if (target && animationMode) {
      window.editorGizmo.attach(target);
      window.editorGizmo.setMode('translate');
    } else window.editorGizmo.detach();
  }
  refreshList();
  renderProperties();
  refreshBoneList();
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
    scene.add(model); objects.push(model); currentModel = model; boneTarget = null; select(model); refreshBoneList(); updateStatus(); toast(allBones().length ? `Modelo importado · ${allBones().length} huesos` : 'Modelo importado · sin armature'); URL.revokeObjectURL(url);
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
function refreshBoneList() {
  const panel = $('#boneList');
  if (!panel) return;
  panel.replaceChildren();
  const bones = allBones();
  if (!currentModel || bones.length === 0) {
    panel.textContent = 'Importa un GLB riggeado para editar huesos';
    return;
  }
  for (const bone of bones) {
    const row = document.createElement('div');
    row.className = `bone-row${bone === boneTarget ? ' selected' : ''}`;
    const pick = document.createElement('button');
    pick.textContent = `🦴 ${bone.name || 'Hueso'}`;
    pick.addEventListener('click', () => {
      boneTarget = bone;
      window.editorGizmo?.attach(bone);
      window.editorGizmo?.setMode('rotate');
      refreshBoneList();
      toast(`Hueso: ${bone.name || 'Hueso'}`);
    });
    row.append(pick);
    panel.append(row);
  }
}
function toggleAnimationMode() {
  animationMode = !animationMode;
  document.body.classList.toggle('animating', animationMode);
  $('#animationPanel').hidden = !animationMode;
  $('#animMode').innerHTML = animationMode ? 'Pose Mode <span>⌄</span>' : 'Object Mode <span>⌄</span>';
  if (animationMode) {
    if (currentModel) refreshBoneList();
    hint.textContent = 'Modo animación · selecciona un hueso y agrega keyframes';
    if (boneTarget) { window.editorGizmo?.attach(boneTarget); window.editorGizmo?.setMode('rotate'); }
  } else {
    boneTarget = null;
    if (selected && activeTool !== 'select') { window.editorGizmo?.attach(selected); window.editorGizmo?.setMode(activeTool); }
    else window.editorGizmo?.detach();
    hint.textContent = 'Arrastra para orbitar · pellizca para acercar';
  }
}
function readTransform(node) {
  return { position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray() };
}
function writeTransform(node, state) {
  if (!node || !state) return;
  node.position.fromArray(state.position);
  node.quaternion.fromArray(state.quaternion);
  node.scale.fromArray(state.scale);
}
function captureKeyframe() {
  const frame = Math.max(0, Math.min(120, Number($('#frameNumber').value) || currentFrame));
  currentFrame = frame;
  const pose = new Map();
  for (const object of objects) pose.set(object.uuid, readTransform(object));
  for (const bone of allBones()) pose.set(bone.uuid, readTransform(bone));
  keyframes.set(frame, pose);
  updateFrameControls();
  toast(`Keyframe guardado · ${frame}`);
}
function poseAt(frame, pose) {
  for (const object of objects) if (pose.has(object.uuid)) writeTransform(object, pose.get(object.uuid));
  for (const bone of allBones()) if (pose.has(bone.uuid)) writeTransform(bone, pose.get(bone.uuid));
}
function updateFrameControls() {
  $('#frameRange').value = String(currentFrame);
  $('#frameNumber').value = String(currentFrame);
  const panel = $('#animationPanel');
  panel?.querySelectorAll('.frame-tick').forEach((node) => node.remove());
  for (const frame of keyframes.keys()) {
    const tick = document.createElement('span');
    tick.className = 'frame-tick';
    tick.textContent = '◆';
    tick.title = `Keyframe ${frame}`;
    tick.style.left = `${(frame / 120) * 100}%`;
    $('#frameRange').parentElement.append(tick);
  }
}
function setFrame(frame) {
  currentFrame = Math.max(0, Math.min(120, Number(frame) || 0));
  const saved = keyframes.get(currentFrame);
  if (saved) poseAt(currentFrame, saved);
  updateFrameControls();
}
function togglePlayback() {
  isPlaying = !isPlaying;
  $('#playAnimation').textContent = isPlaying ? '❚❚' : '▶';
  clearInterval(playTimer);
  if (isPlaying) playTimer = setInterval(() => {
    currentFrame = currentFrame >= 120 ? 0 : currentFrame + 1;
    const frames = [...keyframes.keys()].sort((a, b) => a - b);
    if (frames.length) {
      let before = frames.filter((f) => f <= currentFrame).at(-1);
      let after = frames.find((f) => f >= currentFrame);
      if (before === undefined) before = frames[0];
      if (after === undefined) after = frames.at(-1);
      const a = keyframes.get(before), b = keyframes.get(after);
      const t = before === after ? 0 : (currentFrame - before) / (after - before);
      for (const node of [...objects, ...allBones()]) {
        const start = a.get(node.uuid), end = b.get(node.uuid);
        if (!start || !end) continue;
        node.position.fromArray(start.position).lerp(new THREE.Vector3(...end.position), t);
        node.scale.fromArray(start.scale).lerp(new THREE.Vector3(...end.scale), t);
        node.quaternion.fromArray(start.quaternion).slerp(new THREE.Quaternion(...end.quaternion), t);
      }
    }
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
$('#addMenu')?.addEventListener('click', () => addObject('Cubo'));
$('#save').addEventListener('click', saveScene);
$('#exportScene').addEventListener('click', exportGlb);
$('#importScene').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { importFile(fileInput.files?.[0]); fileInput.value = ''; });
$('#gridToggle').addEventListener('click', () => { gridVisible = !gridVisible; grid.visible = gridVisible; });
$('#frame').addEventListener('click', () => { orbit.target.set(0, 0.6, 0); camera.position.set(5, 4, 7); orbit.update(); });
$('#undo').addEventListener('click', () => toast('Deshacer todavía no está disponible'));
$('#animMode').addEventListener('click', toggleAnimationMode);
$('#addKeyframe').addEventListener('click', captureKeyframe);
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
