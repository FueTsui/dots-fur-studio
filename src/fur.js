import * as THREE from 'three';
import { sampleSurface } from './characters.js';
import { PARAMETER_DEFS } from './catalog.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

export const DEFAULTS = Object.freeze(Object.fromEntries(PARAMETER_DEFS.map(p => [p.id, p.default])));
export const MAX_STRANDS = 180000;

// Each instance is a tapered, three-segment strand. All animation is on the GPU.
const vertexShader = /* glsl */ `
  attribute vec3 aRoot;
  attribute vec3 aNormal;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uLength;
  uniform float uThickness;
  uniform float uMess;
  uniform float uCurl;
  uniform float uGravity;
  uniform vec4 uFaceZones[2];
  uniform vec2 uFaceDepth;
  uniform vec3 uTouch;
  uniform float uTouchStrength;
  varying float vAcross;
  varying float vAlong;
  varying float vTint;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vTangent;

  void main() {
    float t = position.y;
    vec3 n = aNormal;
    vec3 reference = abs(n.y) > 0.95 ? vec3(1.,0.,0.) : vec3(0.,1.,0.);
    vec3 tangent = normalize(cross(reference, n));
    vec3 bitangent = cross(n, tangent);
    float angle = aSeed.x * 6.283185;
    vec3 comb = tangent * cos(angle) + bitangent * sin(angle);
    vec3 curlDir = cross(n, comb);
    float strandLength = uLength * mix(0.57, 1.2, aSeed.y);
    // Groom the coat around the native face without moving its authored meshes.
    for (int i = 0; i < 2; i++) {
      vec4 zone = uFaceZones[i];
      vec2 delta = (aRoot.xy - zone.xy) / max(zone.zw, vec2(.001));
      float distanceToEye = length(delta);
      float front = smoothstep(uFaceDepth[i] - .16, uFaceDepth[i] - .04, aRoot.z);
      float trim = mix(.025, 1., smoothstep(.75, 1.65, distanceToEye));
      strandLength *= mix(1., trim, front);
    }
    float breeze = sin(uTime * 1.75 + aRoot.y * 4. + aSeed.z * 6.28);
    vec3 gravity = vec3(0., -1., 0.);
    gravity -= n * dot(gravity, n) * 0.75;
    vec3 bend = comb * uMess * .4 + curlDir * uCurl * .17
      + gravity * uGravity * .8 + tangent * breeze * .11;
    vec3 touchDelta = aRoot - uTouch;
    float touchInfluence = exp(-dot(touchDelta, touchDelta) * 4.5) * uTouchStrength;
    vec3 push = touchDelta - n * dot(touchDelta, n);
    bend += push * touchInfluence * 5.;
    vec3 center = aRoot + n * strandLength * t + bend * strandLength * t * t;
    center += curlDir * sin(t * 5. + aSeed.w * 6.28) * strandLength * .1 * uCurl * t;
    float curlPhase = t * 5. + aSeed.w * 6.28;
    vec3 curlDerivative = curlDir * .1 * uCurl * (sin(curlPhase) + 5. * t * cos(curlPhase));
    vec3 strandTangent = normalize(n + 2. * t * bend + curlDerivative);
    vec4 viewCenter = modelViewMatrix * vec4(center, 1.);
    vec3 viewTangent = normalize(mat3(modelViewMatrix) * strandTangent);
    vec3 ray = vec3(0., 0., 1.); // Orthographic camera, parallel rays.
    vec3 side = cross(viewTangent, ray);
    float sideLength = length(side);
    side = sideLength > .025 ? side / sideLength : vec3(cos(angle), sin(angle), 0.);
    float taper = pow(max(0.018, 1. - t), .64);
    float width = .009 * uThickness * mix(.6, 1.2, aSeed.w) * taper;
    float modelScale = length(modelViewMatrix[0].xyz);
    viewCenter.xyz += side * position.x * width * .5 * modelScale;
    gl_Position = projectionMatrix * viewCenter;
    vNormal = normalize(normalMatrix * n);
    vView = -viewCenter.xyz;
    vTangent = viewTangent;
    vAcross = position.x;
    vAlong = t;
    vTint = aSeed.z;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  uniform float uRim;
  uniform float uCoverage;
  varying float vAcross;
  varying float vAlong;
  varying float vTint;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vTangent;
  void main() {
    float aa = max(fwidth(vAcross), .04);
    float alpha = 1. - smoothstep(1. - aa, 1. + aa, abs(vAcross));
    alpha *= 1. - smoothstep(.88, 1.02, vAlong);
    if (alpha < .12) discard;
    if (uCoverage < .5 && alpha < .46) discard;
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vView);
    vec3 light = normalize(vec3(-.65, 1.3, 1.8));
    float diffuse = pow(max(0., dot(n, light)) * .72 + .28, 1.15);
    float rim = pow(1. - max(0., dot(n, viewDir)), 3.0);
    float fiber = pow(max(0., 1. - abs(dot(normalize(vTangent), normalize(light + viewDir)))), 12.);
    float rootAO = mix(.58, 1.19, pow(vAlong, .6));
    float variation = mix(.68, 1.20, vTint);
    vec3 color = uColor * (.18 + diffuse * .88) * rootAO * variation * uBright;
    color += uColor * rim * uRim * .40;
    color += vec3(.0025) * fiber * diffuse;
    gl_FragColor = vec4(color, uCoverage > .5 ? alpha : 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function seededRandom(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createBodyGeometry(id) {
  const geometry = new THREE.SphereGeometry(1, 112, 80);
  const positions = geometry.attributes.position;
  const direction = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const p = sampleSurface(direction, id);
    positions.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function createBodyMaterial(color, parameters) {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { uColor: {value: new THREE.Color(color)}, uBright: {value: parameters.bright}, uRim: {value: parameters.rim} },
    vertexShader: `varying vec3 vNormal;
      void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uBright; uniform float uRim; varying vec3 vNormal;
      void main() {
        vec3 light = normalize(vec3(-.65, 1.3, 1.8));
        float diffuse = pow(max(0., dot(normalize(vNormal), light)) * .72 + .28, 1.15);
        float rim = pow(1. - max(0., normalize(vNormal).z), 3.);
        gl_FragColor = vec4(uColor * ((.18 + diffuse * .88) * .68 * uBright + rim * uRim * .4), 1.);
        #include <colorspace_fragment>
      }`,
  });
}

export function createFur(id, color, parameters, coverage = false, options = {}) {
  const count = options.count ?? MAX_STRANDS;
  const surface = options.sample ?? (direction => sampleSurface(direction, id));
  const geometry = new THREE.InstancedBufferGeometry();
  const vertices = [], indices = [];
  for (let i = 0; i <= 3; i++) {
    vertices.push(-1, i / 3, 0, 1, i / 3, 0);
    if (i < 3) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const roots = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  const random = seededRandom(71923);
  const sampler = options.geometry ? new MeshSurfaceSampler(new THREE.Mesh(options.geometry)).setRandomGenerator(random).build() : null;
  const sampledPosition = new THREE.Vector3();
  const direction = new THREE.Vector3(), axis = new THREE.Vector3();
  const tangent = new THREE.Vector3(), bitangent = new THREE.Vector3();
  const da = new THREE.Vector3(), db = new THREE.Vector3();
  const normal = new THREE.Vector3();
  // Randomized ordering means instanceCount is a real, evenly distributed LOD.
  for (let i = 0; i < count; i++) {
    if (sampler) {
      // Sample the exact original mesh by triangle area, including concave shapes.
      sampler.sample(sampledPosition, normal);
      roots.set(sampledPosition.toArray(), i * 3);
      normals.set(normal.toArray(), i * 3);
      seeds.set([random(), random(), random(), random()], i * 4);
      continue;
    }
    const y = random() * 2 - 1, phi = random() * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y);
    direction.set(radius * Math.cos(phi), y, radius * Math.sin(phi));
    const p = surface(direction);
    axis.set(Math.abs(y) > .95 ? 1 : 0, Math.abs(y) > .95 ? 0 : 1, 0);
    tangent.crossVectors(axis, direction).normalize();
    bitangent.crossVectors(direction, tangent).normalize();
    da.copy(direction).addScaledVector(tangent, .001).normalize();
    db.copy(direction).addScaledVector(bitangent, .001).normalize();
    const a = surface(da).sub(p), b = surface(db).sub(p);
    normal.crossVectors(a, b).normalize();
    if (normal.dot(direction) < 0) normal.negate();
    roots.set([p.x, p.y, p.z], i * 3);
    normals.set([normal.x, normal.y, normal.z], i * 3);
    seeds.set([random(), random(), random(), random()], i * 4);
  }
  geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 3));
  geometry.setAttribute('aNormal', new THREE.InstancedBufferAttribute(normals, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = Math.min(count, parameters.density * 1000);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.7);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uColor: {value: new THREE.Color(color)},
      uTime: {value: 0},
      uLength: {value: parameters.length},
      uThickness: {value: parameters.thickness},
      uMess: {value: parameters.mess},
      uCurl: {value: parameters.curl},
      uGravity: {value: parameters.gravity},
      uFaceZones: {value: [new THREE.Vector4(10,10,.01,.01),new THREE.Vector4(10,10,.01,.01)]},
      uFaceDepth: {value: new THREE.Vector2(10,10)},
      uBright: {value: parameters.bright},
      uRim: {value: parameters.rim},
      uTouch: {value: new THREE.Vector3(0, 0, 10)},
      uTouchStrength: {value: 0},
      uCoverage: {value: coverage ? 1 : 0},
    },
    side: THREE.DoubleSide,
    alphaToCoverage: coverage,
    transparent: false,
    depthWrite: true,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Opaque body first; hidden rear strands are rejected early by depth testing.
  mesh.renderOrder = 1;
  return mesh;
}

export function updateFurParameters(fur, parameters) {
  for (const [key, value] of Object.entries(parameters)) {
    const name = `u${key[0].toUpperCase()}${key.slice(1)}`;
    if (fur.material.uniforms[name]) fur.material.uniforms[name].value = value;
  }
}
