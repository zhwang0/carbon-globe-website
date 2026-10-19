// Procedural point-cloud trees whose growth is driven by CarbonGlobe canopy height.
import * as THREE from '../assets/vendor/three.module.js';
import {mulberry32} from './random.js';

export {mulberry32};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const MAX_DEPTH = 3;

function skeleton(rng) {
  const segs = [], tips = [];
  const perp = d => (Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(d).normalize();
  function branch(p, d, len, r, depth, t0) {
    const n = 4, pts = [p.clone()], dir = d.clone();
    let cur = p.clone();
    for (let k = 0; k < n; k++) {
      dir.add(V(rng() - .5, rng() - .5, rng() - .5).multiplyScalar(depth ? 0.22 : 0.08));
      if (depth) dir.y += 0.05;
      dir.normalize();
      const next = cur.clone().addScaledVector(dir, len / n);
      segs.push({a: cur, b: next, ra: r * (1 - .3 * k / n), rb: r * (1 - .3 * (k + 1) / n), ta: t0 + len * k / n, tb: t0 + len * (k + 1) / n, depth, last: k === n - 1});
      cur = next; pts.push(cur);
    }
    if (depth >= MAX_DEPTH) { tips.push({p: cur, t: t0 + len, dir: dir.clone()}); return; }
    const kids = depth === 0 ? 7 : (rng() < 0.55 ? 3 : 2);
    for (let i = 0; i < kids; i++) {
      const f = depth === 0 ? 0.4 + 0.6 * (i + 0.2 + rng() * 0.6) / kids : 0.45 + 0.55 * rng();
      const idx = Math.min(n - 1, Math.floor(f * n));
      const at = pts[idx].clone().lerp(pts[idx + 1], f * n - idx);
      const az = (i / kids) * Math.PI * 2 + rng() * 0.9 + depth * 1.7;
      const elev = (depth === 0 ? 48 + 20 * f : 30) * (0.75 + 0.5 * rng()) * Math.PI / 180;
      const p1 = perp(dir), p2 = dir.clone().cross(p1).normalize();
      const side = p1.multiplyScalar(Math.cos(az)).add(p2.multiplyScalar(Math.sin(az)));
      const cd = dir.clone().multiplyScalar(Math.cos(elev)).addScaledVector(side, Math.sin(elev)).normalize();
      const clen = len * (depth === 0 ? 0.78 * (1.15 - 0.55 * f) : 0.66) * (0.8 + 0.4 * rng());
      branch(at, cd, clen, r * 0.55, depth + 1, t0 + len * f);
    }
  }
  branch(V(), V((rng() - .5) * .06, 1, (rng() - .5) * .06).normalize(), 0.62, 0.032, 0, 0);
  return {segs, tips};
}

// Attributes: position (unit tree, top = 1), aBirth/aDeath on a 0..1 growth clock, aKind (0 wood, 1 leaf), aRnd.
export function treeGeometry(seed, count = 24000) {
  const rng = mulberry32(seed * 9973 + 17);
  const {segs, tips} = skeleton(rng);
  const nWood = Math.round(count * 0.28), nLeaf = count - nWood;
  const pos = new Float32Array(count * 3), birth = new Float32Array(count), death = new Float32Array(count);
  const kind = new Float32Array(count), rnd = new Float32Array(count);
  let i = 0;

  const wSum = segs.reduce((s, g) => s + g.a.distanceTo(g.b) * (g.ra + 0.006), 0);
  const tmp = V(), d = V();
  for (const g of segs) {
    const len = g.a.distanceTo(g.b);
    const n = Math.round(nWood * len * (g.ra + 0.006) / wSum);
    d.subVectors(g.b, g.a).normalize();
    const p1 = (Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(d).normalize(), p2 = d.clone().cross(p1);
    for (let k = 0; k < n && i < nWood; k++, i++) {
      const s = rng(), th = rng() * Math.PI * 2, r = (g.ra + (g.rb - g.ra) * s) * (0.75 + 0.25 * rng());
      tmp.copy(g.a).lerp(g.b, s).addScaledVector(p1, Math.cos(th) * r).addScaledVector(p2, Math.sin(th) * r);
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
      birth[i] = g.ta + (g.tb - g.ta) * s; death[i] = 99; kind[i] = 0; rnd[i] = rng();
    }
  }
  const nWoodReal = i;

  // Foliage: big clusters on tips, smaller ones along younger branches that self-prune as the crown rises.
  const clusters = tips.map(t => ({c: t.p.clone().addScaledVector(t.dir, 0.03).add(V(0, 0.02, 0)), r: 0.085 + rng() * 0.05, t: t.t - 0.08, die: 99, w: 1}));
  for (const g of segs) {
    if (g.depth === 0 && g.b.y < 0.18) continue;
    const life = [0.16, 0.34, 0.6, 99][g.depth];
    clusters.push({c: g.b.clone(), r: (0.05 + rng() * 0.03) * (g.depth ? 1 : 1.3), t: g.tb, die: g.tb + life, w: g.depth ? 0.5 : 0.9});
  }
  const cSum = clusters.reduce((s, c) => s + c.w * c.r ** 2, 0);
  for (const c of clusters) {
    const n = Math.round(nLeaf * c.w * c.r ** 2 / cSum);
    for (let k = 0; k < n && i < count; k++, i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u), rr = c.r * Math.cbrt(rng());
      tmp.set(Math.cos(a) * s * rr * 1.25, u * rr * 0.62, Math.sin(a) * s * rr * 1.25).add(c.c);
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
      birth[i] = c.t + 0.03 + rng() * 0.1; death[i] = c.die; kind[i] = 1; rnd[i] = rng();
    }
  }
  const n = i;
  let tMax = 0, yMax = 0;
  for (let k = 0; k < n; k++) { tMax = Math.max(tMax, birth[k]); yMax = Math.max(yMax, pos[k * 3 + 1]); }
  for (let k = 0; k < n; k++) {
    birth[k] = Math.max(0, birth[k]) / tMax; death[k] = death[k] > 50 ? 9 : death[k] / tMax;
    pos[k * 3] /= yMax; pos[k * 3 + 1] /= yMax; pos[k * 3 + 2] /= yMax;
  }
  // Visible top of the tree as a function of growth, so we can scale to a target height.
  const top = new Float32Array(65);
  for (let k = 0; k < n; k++) {
    const j = Math.min(64, Math.ceil(birth[k] * 64));
    if (pos[k * 3 + 1] > top[j]) top[j] = pos[k * 3 + 1];
  }
  for (let j = 1; j <= 64; j++) top[j] = Math.max(top[j], top[j - 1]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth.subarray(0, n), 1));
  geo.setAttribute('aDeath', new THREE.BufferAttribute(death.subarray(0, n), 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind.subarray(0, n), 1));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd.subarray(0, n), 1));
  geo.boundingSphere = new THREE.Sphere(V(0, 0.5, 0), 1.2);
  geo.userData = {top, woodCount: nWoodReal};
  return geo;
}

