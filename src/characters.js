import * as THREE from 'three';

/** Character dimensions share a soft, approximately 2.2-unit silhouette. */
export const CHARACTER_DEFS = [
  { id: 'cobalt', name: 'Cobalt', subtitle: '钴蓝 · 小小艺术家', color: '#2461ff', accent: '#1d53e4' },
  { id: 'matcha', name: 'Matcha', subtitle: '抹茶 · 今天也精神满满', color: '#a6e935', accent: '#79b823' },
  { id: 'sunny', name: 'Sunny', subtitle: '暖黄 · 阳光收藏家', color: '#f5cb35', accent: '#c79b24' },
  { id: 'berry', name: 'Berry', subtitle: '莓紫 · 自带一点酷', color: '#cd48df', accent: '#a635ba' },
  { id: 'rose', name: 'Rose', subtitle: '蔷薇 · 正在听喜欢的歌', color: '#ed789b', accent: '#cd567e' },
];

/**
 * Smooth map from a unit sphere. The fur and its underlying body should use
 * this same function. It also accepts non-unit vectors defensively.
 */
export function sampleSurface(direction, id = 'cobalt') {
  const length = direction.length();
  if (length < 1e-10) return new THREE.Vector3(0, 0, 0.75);
  const x = direction.x / length;
  const y = direction.y / length;
  const z = direction.z / length;

  switch (id) {
    case 'matcha': {
      const width = 1.06 - 0.17 * y + 0.08 * Math.exp(-(((y + 0.17) / 0.48) ** 2));
      return new THREE.Vector3(x * width, y * 1.01, z * 0.73);
    }
    case 'sunny': {
      // A smooth cubic creates three rounded corners without hard seams.
      const triangle = 1 + 0.22 * (y * y * y - 3 * x * x * y);
      return new THREE.Vector3(x * 1.04 * triangle, y * 1.04 * triangle - 0.075, z * 0.73);
    }
    case 'berry': {
      const upper = Math.max(0, y);
      const cleft = 0.25 * Math.exp(-(x * x) / 0.075) * upper ** 6;
      return new THREE.Vector3(x * (1.075 + 0.45 * y), y * 1.105 - cleft, z * 0.72 * (1 + 0.035 * y));
    }
    case 'rose':
      return new THREE.Vector3(x * 0.985, y * 1.065, z * 0.755);
    case 'cobalt':
    default: {
      const cheeks = 0.20 * Math.exp(-(((y + 0.14) / 0.42) ** 2));
      const width = 1.005 - 0.205 * y + cheeks;
      return new THREE.Vector3(x * width, y * 1.055, z * 0.75 * (1 - 0.045 * y));
    }
  }
}

function sphere(material, scale, position, name) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), material);
  mesh.scale.set(...scale);
  mesh.position.set(...position);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tube(points, radius, material, name, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 10, false), material);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

