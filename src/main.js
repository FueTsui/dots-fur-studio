import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEFAULTS, createBodyMaterial, createFur, updateFurParameters } from './fur.js';
import { setupUI } from './ui.js';
import { CATALOG, PARAMETER_DEFS, DEFAULT_APPEARANCE } from './catalog.js';
import { getGeometryMetrics } from './original-geometry.js';
import { loadOriginalAccessories, loadPreparedBody, updateOriginalAccessories, updateAccessoryColors } from './original-accessories.js';
import { loadSettings, saveSettings, normalizeAppearance, normalizeParameters, resolveBodyColor } from './settings.js';
import { createGazeMotion, stepGazeMotion, GAZE_MOTION } from './gaze-motion.js';
import { GAZE_PRESENTATION, mapGazeInput } from './gaze-input.js';

const canvas = document.querySelector('#scene');
const saved = loadSettings();
const parameters = saved?.parameters ?? { ...DEFAULTS };
let appearance = saved?.appearance ?? normalizeAppearance(DEFAULT_APPEARANCE);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer, scene, camera, active, shadow;
let paused = reducedMotion, quality = saved?.quality ?? 'auto', autoLevel = 2, running = true;
let time = 0, lastTime = 0, fpsClock = 0, fpsFrames = 0, averageFPS = 60;
let slowWindows = 0, settlingSeconds = 2, selectionSerial = 0, enterTime = 0;
let yaw = 0, pitch = 0, yawTarget = 0, pitchTarget = 0, touchStrength = 0;
let spring = 0, velocity = 0, drag = null, zoom = 1;
let blink = 0;
const look = new THREE.Vector2(), smoothLook = new THREE.Vector2(), headLook = new THREE.Vector2();
const gazeMotion = createGazeMotion();
// Local presentation enhancement; native trajectories and response timing stay intact.
const GAZE = Object.freeze({ ...GAZE_PRESENTATION, motion: GAZE_MOTION });
const pointer = new THREE.Vector2(9, 9), raycaster = new THREE.Raycaster();
const touch = new THREE.Vector3(0, 0, 10);
const cache = new Map();
const qualityLevels = [
  { name: '轻量', cap: 40000, dpr: 1 },
  { name: '均衡', cap: 85000, dpr: 1.4 },
  { name: '细腻', cap: 180000, dpr: 1.8 },
];

const ui = setupUI({
  catalog: CATALOG, parameterDefs: PARAMETER_DEFS,
  initialAppearance: appearance, initialParameters: parameters, initialQuality: quality,
  onAppearance: (value) => selectAppearance(value),
  onParameter: (key, value) => {
    if (!(key in parameters) || !Number.isFinite(value)) return;
    parameters[key] = normalizeParameters({ ...parameters, [key]:value })[key];
    for (const item of cache.values()) syncParameters(item);
    if (key === 'density') applyQuality();
    ui.setSaved(false);
  },
  onPause: (value) => { paused = value; ui.setPaused(paused); },
  onReset: () => {
    Object.assign(parameters, DEFAULTS);
    quality = 'auto'; autoLevel = 2; slowWindows = 0; settlingSeconds = 2;
    yawTarget = pitchTarget = yaw = pitch = 0; spring = velocity = 0;
    look.set(0, 0); smoothLook.set(0, 0); headLook.set(0, 0);
    Object.assign(gazeMotion, createGazeMotion());
    zoom = 1; paused = reducedMotion; ui.setPaused(paused);
    for (const item of cache.values()) syncParameters(item);
    ui.setParameters(parameters); ui.setQuality(quality);
    selectAppearance(DEFAULT_APPEARANCE); applyQuality(); resize();
  },
  onCapture: capture,
  onSave: () => { saveSettings({appearance,parameters,quality}); ui.setSaved(true); },
  onExport: exportSettings,
  onQuality: (value) => {
    quality = value; settlingSeconds = 1.5; slowWindows = 0;
    if (value === 'auto') autoLevel = 2;
    applyQuality(); ui.setSaved(false);
  },
});

