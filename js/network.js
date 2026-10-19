// The deep-learning emulator as an annotated architecture: monthly climate forcing and the current
// forest state go in, an encoder embeds them, a sequence model reads the twelve months, one head per
// target predicts next year's forest state, and that prediction is fed back as the next input: the
// autoregressive rollout CarbonGlobe's benchmarks evaluate over 40 years.
import * as THREE from '../assets/vendor/three.module.js';
import {mulberry32} from './random.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// Layout in network space; the stage scales and places the group.
export const NET = {
  forcing: {x: -1.2, y: 0.4},      // centre of the input tensor
  state: {x: -1.2, y: -0.42},      // centre of the forest-state bars
  enc: [-0.66, -0.36],             // x of the two encoder slabs
  core: {x0: -0.02, x1: 0.58, y: 0.02},
  heads: 0.86,
  next: {x: 1.22, y: 0.0},
  tree: {x: -1.72, y: -0.62},       // the initial forest
};
// Order in which the parts appear (0..1 of the chapter's build-up).
const STAGES = {inputs: 0, enc: 0.18, core: 0.36, heads: 0.54, next: 0.66, loop: 0.8};
const DRIVERS = ['#ff8a5c', '#35c6f4', '#ffd166', '#5fe0d0', '#a9bccb', '#b9f46b', '#c49a6c'];   // temp, rain, radiation, humidity, wind, CO2, soil
const TARGETS = ['#b9f46b', '#7fe27a', '#c49a6c', '#3ee08f', '#5fe0d0', '#35c6f4', '#f59e0b'];   // height, AGB, soil C, LAI, GPP, NPP, Rh

const POINT_VERT = /* glsl */`
attribute vec3 color;
attribute vec4 aP;            // size, stage, square (1) or round (0), random
uniform float uTime, uPx, uScale, uBuild, uOpacity;
varying vec3 vC;
varying float vA, vSq;
void main() {
  float on = smoothstep(aP.y, aP.y + 0.12, uBuild);
  vC = color;
  vA = on * uOpacity * (0.75 + 0.25 * sin(uTime * 2.1 + aP.w * 30.0));
  vSq = aP.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * uScale * aP.x * (0.6 + 0.4 * on) / -mv.z;
}`;
const POINT_FRAG = /* glsl */`
varying vec3 vC;
varying float vA, vSq;
void main() {
  vec2 q = abs(gl_PointCoord - 0.5);
  float d = vSq > 0.5 ? max(q.x, q.y) : length(q);
  float core = smoothstep(0.42, 0.3, d), halo = smoothstep(0.5, 0.0, length(q)) * 0.35;
  gl_FragColor = vec4(vC * (core + halo) * vA, 1.0);
}`;
const LINE_VERT = /* glsl */`
attribute vec3 color;
attribute vec2 aL;            // stage, position along the line (for the dash)
uniform float uBuild;
varying vec3 vC;
varying float vOn, vS;
void main() {
  vC = color;
  vOn = smoothstep(aL.x, aL.x + 0.12, uBuild);
  vS = aL.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const LINE_FRAG = /* glsl */`