function palette() {
  return {
    black: new THREE.MeshPhysicalMaterial({ color: '#101113', roughness: 0.15, metalness: 0.04, clearcoat: 1, clearcoatRoughness: 0.10 }),
    frame: new THREE.MeshStandardMaterial({ color: '#232427', roughness: 0.28, metalness: 0.2 }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#1d2322', roughness: 0.12, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }),
    white: new THREE.MeshPhysicalMaterial({ color: '#fffdf5', roughness: 0.22, clearcoat: 0.9 }),
    glint: new THREE.MeshBasicMaterial({ color: '#fffef8', toneMapped: false }),
    fabric: new THREE.MeshStandardMaterial({ color: '#242326', roughness: 0.98 }),
    silk: new THREE.MeshStandardMaterial({ color: '#101012', roughness: 0.85, metalness: 0, envMapIntensity: 0.25 }),
    cushion: new THREE.MeshStandardMaterial({ color: '#29292c', roughness: 0.79 }),
    metal: new THREE.MeshStandardMaterial({ color: '#626367', metalness: 0.70, roughness: 0.34 }),
  };
}

function addEyes(group, materials, { x, y, z, white = false, radius = 0.23 }) {
  for (const sign of [-1, 1]) {
    const eye = new THREE.Group();
    eye.name = sign < 0 ? 'eye-left' : 'eye-right';
    eye.position.set(sign * x, y, z);
    group.add(eye);
    group.userData.eyes.push(eye);

    if (white) {
      eye.add(sphere(materials.white, [radius, radius * 1.035, radius * 0.74], [0, 0, 0], 'eye-white'));
      const pupil = new THREE.Group();
      pupil.position.set(0, 0.014, radius * 0.69);
      pupil.userData.origin = pupil.position.clone();
      pupil.userData.travel = radius * 0.22;
      pupil.add(sphere(materials.black, [radius * 0.58, radius * 0.64, radius * 0.23], [0, 0, 0], 'pupil'));
      pupil.add(sphere(materials.glint, [radius * 0.18, radius * 0.205, radius * 0.07], [-radius * 0.16, radius * 0.22, radius * 0.225], 'eye-highlight'));
      pupil.add(sphere(materials.glint, [radius * 0.075, radius * 0.09, radius * 0.035], [radius * 0.17, -radius * 0.17, radius * 0.225], 'eye-small-highlight'));
      eye.add(pupil);
      group.userData.pupils.push(pupil);
    } else {
      const pupil = new THREE.Group();
      pupil.userData.origin = pupil.position.clone();
      pupil.userData.travel = 0.014;
      pupil.add(sphere(materials.black, [0.084, 0.145, 0.071], [0, 0, 0], 'glossy-eye'));
      pupil.add(sphere(materials.glint, [0.022, 0.048, 0.009], [-0.024, 0.045, 0.064], 'eye-highlight'));
      eye.add(pupil);
      group.userData.pupils.push(pupil);
    }
  }
}

function bowTie(materials, position, size = 1) {
  const bow = new THREE.Group();
  bow.name = 'bow-tie';
  bow.position.set(...position);
  bow.scale.setScalar(size);

  for (const sign of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0.015, 0.0);
    shape.bezierCurveTo(0.14, 0.075, 0.38, 0.14, 0.50, 0.18);
    shape.quadraticCurveTo(0.535, 0.0, 0.50, -0.18);
    shape.bezierCurveTo(0.36, -0.125, 0.14, -0.07, 0.015, 0.0);
    const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.022,
      bevelThickness: 0.035,
      curveSegments: 12,
    }), materials.silk);
    wing.scale.x = sign;
    wing.rotation.y = sign * -0.08;
    wing.name = sign < 0 ? 'bow-left-wing' : 'bow-right-wing';
    wing.castShadow = true;
    bow.add(wing);
  }
  bow.add(sphere(materials.silk, [0.115, 0.09, 0.08], [0, 0, 0.065], 'bow-knot'));
  return bow;
}

function glasses(group, materials, { x, y, z, radius, sunglasses = false }) {
  const glassesGroup = new THREE.Group();
  glassesGroup.name = sunglasses ? 'round-sunglasses' : 'round-glasses';
  glassesGroup.position.set(0, y, z);
  group.add(glassesGroup);
  for (const sign of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.026, 12, 64), materials.frame);
    rim.position.x = sign * x;
    rim.name = sign < 0 ? 'glasses-left-rim' : 'glasses-right-rim';
    rim.castShadow = true;
    glassesGroup.add(rim);
    if (sunglasses) {
      const lens = sphere(materials.lens, [radius * 0.90, radius * 0.90, 0.035], [sign * x, 0, -0.008], 'dark-lens');
      glassesGroup.add(lens);
      // A subtle sculpted reflection follows the curved smoked lens.
      glassesGroup.add(tube([
        [sign * x - radius * 0.53, radius * 0.49, 0.025],
        [sign * x - radius * 0.12, radius * 0.61, 0.028],
        [sign * x + radius * 0.22, radius * 0.57, 0.029],
      ], 0.006, materials.metal, 'lens-reflection', 12));
    }
    glassesGroup.add(tube([
      [sign * (x + radius), 0.035, 0],
      [sign * (x + radius + 0.13), 0.045, -0.11],
      [sign * (x + radius + 0.25), 0.075, -0.35],
    ], 0.02, materials.frame, 'glasses-temple', 18));
  }
  glassesGroup.add(tube([
    [-x + radius, 0.015, 0.004],
    [0, 0.062, 0.02],
    [x - radius, 0.015, 0.004],
  ], 0.022, materials.frame, 'glasses-bridge', 18));
  group.userData.glasses = glassesGroup;
}

function addBeret(group, materials) {
  const beret = new THREE.Group();
  beret.name = 'tilted-beret';
  beret.position.set(-0.11, 1.025, 0.015);
  beret.rotation.set(-0.09, 0.015, 0.37);
  // One continuous padded crown keeps the silhouette soft and avoids a dark
  // artificial seam between stacked flattened shells.
  const crown = sphere(materials.fabric, [1.015, 0.245, 0.71], [0, 0.0, 0], 'beret-crown');
  const stem = sphere(materials.fabric, [0.137, 0.155, 0.13], [-0.47, 0.258, -0.10], 'beret-top-stem');
  beret.add(crown, stem);
  group.userData.furParts.push(
    { mesh: crown, color: '#242326' },
    { mesh: stem, color: '#242326' },
  );
  group.add(beret);
  group.userData.hat = beret;
}

