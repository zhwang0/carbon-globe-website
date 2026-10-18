// The scroll-driven film: hero globe -> one forest -> fifteen ages -> planet -> emulator -> numbers.
import * as THREE from '../assets/vendor/three.module.js';
import {createGlobe, createStars, facing, cellOf, latLonToVec3} from './globe.js';
import {treeGeometry, treeMaterial, setTreeHeight, createGround, createMotes, mulberry32} from './tree.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const ease = t => (t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const AGES = [1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const DIVE_ALT = 0.2;

// Interpolate a 41-element annual series at fractional year index.
const at = (series, y) => { const i = Math.floor(y), f = y - i; return i >= 40 ? series[40] : series[i] * (1 - f) + series[i + 1] * f; };

// Year index (0..40) of the forest chapters as a function of film position u.
function forestYear(u) {
  if (u < 2.15) return 0;
  if (u < 3.45) return 40 * (u - 2.15) / 1.3;
  if (u < 3.5) return 40;
  if (u < 3.85) return 40 * (1 - ss(3.5, 3.85, u));
  if (u < 3.95) return 0;
  return 40 * clamp((u - 3.95) / 1.0);
}

// ------------------------------------------------------------------ network
function createNetwork(px) {
  const spec = [
    {rows: 12, depth: 1, x: -1, span: 0.66, color: [0.21, 0.78, 0.96]},
    {rows: 16, depth: 1, x: -0.5, span: 0.78, color: [0.24, 0.88, 0.56]},
    {rows: 16, depth: 1, x: 0, span: 0.78, color: [0.24, 0.88, 0.56]},
    {rows: 12, depth: 1, x: 0.5, span: 0.66, color: [0.24, 0.88, 0.56]},
    {rows: 7, depth: 1, x: 1, span: 0.42, color: [0.73, 0.96, 0.42]},
  ];
  const rng = mulberry32(7);
  const layers = spec.map(s => {
    const nodes = [];
    for (let r = 0; r < s.rows; r++) for (let d = 0; d < s.depth; d++) {
      nodes.push(new THREE.Vector3(s.x, lerp(s.span, -s.span, r / (s.rows - 1)), (rng() - 0.5) * 0.12));
    }
    return {...s, nodes};
  });
  const nodePos = [], nodeCol = [], nodeRnd = [];
  layers.forEach(l => l.nodes.forEach(p => { nodePos.push(p.x, p.y, p.z); nodeCol.push(...l.color); nodeRnd.push(rng()); }));
  const edges = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const A = layers[i].nodes, B = layers[i + 1].nodes;
    A.forEach(a => { for (let k = 0; k < 4; k++) edges.push([a, B[Math.floor(rng() * B.length)]]); });
    B.forEach(b => edges.push([A[Math.floor(rng() * A.length)], b]));
  }
  const ePos = new Float32Array(edges.length * 6), eCol = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], i) => {
    ePos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    eCol.set([0.2, 0.7, 0.85, 0.5, 0.95, 0.55], i * 6);
  });
  const group = new THREE.Group();

  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
  const eMat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 0}},
    vertexShader: `attribute vec3 color; varying vec3 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uOpacity; varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 0.09 * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.LineSegments(eGeo, eMat));

  const nGeo = new THREE.BufferGeometry();
  nGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodePos, 3));
  nGeo.setAttribute('color', new THREE.Float32BufferAttribute(nodeCol, 3));
  nGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(nodeRnd, 1));
  const nMat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 0}, uTime: {value: 0}, uPx: {value: px}, uScale: {value: 1}},
    vertexShader: `attribute vec3 color; attribute float aRnd; uniform float uTime; uniform float uPx; uniform float uScale; varying vec3 vC; varying float vB;
      void main(){ vC = color; vB = 0.55 + 0.45 * sin(uTime * 2.2 + aRnd * 20.0 + position.x * 3.0);
      vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * uScale * 30.0 / -mv.z; }`,
    fragmentShader: `uniform float uOpacity; varying vec3 vC; varying float vB;
      void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.2, 0.1, d); float halo = smoothstep(0.5, 0.0, d) * 0.45;
      gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.6), (core + halo * vB) * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(nGeo, nMat));

  const P = 700, pA = new Float32Array(P * 3), pB = new Float32Array(P * 3), pPh = new Float32Array(P);
  for (let i = 0; i < P; i++) {
    const [a, b] = edges[Math.floor(rng() * edges.length)];
    pA.set([a.x, a.y, a.z], i * 3); pB.set([b.x, b.y, b.z], i * 3); pPh[i] = rng();
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pA, 3));
  pGeo.setAttribute('aB', new THREE.BufferAttribute(pB, 3));
  pGeo.setAttribute('aPh', new THREE.BufferAttribute(pPh, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 0}, uTime: {value: 0}, uPx: {value: px}, uScale: {value: 1}},
    vertexShader: `attribute vec3 aB; attribute float aPh; uniform float uTime; uniform float uPx; uniform float uScale; varying float vA; varying float vX;
      void main(){ float t = fract(uTime * 0.55 + aPh); vec3 p = mix(position, aB, t); vA = sin(3.14159 * t); vX = p.x;
      vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * uScale * 13.0 / -mv.z; }`,
    fragmentShader: `uniform float uOpacity; varying float vA; varying float vX;
      void main(){ float d = length(gl_PointCoord - 0.5); vec3 c = mix(vec3(0.3, 0.85, 1.0), vec3(0.8, 1.0, 0.5), clamp(vX * 0.5 + 0.5, 0.0, 1.0));
      gl_FragColor = vec4(c, smoothstep(0.5, 0.0, d) * vA * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(pGeo, pMat));
  return {group, layers, mats: [eMat, nMat, pMat]};
}

// Particles flowing from land cells on the globe into the network's input layer.
function createStreams(zones, inputs, px, count) {
  const cells = [];
  for (let i = 0; i < zones.data.length; i += 7) if (zones.data[i]) cells.push(i);
  const rng = mulberry32(11), v = new THREE.Vector3();
  const dir = new Float32Array(count * 3), end = new Float32Array(count * 3), ph = new Float32Array(count), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const c = cells[Math.floor(rng() * cells.length)], row = Math.floor(c / 720), col = c % 720;
    latLonToVec3(89.75 - row * 0.5, -179.75 + col * 0.5, 1, v);
    dir.set([v.x, v.y, v.z], i * 3);
    const e = inputs[Math.floor(rng() * inputs.length)];
    end.set([e.x, e.y, e.z], i * 3);
    ph[i] = rng(); rnd[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 3));
  geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 0}, uTime: {value: 0}, uPx: {value: px}, uGlobeM: {value: new THREE.Matrix4()}, uNetM: {value: new THREE.Matrix4()}},
    vertexShader: `attribute vec3 aEnd; attribute float aPh; attribute float aRnd;
      uniform float uTime; uniform float uPx; uniform mat4 uGlobeM; uniform mat4 uNetM; varying float vA; varying float vT;
      void main(){
        vec3 p0 = (uGlobeM * vec4(position * 1.012, 1.0)).xyz;
        vec3 p2 = (uNetM * vec4(aEnd, 1.0)).xyz;
        vec3 p1 = mix(p0, p2, 0.45) + vec3(0.0, (aRnd - 0.5) * 0.8, 0.35);
        float t = fract(uTime * (0.16 + aRnd * 0.1) + aPh);
        vec3 p = mix(mix(p0, p1, t), mix(p1, p2, t), t);
        vT = t; vA = pow(sin(3.14159 * t), 0.7);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.5 + aRnd * 2.5) * 3.2 / -mv.z;
      }`,
    fragmentShader: `uniform float uOpacity; varying float vA; varying float vT;
      void main(){ float d = length(gl_PointCoord - 0.5); vec3 c = mix(vec3(0.73, 0.96, 0.42), vec3(0.25, 0.8, 1.0), vT);
      gl_FragColor = vec4(c, smoothstep(0.5, 0.0, d) * vA * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ------------------------------------------------------------------ stage
export function createStage({canvas, meta, tex, dom, mobile, reduced = false}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
  renderer.setClearColor(0x050a0c, 1);
  renderer.autoClear = false;
  const px = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(px);

  const story = meta.story.amazon;
  const target = cellOf(story.lat, story.lon);
  const targetRot = facing(story.lat, story.lon);

  // globe scene
  const gScene = new THREE.Scene();
  const gCam = new THREE.PerspectiveCamera(35, 1, 0.005, 200);
  const G = createGlobe({day: tex.day, mask: tex.mask, zones: tex.zones.tex, data: tex.height.tex, segments: mobile ? 160 : 224});
  G.uniforms.uTarget.value.set(target.col, target.row);
  G.globe.renderOrder = 1; G.atmo.renderOrder = 2;
  const stars = createStars(mobile ? 1400 : 2800);
  stars.material.uniforms.uPx.value = px;
  gScene.add(stars, G.group);
  const net = createNetwork(px);
  gScene.add(net.group);
  const streams = createStreams(tex.zones, net.layers[0].nodes, px, mobile ? 700 : 1400);
  streams.renderOrder = 3;
  gScene.add(streams);

  // forest scene
  const fScene = new THREE.Scene();
  const fCam = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 0}},
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform float uOpacity; varying vec2 vUv;
      void main(){ vec3 top = vec3(0.03, 0.09, 0.09), bot = vec3(0.012, 0.03, 0.035);
      vec3 c = mix(bot, top, smoothstep(0.1, 0.95, vUv.y)) + vec3(0.04, 0.12, 0.08) * exp(-pow((vUv.y - 0.42) * 4.0, 2.0)) * 0.5;
      gl_FragColor = vec4(c, uOpacity); }`,
    depthTest: false, depthWrite: false, transparent: true,
  }));
  bg.frustumCulled = false; bg.renderOrder = -10;
  fScene.add(bg);
  const ground = createGround(px);
  ground.renderOrder = -5;
  fScene.add(ground);
  const motes = createMotes(mobile ? 400 : 900, px);
  fScene.add(motes);

  const mainGeo = treeGeometry(1, mobile ? 26000 : 46000);
  const main = new THREE.Points(mainGeo, treeMaterial(px));
  fScene.add(main);
  const cohortGeos = [2, 3, 4, 5, 6, 7].map(s => treeGeometry(s, mobile ? 4200 : 7500));
  const cohorts = [];
  const rng = mulberry32(5);
  AGES.forEach((age, gi) => {
    const r = gi === 0 ? 0 : 3.3 * Math.sqrt(gi + 0.4), th = gi * 2.39996 + 0.6;
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    const trees = [];
    const n = gi === 0 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2, rr = gi === 0 ? 1.3 + rng() * 0.5 : 0.35 + rng() * 0.9;
      const p = new THREE.Points(cohortGeos[Math.floor(rng() * cohortGeos.length)], treeMaterial(px));
      p.position.set(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr);
      p.rotation.y = rng() * Math.PI * 2;
      p.userData.scale = 0.88 + rng() * 0.2;
      fScene.add(p);
      trees.push(p);
    }
    cohorts.push({age, cx, cz, trees, label: null});
  });
  main.rotation.y = 0.4;

  // cohort bars + labels (DOM)
  dom.bars.innerHTML = AGES.map(a => `<div><i></i><span>${a}</span></div>`).join('');
  const barEls = [...dom.bars.querySelectorAll('i')];
  dom.cohortLabels.innerHTML = AGES.map(a => `<span>${a} yr</span>`).join('');
  const labelEls = [...dom.cohortLabels.children];
  const netLabelEls = Object.fromEntries([...dom.netLabels.children].map(el => [el.dataset.k, el]));

  // interaction: drag the hero globe
  const drag = {active: false, x: 0, y: 0, vy: 0, dy: 0, tilt: 0};
  let heroY = facing(15, -35).y, heroTilt = 0.3;
  let u = 0;
  canvas.addEventListener('pointerdown', e => {
    if (u > 0.5) return;
    drag.active = true; drag.x = e.clientX; drag.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    canvas.style.cursor = u < 0.5 ? (drag.active ? 'grabbing' : 'grab') : '';
    if (!drag.active) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    heroY += dx * 0.006; drag.vy = dx * 0.006;
    heroTilt = clamp(heroTilt + dy * 0.004, -0.6, 0.9);
  });
  const end = () => { drag.active = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // layout
  let W = 1, H = 1, aspect = 1;
  const L = {};
  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight; aspect = W / H;
    renderer.setSize(W, H, false);
    gCam.aspect = fCam.aspect = aspect;
    gCam.updateProjectionMatrix(); fCam.updateProjectionMatrix();
    const proj = H * 0.5 / Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2);
    fScene.traverse(o => { if (o.material?.uniforms?.uProj) o.material.uniforms.uProj.value = proj; });
    const t = Math.tan(THREE.MathUtils.degToRad(gCam.fov) / 2);
    const narrow = aspect < 0.85;
    // hero: globe to the right of the title (or above it on phones)
    const dh = 4.2, hh = dh * t, hw = hh * aspect;
    L.hero = narrow ? {x: 0, y: hh * 0.4, s: Math.min(0.9, hw * 0.85), d: dh} : {x: hw * 0.5, y: 0, s: 0.95, d: dh};
    L.planet = narrow ? {x: 0, y: -hh * 0.18, s: Math.min(0.9, hw * 0.85), d: dh} : {x: hw * 0.36, y: 0, s: 1, d: dh};
    // emulator: globe left, network right
    const dn = 4.4, nh = dn * t, nw = nh * aspect;
    L.net = narrow
      ? {gx: -nw * 0.5, gy: -nh * 0.42, gs: nw * 0.36, nx: nw * 0.42, ny: -nh * 0.42, ns: nw * 0.36, d: dn}
      : {gx: -nw * 0.55, gy: -nh * 0.3, gs: Math.min(nh * 0.44, nw * 0.28), nx: nw * 0.36, ny: -nh * 0.1, ns: nw * 0.4, d: dn};
    L.fc = narrow ? {gx: 0, gy: nh * 0.1, gs: nw * 0.6} : {gx: -nw * 0.62, gy: -nh * 0.62, gs: nh * 0.62};
    L.narrow = narrow;
  }
  resize();

  const tmp = new THREE.Vector3();
  function project(v, cam) {
    tmp.copy(v).project(cam);
    return {x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, z: tmp.z};
  }
  const amazon = story.ages;

  let last = performance.now(), time = 0;
  function render(uNow, tFixed) {
    u = uNow;
    let dt;
    if (tFixed !== undefined) { dt = Math.max(0, tFixed - time); time = tFixed; }
    else { const now = performance.now(); dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt; }

    // ---------- globe state (a chain of eased keyframes)
    // Turn to the Amazon first, then fly straight down onto the highlighted cell.
    const kDive = ease(ss(0.55, 1.95, u)), kRot = ease(ss(0.55, 1.45, u));
    if (!drag.active) { heroY += (reduced ? 0 : dt * 0.06 * (1 - kRot)) + drag.vy; drag.vy *= 0.92; }
    let rx = lerp(heroTilt, targetRot.x, kRot);
    let ry = heroY + wrapPi(targetRot.y - heroY) * kRot;
    let alt = Math.exp(lerp(Math.log(L.hero.d - 1), Math.log(DIVE_ALT), kDive));
    let gx = lerp(L.hero.x, 0, kRot), gy = lerp(L.hero.y, 0, kRot), gs = lerp(L.hero.s, 1, kRot);
    if (u > 5.0) {
      // pull back out to the planet, settling right of the caption
      const kOut = ease(ss(5.15, 5.85, u));
      alt = Math.exp(lerp(Math.log(DIVE_ALT), Math.log(L.planet.d - 1), kOut));
      rx = lerp(targetRot.x, 0.32, kOut);
      ry = targetRot.y + kOut * 0.7 + Math.max(0, u - 5.85) * 0.3;
      gx = lerp(0, L.planet.x, kOut); gy = lerp(0, L.planet.y, kOut); gs = lerp(1, L.planet.s, kOut);
    }
    let dist = 1 + alt;
    const kNet = ease(ss(6.45, 7.0, u)), kFc = ease(ss(8.0, 8.45, u)), kNum = ease(ss(9.2, 9.65, u));
    if (u > 6.0) {
      dist = lerp(dist, L.net.d, kNet);
      gx = lerp(gx, L.net.gx, kNet); gy = lerp(gy, L.net.gy, kNet); gs = lerp(gs, L.net.gs, kNet);
      gx = lerp(gx, L.fc.gx, kFc); gy = lerp(gy, L.fc.gy, kFc); gs = lerp(gs, L.fc.gs, kFc);
      dist = lerp(dist, 4.3, kNum); gx = lerp(gx, 0, kNum); gy = lerp(gy, 0, kNum); gs = lerp(gs, L.narrow ? 0.95 : 1.3, kNum);
    }
    G.group.position.set(gx, gy, 0);
    G.group.scale.setScalar(gs);
    G.spin.rotation.set(rx, ry, 0, 'XYZ');
    gCam.position.set(0, 0, dist);
    gCam.lookAt(0, 0, 0);
    gCam.near = Math.max(0.002, (dist - gs) * 0.3);
    gCam.updateProjectionMatrix();

    const U = G.uniforms;
    U.uTime.value = time;
    const zoneMix = ss(5.7, 5.85, u) * (1 - ss(5.98, 6.1, u));
    U.uZoneMix.value = zoneMix * 0.8;
    // Near the surface, let the satellite imagery show through the data layer.
    const surface = ss(1.15, 1.7, u) * (1 - ss(5.35, 5.7, u));
    U.uDataMix.value = (1 - zoneMix * 0.85) * (1 - 0.6 * surface);
    U.uYear.value = u < 5.95 ? 40 : 40 * ss(6.06, 6.55, u);
    U.uGridMix.value = u > 0.9 && u < 5.6 ? 1 : 0;
    U.uTargetMix.value = ss(1.4, 1.75, u) * (1 - ss(5.3, 5.55, u));
    U.uDim.value = lerp(1, 0.45, kNum) * lerp(1, 0.6, kFc * (1 - kNum));
    G.atmoUniforms.uOpacity.value = clamp((dist / gs - 1.25) / 0.6);
    G.atmoUniforms.uCenter.value.copy(G.group.position);
    stars.material.uniforms.uTime.value = time;
    stars.rotation.y = time * 0.004;

    // network & streams
    const netA = ss(6.75, 7.1, u) * (1 - 0.7 * ss(8.1, 8.35, u)) * (1 - ss(9.15, 9.4, u));
    net.group.visible = netA > 0.002;
    net.group.position.set(L.net.nx, L.net.ny, 0);
    net.group.scale.setScalar(L.net.ns);
    net.group.rotation.set(0.05 * Math.sin(time * 0.3), -0.12 + 0.08 * Math.sin(time * 0.2), 0);
    net.mats.forEach(m => { m.uniforms.uOpacity.value = netA; if (m.uniforms.uTime) m.uniforms.uTime.value = time; if (m.uniforms.uScale) m.uniforms.uScale.value = L.net.ns; });
    const strA = ss(6.95, 7.3, u) * (1 - ss(8.05, 8.4, u));
    streams.visible = strA > 0.002;
    G.group.updateMatrixWorld(); net.group.updateMatrixWorld();
    streams.material.uniforms.uOpacity.value = strA;
    streams.material.uniforms.uTime.value = time;
    streams.material.uniforms.uGlobeM.value.copy(G.spin.matrixWorld);
    streams.material.uniforms.uNetM.value.copy(net.group.matrixWorld);

    // ---------- forest state
    const fA = ss(1.9, 2.06, u) * (1 - ss(5.08, 5.26, u));
    const year = forestYear(u);
    const hMain = at(amazon['1'].height, year), lai = at(amazon['1'].lai, year);
    const Hm = setTreeHeight(main, hMain, lai);
    const cohortA = ss(3.85, 4.1, u);
    cohorts.forEach((c, gi) => {
      const h = at(amazon[String(c.age)].height, year), l = at(amazon[String(c.age)].lai, year);
      c.h = h;
      c.trees.forEach(t => {
          setTreeHeight(t, h * t.userData.scale, l);
        t.material.uniforms.uOpacity.value = cohortA * fA;
        t.visible = cohortA * fA > 0.002;
      });
    });
    const sharedT = fScene.children;
    for (const o of sharedT) if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = time;
    main.material.uniforms.uOpacity.value = fA;
    ground.material.uniforms.uOpacity.value = fA;
    motes.material.uniforms.uOpacity.value = fA;
    bg.material.uniforms.uOpacity.value = fA;

    // forest camera
    const az = 0.5 + (u - 1.9) * 0.42;
    const rA = 1.3 + Hm * 2.4, cyA = 0.25 + Hm * 0.42, tyA = Hm * 0.5;
    const b = ease(ss(3.85, 4.4, u)), c = ease(ss(4.85, 5.25, u));
    const r = lerp(lerp(rA, mobile ? 27 : 22, b), 3, c);
    const cy = lerp(lerp(cyA, 8, b), 48, c);
    const ty = lerp(lerp(tyA, 1.5, b), 0, c);
    fCam.position.set(Math.cos(az) * r, cy, Math.sin(az) * r);
    fCam.lookAt(0, ty, 0);
    if (!L.narrow) {
      // slide camera and target sideways so the subject sits right of the caption
      const shift = Math.hypot(r, cy - ty) * Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2) * aspect * 0.15 * (1 - c);
      tmp.setFromMatrixColumn(fCam.matrixWorld, 0).multiplyScalar(-shift);
      fCam.position.add(tmp);
      fCam.lookAt(tmp.x, ty + tmp.y, tmp.z);
    }

    // ---------- draw
    renderer.clear();
    if (fA < 0.999) renderer.render(gScene, gCam);
    if (fA > 0.001) { renderer.clearDepth(); renderer.render(fScene, fCam); }

    // ---------- DOM overlays
    dom.flash.style.opacity = (ss(1.75, 1.96, u) * (1 - ss(1.98, 2.25, u)) * 0.55 + ss(5.02, 5.14, u) * (1 - ss(5.18, 5.4, u)) * 0.3).toFixed(3);
    const yr = Math.round(year);
    dom.treeYear.textContent = 1981 + yr;
    dom.cohortYear.textContent = 1981 + yr;
    dom.treeH.textContent = at(amazon['1'].height, year).toFixed(1);
    dom.treeAgb.textContent = at(amazon['1'].agb, year).toFixed(1);
    dom.treeLai.textContent = lai.toFixed(1);
    cohorts.forEach((c, i) => { barEls[i].style.height = `${clamp(c.h / 34) * 100}%`; });
    dom.globeYear.textContent = 1981 + Math.round(U.uYear.value);
    dom.zoneLegend.style.opacity = zoneMix.toFixed(3);
    dom.globeGrowth.style.opacity = (1 - zoneMix).toFixed(3);

    const labA = ss(4.1, 4.35, u) * (1 - ss(4.8, 4.95, u));
    cohorts.forEach((c, i) => {
      const el = labelEls[i];
      if (labA < 0.01) { el.style.opacity = 0; return; }
      const p = project(tmp.set(c.cx, c.h / 10 + 0.5, c.cz), fCam);
      el.style.opacity = p.z < 1 ? labA : 0;
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    });

    const nlA = ss(6.95, 7.2, u) * (1 - ss(7.85, 8.05, u));
    const lay = net.layers;
    const anchors = {in: [lay[0], 1, 'right'], mid: [lay[2], 1, 'center'], out: [lay[4], -1, 'left']};
    for (const [k, [layer, side]] of Object.entries(anchors)) {
      const el = netLabelEls[k];
      if (!el) continue;
      if (nlA < 0.01) { el.style.opacity = 0; continue; }
      const top = layer.span + 0.16;
      const wp = net.group.localToWorld(tmp.set(layer.x, k === 'mid' ? top : -top - 0.05, 0));
      const p = project(wp, gCam);
      el.style.opacity = nlA;
      const tx = k === 'in' ? '-30%' : k === 'out' ? '-70%' : '-50%';
      const ty2 = k === 'mid' ? '-100%' : '0%';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(${tx}, ${ty2})`;
    }
  }

  return {render, resize, renderer, dispose() { renderer.dispose(); }};
}