try {
  // Explicit opaque context: Three.js otherwise requests alpha:true internally.
  // MSAA alpha-to-coverage must not leave translucent samples for the DOM to
  // composite against white, which would wash out the strands and silhouette.
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!context) throw new Error('浏览器未提供 WebGL 2 上下文');
  renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
  renderer.setClearColor(0xffffff, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .35;
  room.dispose(); pmrem.dispose();
  camera = new THREE.OrthographicCamera(-3, 3, 2.4, -2.4, .1, 50);
  camera.position.set(0, .12, 8);
  camera.lookAt(0, .12, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc2b7c3, 1.3));
  const key = new THREE.DirectionalLight(0xfffaf3, 2);
  key.position.set(-3.5, 5, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe9efff, .6);
  fill.position.set(4, 2, -2); scene.add(fill);
  shadow = createShadow(); scene.add(shadow);
  applyQuality(); resize();
  ui.setPaused(paused);
  await selectAppearance(appearance);
  renderer.setAnimationLoop(animate);
} catch (error) {
  console.error(error);
  ui.showError(`无法启动 WebGL：${error.message}。请使用支持 WebGL 2 的浏览器，并开启硬件加速。`);
}

function getLevel() {
  return qualityLevels[quality === 'auto' ? autoLevel : ({ low: 0, medium: 1, high: 2 }[quality] ?? 2)];
}

function applyQuality() {
  if (!renderer) return;
  const level = getLevel();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, level.dpr));
  for (const item of cache.values()) {
    item.fur.geometry.instanceCount = Math.min(Math.round(parameters.density * 1000), level.cap, item.fur.geometry.attributes.aRoot.count);
    for (const part of item.extraFur) part.geometry.instanceCount = Math.round(part.userData.maxCount * Math.min(1, level.cap / 100000));
  }
  if (camera) resize();
  updateStats();
}

function resize() {
  if (!renderer || !camera) return;
  const rect = ui.getViewportRect();
  const width = Math.max(1,rect.width), height = Math.max(1,rect.height);
  renderer.setSize(width, height, false);
  const aspect = width / height;
  // Keep the same generous margins on portrait and landscape screens.
  const viewHeight = Math.max(4.1, 3.35 / aspect);
  camera.left = -viewHeight * aspect / 2; camera.right = -camera.left;
  camera.top = viewHeight / 2; camera.bottom = -camera.top;
  camera.zoom = zoom; camera.updateProjectionMatrix();
  renderOnce();
}
window.addEventListener('resize', resize);

async function selectAppearance(value) {
  const next = normalizeAppearance(value);
  const serial = ++selectionSerial;
  const key = [next.shape,next.eyes,next.eyewear,...[...next.accessories].sort()].join('|');
  appearance = next;
  ui.setAppearance(next); ui.setSaved(false);
  const color = resolveBodyColor(next.color);
  if (active?.id === key) {
    syncColors(active, next);
    ui.setLoading(false); return;
  }
  ui.setLoading(true);
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if (serial !== selectionSerial) return;
  try {
    let item = cache.get(key);
    if (!item) {
      const [geometry,accessories,metrics] = await Promise.all([
        loadPreparedBody(next.shape), loadOriginalAccessories(next), getGeometryMetrics(next.shape),
      ]);
      if (serial !== selectionSerial) {
        geometry.dispose(); disposeCharacter({group:accessories}); return;
      }
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';
      const body = new THREE.Mesh(geometry,createBodyMaterial(color,parameters));
      body.scale.setScalar(.985);
      const fur = createFur(next.shape,color,parameters,false,{geometry});
      const extraFur=[];
      for (const part of accessories.userData.furParts ?? []) {
        const source=part.mesh;
        const count=18000;
        const hair=createFur(next.shape,part.color,{...parameters,length:parameters.length*.25,thickness:parameters.thickness*.65},false,{geometry:source.geometry,count});
        hair.userData.maxCount=count;
        part.hair = hair;
        source.parent.add(hair);extraFur.push(hair);
        source.material.dispose();source.material=createBodyMaterial(part.color,parameters);
      }
      group.add(body,fur,accessories);
      item={id:key,shape:next.shape,group,body,fur,accessories,extraFur,metrics};
      cache.set(key,item);
    }
    if(active)scene.remove(active.group);
    active=item;scene.add(item.group);
    blink = 0;
    updateFace(item);
    syncColors(item, next);
    syncParameters(item);
    yaw=yawTarget=pitch=pitchTarget=0;spring=velocity=0;
    enterTime=time;settlingSeconds=1.8;
    applyQuality();
    while(cache.size>3){const oldId=[...cache.keys()].find(k=>k!==key);disposeCharacter(cache.get(oldId));cache.delete(oldId);}
    ui.setMetrics?.({shape:next.shape,originalMesh:item.metrics,preparedBody:item.body.geometry.userData.metrics,assembly:item.accessories.userData.metrics});
    ui.setLoading(false);renderOnce();
  }catch(error){
    if(serial!==selectionSerial)return;
    console.error(error);ui.setLoading(false);ui.showError('外形加载失败：'+error.message);
  }
}