function addHeadphones(group, materials) {
  const headphones = new THREE.Group();
  headphones.name = 'headphones';
  const points = [];
  for (let index = 0; index <= 28; index += 1) {
    const angle = (index / 28) * Math.PI;
    points.push([Math.cos(angle) * 1.08, 0.005 + Math.sin(angle) * 1.16, 0.10]);
  }
  headphones.add(tube(points, 0.038, materials.frame, 'headphone-headband', 80));
  const inside = points.map(([x, y, z]) => [x * 0.975, y - 0.027, z]);
  headphones.add(tube(inside, 0.021, materials.cushion, 'headphone-headband-padding', 80));
  for (const sign of [-1, 1]) {
    const cup = new THREE.Group();
    cup.name = sign < 0 ? 'headphone-left-cup' : 'headphone-right-cup';
    cup.position.set(sign * 1.055, 0.014, 0.09);
    cup.rotation.z = sign * 0.06;
    cup.add(sphere(materials.cushion, [0.126, 0.235, 0.183], [0, 0, 0], 'ear-cushion'));
    cup.add(sphere(materials.frame, [0.075, 0.20, 0.156], [sign * 0.080, 0, 0], 'earcup-shell'));
    cup.add(sphere(materials.metal, [0.025, 0.13, 0.115], [sign * 0.144, 0, 0], 'earcup-metal-detail'));
    headphones.add(cup);
  }
  group.add(headphones);
  group.userData.headphones = headphones;
}

export function createAccessories(id = 'cobalt') {
  const group = new THREE.Group();
  group.name = `${id}-accessories`;
  group.userData = { characterId: id, eyes: [], pupils: [], furParts: [] };
  const materials = palette();

  switch (id) {
    case 'matcha':
      addEyes(group, materials, { x: 0.355, y: 0.57, z: 0.642, white: true, radius: 0.225 });
      group.add(bowTie(materials, [0, -0.78, 0.62], 1.02));
      break;
    case 'sunny':
      addEyes(group, materials, { x: 0.34, y: 0.13, z: 0.714, white: true, radius: 0.232 });
      glasses(group, materials, { x: 0.34, y: 0.13, z: 0.909, radius: 0.254 });
      group.add(bowTie(materials, [0, -0.79, 0.61], 1.06));
      break;
    case 'berry':
      glasses(group, materials, { x: 0.30, y: -0.015, z: 0.808, radius: 0.195, sunglasses: true });
      break;
    case 'rose': {
      const rose = new THREE.MeshStandardMaterial({ color: '#ed789b', roughness: 1 });
      for (const sign of [-1, 1]) {
        const center = [sign * 0.39, 1.01, -0.09];
        const scale = [0.23, 0.27, 0.23];
        const ear = sphere(rose, scale, center, sign < 0 ? 'left-furry-ear' : 'right-furry-ear');
        group.add(ear);
        group.userData.furParts.push({ center, scale, color: '#ed789b', mesh: ear });
        const closedEye = tube([
          [sign * 0.29 - 0.117, 0.13, 0.81],
          [sign * 0.29 - 0.060, 0.084, 0.826],
          [sign * 0.29, 0.068, 0.832],
          [sign * 0.29 + 0.060, 0.084, 0.826],
          [sign * 0.29 + 0.117, 0.13, 0.81],
        ], 0.022, materials.frame, sign < 0 ? 'closed-eye-left' : 'closed-eye-right', 24);
        group.add(closedEye);
      }
      addHeadphones(group, materials);
      break;
    }
    case 'cobalt':
    default:
      addEyes(group, materials, { x: 0.278, y: 0.495, z: 0.758 });
      addBeret(group, materials);
      break;
  }
  return group;
}

/** Face motion stays local so the caller can independently tilt the whole dot. */
export function updateAccessories(group, { time = 0, lookX = 0, lookY = 0, blink = 0 } = {}) {
  const shut = THREE.MathUtils.clamp(blink, 0, 1);
  for (const eye of group.userData.eyes ?? []) eye.scale.y = 1 - shut * 0.94;
  for (const pupil of group.userData.pupils ?? []) {
    const origin = pupil.userData.origin;
    const travel = pupil.userData.travel;
    pupil.position.set(
      origin.x + THREE.MathUtils.clamp(lookX, -1, 1) * travel,
      origin.y + THREE.MathUtils.clamp(lookY, -1, 1) * travel,
      origin.z,
    );
  }
  // Record the animation clock for consumers without adding a second idle sway.
  group.userData.time = time;
}
