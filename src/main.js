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
import { Reflector } from 'three/addons/objects/Reflector.js';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import { Capacitor, registerPlugin } from '@capacitor/core';
const NativeRenderExport = registerPlugin('RenderExport');
import '../style.css';

const $ = (selector) => document.querySelector(selector);
const container = $('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#3d3b38');
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
let materialTargetUuid = null;
let animationLoop = true;
let importedMixer = null;
let importedClips = [];
let importedAnimationAction = null;
let activeCamera = camera;
let viewCameraObject = null;
let cameraMode = false;
let currentProjectId = null;
let loadingProjectScene = false;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor('#3d3b38', 1);
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
  gizmo.addEventListener('objectChange', () => { lightingBaked=false; renderProperties(); updateBoneMarkers(); if (gizmo.object?.userData.helper) gizmo.object.userData.helper.update(); scheduleProjectSave(); });
  window.editorGizmo = gizmo;
} catch (error) {
  console.error('Editor 3D startup error:', error);
  showFatal(error?.message || String(error));
  throw error;
}

scene.add(new THREE.HemisphereLight(0xfff5e8, 0x5b5148, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(5, 9, 6);
sun.castShadow = false; // Bake a single shadow map when rendering; no per-frame shadow cost.
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x96999d, 0x606266);
grid.position.y = -0.01;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#292a2c', roughness: 0.32, metalness: 0.06 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.025;
ground.receiveShadow = true;
scene.add(ground);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); // Lower-resolution post FX for mobile GPUs.
const sceneRenderPass = new RenderPass(scene, camera);
composer.addPass(sceneRenderPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.55, 0.72);
composer.addPass(bloomPass);
const lightPostPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.012 }, vignette: { value: 0.22 }, contrast: { value: 1.16 }, saturation: { value: 0.92 }, warmth: { value: 0.035 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float time;uniform float grain;uniform float vignette;uniform float contrast;uniform float saturation;uniform float warmth;varying vec2 vUv;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+time*17.0)*43758.5453);}void main(){vec4 c=texture2D(tDiffuse,vUv);float n=(hash(gl_FragCoord.xy)-0.5)*grain;float v=1.0-vignette*smoothstep(0.28,0.78,distance(vUv,vec2(0.5)));float lum=dot(c.rgb,vec3(0.2126,0.7152,0.0722));c.rgb=mix(vec3(lum),c.rgb,saturation);c.rgb=(c.rgb-0.5)*contrast+0.5;c.rgb+=vec3(warmth*0.85,warmth*0.22,-warmth*0.35);c.rgb=c.rgb*v+n;gl_FragColor=c;}`
});
composer.addPass(lightPostPass);
composer.addPass(new OutputPass());
let postEnabled = false;
let lightingBaked = false;
let lightingBakePromise = null;
let renderMaterialMesh = null;
let wetFloorEnabled = false;
let emissiveBloomActive = false;
const wetReflector = new Reflector(new THREE.PlaneGeometry(60,60), {clipBias:0.003, textureWidth:768, textureHeight:768, color:0x90949a});
wetReflector.rotation.x=-Math.PI/2; wetReflector.position.y=-0.019; wetReflector.visible=false; wetReflector.userData.editorGuide=true;
const reflectorRender=wetReflector.onBeforeRender;
wetReflector.userData.capturePending=false;wetReflector.onBeforeRender=function(...args){if(this.userData.capturePending&&!this.userData.frozen){reflectorRender.apply(this,args);this.userData.frozen=true;this.userData.capturePending=false;this.onBeforeRender=()=>{};}};
scene.add(wetReflector);

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
  lightingBaked=false;
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
    object.position.set(0, 2.2, 7);
    object.up.set(0,1,0); object.lookAt(0, 1, 0); object.rotation.z=0;
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
    const helper = new THREE.PointLightHelper(object, 0.14, '#b8c2c7');
    object.userData.helper = helper;
    scene.add(helper);
    object.userData.helper.update();
  } else if (kind === 'directional') {
    object = new THREE.DirectionalLight(0xffffff, 1.2);
    object.position.set(3, 5, 2);
    object.name = `Luz direccional ${suffix}`;
    object.castShadow = false;
    object.userData.kind = 'Luz direccional';
    const helper = new THREE.DirectionalLightHelper(object, 0.35, '#b8c2c7');
    object.userData.helper = helper;
    scene.add(helper);
    object.userData.helper.update();
  } else if (kind === 'ambient') {
    object = new THREE.HemisphereLight(0xfff1dc, 0x594d43, 0.7);
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
  if(!$('#materialPanel').hidden) refreshMaterialPanel();
  refreshBoneList();
}
function addObject(kind = 'Cubo', position = [0, 0.65, 0], color = null) {
  lightingBaked=false;
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
function materialTargetsFor(object) { const result=[]; if(object?.isMesh)result.push(object); else object?.traverse?.(node=>{if(node.isMesh)result.push(node);}); return result; }
function materialListFor(mesh) { return (Array.isArray(mesh?.material)?mesh.material:[mesh?.material]).filter(Boolean); }
function hasEmissiveMeshes(){return objects.some(object=>{let found=false;object.traverse?.(node=>{if(node.isMesh&&materialListFor(node).some(mat=>mat.emissive&&mat.emissiveIntensity>0))found=true;});return found;});}
function usePostPipeline(){bloomPass.enabled=postEnabled||emissiveBloomActive;lightPostPass.enabled=postEnabled;return postEnabled||emissiveBloomActive;}
function applyTextureShader(material, mode) {
  material.userData ||= {}; material.userData.editorShader=mode; material.wireframe=mode==='wire';
  const key=`editor-style-${mode}`; material.customProgramCacheKey=()=>key;
  if(mode==='original'){material.wireframe=false;material.onBeforeCompile=()=>{};material.needsUpdate=true;return;}
  material.onBeforeCompile=(shader)=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat styleLum=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\n${mode==='toon'?'float band=floor(styleLum*4.0)/3.0; diffuseColor.rgb*=max(0.28,band);':mode==='sketch'?'float hatch=step(0.5,fract((gl_FragCoord.x+gl_FragCoord.y)*0.18)); float ink=smoothstep(0.18,0.68,styleLum); diffuseColor.rgb*=mix(vec3(0.28),vec3(1.0),mix(ink,hatch,0.55));':mode==='dots'?'float dotPattern=step(0.42,length(fract(gl_FragCoord.xy*0.075)-0.5)); diffuseColor.rgb*=mix(vec3(0.12),vec3(1.0),dotPattern);':mode==='notepad'?'float lines=step(0.82,fract(gl_FragCoord.y*0.045)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.08,0.20,0.42),lines*0.75);':mode==='hope'?'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.15,0.95,1.0),0.24+0.22*sin(gl_FragCoord.y*0.035));':mode==='wire'?'float wireLine=step(0.90,fract(gl_FragCoord.x*0.075))*step(0.90,fract(gl_FragCoord.y*0.075)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.05,0.85,1.0),wireLine*0.8);':'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.92,0.62,0.30),0.18);'}\n`);
  }; material.needsUpdate=true;
}
function refreshMaterialPanel() {
  const panel=$('#materialPanel'); if(!panel||panel.hidden)return;
  const meshes=materialTargetsFor(selected); const chooser=$('#materialMeshTarget'); chooser.replaceChildren();
  meshes.forEach((mesh,index)=>{const opt=document.createElement('option');opt.value=mesh.uuid;opt.textContent=safeName(mesh.name||`Malla ${index+1}`);chooser.append(opt);});
  if(!meshes.length){$('#materialTargetName').textContent='Selecciona una malla en la escena';return;}
  renderMaterialMesh=meshes.find(mesh=>mesh.uuid===renderMaterialMesh?.uuid)||meshes[0];chooser.value=renderMaterialMesh.uuid;
  const mats=materialListFor(renderMaterialMesh);const mat=mats[0];if(!mat)return;
  $('#materialTargetName').textContent=`${selected?.name||'Objeto'} · ${renderMaterialMesh.name||'Malla'}`;
  $('#materialColor').value=`#${mat.color?.getHexString?.()||'ffffff'}`;$('#baseTextureFile').value='';$('#roughnessTextureFile').value='';$('#normalTextureFile').value='';
  $('#materialRoughness').value=String(mat.roughness??0.55);$('#roughnessValue').value=Number(mat.roughness??0.55).toFixed(2);
  $('#materialMetalness').value=String(mat.metalness??0.05);$('#metalnessValue').value=Number(mat.metalness??0.05).toFixed(2);
  $('#materialEmissive').value=`#${mat.emissive?.getHexString?.()||'000000'}`;$('#materialEmissionPower').value=String(mat.emissiveIntensity||0);$('#emissionValue').value=Number(mat.emissiveIntensity||0).toFixed(2);
  $('#materialShader').value=mat.userData?.editorShader||'original';$('#normalStrength').value=String(mat.normalScale?.x??1);$('#normalStrengthValue').value=Number(mat.normalScale?.x??1).toFixed(2);
}
function editTargetMaterials(edit) { lightingBaked=false; for(const mat of materialListFor(renderMaterialMesh))edit(mat);emissiveBloomActive=hasEmissiveMeshes();usePostPipeline();scheduleProjectSave(); }
function importMaterialMap(file,inputId,mapKey,userDataKey,colorSpace) {
  if(!file||!renderMaterialMesh)return;
  const targetMesh=renderMaterialMesh;const targetMaterials=materialListFor(targetMesh);const url=URL.createObjectURL(file);lightingBaked=false;new THREE.TextureLoader().load(url,texture=>{URL.revokeObjectURL(url);texture.colorSpace=colorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;for(const mat of targetMaterials){mat[mapKey]=texture;mat.userData ||= {};}scheduleProjectSave();urlToDataUrl(file,mapKey).then(data=>{for(const mat of targetMaterials){mat.userData ||= {};mat.userData[userDataKey]=data;}scheduleProjectSave();}).catch(error=>toast(`No se pudo guardar el mapa: ${error.message||error}`));toast(`${inputId} aplicado sobre la textura original`);},undefined,error=>{URL.revokeObjectURL(url);toast(`No se pudo cargar el mapa: ${error?.message||error}`);});
}
function urlToDataUrl(file,mapKey='map'){return new Promise((resolve,reject)=>{createImageBitmap(file).then(bitmap=>{const scale=Math.min(1,768/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();canvas.toBlob(blob=>{if(!blob){reject(new Error('No se pudo optimizar el mapa'));return;}const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);},mapKey==='map'?'image/webp':'image/png',mapKey==='map'?0.9:undefined);}).catch(reject);});}

