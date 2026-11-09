// The film's trees on screen: lit point clouds (bark on cylinders, leaves in flattened clumps) with an
// optional faint additive halo. The trees themselves are grown in a worker by hero-grow.js.
import * as THREE from '../assets/vendor/three.module.js';
import {mulberry32} from './random.js';
export {PRE_TAU} from './hero-grow.js';

// Grows trees in a worker. specs: for each geometry, the list of parts it is grown from (options of
// growHeroTree and heroTreeArrays). Returns the geometries at once, empty until grown, and a promise
// for each.
export function growTrees(specs) {
  const geos = specs.map(() => new THREE.BufferGeometry());
  const resolvers = [];
  const ready = specs.map((_, i) => new Promise(r => { resolvers[i] = r; }));
  const fill = (id, a) => {
    const geo = geos[id];
    geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    geo.setAttribute('aNrm', new THREE.BufferAttribute(a.normal, 3));
    geo.setAttribute('aA', new THREE.BufferAttribute(a.a, 4));
    geo.setAttribute('aB', new THREE.BufferAttribute(a.b, 4));
    resolvers[id]();
  };
  let got = 0;
  new Promise((resolve, reject) => {
    const w = new Worker(new URL('./hero-worker.js', import.meta.url), {type: 'module'});
    w.onmessage = ({data}) => { fill(data.id, data.a); if (++got === specs.length) { w.terminate(); resolve(); } };
    w.onerror = e => { w.terminate(); e.preventDefault(); reject(e); };
    w.postMessage({specs});
  }).catch(async () => {
    // no module workers: grow here instead, one tree per task so the page keeps drawing
    const {growTreeArrays} = await import('./hero-grow.js');
    for (let id = got; id < specs.length; id++) {
      fill(id, growTreeArrays(specs[id]));
      await new Promise(r => setTimeout(r, 0));
    }
  });
  return {geos, ready};
}

// A tree drawn from a grown geometry; `glow` adds the faint halo pass.
export function treePoints(geo, px, {glow = false} = {}) {
  const tree = new THREE.Points(geo, heroTreeMaterial(px));
  tree.frustumCulled = false;
  if (glow) {
    const halo = new THREE.Points(geo, heroTreeMaterial(px, true, tree.material.uniforms));
    halo.frustumCulled = false;
    halo.renderOrder = 1;
    tree.add(halo);
  }
  return tree;
}