export function visibleTop(geo, g) {
  const top = geo.userData.top, x = Math.min(64, Math.max(0, g * 64)), j = Math.floor(x);
  return Math.max(0.02, top[j] + (top[Math.min(64, j + 1)] - top[j]) * (x - j));
}

const TREE_VERT = /* glsl */`
attribute float aBirth, aDeath, aKind, aRnd;
uniform float uGrowth, uSY, uSXZ, uLeaf, uTime, uPx, uSize, uFogNear, uFogFar, uOpacity, uTop, uProj;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float vis = clamp((uGrowth - aBirth) / 0.05, 0.0, 1.0) * clamp((aDeath - uGrowth) / 0.08, 0.0, 1.0);
  if (aKind > 0.5) vis *= step(aRnd, uLeaf);
  vec3 p = position;
  float h = p.y / max(uTop, 0.05);
  if (aKind > 0.5) {
    float sway = sin(uTime * 1.1 + p.y * 6.0 + aRnd * 6.28) * 0.012 * h * h;
    p.x += sway; p.z += sway * 0.6;
  }
  p.xz *= uSXZ; p.y *= uSY;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  float fog = smoothstep(uFogFar, uFogNear, dist);
  vec3 wood = vec3(0.86, 0.64, 0.38) * (0.45 + 0.5 * aRnd);
  vec3 c1 = vec3(0.07, 0.36, 0.22), c2 = vec3(0.2, 0.82, 0.48), c3 = vec3(0.62, 0.92, 0.38), c4 = vec3(0.86, 0.98, 0.68);
  float t = clamp(h + (aRnd - 0.5) * 0.25, 0.0, 1.0);
  vec3 leaf = t < 0.45 ? mix(c1, c2, t / 0.45) : (t < 0.85 ? mix(c2, c3, (t - 0.45) / 0.4) : mix(c3, c4, (t - 0.85) / 0.15));
  vColor = mix(wood, leaf, aKind);
  vAlpha = vis * fog * uOpacity * (aKind > 0.5 ? 0.24 : 0.6);
  gl_PointSize = vis * uPx * uSize * sqrt(uSY) * (aKind > 0.5 ? (0.8 + aRnd * 0.9) : 0.55) * uProj / dist;
}`;
const TREE_FRAG = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  if (a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

export function treeMaterial(px) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGrowth: {value: 1}, uSY: {value: 1}, uSXZ: {value: 1}, uLeaf: {value: 1}, uTime: {value: 0}, uPx: {value: px},
      uSize: {value: 0.02}, uFogNear: {value: 30}, uFogFar: {value: 70}, uOpacity: {value: 1}, uTop: {value: 1}, uProj: {value: 1000},
    },
    vertexShader: TREE_VERT, fragmentShader: TREE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// Set a tree's growth from canopy height (metres); world units are 10 m.
