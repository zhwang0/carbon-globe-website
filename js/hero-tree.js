// Chapter one's tree on screen: a lit point cloud (bark on cylinders, leaves in flattened clumps) with
// a faint additive halo. The tree itself is grown in a worker by hero-grow.js.
import * as THREE from '../assets/vendor/three.module.js';
export {PRE_TAU} from './hero-grow.js';

// Returns the tree (a Points object, empty until `ready` resolves) for a canopy-height series in metres.
export function createHeroTree(heights, {px, leaf = 12}) {
  const geo = new THREE.BufferGeometry();
  const tree = new THREE.Points(geo, heroTreeMaterial(px));
  const glow = new THREE.Points(geo, heroTreeMaterial(px, true, tree.material.uniforms));
  tree.frustumCulled = glow.frustumCulled = false;
  glow.renderOrder = 1;
  tree.add(glow);
  const ready = growArrays(heights, leaf).then(a => {
    geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    geo.setAttribute('aNrm', new THREE.BufferAttribute(a.normal, 3));
    geo.setAttribute('aA', new THREE.BufferAttribute(a.a, 4));
    geo.setAttribute('aB', new THREE.BufferAttribute(a.b, 4));
  });
  return {tree, ready};
}

function growArrays(heights, leaf) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./hero-worker.js', import.meta.url), {type: 'module'});
    w.onmessage = e => { w.terminate(); resolve(e.data); };
    w.onerror = e => { w.terminate(); e.preventDefault(); reject(e); };
    w.postMessage({heights, leaf});
  }).catch(async () => {
    // no module workers: grow it here instead
    const {growHeroTree, heroTreeArrays} = await import('./hero-grow.js');
    return heroTreeArrays(growHeroTree(heights), {leaf});
  });
}

// Attributes as written by heroTreeArrays: aA = (birth, death, kind, random), aB = (bark radius,
// time it is reached, point size, stem flag); positions and sizes in metres, times on the growth clock.
const HERO_VERT = /* glsl */`
attribute vec3 aNrm;
attribute vec4 aA, aB;
uniform float uT, uLeaf, uStress, uTime, uPx, uProj, uTop, uThick;
uniform vec3 uLight;
varying vec3 vColor;
varying float vVis;
void main() {
  float birth = aA.x, death = aA.y, kind = aA.z, rnd = aA.w;
  float grow = smoothstep(birth, birth + 0.012, uT);
  float fall = clamp((uT - death) / 0.035, 0.0, 1.0);
  // some of the dying leaves drift to the ground instead of fading where they hang
  float drop = kind > 0.5 && fract(rnd * 7.31) < 0.12 ? clamp((uT - death) / 0.06, 0.0, 1.0) : 0.0;
  float vis = grow * (drop > 0.0 ? 1.0 - smoothstep(0.75, 1.0, drop) : 1.0 - fall);
  if (kind > 0.5) vis *= step(rnd, uLeaf);
  float fresh = exp(-max(uT - birth, 0.0) / 0.03) * grow;
  vec3 p = position;
  float size = aB.z;
  if (kind < 0.5) {
    float f = clamp((uT - birth) / max(aB.y - birth, 0.02), 0.0, 1.0);
    float r = max(0.004, aB.x * pow(f, 1.05)) * uThick;
    if (aB.w > 0.5) {
      // buttresses: the mature stem flares into five plank roots near the ground
      float fin = pow(abs(cos(atan(aNrm.z, aNrm.x) * 2.5)), 10.0);
      r *= 1.0 + exp(-p.y / (0.5 + 0.06 * uTop)) * (0.4 + 3.2 * fin) * smoothstep(8.0, 26.0, uTop);
    }
    p += aNrm * r * 0.85;
    size = max(size, r * 0.5);
    p.y -= fall * fall * 2.5;
  } else {
    float h = clamp(p.y / uTop, 0.0, 1.0);
    p.x += sin(uTime * 1.3 + p.y * 0.7 + rnd * 6.28) * 0.06 * h * h;
    p.z += cos(uTime * 1.1 + p.x * 0.6 + rnd * 6.28) * 0.04 * h * h;
    if (drop > 0.0) {
      float fy = max(p.y, 0.05);
      p.y = mix(p.y, 0.05, drop * drop);
      p.x += sin(drop * 9.0 + rnd * 40.0) * 0.6 * drop * fy / uTop + (rnd - 0.5) * 3.0 * drop;
      p.z += cos(drop * 7.0 + rnd * 30.0) * 0.6 * drop * fy / uTop;
    }
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;

  vec3 N = normalize(mat3(modelMatrix) * aNrm);
  vec3 V = normalize(cameraPosition - wp.xyz);
  float diff = clamp((dot(N, uLight) + 0.3) / 1.3, 0.0, 1.0);
  float rim = pow(1.0 - abs(dot(N, V)), 2.5);
  float h = clamp(p.y / uTop, 0.0, 1.0);
  vec3 col;
  if (kind > 0.5) {
    float t = clamp(h + (rnd - 0.5) * 0.18, 0.0, 1.0);
    vec3 c1 = vec3(0.03, 0.26, 0.2), c2 = vec3(0.12, 0.62, 0.38), c3 = vec3(0.5, 0.86, 0.36), c4 = vec3(0.86, 0.97, 0.6);
    col = t < 0.5 ? mix(c1, c2, t / 0.5) : (t < 0.85 ? mix(c2, c3, (t - 0.5) / 0.35) : mix(c3, c4, (t - 0.85) / 0.15));
    col = mix(col, vec3(0.78, 0.62, 0.24), clamp(uStress * (0.4 + 0.6 * rnd) + drop * 0.8, 0.0, 1.0));
    col *= 0.22 + 1.0 * diff;
    col += vec3(0.35, 0.95, 0.75) * rim * 0.22 + vec3(0.75, 1.0, 0.45) * fresh * 0.5;
  } else {
    col = vec3(0.66, 0.55, 0.42) * (0.85 + 0.3 * rnd) * (0.2 + 1.0 * diff) + vec3(0.3, 0.7, 0.6) * rim * 0.12;
  }
  vColor = col;
  vVis = vis;
#ifdef GLOW
  vVis *= kind > 0.5 ? 0.5 + fresh : 0.18;
  size *= 4.0;
#endif
  gl_PointSize = vis * uPx * size * length(modelMatrix[0].xyz) * uProj / -mv.z;
}`;
const HERO_FRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vColor;
varying float vVis;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (vVis < 0.01 || d > 0.5) discard;
#ifdef GLOW
  gl_FragColor = vec4(vColor * vVis * uOpacity * 0.07 * exp(-d * d * 14.0), 1.0);
#else
  gl_FragColor = vec4(vColor, uOpacity * smoothstep(0.5, 0.36, d));
#endif
}`;

// The solid, lit point cloud; with glow = true, a faint additive halo drawn after it.
export function heroTreeMaterial(px, glow = false, shared = null) {
  return new THREE.ShaderMaterial({
    defines: glow ? {GLOW: 1} : {},
    uniforms: shared || {
      uT: {value: 0}, uLeaf: {value: 1}, uStress: {value: 0}, uTime: {value: 0}, uPx: {value: px}, uProj: {value: 1000},
      uTop: {value: 30}, uThick: {value: 1.15}, uOpacity: {value: 1}, uLight: {value: new THREE.Vector3(-0.55, 0.7, 0.45).normalize()},
    },
    vertexShader: HERO_VERT, fragmentShader: HERO_FRAG,
    ...(glow
      ? {transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor}
      : {transparent: true, depthWrite: true, alphaToCoverage: true}),
  });
}
