import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import { Capacitor, registerPlugin } from '@capacitor/core';
const NativeRenderExport = registerPlugin('RenderExport');
import '../style.css';

const $ = (selector) => document.querySelector(selector);
const container = $('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000');
let cameraVisualTemplatePromise=null;
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
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
let ikDragState = null;
const IK_FK_MAP = {
  'head':['hips','pelvis','spine','spine_01','spine_02','spine_03','neck','neck_01','head'],
  'arm_l':['clavicle_l','shoulder_l','upperarm_l','upper_arm_l','arm_l','lowerarm_l','lower_arm_l','forearm_l','hand_l','wrist_l'],
  'arm_r':['clavicle_r','shoulder_r','upperarm_r','upper_arm_r','arm_r','lowerarm_r','lower_arm_r','forearm_r','hand_r','wrist_r'],
  'leg_l':['hips','pelvis','thigh_l','upperleg_l','upper_leg_l','leg_l','calf_l','lowerleg_l','lower_leg_l','shin_l','foot_l','ankle_l','ball_l'],
  'leg_r':['hips','pelvis','thigh_r','upperleg_r','upper_leg_r','leg_r','calf_r','lowerleg_r','lower_leg_r','shin_r','foot_r','ankle_r','ball_r']
};
let activeCamera = camera;
let viewCameraObject = null;
let cameraMode = false;
let currentProjectId = null;
let loadingProjectScene = false;
let boneTarget = null;
let activeAnimationTarget = null;
let assetCount = 0;
const keyframes = new Map();
const animationTrackIds = new Set();
let copiedKeyframe = null;
let autoKeyEnabled = false;
let animationInterpolation='linear';
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
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.82));
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.transmissionResolutionScale=0.45;
  renderer.setClearColor('#000000', 1);
  container.append(renderer.domElement);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.09;
  orbit.target.set(0, 0.6, 0);
  orbit.minDistance = 1.6;
  orbit.maxDistance = 40;
  const gizmo = new TransformControls(camera, renderer.domElement);
  orbit.addEventListener('start',()=>beginInteractiveMotion());
  orbit.addEventListener('end',()=>endInteractiveMotion());
  renderer.domElement.addEventListener('pointerdown',()=>beginInteractiveMotion(),{passive:true});
  renderer.domElement.addEventListener('pointerup',()=>endInteractiveMotion(),{passive:true});
  renderer.domElement.addEventListener('pointercancel',()=>endInteractiveMotion(),{passive:true});
  scene.add(gizmo.getHelper());
  gizmo.setSize(1.18);
  gizmo.addEventListener('dragging-changed', (event) => { event.value?beginInteractiveMotion():endInteractiveMotion();orbit.enabled = !event.value;if(event.value&&gizmo.object?.isBone)beginIkDrag(gizmo.object);else if(!event.value&&ikDragState){solveIkDrag();scheduleProjectSave();ikDragState=null;}if(!event.value&&animationMode&&autoKeyEnabled&&gizmo.object)captureKeyframe(gizmo.object); });
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
  gizmo.addEventListener('objectChange', () => { if(gizmo.object?.isBone&&ikDragState)solveIkDrag();markSceneLightingDirty(); if(gizmo.object?.isObject3D&&!gizmo.object.isBone)markReflectionDirty(); renderProperties(); updateBoneMarkers(); if (gizmo.object?.userData.helper) gizmo.object.userData.helper.update(); scheduleProjectSave(); });
  window.editorGizmo = gizmo;
} catch (error) {
  console.error('Editor 3D startup error:', error);
  showFatal(error?.message || String(error));
  throw error;
}