export function setTreeHeight(points, heightM, lai = 5, refM = 34) {
  const u = points.material.uniforms, geo = points.geometry;
  const g = Math.min(1, Math.max(0.1, Math.pow(heightM / refM, 0.8)));
  const top = visibleTop(geo, g), H = heightM / 10;
  u.uGrowth.value = g;
  u.uTop.value = top;
  u.uSY.value = H / top;
  u.uSXZ.value = (H / top) * (0.42 + 0.58 * g);
  u.uLeaf.value = Math.min(1, 0.25 + lai / 6);
  return H;
}

export function createGround(px) {
  const geo = new THREE.PlaneGeometry(120, 120, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 1}, uTime: {value: 0}, uShade: {value: 0}},
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uOpacity, uShade; varying vec3 vW;
      float grid(vec2 p, float s){ vec2 g = p / s; vec2 w = fwidth(g); vec2 f = abs(fract(g - 0.5) - 0.5) / w; return 1.0 - min(min(f.x, f.y), 1.0); }
      void main(){
        float r = length(vW.xz);
        float fade = smoothstep(42.0, 4.0, r);
        float g = grid(vW.xz, 1.0) * 0.12 + grid(vW.xz, 5.0) * 0.22;
        vec3 base = mix(vec3(0.02, 0.07, 0.06), vec3(0.01, 0.025, 0.03), smoothstep(0.0, 30.0, r));
        float sh = uShade > 0.0 ? smoothstep(uShade, uShade * 0.2, r) : 0.0;  // shade under a crown of radius uShade
        vec3 col = base * (1.0 - 0.45 * sh) + vec3(0.25, 0.9, 0.6) * g * fade * (1.0 - 0.7 * sh);
        gl_FragColor = vec4(col, uOpacity * (0.25 + 0.75 * fade));
      }`,
    transparent: true, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

export function createMotes(count, px) {
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 26;
    pos.set([Math.cos(a) * r, Math.random() * 10, Math.sin(a) * r], i * 3);
    rnd[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uOpacity: {value: 1}, uPx: {value: px}, uProj: {value: 1000}},
    vertexShader: `attribute float aRnd; uniform float uTime; uniform float uPx; uniform float uProj; varying float vA;
      void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.08 + aRnd * 0.12), 10.0); p.x += sin(uTime * 0.3 + aRnd * 20.0) * 0.4;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
      vA = smoothstep(0.0, 1.5, p.y) * smoothstep(10.0, 7.0, p.y) * (0.3 + 0.7 * aRnd);
      gl_PointSize = uPx * (0.6 + aRnd * 1.2) * 0.025 * uProj / -mv.z; }`,
    fragmentShader: `uniform float uOpacity; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.75, 1.0, 0.7, smoothstep(0.5, 0.0, d) * vA * uOpacity * 0.6); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}