function applyWetFloor() {
  wetFloorEnabled=!wetFloorEnabled; lightingBaked=false;
  ground.material.roughness=wetFloorEnabled?0.035:0.32;ground.material.metalness=wetFloorEnabled?0.92:0.06;
  ground.visible=!wetFloorEnabled; wetReflector.visible=wetFloorEnabled; wetReflector.userData.frozen=false; wetReflector.userData.capturePending=false;wetReflector.onBeforeRender=function(...args){if(this.userData.capturePending&&!this.userData.frozen){reflectorRender.apply(this,args);this.userData.frozen=true;this.userData.capturePending=false;this.onBeforeRender=()=>{};}};
  ground.material.needsUpdate=true;$('#wetFloor').textContent=wetFloorEnabled?'Quitar acabado mojado':'Aplicar piso mojado';
  if(wetFloorEnabled&&!lightingBaked){toast('Precalculando reflejos y sombras · espera 5 s…');prepareRenderLighting();}else toast(wetFloorEnabled?'Acabado mojado aplicado':'Piso restaurado');
}
async function prepareRenderLighting() {
  if(lightingBakePromise)return lightingBakePromise;
  if(lightingBaked)return;
  lightingBakePromise=(async()=>{
    const status=$('#renderStatus');status.textContent='Precalculando iluminación, sombras y reflejos · espera 5 s…';
    await new Promise(resolve=>setTimeout(resolve,5000));
    const restore=hideEditorGuidesForRender();const groundWasVisible=ground.visible;ground.visible=!wetFloorEnabled;wetReflector.visible=wetFloorEnabled;wetReflector.userData.frozen=false;wetReflector.userData.capturePending=true;wetReflector.onBeforeRender=function(...args){if(this.userData.capturePending&&!this.userData.frozen){reflectorRender.apply(this,args);this.userData.frozen=true;this.userData.capturePending=false;this.onBeforeRender=()=>{};}};
    try {
      renderer.shadowMap.enabled=true;sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-18;sun.shadow.camera.right=18;sun.shadow.camera.top=18;sun.shadow.camera.bottom=-18;sun.shadow.camera.near=0.5;sun.shadow.camera.far=60;sun.shadow.bias=-0.0003;sun.shadow.camera.updateProjectionMatrix();
      for(const object of objects)object.traverse?.(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
      renderer.shadowMap.needsUpdate=true;
      renderer.render(scene,cameraMode?activeCamera:camera);lightingBaked=true;
      status.textContent='Iluminación, sombras y reflejos precalculados.';
    } finally {if(!wetFloorEnabled){wetReflector.visible=false;ground.visible=groundWasVisible;}restore();lightingBakePromise=null;}
  })();return lightingBakePromise;
}
function renderProperties() {
  if (!selected) {
    props.textContent = 'Selecciona un objeto';
    return;
  }
  const p = selected.position;
  const r = selected.rotation;
  const s = selected.scale;
  const cameraAction = selected.isCamera ? `<button id="selectedCameraView">Mirar por esta cámara</button><button id="alignCameraView">Alinear con la vista actual</button><div class="section-label">CÁMARA</div><label class="prop-label">Campo de visión <span><input id="cameraFov" type="range" min="20" max="100" step="1" value="${selected.fov}"><output>${Math.round(selected.fov)}°</output></span></label><label class="prop-label">Plano cercano<input id="cameraNear" type="number" min="0.01" step="0.01" value="${selected.near}"></label><label class="prop-label">Plano lejano<input id="cameraFar" type="number" min="10" step="10" value="${selected.far}"></label>` : '';
  const lightEditor=selected.isLight?`<div class="section-label">LUZ</div><label class="prop-label">Color<input id="lightColor" type="color" value="#${selected.color?.getHexString?.()||'ffffff'}"></label><label class="prop-label">Intensidad <span><input id="lightIntensity" type="range" min="0" max="12" step="0.05" value="${selected.intensity}"><output>${Number(selected.intensity).toFixed(2)}</output></span></label>${'distance' in selected?`<label class="prop-label">Rango <span><input id="lightDistance" type="range" min="0" max="50" step="0.25" value="${selected.distance}"><output>${Number(selected.distance).toFixed(2)}</output></span></label>`:''}${'angle' in selected?`<label class="prop-label">Ángulo <span><input id="lightAngle" type="range" min="0.05" max="1.4" step="0.01" value="${selected.angle}"><output>${THREE.MathUtils.radToDeg(selected.angle).toFixed(0)}°</output></span></label><label class="prop-label">Penumbra <span><input id="lightPenumbra" type="range" min="0" max="1" step="0.01" value="${selected.penumbra}"><output>${Number(selected.penumbra).toFixed(2)}</output></span></label>`:''}`:'';
  props.innerHTML = `${cameraAction}<label class="prop-label">Nombre<input id="objectName" type="text" maxlength="50"></label>${lightEditor}
    <div class="section-label">POSICIÓN</div>${field('X', 0, p.x, 'position')}${field('Y', 1, p.y, 'position')}${field('Z', 2, p.z, 'position')}
    <div class="section-label">ROTACIÓN</div>${field('X', 0, THREE.MathUtils.radToDeg(r.x), 'rotation')}${field('Y', 1, THREE.MathUtils.radToDeg(r.y), 'rotation')}${field('Z', 2, THREE.MathUtils.radToDeg(r.z), 'rotation')}
    <div class="section-label">ESCALA</div>${field('X', 0, s.x, 'scale')}${field('Y', 1, s.y, 'scale')}${field('Z', 2, s.z, 'scale')}`;
  const nameInput=$('#objectName');nameInput.value=selected.name;
  nameInput.addEventListener('change',()=>{selected.name=safeName(nameInput.value);refreshList();saveCurrentProject();});
  $('#selectedCameraView')?.addEventListener('click', () => enterCameraView(selected));
  $('#alignCameraView')?.addEventListener('click',()=>{selected.position.copy(camera.position);selected.quaternion.copy(camera.quaternion);selected.up.set(0,1,0);selected.lookAt(orbit.target);selected.updateProjectionMatrix();selected.userData.helper?.update();scheduleProjectSave();toast('Cámara alineada con la vista del editor');});
  const lightChanged=()=>{lightingBaked=false;selected.userData.helper?.update?.();scheduleProjectSave();};
  $('#lightColor')?.addEventListener('input',e=>{selected.color.set(e.target.value);lightChanged();});
  $('#lightIntensity')?.addEventListener('input',e=>{selected.intensity=Number(e.target.value);e.target.nextElementSibling.value=selected.intensity.toFixed(2);lightChanged();});
  $('#lightDistance')?.addEventListener('input',e=>{selected.distance=Number(e.target.value);e.target.nextElementSibling.value=selected.distance.toFixed(2);lightChanged();});
  $('#lightAngle')?.addEventListener('input',e=>{selected.angle=Number(e.target.value);e.target.nextElementSibling.value=`${THREE.MathUtils.radToDeg(selected.angle).toFixed(0)}°`;lightChanged();});
  $('#lightPenumbra')?.addEventListener('input',e=>{selected.penumbra=Number(e.target.value);e.target.nextElementSibling.value=selected.penumbra.toFixed(2);lightChanged();});
  $('#cameraFov')?.addEventListener('input',e=>{selected.fov=Number(e.target.value);selected.updateProjectionMatrix();e.target.nextElementSibling.value=`${selected.fov}°`;selected.userData.helper?.update();scheduleProjectSave();});
  $('#cameraNear')?.addEventListener('change',e=>{selected.near=Math.max(0.01,Number(e.target.value)||0.1);selected.updateProjectionMatrix();selected.userData.helper?.update();scheduleProjectSave();});
  $('#cameraFar')?.addEventListener('change',e=>{selected.far=Math.max(selected.near+1,Number(e.target.value)||100);selected.updateProjectionMatrix();selected.userData.helper?.update();scheduleProjectSave();});
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
function duplicateSelected() {
  if(!selected){toast('Selecciona un objeto para duplicar');return;}
  lightingBaked=false;const originalHelper=selected.userData.helper;selected.userData.helper=null;let copy;try{copy=selected.clone(true);}finally{selected.userData.helper=originalHelper;}copy.name=`${selected.name} copia`;copy.position.x+=0.35;copy.userData={...copy.userData,helper:null};
  copy.traverse(node=>{if(node.isMesh){const mats=Array.isArray(node.material)?node.material: [node.material];const cloned=mats.map(mat=>mat.clone());node.material=Array.isArray(node.material)?cloned:cloned[0];node.castShadow=true;node.receiveShadow=true;}});
  if(copy.userData.helper){scene.remove(copy.userData.helper);copy.userData.helper=null;}
  if(copy.isLight){copy.userData.helper=copy.isPointLight?new THREE.PointLightHelper(copy,0.14,'#9aa0a6'):copy.isDirectionalLight?new THREE.DirectionalLightHelper(copy,0.35,'#9aa0a6'):null;if(copy.userData.helper)scene.add(copy.userData.helper);assetObjects.push(copy);}
  if(copy.isCamera){copy.userData.helper=new THREE.CameraHelper(copy);scene.add(copy.userData.helper);viewCameraObject=copy;$('#enterCamera').hidden=false;}
  scene.add(copy);objects.push(copy);select(copy);rebuildTimeline();updateStatus();saveCurrentProject();toast('Objeto duplicado');
}
function removeSelected() {
  if (!selected) return;
  lightingBaked=false;
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
  return { format: 'editor-3d-scene', version: 4, renderSettings:{wetFloorEnabled,postLook:$('#postLook')?.value||'cinematic',postEnabled}, objects: objects.map((object) => ({
    name: object.name, kind: object.userData.kind || 'Cubo', assetKey: object.userData.kind === 'Modelo' ? (object.userData.assetKey || null) : undefined, position: object.position.toArray(),
    rotation: object.rotation.toArray(), scale: object.scale.toArray(),
    color: `#${object.material?.color?.getHexString?.() || object.color?.getHexString?.() || 'ffffff'}`,
    materials: (()=>{const rows=[];object.traverse?.(node=>{if(node.isMesh){const mats=Array.isArray(node.material)?node.material:[node.material];rows.push({nodeName:node.name,materials:mats.map(mat=>({color:mat.color?`#${mat.color.getHexString()}`:null,roughness:mat.roughness,metalness:mat.metalness,emissive:mat.emissive?`#${mat.emissive.getHexString()}`:null,emissiveIntensity:mat.emissiveIntensity,editorShader:mat.userData?.editorShader||'original',baseTextureData:mat.userData?.baseTextureData||null,roughnessTextureData:mat.userData?.roughnessTextureData||null,normalTextureData:mat.userData?.normalTextureData||null,normalScale:mat.normalScale?.toArray?.()||[1,1]}))});}});if(object.isMesh){const mats=Array.isArray(object.material)?object.material:[object.material];rows.push({nodeName:object.name,materials:mats.map(mat=>({color:mat.color?`#${mat.color.getHexString()}`:null,roughness:mat.roughness,metalness:mat.metalness,emissive:mat.emissive?`#${mat.emissive.getHexString()}`:null,emissiveIntensity:mat.emissiveIntensity,editorShader:mat.userData?.editorShader||'original',baseTextureData:mat.userData?.baseTextureData||null,roughnessTextureData:mat.userData?.roughnessTextureData||null,normalTextureData:mat.userData?.normalTextureData||null,normalScale:mat.normalScale?.toArray?.()||[1,1]}))});}return rows;})(),
    intensity: object.intensity, lightColor:object.color?`#${object.color.getHexString()}`:null, distance: object.distance, angle: object.angle, penumbra: object.penumbra,
    fov: object.fov, near: object.near, far: object.far
  })) };
}
function projectList() { try { return JSON.parse(localStorage.getItem('editor3d:projects') || '[]'); } catch { return []; } }
function writeProjectList(items) { localStorage.setItem('editor3d:projects', JSON.stringify(items)); }
let projectSaveTimer = null;
function scheduleProjectSave() { clearTimeout(projectSaveTimer); projectSaveTimer = setTimeout(saveCurrentProject, 350); }
function saveCurrentProject() {
  if (loadingProjectScene || !currentProjectId) return;
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
async function openProject(id) {
  const project = projectList().find((item) => item.id === id);
  if (!project) return;
  currentProjectId = id;
  localStorage.setItem('editor3d:last-project', id);
  $('#projectHome').hidden = true; $('#app').hidden = false;
  if (project.scene) await loadScene(project.scene);
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
async function returnToProjects() { saveCurrentProject(); $('#app').hidden = true; $('#projectHome').hidden = false; renderProjectCards(); }
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function openRenderDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('editor3d-storage', 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles'); if (!db.objectStoreNames.contains('model-assets')) db.createObjectStore('model-assets'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storeRenderFolder(handle) {
  try { const db = await openRenderDb(); await new Promise((resolve, reject) => { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(handle, 'render-folder'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch {}
}
async function storeModelAsset(key, blob) { const db = await openRenderDb(); await new Promise((resolve, reject) => { const tx = db.transaction('model-assets', 'readwrite'); tx.objectStore('model-assets').put(blob, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function getModelAsset(key) { const db = await openRenderDb(); return await new Promise((resolve, reject) => { const req = db.transaction('model-assets').objectStore('model-assets').get(key); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); }
async function persistModelAsset(model, clips) {
  const key = model.userData.assetKey; const position=model.position.clone(), rotation=model.quaternion.clone(), scale=model.scale.clone();
  model.position.set(0,0,0); model.quaternion.identity(); model.scale.set(1,1,1); model.updateMatrixWorld(true);
  try { await new Promise((resolve,reject) => new GLTFExporter().parse(model, async (result) => { try { await storeModelAsset(key,new Blob([result],{type:'model/gltf-binary'})); resolve(); } catch(error) { reject(error); } }, reject, {binary:true,animations:clips||[]})); }
  finally { model.position.copy(position); model.quaternion.copy(rotation); model.scale.copy(scale); model.updateMatrixWorld(true); }
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
  if (mode === '1440') return [2560, 1440];
  if (mode === '1080') return [1920, 1080];
  if (mode === '720') return [1280, 720];
  return [Math.max(2, container.clientWidth & ~1), Math.max(2, container.clientHeight & ~1)];
}
function hideEditorGuidesForRender() {
  const restore=[];
  const hide=node=>{if(!node)return;restore.push([node,node.visible]);node.visible=false;};
  hide(grid); hide(window.editorGizmo?.getHelper());
  for(const object of objects) hide(object.userData.helper);
  for(const marker of boneDots.values()) hide(marker);
  return ()=>{for(const [node,visible] of restore)node.visible=visible;};
}
function captureRenderFrame(width, height) {
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize);
  const oldRatio = renderer.getPixelRatio();
  const renderCamera = cameraMode ? activeCamera : camera;
  const oldAspect = renderCamera.aspect;
  const restoreGuides=hideEditorGuidesForRender();
  try {
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    composer.setPixelRatio(1); composer.setSize(width, height);
    renderCamera.aspect = width / height; renderCamera.updateProjectionMatrix();
    sceneRenderPass.camera = renderCamera;
    if (usePostPipeline()) composer.render(); else renderer.render(scene, renderCamera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    restoreGuides();
    renderer.setPixelRatio(oldRatio); renderer.setSize(oldSize.x, oldSize.y, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); composer.setSize(oldSize.x, oldSize.y);
    renderCamera.aspect = oldAspect; renderCamera.updateProjectionMatrix();
    sceneRenderPass.camera = cameraMode ? activeCamera : camera;
  }
}
async function exportPng() {
  try {
    await prepareRenderLighting();
    const [width, height] = renderSize();
    const dataUrl = captureRenderFrame(width, height);
    const blob = await (await fetch(dataUrl)).blob();
    if (Capacitor.isNativePlatform() || renderFolderHandle) {
      try { await saveBlobToChosenFolder(`render-${Date.now()}.png`, blob); $('#renderStatus').textContent = 'PNG guardado en la carpeta elegida.'; return; } catch (error) { $('#renderStatus').textContent = `Error guardando PNG: ${error.message || error}`; toast(`No se pudo guardar PNG: ${error.message || error}`); return; }
    }
    download(`render-${Date.now()}.png`, blob, 'image/png');
    $('#renderStatus').textContent = 'PNG exportado a Descargas. Si tu Android no permite elegir carpeta en esta WebView, usa el selector de archivos del sistema.';
  } catch (error) { toast(`No se pudo exportar PNG: ${error.message || error}`); }
}
async function exportMp4() {
  await prepareRenderLighting();
  const duration = Math.max(1, Math.min(15, Number($('#renderDuration').value) || 5));
  if (Capacitor.isNativePlatform()) { await exportMp4Native(duration); return; }
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    toast('Este WebView no ofrece codificación H.264 MP4.');
    $('#renderStatus').textContent = 'No se generó MP4: este WebView no incluye WebCodecs H.264. PNG funciona; MP4 requiere un Android/WebView compatible.';
    return;
  }
  const [width, height] = renderSize();
  const config = { codec: 'avc1.640028', width, height, bitrate: 16000000, framerate: 30 };
  let support = await VideoEncoder.isConfigSupported(config).catch(() => null);
  if(!support?.supported){config.codec='avc1.42001f';config.bitrate=9000000;config.framerate=24;support=await VideoEncoder.isConfigSupported(config).catch(()=>null);}
  if (!support?.supported) { $('#renderStatus').textContent = 'El dispositivo no ofrece H.264 para MP4 en este WebView; no se guardó un video con extensión incorrecta.'; toast('Codificador MP4 no disponible'); return; }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const renderCanvas = renderer.domElement;
  const videoSource = new CanvasSource(renderCanvas, { codec: 'avc', quality: new Quality({ bitrate: config.bitrate }) });
  const fps = config.framerate; output.addVideoTrack(videoSource, { frameRate: fps });
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize); const oldRatio = renderer.getPixelRatio(); const renderCamera = cameraMode ? activeCamera : camera; const oldAspect = renderCamera.aspect;
  const restoreGuides=hideEditorGuidesForRender();
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); composer.setPixelRatio(1); composer.setSize(width, height); renderCamera.aspect = width / height; renderCamera.updateProjectionMatrix();
  sceneRenderPass.camera = renderCamera;
  $('#renderStatus').textContent = `Renderizando MP4 · ${duration} s…`;
  try {
    await output.start();
    const total = duration * fps;
    for (let index = 0; index < total; index++) {
      if (keyframes.size) interpolatePose(Math.round(index / Math.max(1, total - 1) * 120));
      else if (importedMixer && importedAnimationAction) importedMixer.setTime(index / fps);
      if (usePostPipeline()) composer.render(); else renderer.render(scene, renderCamera);
      await videoSource.add(index / fps, 1 / fps);
      if (index % 10 === 0) { $('#renderStatus').textContent = `Renderizando MP4 · ${Math.floor(index / total * 100)}%`; await new Promise((resolve) => requestAnimationFrame(resolve)); }
    }
    await output.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' }); const name = `render-${Date.now()}.mp4`;
    if (Capacitor.isNativePlatform() || renderFolderHandle) await saveBlobToChosenFolder(name, blob);
    else download(name, blob, 'video/mp4');
    $('#renderStatus').textContent = 'MP4 H.264 exportado.'; toast('Render MP4 listo');
  } catch (error) { console.error(error); toast(`No se pudo renderizar MP4: ${error.message || error}`); $('#renderStatus').textContent = `Falló la exportación MP4: ${error.message || error}`; }
  finally { restoreGuides(); renderer.setPixelRatio(oldRatio); renderer.setSize(oldSize.x, oldSize.y, false); composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); composer.setSize(oldSize.x, oldSize.y); renderCamera.aspect = oldAspect; renderCamera.updateProjectionMatrix(); sceneRenderPass.camera = cameraMode ? activeCamera : camera; if (keyframes.size) interpolatePose(currentFrame); }
}
async function exportMp4Native(duration) {
  const [width,height]=renderSize(), fps=30, total=duration*fps, renderCamera=cameraMode?activeCamera:camera;
  const oldSize=new THREE.Vector2();renderer.getSize(oldSize);const oldRatio=renderer.getPixelRatio(),oldAspect=renderCamera.aspect;
  const restoreGuides=hideEditorGuidesForRender();
  try {
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);composer.setPixelRatio(1);composer.setSize(width,height);renderCamera.aspect=width/height;renderCamera.updateProjectionMatrix();sceneRenderPass.camera=renderCamera;
    await NativeRenderExport.startVideo({width,height,fps});$('#renderStatus').textContent=`Renderizando MP4 · ${duration} s…`;
    for(let i=0;i<total;i++){if(keyframes.size)interpolatePose(Math.round(i/Math.max(1,total-1)*120));else if(importedMixer&&importedAnimationAction)importedMixer.setTime(i/fps);if(usePostPipeline())composer.render();else renderer.render(scene,renderCamera);const jpeg=renderer.domElement.toDataURL('image/jpeg',0.94).split(',')[1];await NativeRenderExport.addVideoFrame({jpeg});if(i%3===0){$('#renderStatus').textContent=`Renderizando MP4 · ${Math.floor((i+1)/total*100)}%`;await new Promise(resolve=>requestAnimationFrame(resolve));}}
    await NativeRenderExport.finishVideo();$('#renderStatus').textContent='MP4 guardado en la carpeta elegida.';toast('Exportación MP4 lista');
  } catch(error){console.error(error);$('#renderStatus').textContent=`Falló la exportación MP4: ${error.message||error}`;toast(`No se pudo exportar MP4: ${error.message||error}`);}
  finally{restoreGuides();renderer.setPixelRatio(oldRatio);renderer.setSize(oldSize.x,oldSize.y,false);composer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));composer.setSize(oldSize.x,oldSize.y);renderCamera.aspect=oldAspect;renderCamera.updateProjectionMatrix();sceneRenderPass.camera=cameraMode?activeCamera:camera;if(keyframes.size)interpolatePose(currentFrame);}
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
async function saveScene() {
  const data=snapshot(); data.modelAssets=[];
  try { for (const object of objects.filter(item=>item.userData.kind==='Modelo'&&item.userData.assetKey)) { const blob=await getModelAsset(object.userData.assetKey); if(!blob) continue; const bytes=new Uint8Array(await blob.arrayBuffer()); let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); data.modelAssets.push({key:object.userData.assetKey,data:btoa(binary)}); } download('mi-escena-3d.json',JSON.stringify(data,null,2),'application/json'); toast('Escena y modelos guardados'); } catch(error) { console.error(error); toast(`No se pudo guardar escena: ${error.message||error}`); }
}
function restoreMaterialSnapshots(root, rows) {
  if(!Array.isArray(rows))return;const meshes=[];if(root.isMesh)meshes.push(root);root.traverse?.(node=>{if(node.isMesh)meshes.push(node);});
  for(let i=0;i<Math.min(meshes.length,rows.length);i++){const mats=Array.isArray(meshes[i].material)?meshes[i].material:[meshes[i].material];const saved=rows[i].materials||[];for(let j=0;j<Math.min(mats.length,saved.length);j++){const mat=mats[j],state=saved[j];if(state.color)mat.color?.set(state.color);if(Number.isFinite(state.roughness)&&'roughness'in mat)mat.roughness=state.roughness;if(Number.isFinite(state.metalness)&&'metalness'in mat)mat.metalness=state.metalness;if(state.emissive)mat.emissive?.set(state.emissive);if(Number.isFinite(state.emissiveIntensity)&&'emissiveIntensity'in mat)mat.emissiveIntensity=state.emissiveIntensity;if(state.editorShader)applyTextureShader(mat,state.editorShader);for(const [mapKey,dataKey] of [['map','baseTextureData'],['roughnessMap','roughnessTextureData'],['normalMap','normalTextureData']])if(state[dataKey]){new THREE.TextureLoader().load(state[dataKey],texture=>{texture.colorSpace=mapKey==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;mat[mapKey]=texture;mat.needsUpdate=true;});mat.userData ||= {};mat.userData[dataKey]=state[dataKey];}if(Array.isArray(state.normalScale)&&mat.normalScale)mat.normalScale.fromArray(state.normalScale);mat.needsUpdate=true;}}
}
async function loadScene(data) {
  if(data.renderSettings){wetFloorEnabled=!!data.renderSettings.wetFloorEnabled;ground.visible=!wetFloorEnabled;wetReflector.visible=wetFloorEnabled;ground.material.roughness=wetFloorEnabled?0.035:0.32;ground.material.metalness=wetFloorEnabled?0.92:0.06;$('#wetFloor').textContent=wetFloorEnabled?'Quitar acabado mojado':'Aplicar piso mojado';$('#postLook').value=data.renderSettings.postLook||'cinematic';postEnabled=!!data.renderSettings.postEnabled;$('#postToggle').classList.toggle('active',postEnabled);bloomPass.enabled=postEnabled;lightPostPass.enabled=postEnabled;if(postEnabled)applyPostLook($('#postLook').value);}
  if (Array.isArray(data?.modelAssets)) for (const asset of data.modelAssets) if (asset?.key&&asset?.data) { const binary=atob(asset.data); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); await storeModelAsset(asset.key,new Blob([bytes],{type:'model/gltf-binary'})); }
  if (data?.format !== 'editor-3d-scene' || !Array.isArray(data.objects)) throw new Error('Archivo de escena no válido');
  for (const object of [...objects]) { scene.remove(object); if (object.userData.helper) scene.remove(object.userData.helper); }
  for (const marker of boneDots.values()) scene.remove(marker);
  boneDots.clear(); objects.length = 0; assetObjects.length = 0; selected = null; currentModel = null; boneTarget = null; importedMixer = null; importedClips = []; importedAnimationAction = null; viewCameraObject = null; $('#animationPanel').querySelector('.clip-box')?.remove();
  $('#enterCamera').hidden = true; if (cameraMode) exitCameraView();
  loadingProjectScene = true;
  const modelItems=[];
  for (const item of data.objects.slice(0, 300)) {
    if(item.kind==='Modelo'){modelItems.push(item);continue;}
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
    restoreMaterialSnapshots(object,item.materials);
    if (object.isLight) { if(item.lightColor)object.color.set(item.lightColor); object.intensity = item.intensity ?? object.intensity; if ('distance' in object) object.distance = item.distance ?? object.distance; if ('angle' in object) object.angle = item.angle ?? object.angle; if ('penumbra' in object) object.penumbra = item.penumbra ?? object.penumbra; }
    if (object.isCamera) { object.fov = item.fov || object.fov; object.near = item.near || object.near; object.far = item.far || object.far; object.updateProjectionMatrix(); object.userData.helper?.update(); viewCameraObject = object; }
  }
  for(const item of modelItems){if(!item.assetKey)continue;try{const blob=await getModelAsset(item.assetKey);if(!blob)continue;const buffer=await blob.arrayBuffer();await new Promise((resolve,reject)=>new GLTFLoader().parse(buffer,'',(gltf)=>{const model=gltf.scene;model.name=safeName(item.name||'Modelo');model.userData.kind='Modelo';model.userData.assetKey=item.assetKey;model.position.fromArray(item.position||[0,0,0]);model.rotation.fromArray(item.rotation||[0,0,0]);model.scale.fromArray(item.scale||[1,1,1]);restoreMaterialSnapshots(model,item.materials);model.traverse(child=>{if(child.isMesh){child.castShadow=true;child.receiveShadow=true;}});scene.add(model);objects.push(model);currentModel=model;importedClips=gltf.animations||[];importedMixer=importedClips.length?new THREE.AnimationMixer(model):null;makeBoneMarkers(model);resolve();},reject));}catch(error){console.warn('Could not restore imported model',error);}}
  loadingProjectScene=false;emissiveBloomActive=hasEmissiveMeshes();usePostPipeline();
  if (viewCameraObject) $('#enterCamera').hidden = false;
  refreshList(); renderProperties(); updateStatus(); saveCurrentProject(); toast('Escena y modelos cargados');
}
function importFile(file) {
  if (!file) return;
  lightingBaked=false;
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
    emissiveBloomActive=hasEmissiveMeshes();usePostPipeline();
    if (importedAnimationAction) { importedAnimationAction.stop(); importedAnimationAction = null; }
    model.userData.assetKey = `model-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    scene.add(model); objects.push(model); currentModel = model; boneTarget = null; select(model); makeBoneMarkers(model);
    importedClips = gltf.animations || [];
    persistModelAsset(model, importedClips).then(() => { saveCurrentProject(); toast('Modelo y animaciones guardados en el proyecto'); }).catch(error => { console.error(error); toast('No se pudo guardar el modelo importado'); });
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
  const markerCamera = cameraMode ? activeCamera : camera;
  markerCamera.updateMatrixWorld();
  currentModel.updateMatrixWorld(true);
  const worldPosition = new THREE.Vector3();
  const height = Math.max(1, container.clientHeight);
  for (const [bone, marker] of boneDots) {
    marker.visible = animationMode;
    if (!animationMode) continue;
    bone.getWorldPosition(worldPosition);
    marker.position.copy(worldPosition);
    const distance = Math.max(0.1, markerCamera.position.distanceTo(worldPosition));
    const radius = THREE.MathUtils.clamp(2.8 * 2 * distance * Math.tan(THREE.MathUtils.degToRad(markerCamera.fov * 0.5)) / height, 0.006, 0.04);
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
    if(currentFrame>=120){if(!animationLoop){isPlaying=false;$('#playAnimation').textContent='▶';clearInterval(playTimer);return;}currentFrame=0;}else currentFrame++;
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
      const screen = bone.getWorldPosition(new THREE.Vector3()).project(cameraMode ? activeCamera : camera);
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
$('#materialPanelToggle').addEventListener('click',()=>{const panel=$('#materialPanel'),workspace=$('#workspace');const opening=panel.hidden;panel.hidden=!opening;if(opening){workspace.classList.remove('hide-objects');workspace.classList.add('show-material');refreshMaterialPanel();}else{workspace.classList.remove('show-material','hide-objects');}});
$('#materialClose').addEventListener('click',()=>{$('#materialPanel').hidden=true;$('#workspace').classList.remove('show-material','hide-objects');});
$('#objectsPanelToggle').addEventListener('click',()=>{const workspace=$('#workspace');if(workspace.classList.contains('show-material')){$('#materialPanel').hidden=true;workspace.classList.remove('show-material','hide-objects');return;}workspace.classList.toggle('hide-objects');});
$('#materialMeshTarget').addEventListener('change',event=>{renderMaterialMesh=materialTargetsFor(selected).find(mesh=>mesh.uuid===event.target.value)||null;refreshMaterialPanel();});
$('#materialColor').addEventListener('input',event=>editTargetMaterials(mat=>mat.color?.set(event.target.value)));
$('#materialRoughness').addEventListener('input',event=>{const value=Number(event.target.value);$('#roughnessValue').value=value.toFixed(2);editTargetMaterials(mat=>{if('roughness'in mat)mat.roughness=value;});});
$('#materialMetalness').addEventListener('input',event=>{const value=Number(event.target.value);$('#metalnessValue').value=value.toFixed(2);editTargetMaterials(mat=>{if('metalness'in mat)mat.metalness=value;});});
$('#materialEmissive').addEventListener('input',event=>editTargetMaterials(mat=>mat.emissive?.set(event.target.value)));
$('#materialEmissionPower').addEventListener('input',event=>{const value=Number(event.target.value);$('#emissionValue').value=value.toFixed(2);editTargetMaterials(mat=>{if(mat.emissive)mat.emissiveIntensity=value;});});
$('#materialShader').addEventListener('change',event=>editTargetMaterials(mat=>applyTextureShader(mat,event.target.value)));
$('#baseTextureFile').addEventListener('change',e=>importMaterialMap(e.target.files?.[0],'Textura base','map','baseTextureData',THREE.SRGBColorSpace));
$('#roughnessTextureFile').addEventListener('change',e=>importMaterialMap(e.target.files?.[0],'Mapa roughness','roughnessMap','roughnessTextureData',THREE.NoColorSpace));
$('#normalTextureFile').addEventListener('change',e=>importMaterialMap(e.target.files?.[0],'Mapa normal','normalMap','normalTextureData',THREE.NoColorSpace));
$('#normalStrength').addEventListener('input',e=>{const value=Number(e.target.value);$('#normalStrengthValue').value=value.toFixed(2);editTargetMaterials(mat=>mat.normalScale?.set(value,value));});
$('#wetFloor').addEventListener('click',applyWetFloor);
$('#bakeLighting').addEventListener('click',()=>{lightingBaked=false;prepareRenderLighting();});
$('#renderOpen').addEventListener('click', async () => { $('#renderPanel').hidden = !$('#renderPanel').hidden; $('#renderPath').value = readRenderFolderName(); if (Capacitor.isNativePlatform()) await loadNativeRenderFolder(); else if (!renderFolderHandle) renderFolderHandle = await restoreRenderFolder(); });
$('#renderClose').addEventListener('click', () => { $('#renderPanel').hidden = true; });
$('#chooseRenderPath').addEventListener('click', chooseRenderFolder);
$('#renderFormat').addEventListener('change', (event) => { $('#startRender').textContent = event.target.value === 'png' ? 'Exportar PNG' : 'Exportar MP4'; $('#renderDuration').hidden = event.target.value !== 'mp4'; });
$('#startRender').addEventListener('click', () => $('#renderFormat').value === 'png' ? exportPng() : exportMp4());
$('#addCube').addEventListener('click', () => addObject('Cubo'));
$('#addSphere').addEventListener('click', () => addObject('Esfera'));
$('#delete').addEventListener('click', removeSelected);
$('#duplicate').addEventListener('click',duplicateSelected);
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
$('#animationLoop').addEventListener('change',event=>{animationLoop=event.target.checked;toast(animationLoop?'Ciclo de animación activado':'Ciclo de animación detenido');});
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
function applyPostLook(name) {
  const look = name === 'warm' ? {contrast:1.22,saturation:1.08,warmth:0.075,vignette:0.27,grain:0.01,bloom:0.36} : (name === 'neutral' ? {contrast:1.04,saturation:1,warmth:0.005,vignette:0.08,grain:0,bloom:0.12} : {contrast:1.08,saturation:0.98,warmth:0.015,vignette:0.15,grain:0.006,bloom:0.2});
  const u=lightPostPass.uniforms;u.contrast.value=look.contrast;u.saturation.value=look.saturation;u.warmth.value=look.warmth;u.vignette.value=look.vignette;u.grain.value=look.grain;bloomPass.strength=look.bloom;
}
$('#postLook').addEventListener('change',event=>{applyPostLook(event.target.value);postEnabled=true;$('#postToggle').classList.add('active');bloomPass.enabled=true;lightPostPass.enabled=true;lightingBaked=false;saveCurrentProject();prepareRenderLighting();toast('Acabado actualizado · precalculando');});
$('#postToggle').addEventListener('click', (event) => {
  postEnabled = !postEnabled;
  event.currentTarget.classList.toggle('active', postEnabled);
  bloomPass.enabled = postEnabled;
  lightPostPass.enabled = postEnabled;
  if(postEnabled) { applyPostLook($('#postLook').value||'cinematic'); prepareRenderLighting(); }
  toast(postEnabled ? 'Postprocesado activado · calculando sombras y reflejos' : 'Postprocesado desactivado');
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
  if (currentModel && animationMode) updateBoneMarkers();
  if (usePostPipeline()) { sceneRenderPass.camera = cameraMode ? activeCamera : camera; composer.render(); }
  else renderer.render(scene, cameraMode ? activeCamera : camera);
}
frame();