// Attributes as written by heroTreeArrays: aA = (birth, death, kind, random), aB = (bark radius,
// time it is reached, point size, flags: 1 on the stem + 2 if burnt); positions and sizes in metres,
// times on the film's growth clock. uBurn is the time of the fire for burnt trees.
const HERO_VERT = /* glsl */`
attribute vec3 aNrm;
attribute vec4 aA, aB;
uniform float uT, uLeaf, uStress, uTime, uPx, uProj, uTop, uThick, uBurn, uDieback, uFall, uKeep;
uniform vec3 uLight, uTint;
varying vec3 vColor;
varying float vVis;
void main() {
  float birth = aA.x, death = aA.y, kind = aA.z, rnd = aA.w;
  float stem = mod(aB.w, 2.0), burnt = step(1.5, aB.w);
  float grow = smoothstep(birth, birth + 0.012, uT);
  // burnt leaves go to ash quickly; other dead points fade over about a year
  float fall = clamp((uT - death) / (burnt * kind > 0.5 ? 0.012 : 0.035), 0.0, 1.0);
  // some of the dying leaves drift to the ground instead of fading where they hang
  float drop = burnt < 0.5 && kind > 0.5 && fract(rnd * 7.31) < 0.12 ? clamp((uT - death) / 0.06, 0.0, 1.0) : 0.0;
  float vis = grow * (drop > 0.0 ? 1.0 - smoothstep(0.75, 1.0, drop) : 1.0 - fall);
  // dieback: whole parts of the crown, a few metres across, die together and keep their bare, bleached
  // limbs (a drought killing back a mature tree), never the stem
  float part = fract(sin(dot(floor(position * 0.3 + 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float dead = step(part, uDieback) * (1.0 - stem);
  // a leaf fall (uFall: 0 -> 1): the leaves above uKeep and those of dead limbs brown and fall, each in
  // its own moment; the rest stay
  float faller = kind > 0.5 && uFall > 0.0001 ? max(step(uKeep, rnd), dead) : 0.0;
  float fallT = clamp((uFall - fract(rnd * 13.7) * 0.4) / 0.6, 0.0, 1.0);
  if (kind > 0.5) {
    if (faller > 0.5) vis *= step(rnd, uLeaf) * (1.0 - smoothstep(0.82, 1.0, fallT));
    else vis *= step(rnd, min(uLeaf, uKeep)) * (1.0 - dead);
  }
  float fresh = exp(-max(uT - birth, 0.0) / 0.03) * grow;
  // fire: the crown flares as the front passes, then the bark is left scorched
  float hb = 0.008 * clamp(position.y / uTop, 0.0, 1.0);
  float flame = burnt * smoothstep(uBurn - 0.01 + hb, uBurn + 0.004 + hb, uT) * (1.0 - smoothstep(uBurn + 0.012 + hb, uBurn + 0.03 + hb, uT));
  float scorch = burnt * smoothstep(uBurn + hb, uBurn + 0.015 + hb, uT);
  vec3 p = position;
  float size = aB.z;
  if (kind < 0.5) {
    float f = clamp((uT - birth) / max(aB.y - birth, 0.02), 0.0, 1.0);
    float r = max(0.004, aB.x * pow(f, 1.05)) * uThick;
    if (stem > 0.5) {
      // buttresses: the mature stem flares into five plank roots near the ground
      float fin = pow(abs(cos(atan(aNrm.z, aNrm.x) * 2.5)), 10.0);
      r *= 1.0 + exp(-p.y / (0.5 + 0.06 * uTop)) * (0.4 + 3.2 * fin) * smoothstep(8.0, 26.0, uTop);
    }
    p += aNrm * r * 0.85;
    size = max(size, r * 0.5);
    // dead branches drop; a dead stem crumbles where it stands
    if (stem < 0.5) p.y -= fall * fall * 2.5;
  } else {
    float h = clamp(p.y / uTop, 0.0, 1.0);
    p.x += sin(uTime * 1.3 + p.y * 0.7 + rnd * 6.28) * 0.06 * h * h;
    p.z += cos(uTime * 1.1 + p.x * 0.6 + rnd * 6.28) * 0.04 * h * h;
    if (faller > 0.5 && fallT > 0.0) {
      // tumbling down, drifting with the wind
      float fy = max(p.y, 0.05);
      p.y = mix(p.y, 0.05, fallT * (0.35 + 0.65 * fallT));
      p.x += sin(fallT * 11.0 + rnd * 40.0) * 1.1 * fallT * fy / uTop + (rnd - 0.5) * 4.0 * fallT;
      p.z += cos(fallT * 8.0 + rnd * 30.0) * 0.9 * fallT * fy / uTop;
      size *= 0.7 + 0.9 * abs(sin(fallT * 23.0 + rnd * 30.0));
    }
    if (drop > 0.0) {
      float fy = max(p.y, 0.05);
      p.y = mix(p.y, 0.05, drop * drop);
      p.x += sin(drop * 9.0 + rnd * 40.0) * 0.6 * drop * fy / uTop + (rnd - 0.5) * 3.0 * drop;
      p.z += cos(drop * 7.0 + rnd * 30.0) * 0.6 * drop * fy / uTop;
    }
    // embers lift off the burning crown
    p.y += burnt * (0.5 + rnd) * 2.0 * clamp((uT - uBurn) / 0.03, 0.0, 1.0);
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
    col = mix(col * uTint, vec3(0.78, 0.62, 0.24), clamp(uStress * (0.4 + 0.6 * rnd) + drop * 0.8, 0.0, 1.0));
    col = mix(col, vec3(0.74, 0.42, 0.14), faller * clamp(uFall * 3.0, 0.0, 1.0));
    col *= 0.22 + 1.0 * diff;
    col += vec3(0.35, 0.95, 0.75) * rim * 0.22 + vec3(0.75, 1.0, 0.45) * fresh * 0.5;
  } else {
    col = vec3(0.66, 0.55, 0.42) * (0.85 + 0.3 * rnd) * (0.2 + 1.0 * diff) + vec3(0.3, 0.7, 0.6) * rim * 0.12;
    col = mix(col, vec3(0.6, 0.58, 0.55) * (0.3 + 0.85 * diff), dead * 0.75 * (uFall > 0.0001 ? smoothstep(0.0, 0.6, uFall) : 1.0));
  }
  col = mix(col, vec3(0.05, 0.045, 0.04) * (0.5 + diff), scorch);
  col = mix(col, vec3(1.0, 0.32, 0.05) * (0.6 + 0.8 * rnd), flame);
  vColor = col;
  vVis = vis;
#ifdef GLOW
  vVis *= ((kind > 0.5 ? 0.5 + fresh : 0.18) + flame * 0.9) * (1.0 - 0.8 * faller * step(0.001, fallT));
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
      uBurn: {value: -9}, uTint: {value: new THREE.Color(1, 1, 1)}, uDieback: {value: 0}, uFall: {value: 0}, uKeep: {value: 1},
    },
    vertexShader: HERO_VERT, fragmentShader: HERO_FRAG,
    ...(glow
      ? {transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor}
      : {transparent: true, depthWrite: true, alphaToCoverage: true}),
  });
}

// Flames, embers and smoke from a burning crown, in the object space (metres) of the tree they are
// added to. uBurn is the fire's time on the growth clock and uH the crown height when it burns. The
// flames climb from the ground into the crown and lick upwards, yellow at their roots and red at their
// tips; embers drift higher; dark smoke (a child sharing the uniforms) rolls up above them and outlasts them.
export function createFlames(px, count = 900) {
  const rng = mulberry32(7);
  // points on a unit disc at heights 0..1; with tongues > 0 they share that many places, one per flame
  const cloud = (n, tongues = 0) => {
    const pos = new Float32Array(n * 3), rnd = new Float32Array(n * 2), at = [];
    for (let i = 0; i < n; i++) {
      if (!tongues || i < tongues) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
        at.push([Math.cos(a) * r, rng(), Math.sin(a) * r]);
      }
      pos.set(at[tongues ? i % tongues : i], i * 3);
      rnd.set([rng(), rng()], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aR', new THREE.BufferAttribute(rnd, 2));
    return geo;
  };
  const uniforms = {uT: {value: 0}, uBurn: {value: -9}, uTime: {value: 0}, uPx: {value: px}, uProj: {value: 1000}, uH: {value: 20}, uOpacity: {value: 1}};
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `attribute vec2 aR;
      uniform float uT, uBurn, uTime, uPx, uProj, uH;
      varying float vA;
      varying vec3 vC;
      void main() {
        float on = smoothstep(uBurn - 0.006, uBurn + 0.004, uT) * (1.0 - smoothstep(uBurn + 0.022, uBurn + 0.045, uT));
        float climb = smoothstep(uBurn - 0.008, uBurn + 0.008, uT);
        float ember = step(0.86, aR.y);
        float life = fract(uTime * (ember > 0.5 ? 0.3 + 0.2 * aR.x : 1.0 + 0.6 * fract(aR.y * 13.0)) + aR.x);
        vec3 p = vec3(position.x * uH * 0.3, mix(0.02, 0.8, position.y) * uH, position.z * uH * 0.3);
        vec2 jit = vec2(cos(aR.y * 40.0), sin(aR.y * 40.0)) * sqrt(fract(aR.y * 7.3));
        if (ember > 0.5) {
          p.xz += jit * uH * 0.15;
          p.y += life * uH * 0.9;
          p.x += sin(uTime * 2.0 + aR.x * 40.0) * 1.5 * life;
          p.z += cos(uTime * 1.7 + aR.y * 30.0) * 1.2 * life;
        } else {
          // the points of one tongue rise together from its place, narrowing and swaying as one flame
          p.xz += jit * uH * 0.075 * (1.0 - 0.75 * life);
          p.y += life * uH * 0.42;
          p.x += sin(uTime * 5.0 + position.x * 9.0 + p.y * 0.35) * 0.9 * life;
          p.z += cos(uTime * 4.0 + position.z * 9.0 + p.y * 0.3) * 0.6 * life;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float flicker = 0.65 + 0.35 * sin(uTime * 11.0 + position.x * 31.0 + position.z * 17.0);
        vA = on * step(position.y, climb * 1.05) * smoothstep(0.0, 0.08, life) * pow(1.0 - life, 1.4) * flicker;
        vec3 tongue = life < 0.3 ? mix(vec3(1.0, 0.84, 0.5), vec3(1.0, 0.48, 0.1), life / 0.3) : mix(vec3(1.0, 0.48, 0.1), vec3(0.5, 0.06, 0.02), (life - 0.3) / 0.7);
        vC = ember > 0.5 ? vec3(1.0, 0.6, 0.22) * (0.7 + 0.6 * step(0.5, fract(uTime * 6.0 + aR.x * 9.0))) : tongue;
        vA *= ember > 0.5 ? 1.0 : 0.3;
        gl_PointSize = vA > 0.0 ? uPx * (ember > 0.5 ? 0.55 : 1.2 + 2.2 * (1.0 - life)) * length(modelMatrix[0].xyz) * uProj / -mv.z : 0.0;
      }`,
    fragmentShader: `uniform float uOpacity;
      varying float vA;
      varying vec3 vC;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * vA * uOpacity * smoothstep(0.5, 0.0, d), 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.Points(cloud(count, 24), mat);
  flames.frustumCulled = false;
  flames.renderOrder = 2;
  const smoke = new THREE.Points(cloud(Math.round(count / 4)), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `attribute vec2 aR;
      uniform float uT, uBurn, uTime, uPx, uProj, uH;
      varying float vA;
      void main() {
        float on = smoothstep(uBurn, uBurn + 0.012, uT) * (1.0 - smoothstep(uBurn + 0.04, uBurn + 0.09, uT));
        float life = fract(uTime * (0.22 + 0.12 * aR.y) + aR.x);
        float spread = uH * 0.25 * (1.0 + 1.2 * life);
        vec3 p = vec3(position.x * spread, mix(0.55, 0.9, position.y) * uH + life * uH * 1.1, position.z * spread);
        p.x += life * life * uH * 0.25 + sin(uTime * 0.7 + aR.x * 20.0) * 0.8 * life;   // the wind takes it
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = on * smoothstep(0.0, 0.2, life) * (1.0 - life) * 0.35;
        gl_PointSize = vA > 0.0 ? uPx * (3.0 + 7.0 * life) * length(modelMatrix[0].xyz) * uProj / -mv.z : 0.0;
      }`,
    fragmentShader: `uniform float uOpacity;
      varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.09, 0.075, 0.07), vA * uOpacity * smoothstep(0.5, 0.1, d)); }`,
    transparent: true, depthWrite: false,
  }));
  smoke.frustumCulled = false;
  smoke.renderOrder = 1;
  flames.add(smoke);
  return flames;
}