uniform float uOpacity, uTime, uDash, uAlpha;
varying vec3 vC;
varying float vOn, vS;
void main() {
  float dash = uDash > 0.0 ? step(0.45, fract(vS * uDash - uTime * 0.8)) : 1.0;
  gl_FragColor = vec4(vC * vOn * uOpacity * uAlpha * dash, 1.0);
}`;
const FLOW_VERT = /* glsl */`
attribute vec3 aB, aC;        // control and end points of a quadratic path from position
attribute vec4 aF;            // phase, speed, stage, size
uniform float uTime, uPx, uScale, uBuild;
varying float vA;
varying vec3 vCol;
void main() {
  float t = fract(uTime * aF.y + aF.x);
  vec3 p = mix(mix(position, aB, t), mix(aB, aC, t), t);
  vA = smoothstep(aF.z, aF.z + 0.12, uBuild) * sin(3.14159 * t);
  vCol = mix(vec3(0.35, 0.85, 1.0), vec3(0.75, 1.0, 0.45), t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * uScale * aF.w / -mv.z;
}`;
const FLOW_FRAG = /* glsl */`
uniform float uOpacity;
varying float vA;
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vCol * smoothstep(0.5, 0.0, d) * vA * uOpacity, 1.0);
}`;
const SLAB_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SLAB_FRAG = /* glsl */`
uniform float uOpacity, uOn, uTime;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  // rounded glass panel: bright rim, faint fill and a slow scan line
  vec2 p = (vUv - 0.5) * uSize, b = uSize * 0.5 - 0.03;
  float d = length(max(abs(p) - b, 0.0)) - 0.03;
  float rim = smoothstep(0.012, 0.0, abs(d)), fill = step(d, 0.0) * 0.07;
  float scan = step(d, 0.0) * smoothstep(0.03, 0.0, abs(fract(vUv.y - uTime * 0.12) - 0.5)) * 0.18;
  gl_FragColor = vec4(vec3(0.24, 0.88, 0.56) * (rim * 0.75 + fill + scan) * uOpacity * uOn, 1.0);
}`;

function additive(shaders, uniforms) {
  return new THREE.ShaderMaterial({...shaders, uniforms, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor});
}

export function createEmulator(px) {
  const rng = mulberry32(17);
  const group = new THREE.Group();
  const shared = {uTime: {value: 0}, uPx: {value: px}, uScale: {value: 1}, uBuild: {value: 0}, uOpacity: {value: 0}};
  const col = new THREE.Color();
  const pts = {pos: [], color: [], p: []};
  const point = (x, y, z, hex, size, stage, square = 1) => {
    col.set(hex);
    pts.pos.push(x, y, z); pts.color.push(col.r, col.g, col.b); pts.p.push(size, stage, square, rng());
    return new THREE.Vector3(x, y, z);
  };
  const lines = {pos: [], color: [], l: []};
  const line = (a, b, hex, stage, s0 = 0, s1 = 1) => {
    col.set(hex);
    lines.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    lines.color.push(col.r, col.g, col.b, col.r, col.g, col.b);
    lines.l.push(stage, s0, stage, s1);
  };

  // inputs: the forcing tensor (12 months x driver groups, two deep) and the forest-state bars
  const forcing = [];
  for (let m = 0; m < 12; m++) for (let r = 0; r < DRIVERS.length; r++) for (let z = 0; z < 2; z++) {
    forcing.push(point(NET.forcing.x + (m - 5.5) * 0.042, NET.forcing.y + (r - 3) * 0.046, (z - 0.5) * 0.05,
      DRIVERS[r], 15, STAGES.inputs));
  }
  const state = [], next = [];
  const bars = (cx, cy, stage, out) => TARGETS.forEach((hex, i) => {
    const h = 3 + Math.round(rng() * 4);
    for (let k = 0; k < 8; k++) {
      const v = point(cx + (i - 3) * 0.058, cy - 0.17 + k * 0.045, 0, hex, k < h ? 15 : 7, stage);
      if (k === 0) out.push(v);
    }
  });
  bars(NET.state.x, NET.state.y, STAGES.inputs, state);
  bars(NET.next.x, NET.next.y, STAGES.next, next);

  // encoder: two glass slabs of units
  const slabs = [], enc = [[], []];
  NET.enc.forEach((x, s) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.98), additive({vertexShader: SLAB_VERT, fragmentShader: SLAB_FRAG},
      {uOpacity: shared.uOpacity, uTime: shared.uTime, uOn: {value: 0}, uSize: {value: new THREE.Vector2(0.34, 0.98)}}));
    mesh.position.set(x, 0, 0);
    mesh.rotation.y = Math.PI / 2 * 0.82;
    group.add(mesh);
    slabs.push({mesh, stage: STAGES.enc + s * 0.06});
    for (let r = 0; r < 11; r++) for (let d = 0; d < 3; d++) {
      enc[s].push(point(x + (d - 1) * 0.05, (r - 5) * 0.08, (d - 1) * 0.09, '#3ee08f', 16, STAGES.enc + s * 0.06, 0));
    }
  });

  // sequence model: one token per month, with attention arcs between them
  const tokens = [];
  for (let m = 0; m < 12; m++) {
    const x = NET.core.x0 + (NET.core.x1 - NET.core.x0) * m / 11;
    tokens.push(point(x, NET.core.y, 0, '#5fe0d0', 26, STAGES.core));
  }
  const arcs = {pos: [], color: [], l: []};
  for (let k = 0; k < 30; k++) {
    const i = Math.floor(rng() * 11), j = Math.min(11, i + 1 + Math.floor(rng() * 6));
    const a = tokens[i], b = tokens[j], h = 0.07 + 0.05 * (j - i);
    let prev = null;
    for (let s = 0; s <= 16; s++) {
      const t = s / 16, p = new THREE.Vector3(a.x + (b.x - a.x) * t, NET.core.y + 0.03 + Math.sin(Math.PI * t) * h, 0);
      if (prev) {
        arcs.pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        arcs.color.push(0.37, 0.88, 0.82, 0.37, 0.88, 0.82);
        arcs.l.push(STAGES.core + 0.05, (s - 1) / 16, STAGES.core + 0.05, s / 16);
      }
      prev = p;
    }
  }

  // heads: one unit per target
  const heads = TARGETS.map((hex, i) => point(NET.heads, (3 - i) * 0.1, 0, hex, 20, STAGES.heads, 0));

  // connections
  const pick = a => a[Math.floor(rng() * a.length)];
  for (let k = 0; k < 70; k++) line(pick(forcing), pick(enc[0]), '#35c6f4', STAGES.enc);
  for (let k = 0; k < 40; k++) line(pick(state), pick(enc[0]), '#b9f46b', STAGES.enc);
  for (let k = 0; k < 80; k++) line(pick(enc[0]), pick(enc[1]), '#3ee08f', STAGES.enc + 0.06);
  for (let k = 0; k < 60; k++) line(pick(enc[1]), pick(tokens), '#3ee08f', STAGES.core);
  tokens.slice(8).forEach(t => heads.forEach(h => line(t, h, '#5fe0d0', STAGES.heads)));
  heads.forEach((h, i) => line(h, next[i], TARGETS[i], STAGES.next));

  // the feedback loop: next year's state goes back in as the forest-state input
  const loopPath = new THREE.CubicBezierCurve3(
    new THREE.Vector3(NET.next.x, NET.next.y - 0.22, 0), new THREE.Vector3(NET.next.x + 0.25, -1.05, 0),
    new THREE.Vector3(NET.state.x - 0.25, -1.05, 0), new THREE.Vector3(NET.state.x, NET.state.y - 0.22, 0));
  const loopPts = loopPath.getPoints(80);
  const loop = {pos: [], color: [], l: []};
  for (let i = 1; i < loopPts.length; i++) {
    const a = loopPts[i - 1], b = loopPts[i];
    loop.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    loop.color.push(0.73, 0.96, 0.42, 0.73, 0.96, 0.42);
    loop.l.push(STAGES.loop, (i - 1) / 80, STAGES.loop, i / 80);
  }
  // arrowhead into the state bars
  const tip = loopPts[loopPts.length - 1], back = loopPts[loopPts.length - 5];
  const dir = tip.clone().sub(back).normalize(), side = new THREE.Vector3(-dir.y, dir.x, 0);
  [1, -1].forEach(sg => {
    const w = tip.clone().addScaledVector(dir, -0.06).addScaledVector(side, 0.035 * sg);
    loop.pos.push(w.x, w.y, w.z, tip.x, tip.y, tip.z);
    loop.color.push(0.73, 0.96, 0.42, 0.73, 0.96, 0.42);
    loop.l.push(STAGES.loop, 0, STAGES.loop, 0);
  });

  // data in motion: pulses along the connections, and along the loop
  const flows = {a: [], b: [], c: [], f: []};
  const flow = (a, c, stage, n, lift = 0, speed = 0.5, size = 9) => {
    for (let k = 0; k < n; k++) {
      const b = a.clone().lerp(c, 0.5); b.y += lift;
      flows.a.push(a.x, a.y, a.z); flows.b.push(b.x, b.y, b.z); flows.c.push(c.x, c.y, c.z);
      flows.f.push(rng(), speed * (0.7 + 0.6 * rng()), stage, size);
    }
  };
  // the initial forest feeds the state input
  const treeTop = new THREE.Vector3(NET.tree.x, NET.tree.y + 0.36, 0);
  for (let k = 0; k < 24; k++) flow(treeTop, pick(state), STAGES.inputs, 1, 0.12, 0.35);
  for (let k = 0; k < 60; k++) flow(pick(forcing), pick(enc[0]), STAGES.enc, 1);
  for (let k = 0; k < 30; k++) flow(pick(state), pick(enc[0]), STAGES.enc, 1);
  for (let k = 0; k < 50; k++) flow(pick(enc[0]), pick(enc[1]), STAGES.enc + 0.06, 1);
  for (let k = 0; k < 50; k++) flow(pick(enc[1]), pick(tokens), STAGES.core, 1);
  for (let k = 0; k < 40; k++) flow(pick(tokens.slice(8)), pick(heads), STAGES.heads, 1);
  heads.forEach((h, i) => flow(h, next[i], STAGES.next, 4));
  for (let k = 0; k < 40; k++) {
    const t0 = rng(), p = loopPath.getPoint(t0);
    flows.a.push(p.x, p.y, p.z); flows.b.push(p.x, p.y, p.z); flows.c.push(p.x, p.y, p.z);
    flows.f.push(t0, 0, STAGES.loop, 12);
  }
  const nLoop = 40;

  const build = (data, attrs, mat, Kind) => {
    const g = new THREE.BufferGeometry();
    for (const [name, arr, size] of attrs) g.setAttribute(name, new THREE.Float32BufferAttribute(data[arr], size));
    const o = new Kind(g, mat);
    o.frustumCulled = false;
    group.add(o);
    return o;
  };
  const lineMat = (alpha, dash = 0) => additive({vertexShader: LINE_VERT, fragmentShader: LINE_FRAG},
    {uOpacity: shared.uOpacity, uTime: shared.uTime, uBuild: shared.uBuild, uAlpha: {value: alpha}, uDash: {value: dash}});
  build(lines, [['position', 'pos', 3], ['color', 'color', 3], ['aL', 'l', 2]], lineMat(0.13), THREE.LineSegments);
  const arcObj = build(arcs, [['position', 'pos', 3], ['color', 'color', 3], ['aL', 'l', 2]], lineMat(0.5), THREE.LineSegments);
  build(loop, [['position', 'pos', 3], ['color', 'color', 3], ['aL', 'l', 2]], lineMat(0.85, 18), THREE.LineSegments);
  build(pts, [['position', 'pos', 3], ['color', 'color', 3], ['aP', 'p', 4]],
    additive({vertexShader: POINT_VERT, fragmentShader: POINT_FRAG}, shared), THREE.Points);
  const flowObj = build(flows, [['position', 'a', 3], ['aB', 'b', 3], ['aC', 'c', 3], ['aF', 'f', 4]],
    additive({vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG}, shared), THREE.Points);

  // loop pulses ride the Bezier curve: recompute their three control points each frame
  const fa = flowObj.geometry.attributes, base = fa.position.count - nLoop, tmp = new THREE.Vector3();
  function update(time, build, opacity) {
    shared.uTime.value = time;
    shared.uBuild.value = build;
    shared.uOpacity.value = opacity;
    slabs.forEach(s => { s.mesh.material.uniforms.uOn.value = ss(s.stage, s.stage + 0.12, build); });
    // attention arcs flicker as if weights change
    arcObj.material.uniforms.uAlpha.value = 0.35 + 0.15 * Math.sin(time * 3.1);
    for (let k = 0; k < nLoop; k++) {
      const t = (flows.f[(base + k) * 4] - time * 0.12 + 10) % 1;
      loopPath.getPoint(1 - t, tmp);
      fa.position.setXYZ(base + k, tmp.x, tmp.y, tmp.z);
      fa.aB.setXYZ(base + k, tmp.x, tmp.y, tmp.z);
      fa.aC.setXYZ(base + k, tmp.x, tmp.y, tmp.z);
    }
    fa.position.needsUpdate = fa.aB.needsUpdate = fa.aC.needsUpdate = true;
  }
  return {group, update, shared, inputs: forcing, anchors: {
    title: new THREE.Vector3(0.1, 0.98, 0),
    forcing: new THREE.Vector3(NET.forcing.x - 0.06, NET.forcing.y + 0.2, 0),
    state: new THREE.Vector3(NET.state.x, NET.state.y - 0.27, 0),
    enc: new THREE.Vector3((NET.enc[0] + NET.enc[1]) / 2 + 0.04, 0.6, 0),
    core: new THREE.Vector3((NET.core.x0 + NET.core.x1) / 2, 0.42, 0),
    heads: new THREE.Vector3(NET.heads, -0.42, 0),
    next: new THREE.Vector3(NET.next.x, NET.next.y + 0.28, 0),
    loop: new THREE.Vector3(0, -1.1, 0),
    tree: new THREE.Vector3(NET.tree.x, NET.tree.y + 0.5, 0),
  }, stages: STAGES};
}