scene.add(new THREE.HemisphereLight(0xfff5e8, 0x211c19, 0.38));
const studioFill = new THREE.DirectionalLight(0x9bbcff, 0.34);studioFill.position.set(-6,4,-5);scene.add(studioFill);
const studioRim = new THREE.DirectionalLight(0xffd5a3, 0.42);studioRim.position.set(-4,6,7);scene.add(studioRim);
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(5, 9, 6);
sun.castShadow = false;
sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;sun.shadow.camera.near=.2;sun.shadow.camera.far=45;sun.shadow.bias=-0.00025;sun.shadow.normalBias=.012;sun.shadow.radius=4;
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x96999d, 0x606266);
grid.position.y = -0.01;
scene.add(grid);
// No gray floor plane: the black background and standard editor grid are the workspace floor.
// Broad, neutral environment fill keeps PBR materials visible across the roughness range.
const environmentGenerator=new THREE.PMREMGenerator(renderer);
const environmentScene=new RoomEnvironment();
scene.environment=environmentGenerator.fromScene(environmentScene,0.04).texture;
scene.environmentIntensity=0.48;
environmentGenerator.dispose();
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.65)); // Low-resolution post FX on mobile.
const sceneRenderPass = new RenderPass(scene, camera);
composer.addPass(sceneRenderPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.72);
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
let reflectionDirty = false;
let reflectionBusy = false;
let reflectionRefreshTimer = null;
let reflectionRefreshDue = 0;
let reflectionStatusText = '';
const wetSurfaces = new Map();
const pendingTextureImports = new Set();
const pendingModelImports = new Set();
const pendingAssetMigrations = new Set();
let emissiveBloomActive = false;const animatedDeformMaterials=new Set();
let renderCaptureActive=false;
let interactiveMotion=false;let idleQualityBoost=false;let adaptiveQualityTimer=0;let adaptiveQualityStep=0;let glContextAvailable=true;let adaptiveBaseRatio=Math.min(window.devicePixelRatio||1,0.82);
let whiteStudioView=false;let realisticMode=true;let savedEnvironment=scene.environment;let savedExposure=renderer.toneMappingExposure;let fastRenderMode=false;let reflectionsEnabled=true;let softShadowsEnabled=false;
let animationTrackCache=null;let animationNodesCache=null;
let sharedBoneMarkerGeometry=null;
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
function addCameraVisual(cameraObject){if(!cameraObject?.isCamera)return;cameraVisualTemplatePromise ||= new GLTFLoader().loadAsync('/models/security-camera-optimized.glb').then(gltf=>gltf.scene).catch(error=>{console.warn('No se pudo cargar el modelo CC0 de cámara',error);return null;});cameraVisualTemplatePromise.then(template=>{if(!template||!cameraObject.parent||cameraObject.userData.cameraVisual)return;const model=template.clone(true);model.name='Cámara 3D · Poly Haven CC0';model.scale.setScalar(0.72);model.position.set(0,0.02,0.28);model.rotation.set(0,Math.PI,0);model.traverse(node=>{if(node.isMesh){node.castShadow=false;node.receiveShadow=false;for(const mat of Array.isArray(node.material)?node.material:[node.material]){mat.envMapIntensity=Math.min(mat.envMapIntensity??1,0.45);mat.needsUpdate=true;}}});cameraObject.add(model);cameraObject.userData.cameraVisual=model;model.visible=!(cameraMode&&activeCamera===cameraObject);});}
function updateCameraAspect(cameraObject,mode){if(!cameraObject?.isCamera)return;cameraObject.userData.aspectMode=mode;const rect=container.getBoundingClientRect();cameraObject.aspect=mode==='4:3'?4/3:mode==='1:1'?1:mode==='16:9'?16/9:Math.max(.1,rect.width/Math.max(1,rect.height));cameraObject.userData.outputAspect=cameraObject.aspect;cameraObject.updateProjectionMatrix();cameraObject.userData.helper?.update?.();}
function addAsset(kind) {
  animationNodesCache=null;lightingBaked=false;
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
    object = new THREE.PerspectiveCamera(55, 16/9, 0.05, 200);
    object.userData.aspectMode='16:9';object.userData.outputAspect=16/9;
    object.position.set(0, 2.2, 7);
    object.up.set(0,1,0); object.lookAt(0, 1, 0); object.rotation.z=0;
    object.name = `Cámara ${suffix}`;
    object.userData.kind = 'Cámara';
    object.userData.helper = new THREE.CameraHelper(object);
    scene.add(object.userData.helper);
    viewCameraObject = object;
    $('#enterCamera').hidden = false;addCameraVisual(object);
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
    object.castShadow = softShadowsEnabled;object.shadow.mapSize.set(512,512);object.shadow.camera.left=-8;object.shadow.camera.right=8;object.shadow.camera.top=8;object.shadow.camera.bottom=-8;object.shadow.camera.updateProjectionMatrix();object.shadow.radius=4;object.shadow.normalBias=.012;
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
  if (object.isCamera) { viewCameraObject = object; $('#enterCamera').hidden = false;addCameraVisual(object); }
  rebuildTimeline();
  updateStatus();
  saveCurrentProject();
  toast(`${object.userData.kind} agregada`);
}
function refreshList() {
  list.replaceChildren();
  for (const object of objects) {
    const row = document.createElement('button');
    row.className = `object-row${object === selected||selected?.isObject3D&&object.getObjectById(selected.id)===selected ? ' selected' : ''}`;
    row.dataset.key = object.uuid;
    const icon = document.createElement('span');
    icon.textContent = object.userData.kind === 'Esfera' ? '◉' : object.userData.kind === 'Modelo' ? '◈' : '⬡'; if(materialTargetsFor(object).some(mesh=>wetSurfaces.has(mesh.uuid)))icon.textContent+=' 💧';
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
  if(animationMode&&object){boneTarget=null;activeAnimationTarget=object;animationTrackIds.add(object.uuid);}
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
  if(animationMode){refreshAnimationNodePicker();renderAnimationTrackList();$('#timelineTrackName').textContent=activeAnimationTarget?getAnimationNodeLabel(activeAnimationTarget):'Selecciona una pista';rebuildTimeline();}
  renderProperties();
  if(!$('#materialPanel').hidden) refreshMaterialPanel();
  refreshBoneList();
}
function roundedBoxGeometry(width,height,depth,radius,steps=4){
  const shape=new THREE.Shape(),x=-width/2,y=-height/2,r=THREE.MathUtils.clamp(radius,0.001,Math.min(width,height,depth)*0.49);
  shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);shape.quadraticCurveTo(x+width,y,x+width,y+r);shape.lineTo(x+width,y+height-r);shape.quadraticCurveTo(x+width,y+height,x+width-r,y+height);shape.lineTo(x+r,y+height);shape.quadraticCurveTo(x,y+height,x,y+height-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:depth-2*r,bevelEnabled:true,bevelSegments:steps,steps:1,bevelSize:r,bevelThickness:r,curveSegments:8});geometry.translate(0,0,-(depth-2*r)/2);geometry.computeVertexNormals();return geometry;
}
function replaceMeshMaterials(mesh,mutate){const oldList=materialListFor(mesh);const next=oldList.map(old=>{const material=old.isMeshPhysicalMaterial?old:new THREE.MeshPhysicalMaterial({color:old.color?.clone?.()||new THREE.Color('#ffffff'),map:old.map||null,normalMap:old.normalMap||null,roughnessMap:old.roughnessMap||null,metalnessMap:old.metalnessMap||null,aoMap:old.aoMap||null,emissiveMap:old.emissiveMap||null,lightMap:old.lightMap||null,displacementMap:old.displacementMap||null,alphaTest:old.alphaTest,emissive:old.emissive?.clone?.()||new THREE.Color('#000000'),roughness:old.roughness??.55,metalness:old.metalness??0,side:old.side,vertexColors:old.vertexColors,transparent:old.transparent,opacity:old.opacity,alphaMap:old.alphaMap||null});material.name=old.name;material.userData={...old.userData};material.onBeforeCompile=old.onBeforeCompile;material.customProgramCacheKey=old.customProgramCacheKey;material.normalScale?.copy(old.normalScale||new THREE.Vector2(1,1));old.dispose();mutate(material);return material;});mesh.material=Array.isArray(mesh.material)?next:next[0];}
function ensurePhysicalMaterial(mesh){if(!mesh)return; if(materialListFor(mesh).some(mat=>!mat.isMeshPhysicalMaterial))replaceMeshMaterials(mesh,()=>{});}
function setMaterialTransparency(mesh,enabled,amount=0.65){if(!mesh)return;ensurePhysicalMaterial(mesh);for(const mat of materialListFor(mesh)){mat.userData ||= {};mat.userData.transparencyEnabled=!!enabled;mat.userData.savedOpacity=mat.userData.savedOpacity??mat.opacity??1;if(enabled){mat.transmission=THREE.MathUtils.clamp(amount,0,1);mat.transparent=true;mat.opacity=1;mat.ior=1.45;mat.thickness=Math.max(.05,mat.thickness||.35);}else{mat.transmission=0;mat.transparent=mat.userData.originalTransparent??false;mat.opacity=mat.userData.savedOpacity??1;}mat.needsUpdate=true;}}
function setMaterialSubsurface(mesh,enabled,depth=.18){if(!mesh)return;ensurePhysicalMaterial(mesh);for(const mat of materialListFor(mesh)){mat.userData ||= {};mat.userData.subsurfaceEnabled=!!enabled;mat.userData.subsurfaceDepth=depth;if(enabled){mat.transmission=Math.max(mat.transmission||0,THREE.MathUtils.clamp(depth*.22,.015,.22));mat.thickness=THREE.MathUtils.clamp(depth,0.01,1);mat.attenuationColor=mat.color?.clone?.()||new THREE.Color('#ffffff');mat.attenuationDistance=Math.max(.08,depth*2);mat.transparent=true;mat.opacity=1;}else if(!mat.userData.transparencyEnabled){mat.transmission=0;mat.thickness=0;mat.transparent=mat.userData.originalTransparent??false;mat.opacity=mat.userData.savedOpacity??1;}mat.needsUpdate=true;}}
function applyCubeFinish(){
  const mesh=selected?.isMesh?selected:(renderMaterialMesh?.isMesh&&(renderMaterialMesh===selected||selected?.getObjectById?.(renderMaterialMesh.id))?renderMaterialMesh:null);if(!mesh){toast('Selecciona el cubo que quieres modificar');return;}
  const finish=$('#cubeFinish').value;
  if(finish==='rounded'){
    if(mesh.geometry?.type!=='BoxGeometry'&&!mesh.userData.originalCubeGeometry){toast('Este acabado necesita un cubo. Selecciona un Cubo de Assets y vuelve a aplicarlo.');return;}
    if(!mesh.userData.originalCubeGeometry){mesh.userData.originalCubeGeometry=mesh.geometry;}
    const sourceGeometry=mesh.userData.originalCubeGeometry;sourceGeometry.computeBoundingBox();const size=sourceGeometry.boundingBox.getSize(new THREE.Vector3());
    if(mesh.geometry!==sourceGeometry)mesh.geometry.dispose();
    mesh.geometry=roundedBoxGeometry(Math.max(size.x,.05),Math.max(size.y,.05),Math.max(size.z,.05),Math.min(size.x,size.y,size.z)*.14,5);mesh.geometry.computeVertexNormals();mesh.userData.cubeFinish='rounded';
  }else if(finish==='clear'){
    if(mesh.userData.originalCubeGeometry){if(mesh.geometry!==mesh.userData.originalCubeGeometry)mesh.geometry.dispose();mesh.geometry=mesh.userData.originalCubeGeometry;delete mesh.userData.originalCubeGeometry;}mesh.userData.cubeFinish='clear';
    for(const mat of materialListFor(mesh)){if(mat.userData.cubeOriginal){mat.color.copy(mat.userData.cubeOriginal.color);mat.roughness=mat.userData.cubeOriginal.roughness;mat.metalness=mat.userData.cubeOriginal.metalness;mat.transmission=mat.userData.cubeOriginal.transmission;mat.ior=mat.userData.cubeOriginal.ior;mat.thickness=mat.userData.cubeOriginal.thickness;mat.transparent=mat.userData.cubeOriginal.transparent;mat.opacity=mat.userData.cubeOriginal.opacity;mat.needsUpdate=true;delete mat.userData.cubeOriginal;}}
  }else if(finish==='glass'){
    replaceMeshMaterials(mesh,()=>{});for(const mat of materialListFor(mesh)){if(!mat.userData.cubeOriginal)mat.userData.cubeOriginal={color:mat.color?.clone?.()||new THREE.Color('#ffffff'),roughness:mat.roughness??.1,metalness:mat.metalness??0,transmission:mat.transmission??0,ior:mat.ior??1.5,thickness:mat.thickness??0,transparent:mat.transparent??false,opacity:mat.opacity??1};mat.color?.set('#2fcf93');mat.roughness=.08;mat.metalness=0;mat.transmission=.92;mat.ior=1.46;mat.thickness=.7;mat.transparent=true;mat.opacity=1;mat.envMapIntensity=1.4;mat.needsUpdate=true;}
    mesh.userData.cubeFinish='glass';
  }else{
    replaceMeshMaterials(mesh,()=>{});for(const mat of materialListFor(mesh)){if(!mat.userData.cubeOriginal)mat.userData.cubeOriginal={color:mat.color?.clone?.()||new THREE.Color('#ffffff'),roughness:mat.roughness??.55,metalness:mat.metalness??0,transmission:mat.transmission??0,ior:mat.ior??1.5,thickness:mat.thickness??0,transparent:mat.transparent??false,opacity:mat.opacity??1};mat.color?.set('#f4f4f4');mat.roughness=.64;mat.metalness=.02;mat.transmission=0;mat.transparent=false;mat.opacity=1;mat.needsUpdate=true;}
    mesh.userData.cubeFinish='studio';
  }
  mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();lightingBaked=false;renderProperties();refreshMaterialPanel();scheduleProjectSave();toast(`Acabado aplicado: ${finish}`);
}
function addObject(kind = 'Cubo', position = [0, 0.65, 0], color = null) {
  animationNodesCache=null;
  lightingBaked=false;
  const geometry = kind === 'Esfera' ? new THREE.SphereGeometry(0.62, 24, 16)
    : kind === 'Plano' ? new THREE.PlaneGeometry(1.5, 1.5)
    : kind === 'Cubo redondeado' ? roundedBoxGeometry(1.15,1.15,1.15,0.12,4)
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
  objects.push(mesh);if(realisticMode&&renderer.shadowMap.enabled)renderer.shadowMap.needsUpdate=true;
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
function hasEmissiveMeshes(){return objects.some(object=>{let found=false;object.traverse?.(node=>{if(node.isMesh&&materialListFor(node).some(mat=>mat.userData?.emissionEnabled===true&&mat.emissive&&mat.emissiveIntensity>0&&mat.emissive.r+mat.emissive.g+mat.emissive.b>0.02))found=true;});return found;});}
function syncEmissionSpill(mesh){if(!mesh?.isMesh)return;const active=materialListFor(mesh).find(m=>m.userData?.emissionEnabled===true&&m.emissive&&m.emissiveIntensity>0&&m.emissive.r+m.emissive.g+m.emissive.b>.02);let light=mesh.userData.emissionSpillLight;if(!active){if(light){mesh.remove(light);light.dispose?.();delete mesh.userData.emissionSpillLight;}return;}if(!light){light=new THREE.PointLight(0xffffff,0,2.5,2);light.name='Luz local de emisión';mesh.add(light);mesh.userData.emissionSpillLight=light;}mesh.geometry?.computeBoundingBox?.();light.position.copy(mesh.geometry?.boundingBox?.getCenter(new THREE.Vector3())||new THREE.Vector3());light.color.copy(active.emissive);light.intensity=THREE.MathUtils.clamp(active.emissiveIntensity*.14,.02,.28);light.distance=THREE.MathUtils.clamp(1.4+active.emissiveIntensity*.8,1.6,2.5);light.decay=2;}
function updateEmissionBloom(){emissiveBloomActive=hasEmissiveMeshes();for(const root of objects)root.traverse?.(node=>{if(node.isMesh)syncEmissionSpill(node);});bloomPass.strength=emissiveBloomActive ? 0.12 : 0;bloomPass.threshold=1.45;bloomPass.radius=.18;usePostPipeline();}
function markSceneLightingDirty(){lightingBaked=false;if(realisticMode&&renderer?.shadowMap?.enabled){renderer.shadowMap.needsUpdate=true;}}
function usePostPipeline(){const enabled=realisticMode&&!fastRenderMode&&emissiveBloomActive;bloomPass.enabled=enabled;lightPostPass.enabled=false;return enabled;}
function setWaterSubdivision(mesh,enabled){if(!mesh?.isMesh)return;if(enabled&&mesh.geometry?.type==='PlaneGeometry'&&!mesh.userData.waterOriginalGeometry){const p=mesh.geometry.parameters||{};mesh.userData.waterOriginalGeometry=mesh.geometry;mesh.geometry=new THREE.PlaneGeometry(p.width||1.5,p.height||1.5,48,48);mesh.geometry.computeVertexNormals();}else if(!enabled&&mesh.userData.waterOriginalGeometry){mesh.geometry.dispose();mesh.geometry=mesh.userData.waterOriginalGeometry;delete mesh.userData.waterOriginalGeometry;}}
function applyTextureShader(material, mode) {
  material.userData ||= {};if((mode==='water'||mode==='rubber')&&!material.userData.editorShaderBase)material.userData.editorShaderBase={color:material.color?.getHexString?.()||'ffffff',roughness:material.roughness??.55,metalness:material.metalness??0};if(mode==='original'&&material.userData.editorShaderBase){const base=material.userData.editorShaderBase;material.color?.set(`#${base.color}`);if('roughness'in material)material.roughness=base.roughness;if('metalness'in material)material.metalness=base.metalness;delete material.userData.editorShaderBase;}else if(mode==='water'){material.color?.lerp?.(new THREE.Color('#7ac7e8'),.28);if('roughness'in material)material.roughness=.12;if('metalness'in material)material.metalness=.16;material.envMapIntensity=Math.max(material.envMapIntensity||0,.8);}else if(mode==='rubber'){if('roughness'in material)material.roughness=.8;if('metalness'in material)material.metalness=0;material.envMapIntensity=Math.min(material.envMapIntensity||1,.22);}material.userData.editorShader=mode;material.wireframe=mode==='wire';
  if(mode==='noise'){material.userData.noiseScale=Number(material.userData.noiseScale)||12;material.userData.noiseStrength=Number.isFinite(material.userData.noiseStrength)?material.userData.noiseStrength:.22;}
  material.customProgramCacheKey=()=>`editor-style-${mode}`;
  if(mode==='original'){animatedDeformMaterials.delete(material);delete material.userData.deformUniform;material.wireframe=false;material.onBeforeCompile=()=>{};material.needsUpdate=true;return;}
  material.onBeforeCompile=shader=>{
    if(mode==='water'||mode==='rubber'){shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float editorDeformTime;');shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nfloat deformT=editorDeformTime;\n${mode==='water'?'float wave=sin(position.x*5.3+deformT*1.8)*cos(position.y*4.1-deformT*1.25)*0.075+sin(position.z*6.0+deformT)*0.032; transformed+=objectNormal*wave;':'float wobble=sin(deformT*2.2+position.y*4.0)*0.072+sin(deformT*1.6+position.x*3.0)*0.028; transformed+=objectNormal*wobble; transformed.x+=sin(deformT*2.0+position.y*3.0)*0.025;'}\n`);shader.uniforms.editorDeformTime={value:0};material.userData.deformUniform=shader.uniforms.editorDeformTime;animatedDeformMaterials.add(material);return;}
    if(mode==='noise'){
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vEditorNoiseUv;');
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_UV\nvEditorNoiseUv=vUv;\n#else\nvEditorNoiseUv=position.xy;\n#endif');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vEditorNoiseUv;\nuniform float editorNoiseScale;\nuniform float editorNoiseStrength;\nfloat editorHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat editorNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(editorHash(i),editorHash(i+vec2(1.0,0.0)),f.x),mix(editorHash(i+vec2(0.0,1.0)),editorHash(i+vec2(1.0,1.0)),f.x),f.y);}');
      shader.uniforms.editorNoiseScale={value:THREE.MathUtils.clamp(Number(material.userData.noiseScale)||12,1,128)};
      shader.uniforms.editorNoiseStrength={value:THREE.MathUtils.clamp(Number(material.userData.noiseStrength)||0,0,.65)};
      material.userData.noiseUniforms=shader.uniforms;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat editorN=editorNoise(vEditorNoiseUv*editorNoiseScale); diffuseColor.rgb*=1.0+editorNoiseStrength*(editorN-0.5)*2.0;');
      return;
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat styleLum=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\n${mode==='toon'?'float band=floor(styleLum*4.0)/3.0; diffuseColor.rgb*=max(0.28,band);':mode==='sketch'?'float hatch=step(0.5,fract((gl_FragCoord.x+gl_FragCoord.y)*0.18)); float ink=smoothstep(0.18,0.68,styleLum); diffuseColor.rgb*=mix(vec3(0.28),vec3(1.0),mix(ink,hatch,0.55));':mode==='dots'?'float dotPattern=step(0.42,length(fract(gl_FragCoord.xy*0.075)-0.5)); diffuseColor.rgb*=mix(vec3(0.12),vec3(1.0),dotPattern);':mode==='notepad'?'float lines=step(0.82,fract(gl_FragCoord.y*0.045)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.08,0.20,0.42),lines*0.75);':mode==='hope'?'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.15,0.95,1.0),0.24+0.22*sin(gl_FragCoord.y*0.035));':mode==='wire'?'float wireLine=step(0.90,fract(gl_FragCoord.x*0.075))*step(0.90,fract(gl_FragCoord.y*0.075)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.05,0.85,1.0),wireLine*0.8);':'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.92,0.62,0.30),0.18);'}\n`);
  };material.needsUpdate=true;
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
  const safeRoughness=THREE.MathUtils.clamp(Number.isFinite(mat.roughness)?mat.roughness:0.55,0.12,0.94);mat.roughness=safeRoughness;$('#materialRoughness').min='0.12';$('#materialRoughness').max='0.94';$('#materialRoughness').value=String(safeRoughness);$('#roughnessValue').value=safeRoughness.toFixed(2);
  $('#materialMetalness').value=String(mat.metalness??0.05);$('#metalnessValue').value=Number(mat.metalness??0.05).toFixed(2);
  $('#materialTransparencyEnabled').checked=mat.userData?.transparencyEnabled===true||Number(mat.transmission||0)>.01;$('#materialTransmission').value=String(mat.transmission||0);$('#transmissionValue').value=Number(mat.transmission||0).toFixed(2);$('#materialSubsurfaceEnabled').checked=mat.userData?.subsurfaceEnabled===true;$('#materialSubsurfaceDepth').value=String(mat.userData?.subsurfaceDepth??.18);$('#subsurfaceValue').value=Number(mat.userData?.subsurfaceDepth??.18).toFixed(2);$('#materialEmissive').value=`#${mat.emissive?.getHexString?.()||'000000'}`;$('#materialEmissionPower').value=String(Math.min(1,mat.userData?.savedEmissionPower??(mat.userData?.emissionEnabled?mat.emissiveIntensity:0)));$('#emissionValue').value=Number(Math.min(1,mat.userData?.savedEmissionPower??(mat.userData?.emissionEnabled?mat.emissiveIntensity:0))).toFixed(2);$('#materialEmissionEnabled').checked=mat.userData?.emissionEnabled===true;$('#materialNoiseScale').value=String(mat.userData?.noiseScale||12);$('#materialNoiseStrength').value=String(mat.userData?.noiseStrength??.22);$('#materialNoiseControls').hidden=mat.userData?.editorShader!=='noise';
  $('#materialShader').value=mat.userData?.editorShader||'original';$('#wetFloor').textContent=wetSurfaces.has(renderMaterialMesh.uuid)||mat.userData?.wetSurface?'Quitar efecto mojado':'Aplicar efecto mojado al objeto';$('#normalStrength').value=String(mat.normalScale?.x??1);$('#normalStrengthValue').value=Number(mat.normalScale?.x??1).toFixed(2);
}
function editTargetMaterials(edit) { markSceneLightingDirty(); for(const mat of materialListFor(renderMaterialMesh))edit(mat);updateEmissionBloom();scheduleProjectSave(); }
function importMaterialMap(file,inputId,mapKey,userDataKey,colorSpace){
  if(!file||!renderMaterialMesh)return;
  const targetMaterials=materialListFor(renderMaterialMesh).slice();const input=$(`#${mapKey==='map'?'baseTextureFile':mapKey==='roughnessMap'?'roughnessTextureFile':'normalTextureFile'}`);
  if(input)input.disabled=true;
  const sourceUrl=URL.createObjectURL(file);
  const task=(async()=>{
    try{
    const immediateKey=`tex-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const durableWrite=storeTextureAsset(immediateKey,file).then(()=>{for(const mat of targetMaterials){mat.userData ||= {};mat.userData[userDataKey]=immediateKey;}saveCurrentProject();});
    const texture=await new Promise((resolve,reject)=>new THREE.TextureLoader().load(sourceUrl,resolve,undefined,reject));
    texture.colorSpace=colorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    for(const mat of targetMaterials){mat[mapKey]=texture;mat.userData ||= {};mat.needsUpdate=true;}
    await durableWrite;
    if(input)input.disabled=false;lightingBaked=false;updateEmissionBloom();scheduleProjectSave();toast(`${inputId} aplicada; optimizando en segundo plano…`);
      let bitmap;try{bitmap=await createImageBitmap(file);const maxSize=1536,scale=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d',{alpha:true}).drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('No se pudo procesar la textura')),mapKey==='map'?'image/webp':'image/png',mapKey==='map'?0.88:undefined));const key=immediateKey;await storeTextureAsset(key,blob);for(const mat of targetMaterials)mat.userData[userDataKey]=key;saveCurrentProject();console.info(`Texture optimized ${canvas.width}x${canvas.height}`);}finally{if(bitmap)bitmap.close();}
    }catch(error){console.error(error);toast(`No se pudo importar ${inputId}: ${error.message||error}`);throw error;}
    finally{URL.revokeObjectURL(sourceUrl);if(input)input.disabled=false;}
  })();pendingTextureImports.add(task);task.finally(()=>pendingTextureImports.delete(task)).catch(()=>{});return task;
}

function wetSurfaceCount(){return wetSurfaces.size;}
function reflectionStatus(message){const el=$('#reflectionStatus'),box=$('#reflectionIndicator');if(!el||!box)return;el.textContent='';box.hidden=!wetSurfaceCount();}
function markReflectionDirty(){if(!wetSurfaceCount())return;reflectionDirty=true;clearTimeout(reflectionRefreshTimer);reflectionRefreshTimer=setTimeout(()=>refreshWetReflections(true),5000);}
function scheduleInitialReflection(mesh){if(!wetSurfaces.has(mesh.uuid))return;reflectionDirty=true;refreshWetReflections(true);}
function enableWetSurface(mesh, restoring=false){
  if(!mesh?.isMesh)return false;
  if(!wetSurfaces.has(mesh.uuid)&&wetSurfaces.size>=1){toast('Para cuidar el rendimiento, usa reflejo dinámico en un solo objeto; los demás usan reflejo PBR de entorno.');return false;}
  if(wetSurfaces.has(mesh.uuid))return true;
  const materials=materialListFor(mesh);if(!materials.length)return false;
  const width=64;const target=new THREE.WebGLCubeRenderTarget(width,{generateMipmaps:false,minFilter:THREE.LinearFilter,colorSpace:THREE.SRGBColorSpace});
  const probe=new THREE.CubeCamera(0.1,100,target);probe.name=`Reflejo dinámico · ${mesh.name||'Malla'}`;scene.add(probe);
  const state={mesh,probe,target,materials,originals:[],originalEnvMaps:materials.map(mat=>mat.envMap||null)};
  materials.forEach(mat=>{
    mat.userData ||= {};let original=mat.userData.wetOriginal;
    if(!original)original={roughness:mat.roughness??0.55,metalness:mat.metalness??0,envMapIntensity:mat.envMapIntensity??1};
    mat.userData.wetOriginal=original;mat.userData.wetSurface=true;state.originals.push(original);
    if('roughness'in mat)mat.roughness=restoring?Math.min(mat.roughness??0.46,0.5):0.46;
    if('metalness'in mat)mat.metalness=Math.max(mat.metalness??0,0.06);
    // Keep the old environment until the first real cube capture; an empty cubemap renders black.
    mat.envMap=state.originalEnvMaps[materials.indexOf(mat)]||null;mat.envMapIntensity=Math.min(original.envMapIntensity??1,0.38);mat.needsUpdate=true;
  });
  mesh.userData ||= {};mesh.userData.wetSurface=true;wetSurfaces.set(mesh.uuid,state);refreshWetReflections(true);
  $('#wetFloor').textContent='Quitar efecto mojado';reflectionStatus('Efecto mojado · preparando reflejo…');
  scheduleProjectSave();return true;
}
function disableWetSurface(mesh){
  const state=wetSurfaces.get(mesh?.uuid);if(!state)return false;
  state.materials.forEach((mat,index)=>{const old=state.originals[index]||mat.userData?.wetOriginal;if(old){if('roughness'in mat)mat.roughness=old.roughness;if('metalness'in mat)mat.metalness=old.metalness;mat.envMapIntensity=old.envMapIntensity??1;}mat.envMap=state.originalEnvMaps[index]||null;if(mat.userData){mat.userData.wetSurface=false;delete mat.userData.wetOriginal;}mat.needsUpdate=true;});
  scene.remove(state.probe);state.target.dispose();wetSurfaces.delete(mesh.uuid);mesh.userData.wetSurface=false;
  reflectionDirty=wetSurfaceCount()>0;$('#wetFloor').textContent='Aplicar efecto mojado al objeto';reflectionStatus(wetSurfaceCount()?'Reflejos · actualizando…':'');scheduleProjectSave();return true;
}
function applyWetFloor(){
  const mesh=renderMaterialMesh?.isMesh?renderMaterialMesh:(selected?.isMesh?selected:null);
  if(!mesh){toast('Selecciona una malla para aplicar el efecto mojado');return;}
  if(wetSurfaces.has(mesh.uuid)){disableWetSurface(mesh);toast('Efecto mojado quitado de esta malla');}
  else if(enableWetSurface(mesh)){toast(`Efecto mojado aplicado a ${mesh.name||selected.name}`);}
}
function refreshWetReflections(force=false){
  if(!wetSurfaceCount()||reflectionBusy)return;
  if(!force&&!reflectionDirty)return;
  clearTimeout(reflectionRefreshTimer);reflectionRefreshDue=0;const now=performance.now();reflectionBusy=true;
  try{
    for(const state of wetSurfaces.values()){
      const mesh=state.mesh;if(!mesh.parent)continue;
      mesh.updateWorldMatrix(true,false);const bounds=new THREE.Box3().setFromObject(mesh);const center=bounds.isEmpty()?mesh.getWorldPosition(new THREE.Vector3()):bounds.getCenter(new THREE.Vector3());
      const wasVisible=mesh.visible;mesh.visible=false;state.probe.position.copy(center);
      try{state.probe.update(renderer,scene);for(const mat of state.materials){mat.envMap=state.target.texture;mat.envMapIntensity=0.42;mat.needsUpdate=true;}}finally{mesh.visible=wasVisible;}
    }
    reflectionDirty=false;reflectionRefreshDue=0;reflectionStatus('');
  }catch(error){console.warn('Dynamic reflection update failed',error);reflectionStatus('Reflejo · error al actualizar');}
  finally{reflectionBusy=false;}
}
function tickReflectionCounter(){
  if(!wetSurfaceCount())reflectionStatus('');
}
function restoreWetSurfaces(){
  for(const object of objects)for(const mesh of materialTargetsFor(object))if(mesh.userData?.wetSurface||materialListFor(mesh).some(mat=>mat.userData?.wetSurface))enableWetSurface(mesh,true);
  if(wetSurfaceCount()){reflectionDirty=false;reflectionRefreshDue=0;reflectionStatus('');}
}
async function prepareRenderLighting(){
  if(lightingBakePromise)return lightingBakePromise;
  if(lightingBaked)return;
  lightingBakePromise=(async()=>{
    const status=$('#renderStatus');status.textContent='Precalculando sombras · espera 5 s…';
    await new Promise(resolve=>setTimeout(resolve,5000));
    try{
      renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.updateProjectionMatrix();
      for(const object of objects)object.traverse?.(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
      renderer.shadowMap.needsUpdate=true;renderer.render(scene,cameraMode?activeCamera:camera);lightingBaked=true;status.textContent='Sombras precalculadas. Reflejos por objeto se actualizan en vivo.';
    }finally{lightingBakePromise=null;}
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
  const cameraAction = selected.isCamera ? `<button id="selectedCameraView">Mirar por esta cámara</button><button id="alignCameraView">Alinear con la vista actual</button><div class="section-label">CÁMARA / CANVAS</div><small class="camera-credit">Modelo optimizado · Poly Haven · CC0</small><label class="prop-label">Formato <select id="cameraAspect"><option value="viewport">Igual al visor</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option></select></label><label class="prop-label">Campo de visión <span><input id="cameraFov" type="range" min="20" max="100" step="1" value="${selected.fov}"><output>${Math.round(selected.fov)}°</output></span></label><label class="prop-label">Plano cercano<input id="cameraNear" type="number" min="0.03" step="0.01" value="${selected.near}"></label><label class="prop-label">Plano lejano<input id="cameraFar" type="number" min="10" step="10" value="${selected.far}"></label>` : '';
  const lightEditor=selected.isLight?`<div class="section-label">LUZ</div><label class="prop-label">Color<input id="lightColor" type="color" value="#${selected.color?.getHexString?.()||'ffffff'}"></label><label class="prop-label">Intensidad <span><input id="lightIntensity" type="range" min="0" max="12" step="0.05" value="${selected.intensity}"><output>${Number(selected.intensity).toFixed(2)}</output></span></label>${'distance' in selected?`<label class="prop-label">Rango <span><input id="lightDistance" type="range" min="0" max="50" step="0.25" value="${selected.distance}"><output>${Number(selected.distance).toFixed(2)}</output></span></label>`:''}${'angle' in selected?`<label class="prop-label">Ángulo <span><input id="lightAngle" type="range" min="0.05" max="1.4" step="0.01" value="${selected.angle}"><output>${THREE.MathUtils.radToDeg(selected.angle).toFixed(0)}°</output></span></label><label class="prop-label">Penumbra <span><input id="lightPenumbra" type="range" min="0" max="1" step="0.01" value="${selected.penumbra}"><output>${Number(selected.penumbra).toFixed(2)}</output></span></label>`:''}`:'';
  props.innerHTML = `${cameraAction}<label class="prop-label">Nombre<input id="objectName" type="text" maxlength="50"></label>${lightEditor}
    <div class="section-label">POSICIÓN</div>${field('X', 0, p.x, 'position')}${field('Y', 1, p.y, 'position')}${field('Z', 2, p.z, 'position')}
    <div class="section-label">ROTACIÓN</div>${field('X', 0, THREE.MathUtils.radToDeg(r.x), 'rotation')}${field('Y', 1, THREE.MathUtils.radToDeg(r.y), 'rotation')}${field('Z', 2, THREE.MathUtils.radToDeg(r.z), 'rotation')}
    <div class="section-label">ESCALA</div>${field('X', 0, s.x, 'scale')}${field('Y', 1, s.y, 'scale')}${field('Z', 2, s.z, 'scale')}`;
  const nameInput=$('#objectName');nameInput.value=selected.name;
  nameInput.addEventListener('change',()=>{selected.name=safeName(nameInput.value);refreshList();saveCurrentProject();});
  $('#cameraAspect')?.addEventListener('change',e=>{updateCameraAspect(selected,e.target.value);scheduleProjectSave();});$('#cameraAspect').value=selected.userData.aspectMode||'16:9';
  $('#selectedCameraView')?.addEventListener('click', () => enterCameraView(selected));
  $('#alignCameraView')?.addEventListener('click',()=>{selected.position.copy(camera.position);selected.quaternion.copy(camera.quaternion);selected.up.set(0,1,0);selected.lookAt(orbit.target);selected.updateProjectionMatrix();selected.userData.helper?.update();scheduleProjectSave();toast('Cámara alineada con la vista del editor');});
  const lightChanged=()=>{lightingBaked=false;selected.userData.helper?.update?.();scheduleProjectSave();};
  $('#lightColor')?.addEventListener('input',e=>{selected.color.set(e.target.value);lightChanged();});$('#lightColor')?.addEventListener('change',()=>{if(animationMode&&autoKeyEnabled)captureKeyframe(selected);});
  $('#lightIntensity')?.addEventListener('input',e=>{selected.intensity=Number(e.target.value);e.target.nextElementSibling.value=selected.intensity.toFixed(2);lightChanged();});$('#lightIntensity')?.addEventListener('change',()=>{if(animationMode&&autoKeyEnabled)captureKeyframe(selected);});
  $('#lightDistance')?.addEventListener('input',e=>{selected.distance=Number(e.target.value);e.target.nextElementSibling.value=selected.distance.toFixed(2);lightChanged();});
  $('#lightAngle')?.addEventListener('input',e=>{selected.angle=Number(e.target.value);e.target.nextElementSibling.value=`${THREE.MathUtils.radToDeg(selected.angle).toFixed(0)}°`;lightChanged();});
  $('#lightPenumbra')?.addEventListener('input',e=>{selected.penumbra=Number(e.target.value);e.target.nextElementSibling.value=selected.penumbra.toFixed(2);lightChanged();});
  $('#cameraFov')?.addEventListener('input',e=>{selected.fov=Number(e.target.value);selected.updateProjectionMatrix();e.target.nextElementSibling.value=`${selected.fov}°`;selected.userData.helper?.update();scheduleProjectSave();});$('#cameraFov')?.addEventListener('change',()=>{if(animationMode&&autoKeyEnabled)captureKeyframe(selected);});
  $('#cameraNear')?.addEventListener('change',e=>{selected.near=Math.max(0.03,Number(e.target.value)||0.05);selected.updateProjectionMatrix();selected.userData.helper?.update();scheduleProjectSave();});
  $('#cameraFar')?.addEventListener('change',e=>{selected.far=Math.max(selected.near+1,Number(e.target.value)||100);selected.updateProjectionMatrix();selected.userData.helper?.update();scheduleProjectSave();});
  props.querySelectorAll('[data-axis]').forEach((input) => input.addEventListener('change', () => {
    const axis = Number(input.dataset.axis);
    const value = Number(input.value) || 0;
    if (input.dataset.kind === 'position') selected.position.setComponent(axis, value);
    if (input.dataset.kind === 'rotation') selected.rotation.setComponent(axis, THREE.MathUtils.degToRad(value));
    if (input.dataset.kind === 'scale') selected.scale.setComponent(axis, Math.max(0.01, value));
    if (selected.isCamera && selected.userData.helper) selected.userData.helper.update();if(selected.isDirectionalLight||selected.isLight)renderer.shadowMap.needsUpdate=true;if(selected.isDirectionalLight||selected.isLight)renderer.shadowMap.needsUpdate=true;
    if (selected.userData.helper?.update) selected.userData.helper.update();
    if(animationMode&&autoKeyEnabled)captureKeyframe(selected);
    lightingBaked=false;markReflectionDirty();saveCurrentProject();
  }));
}
function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  const messages = { select: 'Toca un objeto para seleccionarlo · arrastra para orbitar', translate: 'Selecciona y arrastra el objeto para moverlo', rotate: 'Selecciona y arrastra para rotar el objeto', scale: 'Selecciona y arrastra para cambiar su escala' };
  hint.textContent = messages[tool] || messages.select;
}
function duplicateSelected() {
  animationNodesCache=null;if(!selected){toast('Selecciona un objeto para duplicar');return;}
  lightingBaked=false;const originalHelper=selected.userData.helper;selected.userData.helper=null;let copy;try{copy=selected.clone(true);}finally{selected.userData.helper=originalHelper;}copy.name=`${selected.name} copia`;copy.position.x+=0.35;copy.userData={...copy.userData,helper:null};
  copy.traverse(node=>{if(node.isMesh){const mats=Array.isArray(node.material)?node.material: [node.material];const cloned=mats.map(mat=>mat.clone());node.material=Array.isArray(node.material)?cloned:cloned[0];node.castShadow=true;node.receiveShadow=true;}});
  if(copy.userData.helper){scene.remove(copy.userData.helper);copy.userData.helper=null;}
  if(copy.isLight){copy.userData.helper=copy.isPointLight?new THREE.PointLightHelper(copy,0.14,'#9aa0a6'):copy.isDirectionalLight?new THREE.DirectionalLightHelper(copy,0.35,'#9aa0a6'):null;if(copy.userData.helper)scene.add(copy.userData.helper);assetObjects.push(copy);}
  if(copy.isCamera){copy.userData.helper=new THREE.CameraHelper(copy);scene.add(copy.userData.helper);viewCameraObject=copy;$('#enterCamera').hidden=false;}
  scene.add(copy);objects.push(copy);for(const mesh of materialTargetsFor(copy))if(materialListFor(mesh).some(mat=>mat.userData?.wetSurface))enableWetSurface(mesh,true);select(copy);rebuildTimeline();updateStatus();saveCurrentProject();toast('Objeto duplicado');
}
function removeSelected() {
  if (!selected) return;
  if(!objects.includes(selected)){let root=selected;while(root.parent&&!objects.includes(root))root=root.parent;selected=root;}
  lightingBaked=false;
  const removedAnimationNodes=getAnimatableNodes().filter(item=>item===selected||selected.getObjectById(item.id));
  for(const mesh of materialTargetsFor(selected))if(wetSurfaces.has(mesh.uuid))disableWetSurface(mesh);
  scene.remove(selected);
  if (selected.userData.helper) scene.remove(selected.userData.helper);
  for(const node of removedAnimationNodes){animationTrackIds.delete(node.uuid);for(const pose of keyframes.values())pose.delete(node.uuid);}animationTrackCache=null;animationNodesCache=null;
  objects.splice(objects.indexOf(selected), 1);disposeRemovedObjectResources(selected);
  if (selected === viewCameraObject) viewCameraObject = objects.find((item) => item.isCamera) || null;
  selected = null;
  $('#enterCamera').hidden = !viewCameraObject;
  refreshList();
  if(animationMode){refreshAnimationNodePicker();renderAnimationTrackList();rebuildTimeline();}
  renderProperties();
  updateStatus();
  saveCurrentProject();
}
function snapshot() {
  const modelPoses=[];for(const root of objects.filter(item=>item.userData.kind==='Modelo'))root.traverse(node=>{if(!node.isBone)return;const path=[];let current=node;while(current&&current!==root){const parent=current.parent;if(!parent)break;path.unshift(parent.children.indexOf(current));current=parent;}modelPoses.push({owner:root.userData.assetKey||root.name,path,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()});});
  const animationData={loop:animationLoop,interpolation:animationInterpolation,tracks:[...animationTrackIds].map(uuid=>{const node=[...objects,...getAnimatableNodes()].find(item=>item.uuid===uuid);if(!node)return null;let root=node;while(root.parent&&!objects.includes(root))root=root.parent;const path=[];let current=node;while(current!==root&&current.parent){path.unshift(current.parent.children.indexOf(current));current=current.parent;}return{objectIndex:objects.indexOf(root),ownerName:root.name||'',ownerKind:root.userData?.kind||'',assetKey:root.userData?.assetKey||null,path};}).filter(Boolean),keyframes:[...keyframes.entries()].map(([frame,pose])=>({frame,targets:[...pose.entries()].map(([uuid,transform])=>{const node=getAnimatableNodes().find(item=>item.uuid===uuid);if(!node)return null;let root=node;while(root.parent&&!objects.includes(root))root=root.parent;const objectIndex=objects.indexOf(root),path=[];let current=node;while(current!==root&&current.parent){path.unshift(current.parent.children.indexOf(current));current=current.parent;}return{name:node.name||'',kind:node.isBone?'bone':'object',owner:node.isBone?(root.name||''):node.userData?.kind||'',ownerName:root.name||'',ownerKind:root.userData?.kind||'',assetKey:root.userData?.assetKey||null,objectIndex,path,transform};}).filter(Boolean)}))};
  return { format: 'editor-3d-scene', version: 8, renderSettings:{postLook:$('#postLook')?.value||'cinematic',postEnabled,whiteStudioView,realisticMode,fastRenderMode,reflectionsEnabled,softShadowsEnabled,gridVisible,activeTool,cameraMode,activeCameraName:cameraMode?activeCamera?.name||'':viewCameraObject?.name||'',selectedName:selected?.name||'',currentFrame}, animation:animationData, modelPoses, objects: objects.map((object) => ({
    name: object.name, kind: object.userData.kind || 'Cubo', assetKey: object.userData.kind === 'Modelo' ? (object.userData.assetKey || null) : undefined, position: object.position.toArray(),
    rotation: object.rotation.toArray(), scale: object.scale.toArray(),
    color: `#${object.material?.color?.getHexString?.() || object.color?.getHexString?.() || 'ffffff'}`,
    geometryRecipe:object.userData.cubeFinish==='rounded'?{type:'roundedBox',size:object.userData.originalCubeGeometry? [object.userData.originalCubeGeometry.parameters.width,object.userData.originalCubeGeometry.parameters.height,object.userData.originalCubeGeometry.parameters.depth] : (object.geometry.boundingBox||new THREE.Box3().setFromObject(object)).getSize(new THREE.Vector3()).toArray(),radius:0.14}:null,cubeFinish:object.userData.cubeFinish||null,
    materials: (()=>{const rows=[];object.traverse?.(node=>{if(node.isMesh){const mats=Array.isArray(node.material)?node.material:[node.material];rows.push({nodeName:node.name,materials:mats.map(mat=>({color:mat.color?`#${mat.color.getHexString()}`:null,roughness:mat.roughness,metalness:mat.metalness,emissive:mat.emissive?`#${mat.emissive.getHexString()}`:null,emissiveIntensity:mat.emissiveIntensity,transmission:mat.transmission,transparencyEnabled:mat.userData?.transparencyEnabled===true,subsurfaceEnabled:mat.userData?.subsurfaceEnabled===true,subsurfaceDepth:mat.userData?.subsurfaceDepth??.18,originalTransparent:mat.userData?.originalTransparent, savedOpacity:mat.userData?.savedOpacity,ior:mat.ior,thickness:mat.thickness,transparent:mat.transparent,opacity:mat.opacity,cubeOriginal:mat.userData?.cubeOriginal?{color:mat.userData.cubeOriginal.color?.getHexString?.()||'ffffff',roughness:mat.userData.cubeOriginal.roughness,metalness:mat.userData.cubeOriginal.metalness,transmission:mat.userData.cubeOriginal.transmission,ior:mat.userData.cubeOriginal.ior,thickness:mat.userData.cubeOriginal.thickness,transparent:mat.userData.cubeOriginal.transparent,opacity:mat.userData.cubeOriginal.opacity}:null,editorShader:mat.userData?.editorShader||'original',editorShaderBase:mat.userData?.editorShaderBase||null,noiseScale:mat.userData?.noiseScale??12,noiseStrength:mat.userData?.noiseStrength??.22,emissionEnabled:mat.userData?.emissionEnabled===true,savedEmissionPower:mat.userData?.savedEmissionPower??mat.emissiveIntensity,wetSurface:!!mat.userData?.wetSurface,wetOriginal:mat.userData?.wetOriginal||null,baseTextureKey:mat.userData?.baseTextureKey||null,roughnessTextureKey:mat.userData?.roughnessTextureKey||null,normalTextureKey:mat.userData?.normalTextureKey||null,normalScale:mat.normalScale?.toArray?.()||[1,1]}))});}});if(object.isMesh){const mats=Array.isArray(object.material)?object.material:[object.material];rows.push({nodeName:object.name,materials:mats.map(mat=>({color:mat.color?`#${mat.color.getHexString()}`:null,roughness:mat.roughness,metalness:mat.metalness,emissive:mat.emissive?`#${mat.emissive.getHexString()}`:null,emissiveIntensity:mat.emissiveIntensity,transmission:mat.transmission,transparencyEnabled:mat.userData?.transparencyEnabled===true,subsurfaceEnabled:mat.userData?.subsurfaceEnabled===true,subsurfaceDepth:mat.userData?.subsurfaceDepth??.18,originalTransparent:mat.userData?.originalTransparent, savedOpacity:mat.userData?.savedOpacity,ior:mat.ior,thickness:mat.thickness,transparent:mat.transparent,opacity:mat.opacity,cubeOriginal:mat.userData?.cubeOriginal?{color:mat.userData.cubeOriginal.color?.getHexString?.()||'ffffff',roughness:mat.userData.cubeOriginal.roughness,metalness:mat.userData.cubeOriginal.metalness,transmission:mat.userData.cubeOriginal.transmission,ior:mat.userData.cubeOriginal.ior,thickness:mat.userData.cubeOriginal.thickness,transparent:mat.userData.cubeOriginal.transparent,opacity:mat.userData.cubeOriginal.opacity}:null,editorShader:mat.userData?.editorShader||'original',editorShaderBase:mat.userData?.editorShaderBase||null,noiseScale:mat.userData?.noiseScale??12,noiseStrength:mat.userData?.noiseStrength??.22,emissionEnabled:mat.userData?.emissionEnabled===true,savedEmissionPower:mat.userData?.savedEmissionPower??mat.emissiveIntensity,wetSurface:!!mat.userData?.wetSurface,wetOriginal:mat.userData?.wetOriginal||null,baseTextureKey:mat.userData?.baseTextureKey||null,roughnessTextureKey:mat.userData?.roughnessTextureKey||null,normalTextureKey:mat.userData?.normalTextureKey||null,normalScale:mat.normalScale?.toArray?.()||[1,1]}))});}return rows;})(),
    intensity: object.intensity, lightColor:object.color?`#${object.color.getHexString()}`:null, distance: object.distance, angle: object.angle, penumbra: object.penumbra,
    fov: object.fov, near: object.near, far: object.far, aspect:object.aspect, aspectMode:object.userData?.aspectMode||'viewport',outputAspect:object.userData?.outputAspect||object.aspect
  })) };
}
function projectList() { try { return JSON.parse(localStorage.getItem('editor3d:projects') || '[]'); } catch { return []; } }
function writeProjectList(items) { localStorage.setItem('editor3d:projects', JSON.stringify(items)); }
let historyTimer=null;
function refreshHistoryButtons(){const undo=$('#undo'),redo=$('#redo');if(undo)undo.disabled=historyUndo.length<2;if(redo)redo.disabled=historyRedo.length===0;}
function recordHistory(){if(restoringHistory||!currentProjectId)return;clearTimeout(historyTimer);historyTimer=null;const data=JSON.stringify(snapshot());if(historyUndo.at(-1)===data)return;historyUndo.push(data);if(historyUndo.length>60)historyUndo.shift();historyRedo.length=0;historyStamp=Date.now();refreshHistoryButtons();}
function recordHistorySoon(){if(restoringHistory||loadingProjectScene||!currentProjectId)return;clearTimeout(historyTimer);historyTimer=setTimeout(recordHistory,180);}
async function applyHistorySnapshot(data){if(!data)return;const rollback=JSON.stringify(snapshot());restoringHistory=true;try{await loadScene(JSON.parse(data));}catch(error){console.error('Scene restore failed, reverting',error);try{await loadScene(JSON.parse(rollback));}catch(rollbackError){console.error('Scene rollback also failed',rollbackError);}throw error;}finally{clearTimeout(historyTimer);historyTimer=null;restoringHistory=false;refreshHistoryButtons();}}
async function waitForPendingAssets(){while(pendingTextureImports.size||pendingModelImports.size)await Promise.allSettled([...pendingTextureImports,...pendingModelImports]);}let historyOperationBusy=false;async function undoScene(){if(historyOperationBusy)return;historyOperationBusy=true;try{clearTimeout(historyTimer);await waitForPendingAssets();recordHistory();if(historyUndo.length<2){toast('No hay más cambios para deshacer');return;}const current=historyUndo.at(-1),previous=historyUndo.at(-2);await applyHistorySnapshot(previous);historyUndo.pop();historyRedo.push(current);toast('Cambio deshecho');}catch(error){console.error('Undo failed',error);toast(`Deshacer no pudo restaurar la escena: ${error?.message||'falló la carga de un recurso'}. Conservé el historial.`);}finally{historyOperationBusy=false;refreshHistoryButtons();}}
async function redoScene(){if(historyOperationBusy)return;historyOperationBusy=true;try{clearTimeout(historyTimer);await waitForPendingAssets();if(!historyRedo.length){toast('No hay cambios para rehacer');return;}const next=historyRedo.at(-1);await applyHistorySnapshot(next);historyRedo.pop();historyUndo.push(next);toast('Cambio rehecho');}catch(error){console.error('Redo failed',error);toast(`Rehacer no pudo restaurar la escena: ${error?.message||'falló la carga de un recurso'}. Conservé el historial.`);}finally{historyOperationBusy=false;refreshHistoryButtons();}}
let projectSaveTimer = null;
let historyUndo=[];let historyRedo=[];let historyStamp=0;let restoringHistory=false;
function scheduleProjectSave() { recordHistorySoon(); clearTimeout(projectSaveTimer); projectSaveTimer = setTimeout(saveCurrentProject, 350); }
function saveCurrentProject() {
  if (loadingProjectScene || !currentProjectId) return;
  const projects = projectList();
  const project = projects.find((item) => item.id === currentProjectId);
  if (!project) return;
  recordHistorySoon();
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
  currentProjectId = id;clearTimeout(historyTimer);clearTimeout(projectSaveTimer);historyUndo=[];historyRedo=[];refreshHistoryButtons();
  localStorage.setItem('editor3d:last-project', id);
  $('#projectHome').hidden = true; $('#app').hidden = false;
  if (project.scene) await loadScene(project.scene);
  if (!objects.length) addObject('Cubo');clearTimeout(historyTimer);historyTimer=null;historyUndo=[JSON.stringify(snapshot())];historyRedo=[];refreshHistoryButtons();
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
async function returnToProjects() { saveCurrentProject();if(pendingTextureImports.size)await Promise.allSettled([...pendingTextureImports]);if(pendingModelImports.size)await Promise.allSettled([...pendingModelImports]); $('#app').hidden = true; $('#projectHome').hidden = false; renderProjectCards(); }
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function openRenderDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('editor3d-storage', 2);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles'); if (!db.objectStoreNames.contains('model-assets')) db.createObjectStore('model-assets'); if (!db.objectStoreNames.contains('texture-assets')) db.createObjectStore('texture-assets'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storeRenderFolder(handle) {
  try { const db = await openRenderDb(); await new Promise((resolve, reject) => { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(handle, 'render-folder'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch {}
}
async function storeModelAsset(key, blob) { const db = await openRenderDb(); await new Promise((resolve, reject) => { const tx = db.transaction('model-assets', 'readwrite'); tx.objectStore('model-assets').put(blob, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function getModelAsset(key) { const db = await openRenderDb(); return await new Promise((resolve, reject) => { const req = db.transaction('model-assets').objectStore('model-assets').get(key); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); }

async function storeTextureAsset(key,blob){const db=await openRenderDb();return await new Promise((resolve,reject)=>{const tx=db.transaction('texture-assets','readwrite');tx.objectStore('texture-assets').put(blob,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function getTextureAsset(key){const db=await openRenderDb();return await new Promise((resolve,reject)=>{const req=db.transaction('texture-assets').objectStore('texture-assets').get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
async function blobAsDataUrl(blob){return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
function bytesToBase64(buffer){const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}

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
function captureScenePose(){const pose=new Map();for(const node of getAnimatableNodes())pose.set(node.uuid,readTransform(node));return pose;}
function restoreScenePose(pose){for(const node of getAnimatableNodes()){const state=pose.get(node.uuid);if(state)writeTransform(node,state);}currentModel?.updateMatrixWorld(true);updateBoneMarkers();}
function mobileVideoSize(){const [w0,h0]=renderSize();const scale=Math.min(1,640/w0,360/h0);return[Math.max(2,Math.floor(w0*scale/2)*2),Math.max(2,Math.floor(h0*scale/2)*2)];}
function hideEditorGuidesForRender() {
  const restore=[];
  const hide=node=>{if(!node)return;restore.push([node,node.visible]);node.visible=false;};
  hide(grid); hide(window.editorGizmo?.getHelper());
  for(const object of objects) hide(object.userData.helper);
  for(const marker of boneDots.values()) hide(marker);
  return ()=>{if(renderCaptureActive)return;for(const [node,visible] of restore)node.visible=visible;};
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
    if(!cameraMode||!renderCamera.userData.aspectMode||renderCamera.userData.aspectMode==='viewport')renderCamera.aspect = width / height; renderCamera.updateProjectionMatrix();
    sceneRenderPass.camera = renderCamera;
    if (usePostPipeline()) composer.render(); else renderer.render(scene, renderCamera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    restoreGuides();
    renderer.setPixelRatio(oldRatio); renderer.setSize(oldSize.x, oldSize.y, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.65)); composer.setSize(oldSize.x, oldSize.y);
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
  if(renderCaptureActive){toast('Ya hay una exportación en curso');return;}
  // MP4 uses the current lighting snapshot and never starts a second expensive shadow bake.
  const duration = Math.max(1, Math.min(15, Number($('#renderDuration').value) || 5));
  if (Capacitor.isNativePlatform()) { await exportMp4Native(duration); return; }
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    toast('Este WebView no ofrece codificación H.264 MP4.');
    $('#renderStatus').textContent = 'No se generó MP4: este WebView no incluye WebCodecs H.264. PNG funciona; MP4 requiere un Android/WebView compatible.';
    return;
  }
  const [width, height] = mobileVideoSize();
  const config = { codec: 'avc1.640028', width, height, bitrate: 2000000, framerate: 15 };
  let support = await VideoEncoder.isConfigSupported(config).catch(() => null);
  if(!support?.supported){config.codec='avc1.42001f';config.bitrate=1400000;config.framerate=15;support=await VideoEncoder.isConfigSupported(config).catch(()=>null);}
  if (!support?.supported) { $('#renderStatus').textContent = 'El dispositivo no ofrece H.264 para MP4 en este WebView; no se guardó un video con extensión incorrecta.'; toast('Codificador MP4 no disponible'); return; }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const renderCanvas = document.createElement('canvas');renderCanvas.width=width;renderCanvas.height=height;const renderContext=renderCanvas.getContext('2d',{alpha:false});
  const videoSource = new CanvasSource(renderCanvas, { codec: 'avc', quality: new Quality({ bitrate: config.bitrate }) });
  const fps = config.framerate; output.addVideoTrack(videoSource, { frameRate: fps });
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize); const oldRatio = renderer.getPixelRatio(); const renderCamera = cameraMode ? activeCamera : camera; const oldAspect = renderCamera.aspect;
  const wasPlaying=isPlaying, savedFrame=currentFrame, savedPose=captureScenePose();if(isPlaying){isPlaying=false;clearInterval(playTimer);$('#playAnimation').textContent='▶';}
  const oldPost=postEnabled,oldBloom=bloomPass.enabled,oldLightPost=lightPostPass.enabled;const restoreGuides=hideEditorGuidesForRender();renderCaptureActive=true;
  $('#renderStatus').textContent = `Renderizando MP4 ${width}×${height} · ${duration} s…`;
  try {
    renderer.setPixelRatio(1); renderer.setSize(width, height, false); composer.setPixelRatio(1); composer.setSize(width, height); if(!cameraMode||!renderCamera.userData.aspectMode||renderCamera.userData.aspectMode==='viewport')renderCamera.aspect = width / height; renderCamera.updateProjectionMatrix();sceneRenderPass.camera = renderCamera;
    await output.start();
    const total = duration * fps;
    for (let index = 0; index < total; index++) {
      if (keyframes.size) interpolatePose(index / Math.max(1, total - 1) * 120);
      else if (importedMixer && importedAnimationAction) { importedMixer.setTime(index / fps); currentModel?.updateMatrixWorld(true); }
      if (usePostPipeline()) composer.render(); else renderer.render(scene, renderCamera);
      renderContext.drawImage(renderer.domElement,0,0,width,height);await videoSource.add(index / fps, 1 / fps);
      if (index % 10 === 0) { $('#renderStatus').textContent = `Renderizando MP4 · ${Math.floor(index / total * 100)}%`; await new Promise((resolve) => requestAnimationFrame(resolve)); }
    }
    await output.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' }); const name = `render-${Date.now()}.mp4`;
    if (Capacitor.isNativePlatform() || renderFolderHandle) await saveBlobToChosenFolder(name, blob);
    else download(name, blob, 'video/mp4');
    $('#renderStatus').textContent = 'MP4 H.264 exportado.'; toast('Render MP4 listo');
  } catch (error) { console.error(error); toast(`No se pudo renderizar MP4: ${error.message || error}`); $('#renderStatus').textContent = `Falló la exportación MP4: ${error.message || error}`; }
  finally { renderCaptureActive=false;restoreGuides();postEnabled=oldPost;bloomPass.enabled=oldBloom;lightPostPass.enabled=oldLightPost;renderer.setPixelRatio(oldRatio);renderer.setSize(oldSize.x,oldSize.y,false);composer.setPixelRatio(Math.min(window.devicePixelRatio||1,0.65));composer.setSize(oldSize.x,oldSize.y);renderCamera.aspect=oldAspect;renderCamera.updateProjectionMatrix();sceneRenderPass.camera=cameraMode?activeCamera:camera;currentFrame=savedFrame;restoreScenePose(savedPose);updateFrameControls();if(wasPlaying)togglePlayback(); }
}
async function exportMp4Native(duration) {
  const [width,height]=mobileVideoSize(), fps=15, total=duration*fps, renderCamera=cameraMode?activeCamera:camera;
  const oldSize=new THREE.Vector2();renderer.getSize(oldSize);const oldRatio=renderer.getPixelRatio(),oldAspect=renderCamera.aspect;
  const wasPlaying=isPlaying,savedFrame=currentFrame,savedPose=captureScenePose();if(isPlaying){isPlaying=false;clearInterval(playTimer);$('#playAnimation').textContent='▶';}
  const oldPost=postEnabled,oldBloom=bloomPass.enabled,oldLightPost=lightPostPass.enabled;const restoreGuides=hideEditorGuidesForRender();renderCaptureActive=true;
  try {
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);composer.setPixelRatio(1);composer.setSize(width,height);if(!cameraMode||!renderCamera.userData.aspectMode||renderCamera.userData.aspectMode==='viewport')renderCamera.aspect=width/height;renderCamera.updateProjectionMatrix();sceneRenderPass.camera=renderCamera;
    const started=await NativeRenderExport.startVideo({width,height,fps});if(started?.ready===false)throw new Error('El codificador no quedó iniciado');$('#renderStatus').textContent=`Renderizando MP4 ${width}×${height} · ${duration} s…`;
    for(let i=0;i<total;i++){if(keyframes.size)interpolatePose(i/Math.max(1,total-1)*120);else if(importedMixer&&importedAnimationAction){importedMixer.setTime(i/fps);currentModel?.updateMatrixWorld(true);}if(usePostPipeline())composer.render();else renderer.render(scene,renderCamera);const jpeg=renderer.domElement.toDataURL('image/jpeg',0.94).split(',')[1];await NativeRenderExport.addVideoFrame({jpeg});if(i%3===0){$('#renderStatus').textContent=`Renderizando MP4 · ${Math.floor((i+1)/total*100)}%`;await new Promise(resolve=>requestAnimationFrame(resolve));}}
    await NativeRenderExport.finishVideo();$('#renderStatus').textContent='MP4 guardado en la carpeta elegida.';toast('Exportación MP4 lista');
  } catch(error){console.error(error);try{await NativeRenderExport.abortVideo();}catch(_){}$('#renderStatus').textContent=`Falló la exportación MP4: ${error.message||error}`;toast(`No se pudo exportar MP4: ${error.message||error}`);}
  finally{renderCaptureActive=false;restoreGuides();postEnabled=oldPost;bloomPass.enabled=oldBloom;lightPostPass.enabled=oldLightPost;renderer.setPixelRatio(oldRatio);renderer.setSize(oldSize.x,oldSize.y,false);composer.setPixelRatio(Math.min(window.devicePixelRatio||1,0.65));composer.setSize(oldSize.x,oldSize.y);renderCamera.aspect=oldAspect;renderCamera.updateProjectionMatrix();sceneRenderPass.camera=cameraMode?activeCamera:camera;currentFrame=savedFrame;restoreScenePose(savedPose);updateFrameControls();if(wasPlaying)togglePlayback();}
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
async function imageToStoredBlob(texture){
  const image=texture?.image;if(!image||!image.width||!image.height)throw new Error('La textura todavía no terminó de cargar');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo leer el mapa de textura');ctx.drawImage(image,0,0);
  const type=texture.colorSpace===THREE.SRGBColorSpace?'image/webp':'image/png';return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo empaquetar el mapa de textura')),type,type==='image/webp'?.9:undefined));
}
async function ensureMaterialTextureAssets(){
  const mapDefs=[['map','baseTextureKey'],['roughnessMap','roughnessTextureKey'],['normalMap','normalTextureKey']];
  for(const root of objects)for(const mesh of materialTargetsFor(root))for(const mat of materialListFor(mesh))for(const [mapKey,keyName] of mapDefs){
    const texture=mat[mapKey];if(!texture)continue;let key=mat.userData?.[keyName],saved=key?await getTextureAsset(key):null;
    if(!saved){key=`tex-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;const blob=await imageToStoredBlob(texture);await storeTextureAsset(key,blob);mat.userData ||= {};mat.userData[keyName]=key;}
  }
}
async function buildPortableProject(button=null){
  while(pendingTextureImports.size)await Promise.allSettled([...pendingTextureImports]);while(pendingModelImports.size)await Promise.allSettled([...pendingModelImports]);while(pendingAssetMigrations.size)await Promise.allSettled([...pendingAssetMigrations]);
  await ensureMaterialTextureAssets();saveCurrentProject();
  const data=snapshot();data.modelAssets=[];data.textureAssets=[];
  const modelKeys=[...new Set(objects.filter(item=>item.userData.kind==='Modelo'&&item.userData.assetKey).map(item=>item.userData.assetKey))];
  const textureKeys=new Set();for(const item of data.objects)for(const row of item.materials||[])for(const mat of row.materials||[])for(const k of ['baseTextureKey','roughnessTextureKey','normalTextureKey'])if(mat[k])textureKeys.add(mat[k]);
  for(let i=0;i<modelKeys.length;i++){const key=modelKeys[i],blob=await getModelAsset(key);if(!blob)throw new Error(`Falta el modelo ${key} en el almacenamiento local`);data.modelAssets.push({key,type:blob.type||'model/gltf-binary',data:bytesToBase64(await blob.arrayBuffer())});if(button)button.textContent=`Guardando modelos ${i+1}/${modelKeys.length}`;}
  let n=0;for(const key of textureKeys){const blob=await getTextureAsset(key);if(!blob)throw new Error(`Falta una textura importada (${key}) en el almacenamiento local`);data.textureAssets.push({key,type:blob.type||'image/png',data:await blobAsDataUrl(blob)});if(button)button.textContent=`Guardando texturas ${++n}/${textureKeys.size}`;}
  const project=projectList().find(item=>item.id===currentProjectId);data.projectName=project?.name||'Mi escena';data.savedAt=new Date().toISOString();return data;
}
let documentBackupTimer=null,documentBackupBusy=false,documentBackupAgain=false;
function scheduleDocumentsBackup(){if(!Capacitor.isNativePlatform()||!currentProjectId)return;clearTimeout(documentBackupTimer);documentBackupTimer=setTimeout(runDocumentsBackup,12000);}
async function runDocumentsBackup(){if(documentBackupBusy){documentBackupAgain=true;return;}if(!Capacitor.isNativePlatform()||!currentProjectId)return;documentBackupBusy=true;try{const data=await buildPortableProject();let folder=await NativeRenderExport.getProjectFolder();if(!folder.displayName)return;const name=`${safeName(data.projectName).replace(/\s+/g,'-')}.editor3d.json`;const blob=new Blob([JSON.stringify(data)],{type:'application/json'});await NativeRenderExport.saveProjectFile({name,mimeType:'application/json',data:await blobToBase64(blob)});}catch(error){console.warn('La copia opcional en Documents falló; el proyecto sigue guardado en la biblioteca interna.',error);}finally{documentBackupBusy=false;if(documentBackupAgain){documentBackupAgain=false;scheduleDocumentsBackup();}}}
async function saveSceneToLibrary(){const button=$('#save');button.disabled=true;const label=button.textContent;button.textContent='Guardando…';try{while(pendingTextureImports.size||pendingModelImports.size||pendingAssetMigrations.size)await Promise.allSettled([...pendingTextureImports,...pendingModelImports,...pendingAssetMigrations]);saveCurrentProject();if(!currentProjectId)throw new Error('Abre primero un proyecto');const projects=projectList();const project=projects.find(item=>item.id===currentProjectId);if(!project)throw new Error('El proyecto no está en la biblioteca local');project.scene=snapshot();project.updatedAt=Date.now();writeProjectList(projects);renderProjectCards();toast('Escena guardada dentro de Volumi3d · Proyectos');}catch(error){console.error('Save to in-app library failed',error);toast(`No se pudo guardar en Proyectos: ${error.message||error}`);}finally{button.disabled=false;button.textContent=label||'Guardar en Proyectos';}}
async function saveScene(){
  const button=$('#save');const original=button.textContent;button.disabled=true;button.textContent='Guardando…';
  try{
    let folder={displayName:'Descargas'};
    if(Capacitor.isNativePlatform()){
      folder=await NativeRenderExport.getProjectFolder();
      if(!folder.displayName){$('#renderStatus').textContent='Elige Documents para guardar el proyecto completo.';await NativeRenderExport.chooseProjectFolder();folder=await NativeRenderExport.getProjectFolder();if(!folder.displayName)throw new Error('No se eligió Documents. El proyecto no se guardó.');}
    }
    const data=await buildPortableProject(button);const fileName=`${safeName(data.projectName).replace(/\s+/g,'-')}.editor3d.json`,blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    if(Capacitor.isNativePlatform()){await NativeRenderExport.saveProjectFile({name:fileName,mimeType:'application/json',data:await blobToBase64(blob)});toast(`Proyecto guardado en ${folder.displayName}: ${fileName}`);}else download(fileName,blob,'application/json');
    $('#status').textContent='Proyecto completo guardado';toast(`Proyecto guardado · ${data.objects.length} objetos · ${data.modelAssets.length} modelos · ${data.textureAssets.length} texturas`);
  }catch(error){console.error(error);toast(`No se pudo guardar el proyecto: ${error.message||error}`);}
  finally{button.disabled=false;button.textContent=original||'Guardar proyecto';}
}

async function restoreMaterialSnapshots(root, rows) {
  if(!Array.isArray(rows))return;const meshes=[];if(root.isMesh)meshes.push(root);root.traverse?.(node=>{if(node.isMesh)meshes.push(node);});
  const loader=new THREE.TextureLoader();
  for(let i=0;i<Math.min(meshes.length,rows.length);i++){
    const mats=Array.isArray(meshes[i].material)?meshes[i].material:[meshes[i].material],saved=rows[i].materials||[];
    for(let j=0;j<Math.min(mats.length,saved.length);j++){
      const mat=mats[j],state=saved[j];if(state.color)mat.color?.set(state.color);if('roughness'in mat)mat.roughness=THREE.MathUtils.clamp(Number.isFinite(state.roughness)?state.roughness:.55,.12,.94);if(Number.isFinite(state.metalness)&&'metalness'in mat)mat.metalness=state.metalness;if(state.emissive)mat.emissive?.set(state.emissive);if(Number.isFinite(state.emissiveIntensity)&&'emissiveIntensity'in mat)mat.emissiveIntensity=state.emissiveIntensity;if(Number.isFinite(state.transmission)&&'transmission'in mat)mat.transmission=state.transmission;mat.userData||={};mat.userData.transparencyEnabled=state.transparencyEnabled===true;mat.userData.subsurfaceEnabled=state.subsurfaceEnabled===true;mat.userData.subsurfaceDepth=Number(state.subsurfaceDepth)||.18;mat.userData.originalTransparent=state.originalTransparent;mat.userData.savedOpacity=state.savedOpacity;mat.userData.emissionEnabled=state.emissionEnabled===true;mat.userData.savedEmissionPower=THREE.MathUtils.clamp(Number(state.savedEmissionPower??(state.emissionEnabled?state.emissiveIntensity:0))||0,0,2);if(!mat.userData.emissionEnabled)mat.emissiveIntensity=0;else if(Number.isFinite(state.emissiveIntensity))mat.emissiveIntensity=THREE.MathUtils.clamp(state.emissiveIntensity,0,2);if(Number.isFinite(state.ior)&&'ior'in mat)mat.ior=state.ior;if(Number.isFinite(state.thickness)&&'thickness'in mat)mat.thickness=state.thickness;if(typeof state.transparent==='boolean')mat.transparent=state.transparent;if(Number.isFinite(state.opacity))mat.opacity=state.opacity;
      if(state.cubeOriginal)mat.userData.cubeOriginal={...state.cubeOriginal,color:new THREE.Color(`#${String(state.cubeOriginal.color||'ffffff').replace('#','')}`)};
      if(Number.isFinite(state.noiseScale)||Number.isFinite(state.noiseStrength)){mat.userData.noiseScale=Number(state.noiseScale)||12;mat.userData.noiseStrength=Number.isFinite(state.noiseStrength)?state.noiseStrength:.22;}if(state.editorShader){mat.userData.editorShaderBase=state.editorShaderBase||null;setWaterSubdivision(mesh,state.editorShader==='water');applyTextureShader(mat,state.editorShader);}if(state.wetSurface){mat.userData.wetSurface=true;mat.userData.wetOriginal=state.wetOriginal||{roughness:mat.roughness??.55,metalness:mat.metalness??0,envMapIntensity:1};}
      for(const [mapKey,keyName,legacyName] of [['map','baseTextureKey','baseTextureData'],['roughnessMap','roughnessTextureKey','roughnessTextureData'],['normalMap','normalTextureKey','normalTextureData']]){
        const assetKey=state[keyName];let blob=null;if(assetKey){mat.userData[keyName]=assetKey;try{blob=await getTextureAsset(assetKey);}catch(error){console.warn('Texture restore read failed',assetKey,error);}}else if(state[legacyName]){try{blob=await(await fetch(state[legacyName])).blob();}catch(error){console.warn('Legacy texture read failed',error);}}
        if(blob){const url=URL.createObjectURL(blob);try{const texture=await loader.loadAsync(url);texture.colorSpace=mapKey==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;mat[mapKey]=texture;mat.needsUpdate=true;if(!assetKey){const key=`tex-migrated-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;await storeTextureAsset(key,blob);mat.userData[keyName]=key;}}catch(error){console.warn('Undo: texture could not be decoded; keeping the object and other materials',assetKey||legacyName,error);}finally{URL.revokeObjectURL(url);}}
      }
      if(Array.isArray(state.normalScale)&&mat.normalScale)mat.normalScale.fromArray(state.normalScale);mat.needsUpdate=true;
    }
  }
}
function disposeObjectResources(root){const geometries=new Set(),materials=new Set(),textures=new Set();root?.traverse?.(node=>{if(root.userData?.cameraVisual&&node===root.userData.cameraVisual)return;if(node.geometry)geometries.add(node.geometry);for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat){materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);}});for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose();}
function disposeRemovedObjectResources(root){const usedGeometry=new Set(),usedMaterials=new Set(),usedTextures=new Set();for(const other of objects)other.traverse?.(node=>{if(node.geometry)usedGeometry.add(node.geometry);for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat){usedMaterials.add(mat);for(const value of Object.values(mat))if(value?.isTexture)usedTextures.add(value);}});const geometries=new Set(),materials=new Set(),textures=new Set();root?.traverse?.(node=>{if(root.userData?.cameraVisual&&node===root.userData.cameraVisual)return;if(node.geometry&&!usedGeometry.has(node.geometry))geometries.add(node.geometry);for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat){if(!usedMaterials.has(mat))materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture&&!usedTextures.has(value))textures.add(value);}});for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose();}
async function loadScene(data) {
  if(data.renderSettings){whiteStudioView=!!data.renderSettings.whiteStudioView;scene.overrideMaterial=whiteStudioView?new THREE.MeshStandardMaterial({color:0xe7e7e7,roughness:.86,metalness:0}):null;scene.background=whiteStudioView?new THREE.Color(0x55585d):null;$('#whiteStudioToggle')?.classList.toggle('active',whiteStudioView);$('#postLook').value=data.renderSettings.postLook||'cinematic';postEnabled=!!data.renderSettings.postEnabled;realisticMode=data.renderSettings.realisticMode!==false;fastRenderMode=!!data.renderSettings.fastRenderMode;reflectionsEnabled=data.renderSettings.reflectionsEnabled!==false;softShadowsEnabled=!!data.renderSettings.softShadowsEnabled;$('#featureFastRender').checked=fastRenderMode;$('#featureReflections').checked=reflectionsEnabled;$('#featureSoftShadows').checked=softShadowsEnabled;scene.environment=realisticMode&&reflectionsEnabled?savedEnvironment:null;scene.environmentIntensity=realisticMode&&reflectionsEnabled?0.48:0;renderer.shadowMap.enabled=softShadowsEnabled&&(realisticMode||whiteStudioView);renderer.shadowMap.type=THREE.PCFSoftShadowMap;$('#postToggle').textContent=fastRenderMode?'Rápido':'RA';$('#postToggle').classList.toggle('active',postEnabled);bloomPass.enabled=postEnabled;lightPostPass.enabled=postEnabled;gridVisible=data.renderSettings.gridVisible!==false;grid.visible=gridVisible;setTool(data.renderSettings.activeTool||'select');if(postEnabled)applyPostLook($('#postLook').value);}
  if(Array.isArray(data?.textureAssets))for(const asset of data.textureAssets)if(asset?.key&&asset?.data){const blob=asset.data.startsWith('data:')?await(await fetch(asset.data)).blob():new Blob([Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0))],{type:asset.type||'image/png'});await storeTextureAsset(asset.key,blob);}
  if (Array.isArray(data?.modelAssets)) for (const asset of data.modelAssets) if (asset?.key&&asset?.data) { const binary=atob(asset.data); const bytes=new Uint8Array(binary.length); for(let i=0;i<bytes.length;i++) bytes[i]=binary.charCodeAt(i); await storeModelAsset(asset.key,new Blob([bytes],{type:asset.type||'model/gltf-binary'})); }
  if (data?.format !== 'editor-3d-scene' || !Array.isArray(data.objects)) throw new Error('Archivo de escena no válido');
  for(const item of data.objects){if(item.kind==='Modelo'&&item.assetKey&&!await getModelAsset(item.assetKey))throw new Error(`Falta el modelo ${item.name||item.assetKey}; no borré la escena actual.`);for(const row of item.materials||[])for(const mat of row.materials||[])for(const keyName of ['baseTextureKey','roughnessTextureKey','normalTextureKey'])if(mat[keyName]&&!await getTextureAsset(mat[keyName]))throw new Error(`Falta una textura del objeto ${item.name||''}; no borré la escena actual.`);}
  loadingProjectScene=true;
  try {
  clearTimeout(reflectionRefreshTimer);for(const state of wetSurfaces.values()){scene.remove(state.probe);state.target.dispose();}wetSurfaces.clear();reflectionDirty=false;reflectionRefreshDue=0;reflectionStatus('');
  for (const object of [...objects]) { scene.remove(object); if (object.userData.helper) scene.remove(object.userData.helper); disposeObjectResources(object); }
  for (const marker of boneDots.values()){scene.remove(marker);marker.material?.dispose?.();}
  boneDots.clear();objects.length=0;assetObjects.length=0;keyframes.clear();animationTrackIds.clear();animationTrackCache=null;animationNodesCache=null;currentFrame=0;animationLoop=data.animation?.loop!==false;$('#animationLoop').checked=animationLoop;animationInterpolation=data.animation?.interpolation||'linear';if($('#animationInterpolation'))$('#animationInterpolation').value=animationInterpolation;activeAnimationTarget=null;selected = null; currentModel = null; boneTarget = null; importedMixer = null; importedClips = []; importedAnimationAction = null; viewCameraObject = null; $('#animationPanel').querySelector('.clip-box')?.remove();
  $('#enterCamera').hidden = true; if (cameraMode) exitCameraView();
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
    if(item.geometryRecipe?.type==='roundedBox'){const [w,h,d]=item.geometryRecipe.size;object.geometry.dispose();object.userData.originalCubeGeometry=new THREE.BoxGeometry(w,h,d);object.geometry=roundedBoxGeometry(w,h,d,item.geometryRecipe.radius,5);object.userData.cubeFinish='rounded';}if(item.cubeFinish)object.userData.cubeFinish=item.cubeFinish;
    await restoreMaterialSnapshots(object,item.materials);
    if (object.isLight) { if(item.lightColor)object.color.set(item.lightColor); object.intensity = item.intensity ?? object.intensity;if(object.isDirectionalLight){object.castShadow=softShadowsEnabled;object.shadow.mapSize.set(512,512);object.shadow.camera.left=-8;object.shadow.camera.right=8;object.shadow.camera.top=8;object.shadow.camera.bottom=-8;object.shadow.camera.updateProjectionMatrix();object.shadow.radius=4;object.shadow.normalBias=.012;}if(object.isDirectionalLight){object.castShadow=softShadowsEnabled;object.shadow.mapSize.set(512,512);object.shadow.camera.left=-8;object.shadow.camera.right=8;object.shadow.camera.top=8;object.shadow.camera.bottom=-8;object.shadow.camera.updateProjectionMatrix();object.shadow.radius=4;object.shadow.normalBias=.012;} if ('distance' in object) object.distance = item.distance ?? object.distance; if ('angle' in object) object.angle = item.angle ?? object.angle; if ('penumbra' in object) object.penumbra = item.penumbra ?? object.penumbra; }
    if (object.isCamera) { object.fov = item.fov || object.fov; object.near = item.near ? Math.max(0.005,item.near) : object.near; object.far = item.far || object.far; object.userData.aspectMode=item.aspectMode||'16:9';object.aspect=Number(item.outputAspect)||Number(item.aspect)||16/9;object.userData.outputAspect=object.aspect;object.updateProjectionMatrix(); object.userData.helper?.update(); viewCameraObject = object;addCameraVisual(object); }
  }
  for(const item of modelItems){if(!item.assetKey)continue;const blob=await getModelAsset(item.assetKey);if(!blob)throw new Error(`Falta el modelo ${item.name||item.assetKey} al restaurar la escena`);const buffer=await blob.arrayBuffer();await new Promise((resolve,reject)=>new GLTFLoader().parse(buffer,'',async gltf=>{try{const model=gltf.scene||gltf.scenes?.[0];if(!model)throw new Error('El modelo restaurado no tiene escena');model.name=safeName(item.name||'Modelo');model.userData.kind='Modelo';model.userData.assetKey=item.assetKey;model.position.fromArray(item.position||[0,0,0]);model.rotation.fromArray(item.rotation||[0,0,0]);model.scale.fromArray(item.scale||[1,1,1]);await restoreMaterialSnapshots(model,item.materials);model.traverse(child=>{if(child.isMesh){child.castShadow=true;child.receiveShadow=true;}});scene.add(model);objects.push(model);if(realisticMode&&renderer.shadowMap.enabled)renderer.shadowMap.needsUpdate=true;animationNodesCache=null;currentModel=model;importedClips=gltf.animations||[];importedMixer=importedClips.length?new THREE.AnimationMixer(model):null;if(importedMixer)addImportedClipControls(importedClips,importedMixer);makeBoneMarkers(model);resolve();}catch(error){reject(error);}},reject));}
  for(const pose of data.modelPoses||[]){const owner=objects.find(item=>item.userData.kind==='Modelo'&&(item.userData.assetKey||item.name)===pose.owner);let node=owner;for(const index of pose.path||[])node=node?.children?.[index];if(node?.isBone){node.position.fromArray(pose.position||[0,0,0]);node.quaternion.fromArray(pose.quaternion||[0,0,0,1]).normalize();node.scale.fromArray(pose.scale||[1,1,1]);}}
  if(Array.isArray(data.animation?.tracks)){for(const track of data.animation.tracks){let root=track.assetKey?objects.find(item=>item.userData?.assetKey===track.assetKey):null;if(!root&&track.ownerName)root=objects.find(item=>item.name===track.ownerName&&(!track.ownerKind||item.userData?.kind===track.ownerKind));if(!root)root=objects[track.objectIndex]||null;let node=root;for(const index of track.path||[])node=node?.children?.[index]||null;if(node)animationTrackIds.add(node.uuid);}}if(Array.isArray(data.animation?.keyframes)){const nodes=getAnimatableNodes();for(const row of data.animation.keyframes){const pose=new Map();for(const target of row.targets||[]){let node=null;if(Number.isInteger(target.objectIndex)){let root=target.assetKey?objects.find(item=>item.userData?.assetKey===target.assetKey):null;if(!root&&target.ownerName)root=objects.find(item=>item.name===target.ownerName&&(!target.ownerKind||item.userData?.kind===target.ownerKind));if(!root)root=objects[target.objectIndex]||null;node=root;for(const index of target.path||[])node=node?.children?.[index]||null;}if(!node)node=nodes.find(item=>(item.name||'')===target.name&&(item.isBone?target.kind==='bone':(item.userData?.kind||'Cubo')===target.owner));if(node)pose.set(node.uuid,target.transform);}if(pose.size)keyframes.set(Number(row.frame)||0,pose);}animationTrackCache=null;animationNodesCache=null;}
  currentFrame=Number(data.renderSettings?.currentFrame)||0;loadingProjectScene=false;if(keyframes.size)interpolatePose(currentFrame);restoreWetSurfaces();updateEmissionBloom();rebuildTimeline();updateFrameControls();
  if (viewCameraObject) $('#enterCamera').hidden = false;
  if(data.renderSettings?.selectedName){const previous=objects.find(item=>item.name===data.renderSettings.selectedName);if(previous)selected=previous;}
  if(data.renderSettings?.activeCameraName){const previousCam=objects.find(item=>item.isCamera&&item.name===data.renderSettings.activeCameraName);if(previousCam)viewCameraObject=previousCam;}for(const cam of objects.filter(item=>item.isCamera))if(!cam.userData.cameraVisual)addCameraVisual(cam);
  refreshList();renderProperties();refreshAnimationNodePicker();renderAnimationTrackList();updateStatus();saveCurrentProject();if(data.renderSettings?.cameraMode&&viewCameraObject)enterCameraView(viewCameraObject);loadingProjectScene=false;if(wetSurfaceCount()&&!restoringHistory)refreshWetReflections(true);toast('Escena y modelos cargados');
  } finally { loadingProjectScene=false; }
}
function addImportedClipControls(clips,mixer){
  $('#animationPanel').querySelector('.clip-box')?.remove();if(!mixer||!clips?.length)return;
  const clipBox=document.createElement('div');clipBox.className='clip-box';const title=document.createElement('span');title.textContent='ANIMACIONES DEL MODELO';clipBox.append(title);
  clips.forEach((clip,index)=>{const play=document.createElement('button');play.textContent=`▶ ${clip.name||`Clip ${index+1}`}`;play.addEventListener('click',()=>{mixer.stopAllAction();importedMixer=mixer;importedAnimationAction=mixer.clipAction(clip);importedAnimationAction.reset().play();$('#animMode').dataset.clip='playing';scheduleProjectSave();toast(`Reproduciendo ${clip.name||`Clip ${index+1}`}`);});clipBox.append(play);});
  const own=document.createElement('button');own.textContent='✎ Crear animación propia';own.addEventListener('click',()=>stopImportedClipPreservingPose());clipBox.append(own);$('#animationPanel').append(clipBox);
}
function addLoadedModel(gltf,fileName='Modelo GLB'){
  const model=gltf.scene||gltf.scenes?.[0];if(!model)throw new Error('El GLB no contiene una escena');
  model.name=safeName(fileName.replace(/\.(glb|gltf)$/i,''));model.userData.kind='Modelo';let pbrTextureCount=0;model.traverse(n=>{if(n.isMesh)for(const mat of materialListFor(n))if(mat.map||mat.normalMap||mat.roughnessMap||mat.metalnessMap||mat.emissiveMap)pbrTextureCount++;});const optimization=autoOptimizeImportedRoot(model);model.traverse(child=>{if(child.isMesh){child.castShadow=true;child.receiveShadow=true;for(const mat of materialListFor(child)){mat.userData ||= {};mat.userData.emissionEnabled=false;mat.userData.savedEmissionPower=Number(mat.emissiveIntensity)||.1;mat.emissiveIntensity=0;mat.needsUpdate=true;}}});
  if(importedAnimationAction){importedAnimationAction.stop();importedAnimationAction=null;}
  model.userData.assetKey=`model-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;scene.add(model);objects.push(model);if(realisticMode&&renderer.shadowMap.enabled)renderer.shadowMap.needsUpdate=true;animationNodesCache=null;currentModel=model;boneTarget=null;select(model);makeBoneMarkers(model);importedClips=gltf.animations||[];
  const modelSave=persistModelAsset(model,importedClips);pendingModelImports.add(modelSave);modelSave.then(()=>{saveCurrentProject();toast('GLB guardado con sus materiales y animaciones');}).catch(error=>{console.error(error);toast(`Modelo visible, pero no se pudo conservar completo: ${error.message||error}`);}).finally(()=>pendingModelImports.delete(modelSave));
  importedMixer=importedClips.length?new THREE.AnimationMixer(model):null;if(importedMixer)addImportedClipControls(importedClips,importedMixer);updateEmissionBloom();rebuildTimeline();updateStatus();toast(`GLB importado · ${model.name} · ${pbrTextureCount} materiales con mapas PBR · ${allBones().length} huesos${optimization.before>optimization.after?` · ${optimization.before-optimization.after} vértices exactos duplicados compactados`:''}`);fitImportedModelToView(model);saveCurrentProject();
}
function parseGltfBytes(bytes,fileName){const array=bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);new GLTFLoader().parse(array,'',(gltf)=>{try{addLoadedModel(gltf,fileName);}catch(error){console.error(error);toast(`No se pudo añadir ${fileName}: ${error.message||error}`);}},error=>{console.error(error);toast(`No se pudo leer ${fileName}: ${error.message||error}`);});}
function compactGeometryLosslessly(geometry){if(!geometry?.attributes?.position||geometry.morphAttributes&&Object.keys(geometry.morphAttributes).length)return geometry;const count=geometry.attributes.position.count;if(count<5000)return geometry;const names=Object.keys(geometry.attributes),attrs=names.map(name=>geometry.attributes[name]);if(attrs.some(a=>a.isInterleavedBufferAttribute))return geometry;const indices=geometry.index?Array.from(geometry.index.array):Array.from({length:count},(_,i)=>i),buckets=new Map(),unique=[],remap=new Map(),equal=(a,b)=>{for(const attr of attrs){const offsetA=a*attr.itemSize,offsetB=b*attr.itemSize;for(let k=0;k<attr.itemSize;k++)if(attr.array[offsetA+k]!==attr.array[offsetB+k])return false;}return true;};for(const vertex of indices){let hash=2166136261;for(const attr of attrs){const offset=vertex*attr.itemSize;for(let k=0;k<attr.itemSize;k++){const value=Number(attr.array[offset+k]);const integer=Number.isFinite(value)?Math.imul(Math.trunc(value*65536),0x45d9f3b):0x7fc00000;hash=Math.imul(hash^integer,16777619);}}let bucket=buckets.get(hash),target=-1;if(bucket)for(const candidate of bucket)if(equal(vertex,unique[candidate])){target=candidate;break;}if(target<0){target=unique.length;unique.push(vertex);if(bucket)bucket.push(target);else buckets.set(hash,[target]);}remap.set(vertex,target);}if(unique.length>=count)return geometry;const result=geometry.clone();for(const name of names){const old=geometry.attributes[name],array=new old.array.constructor(unique.length*old.itemSize);for(let i=0;i<unique.length;i++){const from=unique[i]*old.itemSize;array.set(old.array.subarray(from,from+old.itemSize),i*old.itemSize);}result.setAttribute(name,new THREE.BufferAttribute(array,old.itemSize,old.normalized));}result.setIndex(indices.map(i=>remap.get(i)));result.clearGroups();for(const group of geometry.groups)result.addGroup(group.start,group.count,group.materialIndex);result.setDrawRange(geometry.drawRange.start,geometry.drawRange.count);return result;}
function autoOptimizeImportedRoot(root){if(!root)return{before:0,after:0};const shared=new Map();let before=0,after=0;root.traverse(node=>{if(!node.isMesh||!node.geometry)return;const source=node.geometry;before+=source.attributes.position?.count||0;let target=shared.get(source);if(!target){target=compactGeometryLosslessly(source);shared.set(source,target);}node.geometry=target;after+=target.attributes.position?.count||0;});return{before,after};}
function addImportedRoot(root,fileName,clips=[]){if(!root)throw new Error('El archivo no contiene un nodo 3D');const optimization=autoOptimizeImportedRoot(root);const name=safeName(String(fileName||'Modelo').replace(/\.(glb|gltf|fbx|obj|stl|ply)$/i,''));root.name=name;root.userData.kind='Modelo';root.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;for(const mat of materialListFor(node)){mat.userData ||= {};mat.userData.emissionEnabled=false;mat.userData.savedEmissionPower=Number(mat.emissiveIntensity)||.1;mat.emissiveIntensity=0;mat.needsUpdate=true;}}});if(importedAnimationAction){importedAnimationAction.stop();importedAnimationAction=null;}root.userData.assetKey=`model-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;scene.add(root);objects.push(root);if(realisticMode&&renderer.shadowMap.enabled)renderer.shadowMap.needsUpdate=true;animationNodesCache=null;currentModel=root;boneTarget=null;select(root);makeBoneMarkers(root);importedClips=clips||[];const save=persistModelAsset(root,importedClips);pendingModelImports.add(save);save.then(()=>{saveCurrentProject();toast('Modelo y materiales guardados en el proyecto');}).catch(error=>{console.error(error);toast(`Modelo importado, pero no se pudo conservar: ${error.message||error}`);}).finally(()=>pendingModelImports.delete(save));importedMixer=importedClips.length?new THREE.AnimationMixer(root):null;if(importedMixer)addImportedClipControls(importedClips,importedMixer);updateEmissionBloom();rebuildTimeline();updateStatus();toast(`Modelo importado · ${name} · geometría optimizada sin pérdida de calidad${optimization.before>optimization.after?` · ${optimization.before-optimization.after} vértices redundantes eliminados`:''}`);saveCurrentProject();}
function fileBuffer(file){return file.arrayBuffer();}
async function importModelFiles(fileList){const files=[...fileList];if(!files.length)return;const file=files.find(f=>/\.(glb|gltf|fbx|obj|stl|ply)$/i.test(f.name));if(!file){const project=files.find(f=>/\.(json|editor3d)$/i.test(f.name));if(project){await importFile(project);return;}throw new Error('Selecciona un modelo GLB, GLTF, FBX, OBJ, STL o PLY.');}const ext=file.name.split('.').pop().toLowerCase();lightingBaked=false;$('#status').textContent=`Importando ${file.name}…`;const bundle=buildAssetManager(files);try{const bytes=await fileBuffer(file);if(ext==='glb'){const loader=new GLTFLoader(bundle.manager);await new Promise((resolve,reject)=>{const url=bundle.urls.get(file.name.toLowerCase());loader.load(url,gltf=>{try{addLoadedModel(gltf,file.name);resolve();}catch(e){reject(e);}},event=>{if(event.total)$('#status').textContent=`Leyendo ${file.name} · ${Math.round(event.loaded/event.total*100)}%`;},reject);});return;}if(ext==='gltf'){const loader=new GLTFLoader(bundle.manager),json=await file.text();await new Promise((resolve,reject)=>loader.parse(json,'',(gltf)=>{try{addLoadedModel(gltf,file.name);resolve();}catch(e){reject(e);}},reject));return;}if(ext==='fbx'){const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),root=new FBXLoader(bundle.manager).parse(array,'');addImportedRoot(root,file.name,root.animations||[]);return;}if(ext==='obj'){const mtl=files.find(f=>f.name.toLowerCase().endsWith('.mtl'));let loader=new OBJLoader(bundle.manager);if(mtl){const manager=new MTLLoader(bundle.manager);const materials=manager.parse(await mtl.text(),'');materials.preload();loader.setMaterials(materials);}const root=loader.parse(await file.text());addImportedRoot(root,file.name,[]);return;}if(ext==='stl'||ext==='ply'){const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),geometry=ext==='stl'?new STLLoader(bundle.manager).parse(array):new PLYLoader(bundle.manager).parse(array);if(!geometry.attributes.normal)geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({color:'#b9bec4',roughness:.62,metalness:.04});const mesh=new THREE.Mesh(geometry,material);mesh.name=file.name.replace(/\.(stl|ply)$/i,'');const root=new THREE.Group();root.add(mesh);addImportedRoot(root,file.name,[]);return;}}finally{bundle.dispose();$('#status').textContent='Listo';}}
function buildAssetManager(files){const urls=new Map();for(const file of files)urls.set(file.name.toLowerCase(),URL.createObjectURL(file));const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{const clean=decodeURIComponent(url.split(/[?#]/)[0]).split('/').pop().toLowerCase();return urls.get(clean)||url;});return{manager,urls,dispose:()=>{for(const url of urls.values())URL.revokeObjectURL(url);}};}
function bytesToArrayBuffer(bytes){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
function fitImportedModelToView(root){if(!root||!orbit||!camera)return;root.updateWorldMatrix?.(true,true);const bounds=new THREE.Box3().setFromObject(root);if(bounds.isEmpty())return;const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),radius=Math.max(size.length()*.5,.05),fov=THREE.MathUtils.degToRad(camera.fov||45),aspect=Math.max(.25,camera.aspect||1),horizontalFov=2*Math.atan(Math.tan(fov*.5)*aspect),fitFov=Math.min(fov,horizontalFov),distance=Math.max(radius/Math.sin(fitFov*.5)*1.12,camera.near*10);let direction=camera.position.clone().sub(orbit.target);if(direction.lengthSq()<1e-8)direction.set(1,.7,1);direction.normalize();orbit.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);camera.near=Math.max(.001,radius/1000);camera.far=Math.max(500,radius*100);camera.updateProjectionMatrix();orbit.minDistance=Math.max(.005,radius*.02);orbit.maxDistance=Math.max(40,radius*100);orbit.update();}
function importGlbBuffer(buffer,fileName='Modelo.glb'){parseGltfBytes(buffer,fileName);}
async function importProjectData(data,fileName='Proyecto'){
  if(data?.format!=='editor-3d-scene'||!Array.isArray(data.objects))throw new Error('El archivo no parece un proyecto de Editor 3D.');
  const name=safeName(data.projectName||fileName.replace(/\.editor3d\.json$|\.json$/i,''));const item={id:`p-${Date.now()}`,name,createdAt:Date.now(),updatedAt:Date.now(),scene:data};const projects=projectList();projects.unshift(item);writeProjectList(projects);renderProjectCards();currentProjectId=item.id;localStorage.setItem('editor3d:last-project',item.id);$('#projectHome').hidden=true;$('#app').hidden=false;await loadScene(data);$('#home').title=name;toast(`Proyecto importado: ${name}`);
}
async function importPickedFile(name,bytes){const ext=String(name).split('.').pop().toLowerCase();if(ext==='json'){const text=new TextDecoder().decode(bytes);let data;try{data=JSON.parse(text);}catch{throw new Error('No pude leer el archivo JSON seleccionado.');}if(data?.format==='editor-3d-scene'){await importProjectData(data,name);return;}if(data?.metadata?.type==='Object'){addImportedRoot(new THREE.ObjectLoader().parse(data),name,[]);return;}if(Array.isArray(data?.objects)){await loadScene(data);return;}throw new Error('Proyecto JSON no compatible.');}if(ext==='glb'){parseGltfBytes(bytes,name);return;}if(ext==='gltf'){throw new Error('En Android usa GLB para modelos con texturas/archivos externos, o abre el .gltf junto con todos sus recursos desde el selector web.');}if(ext==='fbx'){const root=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');addImportedRoot(root,name,root.animations||[]);return;}if(ext==='obj'){addImportedRoot(new OBJLoader().parse(new TextDecoder().decode(bytes)),name,[]);return;}if(ext==='stl'||ext==='ply'){const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),geometry=ext==='stl'?new STLLoader().parse(array):new PLYLoader().parse(array);if(!geometry.attributes.normal)geometry.computeVertexNormals();const root=new THREE.Group();root.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#b9bec4',roughness:.62,metalness:.04})));addImportedRoot(root,name,[]);return;}throw new Error('Formato no compatible. Usa GLB, GLTF, FBX, OBJ, STL, PLY o proyecto JSON guardado por Volumi3d.');}
function importFile(file){if(!file)return;const ext=file.name.split('.').pop().toLowerCase();if(ext==='json'||ext==='editor3d'){file.text().then(async text=>{const data=JSON.parse(text);if(data?.format==='editor-3d-scene')await importProjectData(data,file.name);else if(data?.metadata?.type==='Object')addImportedRoot(new THREE.ObjectLoader().parse(data),file.name,[]);else if(Array.isArray(data?.objects))await loadScene(data);else throw new Error('Proyecto JSON no compatible');}).catch(error=>toast(error.message||'No se pudo abrir el proyecto'));return;}importModelFiles([file]).catch(error=>{console.error(error);toast(`No se pudo importar: ${error.message||error}`);});}
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
  if (activeAnimationTarget?.isBone) { boneTarget = activeAnimationTarget; window.editorGizmo?.attach(boneTarget); window.editorGizmo?.setMode(['hand','foot','head'].includes(boneRole(boneTarget.name))?'translate':'rotate'); }
  rebuildTimeline(); toast('Clip detenido · edición manual');
}
function boneSide(name){const n=(name||'').toLowerCase();return n.includes('left')||/(^|[^a-z])l([^a-z]|$)/.test(n)||/(_|\.|:)l$/.test(n)?'l':n.includes('right')||/(^|[^a-z])r([^a-z]|$)/.test(n)||/(_|\.|:)r$/.test(n)?'r':'';}
function boneRole(name){const n=(name||'').toLowerCase().replace(/^(?:mixamorig|armature|rig)[:_]?/,'').replace(/[^a-z0-9]/g,'');if(/head|skull/.test(n))return'head';if(/hand|wrist|palm/.test(n))return'hand';if(/foot|ankle|toe|ball/.test(n))return'foot';if(/lowerarm|forearm|elbow/.test(n))return'lowerarm';if(/upperarm|clavicle|shoulder/.test(n)||/^(left|right)?arm$/.test(n))return'upperarm';if(/calf|shin|lowerleg|(?:left|right)?leg$/.test(n))return'calf';if(/thigh|upperleg|upleg|femur/.test(n))return'thigh';if(/spine|pelvis|hips/.test(n))return'torso';if(/neck/.test(n))return'torso';return'';}
function beginIkDrag(endBone){
  if(!currentModel||!endBone?.isBone)return;const role=boneRole(endBone.name),side=boneSide(endBone.name);let allowed=[];
  if(role==='head')allowed=['torso','head'];else if(['hand','lowerarm','upperarm'].includes(role))allowed=['upperarm','lowerarm','hand'];else if(['foot','calf','thigh'].includes(role))allowed=['thigh','calf','foot'];else return;
  const ancestors=[];let parent=endBone.parent;while(parent?.isBone){ancestors.unshift(parent);parent=parent.parent;}
  const chainBones=ancestors.filter(b=>{const r=boneRole(b.name),s=boneSide(b.name);return allowed.includes(r)&&(!side||!s||side===s);});
  if(role==='head'&&chainBones.length>3)chainBones.splice(0,chainBones.length-3);
  if(chainBones.length<2)return;currentModel.updateMatrixWorld(true);
  const joints=chainBones.map(b=>b.getWorldPosition(new THREE.Vector3()));joints.push(endBone.getWorldPosition(new THREE.Vector3()));
  const lengths=joints.slice(1).map((v,i)=>Math.max(v.distanceTo(joints[i]),1e-5));
  ikDragState={endBone,chainBones,joints,rootPosition:joints[0].clone(),lengths,role,side};
}
function solveIkDrag(){
  const state=ikDragState;if(!state)return;const {chainBones,joints,lengths,rootPosition}=state;currentModel?.updateMatrixWorld(true);
  const goal=state.endBone.getWorldPosition(new THREE.Vector3());const total=lengths.reduce((a,b)=>a+b,0),distance=rootPosition.distanceTo(goal);
  if(distance>=total){const direction=goal.clone().sub(rootPosition).normalize();for(let i=1;i<joints.length;i++)joints[i].copy(rootPosition).addScaledVector(direction,lengths.slice(0,i).reduce((a,b)=>a+b,0));}
  else{joints[joints.length-1].copy(goal);for(let iter=0;iter<8;iter++){joints[0].copy(rootPosition);for(let i=1;i<joints.length;i++){const dir=joints[i].clone().sub(joints[i-1]).normalize();joints[i].copy(joints[i-1]).addScaledVector(dir,lengths[i-1]);}joints[joints.length-1].copy(goal);for(let i=joints.length-2;i>=0;i--){const dir=joints[i].clone().sub(joints[i+1]).normalize();joints[i].copy(joints[i+1]).addScaledVector(dir,lengths[i]);}}}
  for(let i=0;i<chainBones.length;i++){rotateBoneToward(chainBones[i],joints[i],joints[i+1],chainBones[i+1]||state.endBone);currentModel?.updateMatrixWorld(true);}
  updateBoneMarkers();
}
function rotateBoneToward(bone,from,to,child=null){
  if(!bone||!from||!to)return;bone.parent?.updateWorldMatrix(true,false);bone.updateWorldMatrix(true,false);
  child=child||bone.children.find(node=>node.isBone);if(!child)return;const origin=bone.getWorldPosition(new THREE.Vector3());const oldDirection=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();const target=to.clone().sub(from).normalize();if(oldDirection.lengthSq()<1e-9||target.lengthSq()<1e-9)return;
  const parentQ=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||new THREE.Quaternion();const worldQ=new THREE.Quaternion().setFromUnitVectors(oldDirection,target).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));const localQ=parentQ.invert().multiply(worldQ);bone.quaternion.slerp(localQ,0.5).normalize();
}
function allBones() {
  const found = [];
  for(const root of objects)if(root.userData?.kind==='Modelo'||root===currentModel)root.traverse?.(node=>{if(node.isBone)found.push(node);});
  return [...new Map(found.map(bone=>[bone.uuid,bone])).values()];
}
function updateBoneMarkers() {
  if (!boneDots.size) return;
  const markerCamera = cameraMode ? activeCamera : camera;
  markerCamera.updateMatrixWorld();
  for(const root of objects)if(root.userData?.kind==='Modelo')root.updateMatrixWorld(true);
  const worldPosition = new THREE.Vector3();
  const height = Math.max(1, container.clientHeight);
  for (const [bone, marker] of boneDots) {
    marker.visible = animationMode && !renderCaptureActive;
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
      if (material.emissive) material.emissive.set('#000000');
      if ('emissiveIntensity' in material) material.emissiveIntensity = 0;
      material.needsUpdate = true;
    }
  });
}
function makeBoneMarkers(model) {
  for(const [bone,marker] of [...boneDots])if(model===bone||model.getObjectById(bone.id)){scene.remove(marker);marker.material?.dispose?.();boneDots.delete(bone);}
  model.updateMatrixWorld(true);
  const bones = [];
  model.traverse((node) => { if (node.isBone) bones.push(node); });
  const geometry = sharedBoneMarkerGeometry||(sharedBoneMarkerGeometry=new THREE.SphereGeometry(1, 8, 6));
  bones.forEach((bone) => {
    const material = new THREE.MeshBasicMaterial({ color: '#e8f3f7', depthTest: false, depthWrite: false, toneMapped: false });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = `Bone handle: ${bone.name || 'Bone'}`;
    marker.userData.boneHandleTarget = bone;
    marker.renderOrder = 1001;
    marker.visible = animationMode && !renderCaptureActive;
    scene.add(marker);
    boneDots.set(bone, marker);
  });
  refreshBoneList();
  updateBoneMarkers();
}
function selectBone(bone) {
  let root=bone;while(root.parent&&!objects.includes(root))root=root.parent;if(root.userData?.kind==='Modelo')currentModel=root;
  if (importedAnimationAction) stopImportedClipPreservingPose();
  boneTarget = bone;
  activeAnimationTarget = bone;animationTrackIds.add(bone.uuid);
  window.editorGizmo?.attach(bone);
  const endRole=boneRole(bone.name);window.editorGizmo?.setMode(['hand','foot','head'].includes(endRole)?'translate':(activeTool === 'select' ? 'rotate' : activeTool));
  $('#timelineTrackName').textContent = bone.name || 'Bone';
  if (!animationMode) toggleAnimationMode();
  rebuildTimeline();refreshAnimationNodePicker();renderAnimationTrackList();
  document.querySelectorAll('.anim-track').forEach((track) => track.classList.toggle('selected', track.dataset.uuid === bone.uuid));
  refreshBoneList();
  updateBoneMarkers();
}
function getAnimatableNodes(){const nodes=[];for(const root of objects){nodes.push(root);root.traverse?.(node=>{if(node!==root&&node.isObject3D&&!node.userData?.helper)nodes.push(node);});}return [...new Map(nodes.map(node=>[node.uuid,node])).values()].slice(0,800);}
function getAnimationNodeLabel(node){let root=node;while(root.parent&&!objects.includes(root))root=root.parent;const owner=root.name||root.userData?.kind||'Objeto';if(node.isBone)return `Hueso · ${node.name||'sin nombre'}`;if(node.isCamera)return `Cámara · ${node.name}`;if(node.isLight)return `${node.userData?.kind||'Luz'} · ${node.name}`;if(node===root)return `${node.userData?.kind||'Objeto'} · ${node.name}`;return `${owner} / ${node.name||node.type}`;}
function refreshAnimationNodePicker(){const picker=$('#animationNodePicker');if(!picker)return;const old=picker.value;picker.replaceChildren(new Option('Elegir objeto, cámara, luz o hueso…',''));for(const node of getAnimatableNodes()){const option=new Option(getAnimationNodeLabel(node),node.uuid);picker.append(option);}if([...picker.options].some(option=>option.value===old))picker.value=old;}
function renderAnimationTrackList(){const panel=$('#animationTrackList');if(!panel)return;panel.replaceChildren();const nodes=getAnimatableNodes().filter(node=>animationTrackIds.has(node.uuid));for(const node of nodes){const row=document.createElement('div');row.className=`animation-track-row${node===activeAnimationTarget?' active':''}`;const pick=document.createElement('button');pick.type='button';pick.className='track-select';pick.textContent=getAnimationNodeLabel(node);pick.title=pick.textContent;pick.addEventListener('click',()=>{activeAnimationTarget=node;if(node.isBone){selectBone(node);return;}boneTarget=null;let root=node;while(root.parent&&!objects.includes(root))root=root.parent;selected=node;window.editorGizmo?.attach(node);window.editorGizmo?.setMode(node.isCamera||node.isLight?'rotate':'translate');$('#timelineTrackName').textContent=getAnimationNodeLabel(node);renderAnimationTrackList();refreshList();renderProperties();});const remove=document.createElement('button');remove.type='button';remove.className='track-remove';remove.textContent='×';remove.title='Quitar pista';remove.addEventListener('click',()=>removeAnimationTrack(node));row.append(pick,remove);panel.append(row);}}
function addAnimationTrack(node){if(!node){toast('Elige un objeto o nodo de escena');return;}if(importedAnimationAction)stopImportedClipPreservingPose();animationMode=true;document.body.classList.add('animating');$('#animationPanel').hidden=false;$('#animationTimeline').hidden=false;animationTrackIds.add(node.uuid);activeAnimationTarget=node;if(node.isBone)boneTarget=node;else{boneTarget=null;let root=node;while(root.parent&&!objects.includes(root))root=root.parent;selected=node;window.editorGizmo?.attach(node);}refreshAnimationNodePicker();renderAnimationTrackList();rebuildTimeline();$('#timelineTrackName').textContent=getAnimationNodeLabel(node);scheduleProjectSave();toast(`Pista añadida · ${getAnimationNodeLabel(node)}`);}
function removeAnimationTrack(node){animationTrackIds.delete(node.uuid);for(const pose of keyframes.values())pose.delete(node.uuid);if(activeAnimationTarget===node)activeAnimationTarget=null;animationTrackCache=null;animationNodesCache=null;renderAnimationTrackList();rebuildTimeline();recordHistory();scheduleProjectSave();}
function makeAnimTrack(node,title){const track=document.createElement('div');track.className=`anim-track${node===activeAnimationTarget?' selected':''}`;track.dataset.uuid=node.uuid;const label=document.createElement('span');label.className='track-label';label.textContent=title;label.title=title;track.append(label);track.addEventListener('pointerdown',event=>{if(event.target.closest('.key-dot'))return;activeAnimationTarget=node;if(node.isBone){selectBone(node);}else{boneTarget=null;let root=node;while(root.parent&&!objects.includes(root))root=root.parent;selected=node;window.editorGizmo?.attach(node);window.editorGizmo?.setMode(node.isCamera||node.isLight?'rotate':'translate');$('#timelineTrackName').textContent=getAnimationNodeLabel(node);renderAnimationTrackList();refreshList();renderProperties();}const bounds=track.getBoundingClientRect();if(event.clientX>bounds.left+56)setFrame(Math.round(THREE.MathUtils.clamp((event.clientX-bounds.left-56)/Math.max(1,bounds.width-56),0,1)*120));});$('#timelineRuler').append(track);}
function rebuildTimeline(){const ruler=$('#timelineRuler');ruler.replaceChildren();const cursor=document.createElement('i');cursor.id='timelineCursor';ruler.append(cursor);for(const frame of [0,10,20,30,40,50,60,70,80,90,100,110,120]){const tick=document.createElement('span');tick.className='ruler-tick';tick.style.left=`${frame/120*100}%`;tick.textContent=String(frame);ruler.append(tick);}const nodes=new Map(getAnimatableNodes().map(node=>[node.uuid,node]));for(const pose of keyframes.values())for(const uuid of pose.keys())if(nodes.has(uuid))animationTrackIds.add(uuid);const target=activeAnimationTarget||boneTarget||selected;if(target)animationTrackIds.add(target.uuid);for(const uuid of animationTrackIds){const node=nodes.get(uuid);if(node)makeAnimTrack(node,getAnimationNodeLabel(node));}updateKeyMarkers();updateFrameControls();renderAnimationTrackList();}
function updateKeyMarkers(){document.querySelectorAll('.anim-track').forEach(track=>{track.querySelectorAll('.key-dot').forEach(marker=>marker.remove());for(const [frame,pose] of keyframes){if(!pose.has(track.dataset.uuid))continue;const marker=document.createElement('button');marker.type='button';marker.className='key-dot';marker.style.left=`${frame/120*100}%`;marker.title=`Fotograma ${frame} · toca para ir, mantén para eliminar`;marker.setAttribute('aria-label',`Keyframe ${frame}`);marker.addEventListener('click',event=>{event.stopPropagation();setFrame(frame);});marker.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();pose.delete(track.dataset.uuid);if(!pose.size)keyframes.delete(frame);animationTrackCache=null;animationNodesCache=null;rebuildTimeline();recordHistory();scheduleProjectSave();toast('Keyframe eliminado');});let holdTimer;marker.addEventListener('pointerdown',event=>{holdTimer=setTimeout(()=>{pose.delete(track.dataset.uuid);if(!pose.size)keyframes.delete(frame);animationTrackCache=null;animationNodesCache=null;rebuildTimeline();recordHistory();scheduleProjectSave();toast('Keyframe eliminado');},650);});for(const type of ['pointerup','pointercancel','pointerleave'])marker.addEventListener(type,()=>clearTimeout(holdTimer));track.append(marker);}});}
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
    if (boneTarget) { window.editorGizmo?.attach(boneTarget); window.editorGizmo?.setMode(['hand','foot','head'].includes(boneRole(boneTarget.name))?'translate':'rotate'); }
    if(!boneTarget&&selected){activeAnimationTarget=selected;animationTrackIds.add(selected.uuid);}
    refreshAnimationNodePicker();rebuildTimeline();
    if (currentModel) refreshBoneList();
    updateBoneMarkers();
    hint.textContent = boneTarget?'Modo animación · manipula el hueso y agrega keyframes':'Modo animación · selecciona objetos, luces o cámaras y agrega keyframes';
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
    scale: vectorValues(node?.scale, [1, 1, 1], 3),
    intensity: Number.isFinite(node?.intensity)?node.intensity:null,
    fov: Number.isFinite(node?.fov)?node.fov:null,
    color: node?.color?.isColor?`#${node.color.getHexString()}`:null,
    distance:Number.isFinite(node?.distance)?node.distance:null,
    angle:Number.isFinite(node?.angle)?node.angle:null,
    penumbra:Number.isFinite(node?.penumbra)?node.penumbra:null
  };
}
function writeTransform(node, state) {
  if (!node || !state) return;
  const safe = readTransform({ position: state.position, quaternion: state.quaternion, scale: state.scale });
  for(const key of ['intensity','fov','color','distance','angle','penumbra'])if(state[key]!==undefined)safe[key]=state[key];
  node.position.fromArray(safe.position);
  node.quaternion.fromArray(safe.quaternion).normalize();
  node.scale.fromArray(safe.scale);
  if(safe.intensity!==null&&'intensity' in node)node.intensity=safe.intensity;
  if(safe.fov!==null&&node.isCamera){node.fov=safe.fov;node.updateProjectionMatrix();node.userData.helper?.update?.();}
  if(safe.color&&node.color?.isColor)node.color.set(safe.color);
  if(safe.distance!==null&&'distance' in node)node.distance=safe.distance;
  if(safe.angle!==null&&'angle' in node)node.angle=safe.angle;
  if(safe.penumbra!==null&&'penumbra' in node)node.penumbra=safe.penumbra;
  if(node.isLight||node.isCamera)node.userData.helper?.update?.();
}
function captureKeyframe(onlyTarget=null) {
  const inputFrame = Number($('#frameNumber').value);
  const frame = Math.max(0, Math.min(120, Number.isFinite(inputFrame) ? inputFrame : currentFrame));
  currentFrame = frame;
  const target = onlyTarget||activeAnimationTarget||boneTarget||selected;
  if (!target) { toast('Selecciona un objeto, una luz, una cámara o un hueso'); return; }
  if(onlyTarget)animationTrackIds.add(onlyTarget.uuid);else if(target)animationTrackIds.add(target.uuid);
  const pose = keyframes.get(frame) || new Map();
  const nodes=getAnimatableNodes();
  const captureIds=onlyTarget?new Set([onlyTarget.uuid]):animationTrackIds;
  for(const node of nodes)if(captureIds.has(node.uuid))pose.set(node.uuid,readTransform(node));
  keyframes.set(frame, pose);animationTrackCache=null;animationNodesCache=null;
  scheduleProjectSave();recordHistory();rebuildTimeline();
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
}
function buildAnimationTrackCache(){
  const tracks=new Map();
  for(const [frame,pose] of keyframes){for(const [uuid,transform] of pose){if(!tracks.has(uuid))tracks.set(uuid,[]);tracks.get(uuid).push([frame,transform]);}}
  for(const list of tracks.values())list.sort((a,b)=>a[0]-b[0]);
  animationTrackCache=tracks;animationNodesCache=new Map(getAnimatableNodes().map(node=>[node.uuid,node]));return tracks;
}
function interpolatePose(frame) {
  const tracks=animationTrackCache||buildAnimationTrackCache();
  const nodes=animationNodesCache||(animationNodesCache=new Map(getAnimatableNodes().map(node=>[node.uuid,node])));
  for(const [uuid,available] of tracks){
    const node=nodes.get(uuid);if(!node||available.length<2)continue;
    let lo=0,hi=available.length;while(lo<hi){const mid=(lo+hi)>>1;if(available[mid][0]<frame)lo=mid+1;else hi=mid;}
    const afterIndex=lo,before=available[Math.max(0,afterIndex-1)],after=available[Math.min(available.length-1,afterIndex)];
    const [f0,start]=before,[f1,end]=after;let t=f0===f1?0:THREE.MathUtils.clamp((frame-f0)/(f1-f0),0,1);if(animationInterpolation==='smooth')t=t*t*(3-2*t);else if(animationInterpolation==='step')t=f0===f1||frame<f1?0:1;
    node.position.fromArray(start.position).lerp(new THREE.Vector3(...end.position),t);
    node.scale.fromArray(start.scale).lerp(new THREE.Vector3(...end.scale),t);
    node.quaternion.fromArray(start.quaternion).slerp(new THREE.Quaternion(...end.quaternion),t).normalize();
    if(Number.isFinite(start.intensity)&&Number.isFinite(end.intensity)&&'intensity' in node)node.intensity=THREE.MathUtils.lerp(start.intensity,end.intensity,t);
    if(Number.isFinite(start.fov)&&Number.isFinite(end.fov)&&node.isCamera){node.fov=THREE.MathUtils.lerp(start.fov,end.fov,t);node.updateProjectionMatrix();}
    if(start.color&&end.color&&node.color?.isColor)node.color.set(start.color).lerp(new THREE.Color(end.color),t);
    for(const key of ['distance','angle','penumbra'])if(Number.isFinite(start[key])&&Number.isFinite(end[key])&&key in node)node[key]=THREE.MathUtils.lerp(start[key],end[key],t);
    if(node.isLight||node.isCamera)node.userData.helper?.update?.();
  }
  currentModel?.updateMatrixWorld(true);if(performance.now()-(window._lastMarkerUpdate||0)>45){updateBoneMarkers();window._lastMarkerUpdate=performance.now();}
}
function setFrame(frame) {
  currentFrame = THREE.MathUtils.clamp(Number.isFinite(Number(frame))?Number(frame):0,0,120);
  interpolatePose(currentFrame);
  updateFrameControls();
}
function togglePlayback() {
  if(importedAnimationAction){stopImportedClipPreservingPose();}
  isPlaying = !isPlaying;$('#playAnimation').textContent=isPlaying?'❚❚':'▶';clearInterval(playTimer);
  if(isPlaying)playTimer=setInterval(()=>{if(document.visibilityState==='hidden'||renderCaptureActive)return;const step=120/Math.max(1,(Number($('#renderDuration').value)||5)*24);if(currentFrame>=120){if(!animationLoop){isPlaying=false;$('#playAnimation').textContent='▶';clearInterval(playTimer);return;}currentFrame=0;}else currentFrame=Math.min(120,currentFrame+step);interpolatePose(currentFrame);updateFrameControls();},1000/24);
}
function resize() {
  const rect = container.getBoundingClientRect();
  if (!renderer || rect.width < 2 || rect.height < 2) return;
  renderer.setSize(rect.width, rect.height, false);
  composer.setSize(rect.width, rect.height);
  const aspect = rect.width / rect.height;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  for (const object of objects) if (object.isCamera) { if(!object.userData.aspectMode||object.userData.aspectMode==='viewport')object.aspect=aspect;else object.aspect=Number(object.userData.outputAspect)||aspect; object.updateProjectionMatrix(); object.userData.helper?.update(); }
  if (cameraMode && activeCamera && (!activeCamera.userData.aspectMode||activeCamera.userData.aspectMode==='viewport')) { activeCamera.aspect = aspect; activeCamera.updateProjectionMatrix(); }
}
function enterCameraView(selectedCamera = viewCameraObject) {
  if (!selectedCamera?.isCamera) { toast('Selecciona una cámara en la jerarquía'); return; }
  activeCamera = selectedCamera;
  cameraMode = true;
  if(selectedCamera.userData.cameraVisual)selectedCamera.userData.cameraVisual.visible=false;
  sceneRenderPass.camera = activeCamera;
  $('#enterCamera').hidden = true;
  $('#exitCamera').hidden = false;
  orbit.enabled = false;
  $('#hint').textContent = `Vista de ${selectedCamera.name} · Pulsa Salir para volver`;
  toast(`Mirando por ${selectedCamera.name}`);
}
function exitCameraView() {
  cameraMode = false;
  if(viewCameraObject?.userData.cameraVisual)viewCameraObject.userData.cameraVisual.visible=true;
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
    else if (activeTool === 'select') {
      const hits = raycaster.intersectObjects(objects, true);
      const hit = hits[0]?.object;
      if (hit) { const target=hit;select(target);window.editorGizmo?.attach(target);window.editorGizmo?.setMode('translate'); }
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
$('#materialRoughness').min='0.12';$('#materialRoughness').max='0.94';
$('#materialRoughness').addEventListener('input',event=>{const value=Number(event.target.value);$('#roughnessValue').value=value.toFixed(2);editTargetMaterials(mat=>{if('roughness'in mat)mat.roughness=THREE.MathUtils.clamp(Number.isFinite(value)?value:0.55,0.12,0.94);});});
$('#materialMetalness').addEventListener('input',event=>{const value=Number(event.target.value);$('#metalnessValue').value=value.toFixed(2);editTargetMaterials(mat=>{if('metalness'in mat)mat.metalness=value;});});
$('#materialEmissionEnabled').addEventListener('change',event=>{editTargetMaterials(mat=>{mat.userData ||= {};if(event.target.checked){mat.userData.emissionEnabled=true;mat.emissive?.set($('#materialEmissive').value);mat.emissiveIntensity=THREE.MathUtils.clamp(Number($('#materialEmissionPower').value)||0,0,1);}else{mat.userData.savedEmissionPower=Number(mat.emissiveIntensity)||Number($('#materialEmissionPower').value)||0;mat.userData.emissionEnabled=false;mat.emissiveIntensity=0;}});syncEmissionSpill(renderMaterialMesh);updateEmissionBloom();refreshMaterialPanel();});
$('#materialEmissive').addEventListener('input',event=>{editTargetMaterials(mat=>{mat.emissive?.set(event.target.value);if($('#materialEmissionEnabled').checked){mat.userData ||= {};mat.userData.emissionEnabled=true;if(mat.emissiveIntensity<=0)mat.emissiveIntensity=Math.min(1,Number(mat.userData.savedEmissionPower)||0);}});syncEmissionSpill(renderMaterialMesh);updateEmissionBloom();});
$('#materialEmissionPower').addEventListener('input',event=>{const value=Number(event.target.value);$('#emissionValue').value=value.toFixed(2);editTargetMaterials(mat=>{mat.userData ||= {};mat.userData.savedEmissionPower=value;mat.userData.emissionEnabled=$('#materialEmissionEnabled').checked;if(mat.emissive)mat.emissiveIntensity=mat.userData.emissionEnabled?value:0;});syncEmissionSpill(renderMaterialMesh);updateEmissionBloom();});
$('#materialShader').addEventListener('change',event=>{const mode=event.target.value;$('#materialNoiseControls').hidden=mode!=='noise';if(renderMaterialMesh)setWaterSubdivision(renderMaterialMesh,mode==='water');editTargetMaterials(mat=>applyTextureShader(mat,mode));});
$('#materialNoiseScale').addEventListener('input',event=>{const value=Number(event.target.value);$('#materialNoiseScaleValue').textContent=value.toFixed(0);for(const mat of materialListFor(renderMaterialMesh)){mat.userData ||= {};mat.userData.noiseScale=value;if(mat.userData.noiseUniforms?.editorNoiseScale)mat.userData.noiseUniforms.editorNoiseScale.value=value;}scheduleProjectSave();});
$('#materialNoiseStrength').addEventListener('input',event=>{const value=Number(event.target.value);$('#materialNoiseStrengthValue').textContent=value.toFixed(2);for(const mat of materialListFor(renderMaterialMesh)){mat.userData ||= {};mat.userData.noiseStrength=value;if(mat.userData.noiseUniforms?.editorNoiseStrength)mat.userData.noiseUniforms.editorNoiseStrength.value=value;}scheduleProjectSave();});
$('#baseTextureFile').addEventListener('change',e=>importMaterialMap(e.target.files?.[0],'Textura base','map','baseTextureKey',THREE.SRGBColorSpace));
$('#roughnessTextureFile').addEventListener('change',e=>importMaterialMap(e.target.files?.[0],'Mapa roughness','roughnessMap','roughnessTextureKey',THREE.NoColorSpace));
$('#normalTextureFile').addEventListener('change',e=>importMaterialMap(e.target.files?.[0],'Mapa normal','normalMap','normalTextureKey',THREE.NoColorSpace));
$('#normalStrength').addEventListener('input',e=>{const value=Number(e.target.value);$('#normalStrengthValue').value=value.toFixed(2);editTargetMaterials(mat=>mat.normalScale?.set(value,value));});
$('#wetFloor').addEventListener('click',applyWetFloor);$('#applyCubeFinish').addEventListener('click',applyCubeFinish);
$('#featureSoftShadows').addEventListener('change',event=>{softShadowsEnabled=event.target.checked;renderer.shadowMap.enabled=softShadowsEnabled&&(realisticMode||whiteStudioView);renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;sun.castShadow=softShadowsEnabled;for(const [i,light] of assetObjects.filter(item=>item.isDirectionalLight).entries())light.castShadow=softShadowsEnabled&&i<2;if(softShadowsEnabled){sun.shadow.mapSize.set(fastRenderMode?512:1024,fastRenderMode?512:1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;sun.shadow.camera.updateProjectionMatrix();sun.shadow.radius=4;sun.shadow.bias=-0.00015;sun.shadow.normalBias=0.012;for(const [i,light] of assetObjects.filter(item=>item.isDirectionalLight).entries()){light.castShadow=i<2;if(i<2){light.shadow.mapSize.set(512,512);light.shadow.camera.left=-8;light.shadow.camera.right=8;light.shadow.camera.top=8;light.shadow.camera.bottom=-8;light.shadow.camera.updateProjectionMatrix();light.shadow.radius=4;light.shadow.bias=-0.00015;light.shadow.normalBias=.012;}}for(const object of objects)object.traverse?.(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});renderer.shadowMap.needsUpdate=true;lightingBaked=false;}scheduleProjectSave();toast(softShadowsEnabled?'Sombras suaves activadas':'Sombras desactivadas para ahorrar GPU');});
$('#featureReflections').addEventListener('change',event=>{reflectionsEnabled=event.target.checked;scene.environmentIntensity=reflectionsEnabled?0.48:0;if(reflectionsEnabled&&wetSurfaceCount()){reflectionDirty=true;refreshWetReflections(true);}scheduleProjectSave();toast(reflectionsEnabled?'Reflejos PBR activados':'Reflejos desactivados para mejorar rendimiento');});
$('#featureFastRender').addEventListener('change',event=>{fastRenderMode=event.target.checked;idleQualityBoost=false;if(fastRenderMode){renderer.setPixelRatio(Math.min(.68,window.devicePixelRatio||1));composer.setPixelRatio(Math.min(.68,window.devicePixelRatio||1));renderer.shadowMap.enabled=false;postEnabled=false;$('#postToggle').textContent='Rápido';}else{renderer.setPixelRatio(restingPixelRatio());composer.setPixelRatio(restingPixelRatio());renderer.shadowMap.enabled=realisticMode&&softShadowsEnabled;if(softShadowsEnabled){sun.shadow.mapSize.set(512,512);sun.shadow.radius=4;renderer.shadowMap.needsUpdate=true;}postEnabled=realisticMode;$('#postToggle').textContent='RA';}const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height,false);composer.setSize(r.width,r.height);usePostPipeline();scheduleProjectSave();toast(fastRenderMode?'Vista rápida · resolución reducida, sin postprocesado ni sombras':'Calidad realista restaurada');});
$('#materialTransparencyEnabled').addEventListener('change',event=>{ensurePhysicalMaterial(renderMaterialMesh);if(event.target.checked){for(const mat of materialListFor(renderMaterialMesh)){mat.userData ||= {};if(mat.userData.originalTransparent===undefined)mat.userData.originalTransparent=mat.transparent;mat.userData.savedOpacity=mat.opacity??1;}setMaterialTransparency(renderMaterialMesh,true,Number($('#materialTransmission').value)||.65);}else setMaterialTransparency(renderMaterialMesh,false);editTargetMaterials(mat=>{});refreshMaterialPanel();});
$('#materialTransmission').addEventListener('input',event=>{const v=Number(event.target.value);$('#transmissionValue').value=v.toFixed(2);ensurePhysicalMaterial(renderMaterialMesh);if(renderMaterialMesh)for(const mat of materialListFor(renderMaterialMesh)){mat.transmission=v;mat.transparent=v>0||mat.userData?.transparencyEnabled===true;mat.userData ||= {};mat.userData.transparencyEnabled=v>0;mat.needsUpdate=true;}$('#materialTransparencyEnabled').checked=v>0;editTargetMaterials(mat=>{});});
$('#materialSubsurfaceEnabled').addEventListener('change',event=>{setMaterialSubsurface(renderMaterialMesh,event.target.checked,Number($('#materialSubsurfaceDepth').value)||.18);editTargetMaterials(mat=>{});refreshMaterialPanel();toast(event.target.checked?'Dispersión subsuperficial aproximada activada':'Dispersión subsuperficial desactivada');});
$('#materialSubsurfaceDepth').addEventListener('input',event=>{const v=Number(event.target.value);$('#subsurfaceValue').value=v.toFixed(2);if($('#materialSubsurfaceEnabled').checked)setMaterialSubsurface(renderMaterialMesh,true,v);editTargetMaterials(mat=>{});});
$('#bakeLighting').addEventListener('click',()=>{lightingBaked=false;prepareRenderLighting();});
$('#refreshReflections').addEventListener('click',()=>{if(!wetSurfaceCount())return;clearTimeout(reflectionRefreshTimer);reflectionDirty=true;refreshWetReflections(true);});
$('#renderOpen').addEventListener('click', async () => { $('#renderPanel').hidden = !$('#renderPanel').hidden;$('#featureSoftShadows').checked=softShadowsEnabled;$('#featureReflections').checked=reflectionsEnabled;$('#featureFastRender').checked=fastRenderMode; $('#renderPath').value = readRenderFolderName(); if (Capacitor.isNativePlatform()) await loadNativeRenderFolder(); else if (!renderFolderHandle) renderFolderHandle = await restoreRenderFolder(); });
$('#renderClose').addEventListener('click', () => { $('#renderPanel').hidden = true; });
$('#chooseRenderPath').addEventListener('click', chooseRenderFolder);
$('#renderFormat').addEventListener('change', (event) => { $('#startRender').textContent = event.target.value === 'png' ? 'Exportar PNG' : 'Exportar MP4'; $('#renderDuration').hidden = event.target.value !== 'mp4'; });
$('#startRender').addEventListener('click', () => $('#renderFormat').value === 'png' ? exportPng() : exportMp4());
$('#addCube').addEventListener('click', () => addObject('Cubo'));
$('#addSphere').addEventListener('click', () => addObject('Esfera'));
$('#delete').addEventListener('click', removeSelected);
$('#duplicate').addEventListener('click',duplicateSelected);
$('#addMenu')?.addEventListener('click', () => addObject('Cubo'));
$('#save').addEventListener('click', saveSceneToLibrary);
$('#exportScene').addEventListener('click', exportGlb);
$('#importScene').addEventListener('click',async()=>{if(Capacitor.isNativePlatform()){try{const info=await NativeRenderExport.readAssetFileInfo();try{const size=Number(info.size);if(!Number.isSafeInteger(size)||size<1)throw new Error('No se pudo leer el archivo seleccionado.');const bytes=new Uint8Array(size),chunkSize=1024*1024;for(let offset=0;offset<size;offset+=chunkSize){const length=Math.min(chunkSize,size-offset),chunk=await NativeRenderExport.readAssetFileChunk({uri:info.uri,offset,length}),raw=atob(chunk.data);for(let i=0;i<Math.min(length,Number(chunk.length)||raw.length);i++)bytes[offset+i]=raw.charCodeAt(i);$('#status').textContent=`Leyendo ${info.name} · ${Math.round((offset+length)/size*100)}%`;}await importPickedFile(info.name,bytes);$('#status').textContent='Listo';}finally{try{await NativeRenderExport.closeAssetFile();}catch(_){}}}catch(error){if(!String(error?.message||error).includes('canceled'))toast(`No se pudo importar: ${error.message||error}`);}return;}fileInput.click();});
$('#importProjectHome').addEventListener('click',()=>$('#projectFileInput').click());
$('#projectFileInput').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await importFile(file);}catch(error){toast(`No se pudo importar el proyecto: ${error.message||error}`);}finally{e.target.value='';}});
fileInput.addEventListener('change',()=>{const files=[...fileInput.files];if(files.length>1||/\.(gltf|fbx|obj|stl|ply)$/i.test(files[0]?.name||''))importModelFiles(files).catch(error=>{console.error(error);toast(`No se pudo importar: ${error.message||error}`);});else importFile(files[0]);fileInput.value='';});
$('#gridToggle').addEventListener('click', () => { gridVisible = !gridVisible; grid.visible = gridVisible; });
$('#frame').addEventListener('click',()=>{const target=selected||null;if(target){let root=target;while(root.parent&&!objects.includes(root))root=root.parent;fitImportedModelToView(root);}else if(objects.length){const bounds=new THREE.Box3();for(const item of objects)bounds.expandByObject(item);if(!bounds.isEmpty()){const center=bounds.getCenter(new THREE.Vector3()),radius=Math.max(bounds.getSize(new THREE.Vector3()).length()*.5,.05),direction=camera.position.clone().sub(orbit.target).normalize();orbit.target.copy(center);camera.position.copy(center).addScaledVector(direction,Math.max(radius*2.5,camera.near*10));camera.near=Math.max(.001,radius/1000);camera.far=Math.max(500,radius*100);camera.updateProjectionMatrix();orbit.minDistance=Math.max(.005,radius*.02);orbit.maxDistance=Math.max(40,radius*100);orbit.update();}}else{orbit.target.set(0,0.6,0);camera.position.set(5,4,7);orbit.update();}});
$('#undo').addEventListener('click', undoScene);
$('#redo').addEventListener('click', redoScene);
$('#animMode').addEventListener('click', toggleAnimationMode);
$('#assetsToggle').addEventListener('click', () => { $('#assetsPanel').hidden = !$('#assetsPanel').hidden; });
$('#assetsClose').addEventListener('click', () => { $('#assetsPanel').hidden = true; });
document.querySelectorAll('[data-asset]').forEach((button) => button.addEventListener('click', () => addAsset(button.dataset.asset)));
$('#addKeyframe').addEventListener('click', () => {
  if (importedAnimationAction) stopImportedClipPreservingPose();
  if (!animationMode) { animationMode = true; document.body.classList.add('animating'); $('#animationPanel').hidden = false; $('#animationTimeline').hidden = false; $('#animMode').innerHTML = 'Animation <span>⌄</span>'; }
  if (!activeAnimationTarget) activeAnimationTarget = boneTarget || selected;
  if (!activeAnimationTarget && currentModel) { boneTarget = allBones()[0] || null; activeAnimationTarget = boneTarget; }
  if(activeAnimationTarget)animationTrackIds.add(activeAnimationTarget.uuid);
  rebuildTimeline();
  captureKeyframe();
});
$('#playAnimation').addEventListener('click', togglePlayback);
$('#animationNodePicker').addEventListener('focus',refreshAnimationNodePicker);
$('#animationLoop').addEventListener('change',event=>{animationLoop=event.target.checked;scheduleProjectSave();toast(animationLoop?'Ciclo de animación activado':'Ciclo de animación detenido');});
$('#frameRange').addEventListener('input', (event) => setFrame(event.target.value));
$('#frameNumber').addEventListener('change', (event) => setFrame(event.target.value));
$('#prevFrame').addEventListener('click', () => setFrame(currentFrame - 1));
$('#nextFrame').addEventListener('click', () => setFrame(currentFrame + 1));
$('#addAnimationTrack').addEventListener('click',()=>{const node=getAnimatableNodes().find(item=>item.uuid===$('#animationNodePicker').value);addAnimationTrack(node);});
$('#autoKeyToggle').addEventListener('change',event=>{autoKeyEnabled=event.target.checked;toast(autoKeyEnabled?'Auto Key activado':'Auto Key desactivado');});
$('#animationInterpolation').addEventListener('change',event=>{animationInterpolation=event.target.value;animationTrackCache=null;saveCurrentProject();toast(`Interpolación ${event.target.selectedOptions[0].text}`);});
$('#deleteKeyframe').addEventListener('click',()=>{const pose=keyframes.get(currentFrame);if(!pose){toast('No hay claves en este fotograma');return;}for(const uuid of animationTrackIds)pose.delete(uuid);if(!pose.size)keyframes.delete(currentFrame);animationTrackCache=null;animationNodesCache=null;rebuildTimeline();recordHistory();scheduleProjectSave();toast(`Claves del fotograma ${currentFrame} eliminadas`);});
$('#copyKeyframe').addEventListener('click',()=>{const pose=keyframes.get(currentFrame);if(!pose?.size){toast('No hay claves en este fotograma');return;}copiedKeyframe=new Map([...pose].filter(([uuid])=>animationTrackIds.has(uuid)));toast(`Copiadas ${copiedKeyframe.size} pistas`);});
$('#pasteKeyframe').addEventListener('click',()=>{if(!copiedKeyframe?.size){toast('Primero copia un fotograma con claves');return;}const pose=keyframes.get(currentFrame)||new Map();for(const [uuid,value] of copiedKeyframe){pose.set(uuid,JSON.parse(JSON.stringify(value)));animationTrackIds.add(uuid);}keyframes.set(currentFrame,pose);animationTrackCache=null;animationNodesCache=null;rebuildTimeline();recordHistory();scheduleProjectSave();toast('Claves pegadas en el fotograma actual');});
function applyPostLook(name) {
  const look = name === 'warm' ? {contrast:1.22,saturation:1.08,warmth:0.075,vignette:0.27,grain:0.003,bloom:0.82} : (name === 'neutral' ? {contrast:1.04,saturation:1,warmth:0.005,vignette:0.08,grain:0,bloom:0.58} : {contrast:1.08,saturation:0.98,warmth:0.015,vignette:0.15,grain:0.002,bloom:0.72});
  const u=lightPostPass.uniforms;u.contrast.value=look.contrast;u.saturation.value=look.saturation;u.warmth.value=look.warmth;u.vignette.value=look.vignette;u.grain.value=look.grain;bloomPass.strength=emissiveBloomActive ? 0.12 : 0;bloomPass.threshold=1.45;bloomPass.radius=.18;
}
$('#postLook').addEventListener('change',event=>{if(!realisticMode){realisticMode=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=savedExposure;scene.environment=savedEnvironment;$('#postToggle').textContent='RA';$('#postToggle').classList.add('active');}applyPostLook(event.target.value);postEnabled=true;usePostPipeline();lightingBaked=false;saveCurrentProject();prepareRenderLighting();toast('Acabado actualizado · modo realista');});
$('#whiteStudioToggle').addEventListener('click',()=>{whiteStudioView=!whiteStudioView;scene.overrideMaterial=whiteStudioView?new THREE.MeshStandardMaterial({color:0xe7e7e7,roughness:0.86,metalness:0}):null;scene.background=whiteStudioView?new THREE.Color(0x55585d):null;$('#whiteStudioToggle').classList.toggle('active',whiteStudioView);renderer.shadowMap.enabled=softShadowsEnabled&&(realisticMode||whiteStudioView);sun.castShadow=softShadowsEnabled&&(realisticMode||whiteStudioView);for(const [i,light] of assetObjects.filter(item=>item.isDirectionalLight).entries())light.castShadow=softShadowsEnabled&&(realisticMode||whiteStudioView)&&i<2;if(softShadowsEnabled)renderer.shadowMap.needsUpdate=true;saveCurrentProject();toast(whiteStudioView?'Vista blanca tipo Blender':'Vista de materiales restaurada');});
$('#postToggle').title='Alternar modo realista y modo sólido ligero';$('#postToggle').setAttribute('aria-label','Modo realista o sólido');
$('#postToggle').addEventListener('click', (event) => {
  realisticMode=!realisticMode;postEnabled=realisticMode;
  if(realisticMode){scene.environment=reflectionsEnabled?savedEnvironment:null;scene.environmentIntensity=reflectionsEnabled?0.48:0;renderer.toneMapping=realisticMode?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;renderer.toneMappingExposure=realisticMode?0.78:1;renderer.shadowMap.enabled=softShadowsEnabled&&(realisticMode||whiteStudioView);renderer.shadowMap.autoUpdate=false;sun.castShadow=softShadowsEnabled;for(const [i,light] of assetObjects.filter(item=>item.isDirectionalLight).entries())light.castShadow=softShadowsEnabled&&i<2;if(softShadowsEnabled)renderer.shadowMap.needsUpdate=true;for(const object of objects)object.traverse?.(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});event.currentTarget.textContent='RA';event.currentTarget.classList.add('active');bloomPass.enabled=true;lightPostPass.enabled=true;applyPostLook($('#postLook').value||'cinematic');}
  else{scene.environment=null;renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=softShadowsEnabled&&whiteStudioView;sun.castShadow=softShadowsEnabled&&whiteStudioView;for(const [i,light] of assetObjects.filter(item=>item.isDirectionalLight).entries())light.castShadow=softShadowsEnabled&&whiteStudioView&&i<2;bloomPass.enabled=false;lightPostPass.enabled=false;event.currentTarget.textContent='Sólido';event.currentTarget.classList.remove('active');}
  usePostPipeline();saveCurrentProject();toast(realisticMode?'Modo realista activado':'Modo sólido ligero activado');
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
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){saveCurrentProject();if(pendingTextureImports.size)Promise.allSettled([...pendingTextureImports]).then(saveCurrentProject);}});window.addEventListener('pagehide',()=>saveCurrentProject());navigator.storage?.persist?.().catch(()=>{});
function beginInteractiveMotion(){interactiveMotion=true;idleQualityBoost=false;adaptiveQualityStep=0;clearTimeout(adaptiveQualityTimer);try{const rect=container.getBoundingClientRect();adaptiveBaseRatio=Math.min(window.devicePixelRatio||1,1.25);const motionRatio=Math.max(.48,Math.min(.56,adaptiveBaseRatio*.52));renderer.setPixelRatio(motionRatio);renderer.setSize(rect.width,rect.height,false);composer.setPixelRatio(motionRatio);composer.setSize(rect.width,rect.height);}catch(error){console.warn('Adaptive preview fallback',error);}}
function estimateSceneComplexity(){let vertices=0;for(const root of objects)root.traverse?.(node=>{if(node.isMesh)vertices+=node.geometry?.attributes?.position?.count||0;});return vertices;}
function restingPixelRatio(){const rect=container.getBoundingClientRect(),area=Math.max(1,rect.width*rect.height),gpuBudget=560000,complexity=estimateSceneComplexity(),complexityScale=complexity>1800000?.68:complexity>900000?.78:complexity>400000?.9:1;return Math.max(.5,Math.min(.66,adaptiveBaseRatio,Math.sqrt(gpuBudget/area),adaptiveBaseRatio*complexityScale));}
function endInteractiveMotion(){interactiveMotion=false;clearTimeout(adaptiveQualityTimer);adaptiveQualityTimer=setTimeout(()=>{if(interactiveMotion||document.visibilityState==='hidden'||isPlaying||importedAnimationAction)return;try{const rect=container.getBoundingClientRect(),target=restingPixelRatio(),steps=[.56,.6,.64];const ratio=Math.min(target,steps[Math.min(adaptiveQualityStep++,steps.length-1)]);renderer.setPixelRatio(ratio);renderer.setSize(rect.width,rect.height,false);composer.setPixelRatio(ratio);composer.setSize(rect.width,rect.height);if(ratio+0.025<target){adaptiveQualityTimer=setTimeout(endInteractiveMotion,120);}else idleQualityBoost=false;}catch(error){idleQualityBoost=false;console.warn('High-quality idle mode skipped to protect device',error);}},550);}
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();glContextAvailable=false;idleQualityBoost=false;interactiveMotion=true;clearTimeout(adaptiveQualityTimer);toast('La escena es pesada para el dispositivo; reduje la calidad para evitar el cierre.');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{glContextAvailable=true;interactiveMotion=false;endInteractiveMotion();});
let lastRenderTimestamp=0;
function frame(timestamp=0) {
  requestAnimationFrame(frame);
  if(document.visibilityState==='hidden'||renderCaptureActive||$('#app').hidden)return;
  if(timestamp-lastRenderTimestamp<(realisticMode?40:1000/60))return;
  orbit.update();
  const delta=Math.min(0.05,Math.max(0,(timestamp-lastRenderTimestamp)/1000||1/30));lastRenderTimestamp=timestamp;
  if (importedMixer && importedAnimationAction) importedMixer.update(delta);for(const mat of animatedDeformMaterials)if(mat.userData?.deformUniform)mat.userData.deformUniform.value=timestamp*.001;
  if (document.visibilityState==='hidden'||renderCaptureActive||!glContextAvailable) return;
  
  try{if (usePostPipeline()) { sceneRenderPass.camera = cameraMode ? activeCamera : camera; composer.render(); }else renderer.render(scene, cameraMode ? activeCamera : camera);}catch(error){idleQualityBoost=false;postEnabled=false;bloomPass.enabled=false;lightPostPass.enabled=false;try{renderer.setPixelRatio(.55);renderer.render(scene,cameraMode?activeCamera:camera);}catch(_){console.error('WebGL render failure',error);}console.warn('Render downgraded after GPU error',error);}
}
frame();