function syncColors(item, next) {
  const color = resolveBodyColor(next.color);
  item.body.material.uniforms.uColor.value.set(color);
  item.fur.material.uniforms.uColor.value.set(color);
  updateAccessoryColors(item.accessories, next.accessoryColors);
  for (const part of item.accessories.userData.furParts ?? []) part.hair?.material.uniforms.uColor.value.set(part.color);
}

function syncParameters(item) {
  updateFurParameters(item.fur, parameters);
  item.body.material.uniforms.uBright.value = parameters.bright;
  item.body.material.uniforms.uRim.value = parameters.rim;
  for (const part of item.extraFur) updateFurParameters(part, {
    ...parameters, length: parameters.length * .25, thickness: parameters.thickness * .65,
  });
  for (const part of item.accessories.userData.furParts ?? []) {
    part.mesh.material.uniforms.uBright.value = parameters.bright;
    part.mesh.material.uniforms.uRim.value = parameters.rim;
  }
}

function updateFace(item) {
  updateOriginalAccessories(item.accessories, { blink, lookX: smoothLook.x, lookY: smoothLook.y });
  // The fur opening follows the same sampled eye transform, independently of blink.
  const uniforms = item.fur.material.uniforms;
  for (const zone of item.accessories.userData.faceZones ?? []) {
    const index = zone.side < 0 ? 0 : 1;
    uniforms.uFaceZones.value[index].set(zone.center[0], zone.center[1], zone.size[0] * .65, zone.size[1] * .65);
    uniforms.uFaceDepth.value.setComponent(index, zone.center[2]);
  }
}

function disposeCharacter(item) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  item.group.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
}

function createShadow() {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = textureCanvas.height = 128;
  const ctx = textureCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(34, 31, 38, 0.24)');
  gradient.addColorStop(.32, 'rgba(40, 38, 44, 0.15)');
  gradient.addColorStop(.68, 'rgba(50, 45, 52, 0.04)');
  gradient.addColorStop(1, 'rgba(50, 45, 52, 0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(textureCanvas);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .52), new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, toneMapped: false,
  }));
  mesh.position.set(0, -1.49, -.8);
  mesh.renderOrder = -1;
  return mesh;
}

function animate(now) {
  if (!running) return;
  const elapsed = lastTime ? (now - lastTime) / 1000 : 1 / 60;
  lastTime = now;
  const dt = Math.min(elapsed, .04);
  if (!paused) time += dt;
  const damping = 1 - Math.exp(-dt * 8);
  stepGazeMotion(gazeMotion, look.x, look.y, Math.min(elapsed, .25));
  smoothLook.set(gazeMotion.eyes.x, gazeMotion.eyes.y);
  headLook.set(gazeMotion.head.x, gazeMotion.head.y);
  yaw += (yawTarget - yaw) * damping;
  pitch += (pitchTarget - pitch) * damping;
  if (!paused && active) {
    velocity += (-spring * 110 - velocity * 9) * dt;
    spring += velocity * dt;
    const bob = Math.sin(time * 1.75) * .065;
    const breath = Math.sin(time * 2.1) * .012;
    const entrance = reducedMotion ? 1 : Math.min(1, (time - enterTime) / .55 + .04);
    const scale = 1 - Math.pow(1 - entrance, 3) * .18;
    active.group.position.y = .02 + bob + spring * .25;
    active.group.scale.set((1 + breath - spring * .11) * scale, (1 - breath + spring * .18) * scale, scale);
    active.group.rotation.set(pitch + headLook.y * GAZE.headPitch, yaw + headLook.x * GAZE.headYaw, Math.sin(time * 1.25) * .028, 'YXZ');
    blink = 0;
    const blinkPhase = time % 5.3;
    if (blinkPhase > 4.92 && blinkPhase < 5.15) blink = Math.sin((blinkPhase - 4.92) / .23 * Math.PI);
    active.fur.material.uniforms.uTime.value = time;
    for (const part of active.extraFur) part.material.uniforms.uTime.value = time;
    shadow.scale.x = 1 - bob * .6;
    shadow.material.opacity = .9 - bob;
  } else if (active) {
    // Pausing freezes autonomous motion, while direct rotation and gaze stay live.
    active.group.rotation.x = pitch + headLook.y * GAZE.headPitch;
    active.group.rotation.y = yaw + headLook.x * GAZE.headYaw;
  }
  if (active) {
    // Pause only stops autonomous animation; deliberate pointer gaze stays live.
    updateFace(active);
    touchStrength += ((drag ? 1.7 : pointer.x < 8 ? .65 : 0) - touchStrength) * damping;
    active.fur.material.uniforms.uTouch.value.copy(touch);
    active.fur.material.uniforms.uTouchStrength.value = touchStrength;
  }
  renderer.render(scene, camera);
  fpsClock += elapsed; fpsFrames++;
  settlingSeconds = Math.max(0, settlingSeconds - elapsed);
  if (fpsClock > 1.25) {
    averageFPS = fpsFrames / fpsClock;
    updateStats();
    if (quality === 'auto' && settlingSeconds === 0) {
      slowWindows = averageFPS < 42 ? slowWindows + 1 : 0;
      if (slowWindows >= 2 && autoLevel > 0) {
        autoLevel--; slowWindows = 0; settlingSeconds = 1.5; applyQuality();
      }
    }
    fpsClock = fpsFrames = 0;
  }
}

function updateStats() {
  if (!renderer) return;
  ui.updateStats({
    fps: Math.round(averageFPS),
    strands: active?.fur.geometry.instanceCount ?? 0,
    drawCalls: renderer.info.render.calls,
    quality: `${quality === 'auto' ? '自动 · ' : ''}${getLevel().name}`,
  });
}

function renderOnce() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function locatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  // Make nearby movement readable in the larger preview without extrapolating
  // beyond the native surface-eye trajectories or introducing a hard plateau.
  look.set(mapGazeInput(pointer.x), mapGazeInput(pointer.y));
  if (!active) return false;
  active.group.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(active.body, false)[0];
  canvas.classList.toggle('is-hovering', !!hit);
  if (hit) touch.copy(active.group.worldToLocal(hit.point.clone()));
  else touch.set(0, 0, 10);
  return !!hit;
}

canvas.addEventListener('pointerdown', event => {
  if (!locatePointer(event)) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: yawTarget, pitch: pitchTarget, moved: false };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('is-dragging');
  if (!paused) velocity += 2.8;
});
canvas.addEventListener('pointermove', event => {
  locatePointer(event);
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.abs(dx) + Math.abs(dy) > 5;
  yawTarget = THREE.MathUtils.clamp(drag.yaw + dx * .006, -1.05, 1.05);
  pitchTarget = THREE.MathUtils.clamp(drag.pitch + dy * .003, -.4, .4);
});
function endDrag(event) {
  if (!drag) return;
  if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
  drag = null; canvas.classList.remove('is-dragging');
  const rect = canvas.getBoundingClientRect();
  if (event && (event.type === 'pointercancel' || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) resetPointer();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', () => { drag = null; canvas.classList.remove('is-dragging'); });
canvas.addEventListener('pointerleave', () => {
  if (drag) return;
  resetPointer();
});
function resetPointer() {
  pointer.set(9, 9); look.set(0, 0); touch.set(0, 0, 10);
  canvas.classList.remove('is-hovering');
}
window.addEventListener('blur', () => { endDrag(); resetPointer(); });
canvas.addEventListener('dblclick', () => { yawTarget = pitchTarget = 0; zoom = 1; resize(); });
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoom = THREE.MathUtils.clamp(zoom - event.deltaY * .0006, .8, 1.35); resize();
}, { passive: false });

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;

  if (event.code === 'Space') { event.preventDefault(); paused = !paused; ui.setPaused(paused); }
});
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (!running) { endDrag(); resetPointer(); }
  lastTime = 0; fpsClock = fpsFrames = 0;
  renderer?.setAnimationLoop(running ? animate : null);
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); running = false; renderer?.setAnimationLoop(null);
  ui.showError('图形上下文已中断，请刷新页面重新加载。');
});

function capture() {
  if (!renderer || !active) return Promise.reject(new Error('角色尚未准备好。'));
  const id = active.id;
  renderOnce();
  const output = document.createElement('canvas');
  output.width = canvas.width; output.height = canvas.height;
  const ctx = output.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) => output.toBlob(blob => {
    if (!blob) { reject(new Error('图片编码失败，请重试。')); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `dots-${appearance.name}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000); resolve();
  }, 'image/png'));
}

// Read-only runtime diagnostics, useful for comparing real devices.
Object.defineProperty(window, '__dots', { value: {
  get state() {
    return {
      character: active?.id, appearance: structuredClone(appearance), parameters: { ...parameters }, paused,
      quality, effectiveQuality: getLevel().name,
      strands: active?.fur.geometry.instanceCount ?? 0,
      bodyColors: active ? {
        surface: `#${active.body.material.uniforms.uColor.value.getHexString()}`,
        fur: `#${active.fur.material.uniforms.uColor.value.getHexString()}`,
      } : null,
      accessoryStrands: active?.extraFur.reduce((sum, part) => sum + part.geometry.instanceCount, 0) ?? 0,
      accessoryMaterials: active?.accessories.children.filter(mesh => mesh.isMesh && mesh.userData.original?.category === 'accessories').map(mesh => ({
        id: mesh.userData.original.id,
        color: `#${(mesh.material.uniforms?.uColor?.value ?? mesh.material.color).getHexString()}`,
        roughness: mesh.material.roughness, metalness: mesh.material.metalness,
        specularIntensity: mesh.material.specularIntensity, clearcoat: mesh.material.clearcoat,
      })),
      accessoryFurColors: active?.accessories.userData.furParts.map(part => ({ id: part.mesh.userData.original.id, color: part.color, hairColor: `#${part.hair.material.uniforms.uColor.value.getHexString()}` })),
      fps: Math.round(averageFPS), drawCalls: renderer?.info.render.calls,
      triangles: renderer?.info.render.triangles,
      geometries: renderer?.info.memory.geometries,
      pixelRatio: renderer?.getPixelRatio(),
      instanced: active?.fur.geometry.isInstancedBufferGeometry === true,
      shader: active?.fur.material.isShaderMaterial === true,
      antialias: renderer?.getContext().getContextAttributes().antialias,
      rotation: active?.group.rotation.toArray().slice(0, 3),
      gaze: {
        target: look.toArray(), current: smoothLook.toArray(), head: headLook.toArray(),
        tuning: GAZE,
        source: 'sampled-original-runtime-with-presentation-gain',
        faceZones: structuredClone(active?.accessories.userData.faceZones ?? []),
        parts: active?.accessories.userData.eyes.flatMap(eye => eye.children.filter(mesh => mesh.userData.gaze).map(mesh => ({ name: mesh.name, matrix: mesh.userData.gaze.matrix.toArray() }))),
      },
      time,
    };
  },
}, configurable: false });

function exportSettings() {
  const payload={version:2,appearance,parameters,quality,source:{renderer:'orbit-character-a46c99f7e8749621/fec1363c5aea4fbb',geometryRevision:'7f2e673cd9cff752c137d3d858bc4ddb530dda34fe9c2e1fb23a94b2831adf1d',note:'Original geometry and placement; custom Three.js GPU fur'},geometry:active?.metrics,preparedBody:active?.body.geometry.userData.metrics,assembly:active?.accessories.userData.metrics};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='dots-'+appearance.name+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
new ResizeObserver(resize).observe(document.getElementById('viewport'));
