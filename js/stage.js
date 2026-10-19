// The scroll-driven film: hero globe -> one forest -> four forcings -> fifteen ages -> planet -> emulator -> what if -> numbers.
import * as THREE from '../assets/vendor/three.module.js';
import {createGlobe, createStars, facing, cellOf, latLonToVec3} from './globe.js';
import {createGround, createMotes} from './forest.js';
import {mulberry32} from './random.js';
import {growTrees, treePoints, createFlames, PRE_TAU} from './hero-tree.js';
import {createEmulator, NET} from './network.js';

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
  if (u < 3.45) return 40 * (u - 2.15) / 1.3;          // one forest
  if (u < 3.55) return 40;
  if (u < 3.85) return 40 * (1 - ss(3.55, 3.85, u));   // back to 1981 as the view splits
  if (u < 3.9) return 0;
  if (u < 4.9) return 40 * (u - 3.9);                  // four forcings
  if (u < 5.05) return 40;
  if (u < 5.3) return 40 * (1 - ss(5.05, 5.3, u));     // back to 1981 as the views merge
  if (u < 5.4) return 0;
  return 40 * clamp(u - 5.4);                          // fifteen ages
}
// Split of the forest view into four: 0 = one view, 1 = four.
const splitK = u => ease(ss(3.5, 3.8, u)) * (1 - ease(ss(5.0, 5.25, u)));

// Particles flowing from land cells on the globe into the emulator's forcing input.
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
export function createStage({canvas, meta, scen, tex, dom, mobile, reduced = false}) {
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
  const net = createEmulator(px);
  gScene.add(net.group);
  const streams = createStreams(tex.zones, net.inputs, px, mobile ? 700 : 1400);
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

  // Trees, grown in a worker, in the order they appear: chapter one's tree from ED's canopy-height
  // series (it stays on as the cohort chapter's 1-year-old stand at the centre); the three other
  // forcings (the 2015 drought, a sketched fire that restarts the stand in 2003, boreal cold); then
  // sparser variants for the fifteen-age forest, grown along the same curve stretched to the tallest cohort.
  const h1 = story.ages['1'].height, dry = scen.drought.age1, cold = meta.story.boreal.ages['1'];
  const FIRE = 22;
  const VAR_HMAX = 31.5, varHeights = h1.map(h => h * VAR_HMAX / Math.max(...h1));
  const sp = mobile ? {leaf: 6, coarse: 1.4} : {leaf: 10, coarse: 1.15};
  const grown = growTrees([
    [{heights: h1, leaf: mobile ? 8 : 12}],
    [{heights: dry.height, seed: 21, ...sp}],
    [{heights: h1.slice(0, FIRE + 1), seed: 31, ...sp, span: FIRE / 40, burn: (FIRE + 0.3) / 40},
      {heights: h1.slice(0, 40 - FIRE), seed: 32, ...sp, t0: (FIRE + 1.2) / 40, span: (38.8 - FIRE) / 40}],
    [{heights: cold.height, seed: 41, form: 'conifer', ...sp}],
    ...[11, 12, 13, 14].map(seed => [{heights: varHeights, seed, coarse: mobile ? 2 : 1.7, leaf: mobile ? 4 : 6}]),
  ]);
  const hero = treePoints(grown.geos[0], px, {glow: true});
  // the emulator's initial forest: chapter one's tree, grown, standing beside the state input
  const miniTree = treePoints(grown.geos[0], px);
  miniTree.position.set(NET.tree.x, NET.tree.y - 0.04, 0);
  miniTree.scale.setScalar(0.42 / 30);
  miniTree.material.uniforms.uT.value = 1;
  miniTree.material.uniforms.uTop.value = Math.max(...h1);
  net.group.add(miniTree);
  let heroReady = false, panelsReady = false, cohortsReady = false;
  // where shaders can compile in parallel, prepare the forest now rather than on the dive's first frame
  grown.ready[0].then(() => {
    heroReady = true;
    if (renderer.extensions.has('KHR_parallel_shader_compile')) return renderer.compileAsync(fScene, fCam);
  }).catch(() => {});
  Promise.all(grown.ready.slice(1, 4)).then(() => { panelsReady = true; });
  Promise.all(grown.ready.slice(4)).then(() => { cohortsReady = true; });
  hero.scale.setScalar(0.1);
  hero.rotation.y = 0.4;
  fScene.add(hero);
  // foliage follows LAI relative to its recent maximum, so droughts thin the crowns
  const leafRatio = (lai, y) => {
    const i = Math.min(40, Math.floor(y)), m = Math.max(...lai.slice(Math.max(0, i - 5), i + 1));
    return m > 0.05 ? at(lai, y) / m : 1;
  };
  // growth clock of a variant tree that has reached height H (m); taller trees are scaled up instead
  const tauOfHeight = H => {
    if (H <= varHeights[0]) return PRE_TAU * clamp((varHeights[0] - H) / (varHeights[0] - 0.5));
    for (let i = 0; i < 40; i++) if (H <= varHeights[i + 1]) return (i + (H - varHeights[i]) / (varHeights[i + 1] - varHeights[i])) / 40;
    return 1;
  };

  const cohorts = [];
  const rng = mulberry32(5);
  AGES.forEach((age, gi) => {
    const r = gi === 0 ? 0 : 3.3 * Math.sqrt(gi + 0.4), th = gi * 2.39996 + 0.6;
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    const trees = [];
    const n = gi === 0 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2, rr = gi === 0 ? 1.3 + rng() * 0.5 : 0.35 + rng() * 0.9;
      const p = treePoints(grown.geos[4 + Math.floor(rng() * 4)], px);
      p.material.uniforms.uLight = hero.material.uniforms.uLight;
      p.position.set(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr);
      p.rotation.y = rng() * Math.PI * 2;
      p.userData.scale = 0.88 + rng() * 0.2;
      fScene.add(p);
      trees.push(p);
    }
    cohorts.push({age, cx, cz, trees, label: null});
  });

  // ---- four forcings: the same 1-year-old start under different weather, as four synchronised views
  const lai1 = story.ages['1'].lai, agb1 = story.ages['1'].agb;
  const afterFire = (arr, y) => at(arr, y <= FIRE ? y : Math.max(0, y - FIRE - 1));   // the stand restarts at age 1
  const dryLoss = Math.round(100 * (1 - dry.agb[35] / dry.agb[34]));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const where = s => `${Math.abs(s.lat).toFixed(2)}°${s.lat < 0 ? 'S' : 'N'}`;
  const panels = [
    {title: 'Warm & wet', color: '#b9f46b', sub: `${story.label} · ${story.temp_c} °C · ${fmt(story.precip_mm)} mm`,
      tree: hero, h: y => at(h1, y), agb: y => at(agb1, y)},
    {title: 'Drought', color: '#f5b544', sub: `${scen.drought.label}, ${where(scen.drought)} · ${scen.drought.temp_c} °C · ${fmt(scen.drought.precip_mm)} mm`,
      h: y => at(dry.height, y), agb: y => at(dry.agb, y), leaf: y => leafRatio(dry.lai, y), min: 0.04,
      note: y => (y >= 34.6 ? `2015 rain ${Math.round(scen.drought.precip_pct[34])}% of normal: the canopy sheds its leaves, biomass −${dryLoss}%` : '')},
    {title: 'Fire', tag: 'sketch', color: '#ff7a45', sub: `${story.label} run, burnt in ${1981 + FIRE} and restarted at age 1`,
      h: y => (y > FIRE && y < FIRE + 1 ? 0 : afterFire(h1, y)), agb: y => (y > FIRE && y < FIRE + 1 ? 0 : afterFire(agb1, y)),
      leaf: y => leafRatio(lai1, y <= FIRE ? y : Math.max(0, y - FIRE - 1)), min: 0.35, burn: (FIRE + 0.3) / 40,
      note: y => (y > FIRE ? 'A fire resets the clock: the stand starts again at age 1' : '')},
    {title: 'Cold', color: '#8fc7ff', sub: `${meta.story.boreal.label} · ${meta.story.boreal.temp_c} °C · ${fmt(meta.story.boreal.precip_mm)} mm`,
      h: y => at(cold.height, y), agb: y => at(cold.agb, y), tint: [0.6, 0.92, 0.86]},
  ];
  panels.forEach((P, i) => {
    P.cam = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
    if (i === 0) return;
    P.tree = treePoints(grown.geos[i], px, {glow: true});
    P.tree.scale.setScalar(0.1);
    P.tree.rotation.y = 0.4 + i * 1.7;
    if (P.tint) P.tree.material.uniforms.uTint.value.setRGB(...P.tint);
    if (P.burn) {
      P.tree.material.uniforms.uBurn.value = P.burn;
      P.flames = createFlames(px, mobile ? 300 : 600);
      P.flames.material.uniforms.uBurn.value = P.burn;
      P.tree.add(P.flames);
    }
    P.tree.visible = false;
    fScene.add(P.tree);
  });
  dom.panels.innerHTML = '<div class="panels-year"><small>Year</small><b>1981</b></div>' + panels.map(P => `<div class="panel" style="--pc:${P.color}">
    <p class="p-head"><b>${P.title}${P.tag ? `<i>${P.tag}</i>` : ''}</b><span>${P.sub}</span></p><p class="p-note"></p>
    <p class="p-stats"><span><small>Canopy height</small><b>0</b> m</span><span><small>Biomass</small><b>0</b> kgC m⁻²</span></p></div>`).join('');
  const panelYear = dom.panels.firstElementChild;
  panels.forEach((P, i) => {
    P.el = dom.panels.children[i + 1];
    [P.hEl, P.agbEl] = P.el.querySelectorAll('.p-stats b');
    P.noteEl = P.el.querySelector('.p-note');
  });
  // where each view sits: one shrinks out of the full screen, the others slide in after it
  function panelRects(k) {
    const cols = L.narrow ? 2 : 4, rows = L.narrow ? 2 : 1, gap = L.narrow ? 10 : 14;
    // the views fill the space below the chapter's caption
    const ax = L.narrow ? 16 : Math.round(W * 0.03), ay = Math.max(Math.round(H * (L.narrow ? 0.3 : 0.27)), L.capBottom + 18);
    const aw = W - 2 * ax, ah = H - ay - Math.round(H * 0.045);
    const w = (aw - gap * (cols - 1)) / cols, h = (ah - gap * (rows - 1)) / rows;
    return panels.map((_, i) => {
      const fin = {x: ax + (i % cols) * (w + gap), y: ay + Math.floor(i / cols) * (h + gap), w, h};
      const ki = i === 0 ? k : ss(0.15 + 0.12 * i, 0.7 + 0.1 * i, k);
      const from = i === 0 ? {x: 0, y: 0, w: W, h: H} : {...fin, x: fin.x + W * 0.3};
      return {x: lerp(from.x, fin.x, ki), y: lerp(from.y, fin.y, ki), w: lerp(from.w, fin.w, ki), h: lerp(from.h, fin.h, ki), k: ki};
    });
  }

  // cohort bars + labels (DOM)
  dom.bars.innerHTML = AGES.map(a => `<div><i></i><span>${a}</span></div>`).join('');
  const barEls = [...dom.bars.querySelectorAll('i')];
  dom.cohortLabels.innerHTML = AGES.map(a => `<span>${a} yr</span>`).join('');
  const labelEls = [...dom.cohortLabels.children];
  const netLabelEls = Object.fromEntries([...dom.netLabels.children].map(el => [el.dataset.k, el]));
  const BELOW = new Set(['state', 'heads', 'loop']);

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
    miniTree.material.uniforms.uProj.value = H * 0.5 / t;
    const narrow = aspect < 0.85;
    // hero: globe to the right of the title (or above it on phones)
    const dh = 4.2, hh = dh * t, hw = hh * aspect;
    L.hero = narrow ? {x: 0, y: hh * 0.4, s: Math.min(0.9, hw * 0.85), d: dh} : {x: hw * 0.5, y: 0, s: 0.95, d: dh};
    L.planet = narrow ? {x: 0, y: -hh * 0.18, s: Math.min(0.9, hw * 0.85), d: dh} : {x: hw * 0.36, y: 0, s: 1, d: dh};
    // emulator: globe left, network right
    const dn = 4.4, nh = dn * t, nw = nh * aspect;
    L.net = narrow
      ? {gx: 0, gy: nh * 0.08, gs: nw * 0.42, nx: nw * 0.06, ny: -nh * 0.5, ns: nw * 0.56, d: dn}
      : {gx: -nw * 0.62, gy: -nh * 0.3, gs: Math.min(nh * 0.4, nw * 0.25), nx: nw * 0.5, ny: -nh * 0.1, ns: nw * 0.29, d: dn};
    L.fc = narrow ? {gx: 0, gy: nh * 0.1, gs: nw * 0.6} : {gx: -nw * 0.62, gy: -nh * 0.62, gs: nh * 0.62};
    L.narrow = narrow;
    const cap = dom.forcingCap;
    L.capBottom = cap ? cap.offsetTop + cap.offsetHeight : 0;
    // narrow views get a one-line readout
    dom.panels.classList.toggle('compact', narrow || (W * 0.94 - 42) / 4 < 300);
  }
  resize();

  const tmp = new THREE.Vector3(), mainTgt = new THREE.Vector3();
  const PANEL_VIEW = 4.2;   // world units (10 m) of height each forcing view shows
  // key light from the upper left of a camera at azimuth az, slightly in front of the subject
  const keyLight = (v, az) => v.set(-Math.sin(az) * 0.55 + Math.cos(az) * 0.4, 0.75, Math.cos(az) * 0.55 + Math.sin(az) * 0.4).normalize();
  // Draw each forcing view into its own viewport, with only its tree visible.
  function drawPanels(rects) {
    const full = H * 0.5 / Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2);
    const trees = panels.map(P => P.tree), opacity = bg.material.uniforms.uOpacity.value;
    renderer.setScissorTest(true);
    rects.forEach((R, i) => {
      if (R.k < 0.002 || R.x >= W || R.w < 2) return;
      const P = panels[i];
      renderer.setViewport(R.x, H - R.y - R.h, R.w, R.h);
      renderer.setScissor(R.x, H - R.y - R.h, R.w, R.h);
      renderer.clear();
      trees.forEach(t => { t.visible = t === P.tree && (i === 0 ? heroReady : panelsReady); });
      P.cam.aspect = R.w / R.h;
      P.cam.updateProjectionMatrix();
      const proj = R.h * 0.5 / Math.tan(THREE.MathUtils.degToRad(P.cam.fov) / 2);
      P.tree.material.uniforms.uProj.value = proj;
      motes.material.uniforms.uProj.value = proj;
      if (P.flames) P.flames.material.uniforms.uProj.value = proj;
      ground.material.uniforms.uShade.value = Math.max(0.2, P.h(forestYear(u)) * 0.034);
      bg.material.uniforms.uOpacity.value = opacity * (i === 0 ? 1 : R.k);
      renderer.render(fScene, P.cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    hero.material.uniforms.uProj.value = full;
    motes.material.uniforms.uProj.value = full;
    bg.material.uniforms.uOpacity.value = opacity;
    trees.forEach(t => { t.visible = false; });
  }
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
    if (u > 6.45) {
      // pull back out to the planet, settling right of the caption
      const kOut = ease(ss(6.6, 7.3, u));
      alt = Math.exp(lerp(Math.log(DIVE_ALT), Math.log(L.planet.d - 1), kOut));
      rx = lerp(targetRot.x, 0.32, kOut);
      ry = targetRot.y + kOut * 0.7 + Math.max(0, u - 7.3) * 0.3;
      gx = lerp(0, L.planet.x, kOut); gy = lerp(0, L.planet.y, kOut); gs = lerp(1, L.planet.s, kOut);
    }
    let dist = 1 + alt;
    const kNet = ease(ss(7.9, 8.45, u)), kFc = ease(ss(9.45, 9.9, u)), kNum = ease(ss(10.65, 11.1, u));
    if (u > 7.45) {
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
    const zoneMix = ss(7.15, 7.3, u) * (1 - ss(7.43, 7.55, u));
    U.uZoneMix.value = zoneMix * 0.8;
    // Near the surface, let the satellite imagery show through the data layer.
    const surface = ss(1.15, 1.7, u) * (1 - ss(6.8, 7.15, u));
    U.uDataMix.value = (1 - zoneMix * 0.85) * (1 - 0.6 * surface);
    U.uYear.value = u < 7.4 ? 40 : 40 * ss(7.51, 8, u);
    U.uGridMix.value = u > 0.9 && u < 7.05 ? 1 : 0;
    U.uTargetMix.value = ss(1.4, 1.75, u) * (1 - ss(6.75, 7, u));
    U.uDim.value = lerp(1, 0.45, kNum) * lerp(1, 0.6, kFc * (1 - kNum));
    G.atmoUniforms.uOpacity.value = clamp((dist / gs - 1.25) / 0.6);
    G.atmoUniforms.uCenter.value.copy(G.group.position);
    stars.material.uniforms.uTime.value = time;
    stars.rotation.y = time * 0.004;

    // network & streams
    const netA = ss(8.2, 8.55, u) * (1 - 0.7 * ss(9.55, 9.8, u)) * (1 - ss(10.6, 10.85, u));
    net.group.visible = netA > 0.002;
    net.group.position.set(L.net.nx, L.net.ny, 0);
    net.group.scale.setScalar(L.net.ns);
    net.group.rotation.set(0.05 * Math.sin(time * 0.3), -0.12 + 0.08 * Math.sin(time * 0.2), 0);
    // the architecture builds up from its inputs to the feedback loop as the chapter plays
    const build = ss(8.3, 9.1, u);
    net.update(time, build, netA);
    net.shared.uScale.value = L.net.ns;
    miniTree.visible = heroReady;
    const MU = miniTree.material.uniforms;
    MU.uOpacity.value = netA; MU.uTime.value = time;
    keyLight(MU.uLight.value, 0.9);
    const strA = ss(8.4, 8.75, u) * (1 - ss(9.5, 9.85, u));
    streams.visible = strA > 0.002;
    G.group.updateMatrixWorld(); net.group.updateMatrixWorld();
    streams.material.uniforms.uOpacity.value = strA;
    streams.material.uniforms.uTime.value = time;
    streams.material.uniforms.uGlobeM.value.copy(G.spin.matrixWorld);
    streams.material.uniforms.uNetM.value.copy(net.group.matrixWorld);

    // ---------- forest state
    const fA = ss(1.9, 2.06, u) * (1 - ss(6.53, 6.71, u));
    const year = forestYear(u);
    const hMain = at(amazon['1'].height, year), lai = at(amazon['1'].lai, year);
    const Hm = hMain / 10;
    const cohortA = ss(5.3, 5.55, u);
    cohorts.forEach(c => {
      const series = amazon[String(c.age)], h = at(series.height, year), r = leafRatio(series.lai, year);
      c.h = h;
      c.trees.forEach(t => {
        const U = t.material.uniforms, H = h * t.userData.scale;
        U.uT.value = tauOfHeight(H);
        U.uTop.value = H;
        U.uLeaf.value = clamp(r * r, 0.35, 1);
        U.uStress.value = clamp((1 - r) * 3.5);
        U.uOpacity.value = cohortA * fA;
        t.scale.setScalar(0.1 * Math.max(1, H / VAR_HMAX));
        t.visible = cohortsReady && cohortA * fA > 0.002;
      });
    });
    const sharedT = fScene.children;
    for (const o of sharedT) if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = time;
    // the hero tree: sprouts during the dive, then follows the simulated years
    const HU = hero.material.uniforms;
    HU.uT.value = u < 2.15 ? lerp(PRE_TAU, 0, ss(1.9, 2.15, u)) : year / 40;
    HU.uTop.value = Math.max(0.5, u < 2.15 ? hMain * ss(1.9, 2.15, u) : hMain);
    const leafR = leafRatio(amazon['1'].lai, year);
    HU.uLeaf.value = clamp(leafR * leafR, 0.35, 1);
    HU.uStress.value = clamp((1 - leafR) * 3.5);
    HU.uOpacity.value = fA;
    hero.visible = heroReady && fA > 0.002;
    ground.material.uniforms.uOpacity.value = fA;
    ground.material.uniforms.uShade.value = Math.max(0.2, hMain * 0.034);
    motes.material.uniforms.uOpacity.value = fA;
    bg.material.uniforms.uOpacity.value = fA;

    // forest camera
    const az = 0.5 + (u - 1.9) * 0.42;
    // on phones, pull back so the tree fits between the caption above and the readout below
    const rA = L.narrow ? 1.6 + Hm * 4.6 : 1.3 + Hm * 2.4, cyA = 0.25 + Hm * 0.42, tyA = Hm * 0.5 + (L.narrow ? rA * 0.035 : 0);
    const b = ease(ss(5.3, 5.85, u)), c = ease(ss(6.3, 6.7, u));
    const r = lerp(lerp(rA, mobile ? 27 : 22, b), 3, c);
    const cy = lerp(lerp(cyA, 8, b), 48, c);
    const ty = lerp(lerp(tyA, 1.5, b), 0, c);
    fCam.position.set(Math.cos(az) * r, cy, Math.sin(az) * r);
    fCam.lookAt(0, ty, 0);
    mainTgt.set(0, ty, 0);
    keyLight(HU.uLight.value, az);
    if (!L.narrow) {
      // slide camera and target sideways so the subject sits right of the caption
      const shift = Math.hypot(r, cy - ty) * Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2) * aspect * 0.15 * (1 - c);
      tmp.setFromMatrixColumn(fCam.matrixWorld, 0).multiplyScalar(-shift);
      fCam.position.add(tmp);
      mainTgt.add(tmp);
      fCam.lookAt(mainTgt);
    }

    // four forcings: every view shares one scale so heights compare directly
    const kS = splitK(u), rects = kS > 0.001 ? panelRects(kS) : null;
    panels.forEach((P, i) => {
      const U = P.tree.material.uniforms, pa = az + i * 0.9;
      if (i > 0) {
        U.uT.value = year / 40;
        U.uTop.value = Math.max(0.5, P.h(year));
        const lr = P.leaf ? P.leaf(year) : 1;
        U.uLeaf.value = clamp(lr * lr, P.min ?? 0.35, 1);
        U.uStress.value = clamp((1 - lr) * 3.5);
        U.uOpacity.value = fA * (rects ? rects[i].k : 0);
        keyLight(U.uLight.value, pa);
        if (P.flames) {
          const F = P.flames.material.uniforms;
          F.uT.value = year / 40; F.uTime.value = time; F.uH.value = h1[FIRE]; F.uOpacity.value = U.uOpacity.value;
        }
      }
      if (!rects) return;
      const dist = PANEL_VIEW / (2 * Math.tan(THREE.MathUtils.degToRad(P.cam.fov) / 2));
      P.cam.position.set(Math.cos(pa) * dist, 1.0, Math.sin(pa) * dist);
      tmp.set(0, 1.9, 0);
      if (i === 0) {
        // the first view keeps chapter one's camera until the split completes
        P.cam.position.lerpVectors(fCam.position, P.cam.position, kS);
        tmp.lerpVectors(mainTgt, tmp, kS);
      }
      P.cam.lookAt(tmp);
    });

    // ---------- draw
    renderer.clear();
    if (fA < 0.999) renderer.render(gScene, gCam);
    if (fA > 0.001) {
      if (rects) drawPanels(rects);
      else { renderer.clearDepth(); renderer.render(fScene, fCam); }
    }

    // ---------- DOM overlays
    dom.panels.style.visibility = rects ? 'visible' : 'hidden';
    if (rects) {
      // the year sits above the final row of views, wherever they are sliding
      const yr = Math.round(year), fin = panelRects(1), last = fin[fin.length - 1];
      panelYear.style.opacity = (ss(0.6, 1, kS) * fA).toFixed(3);
      panelYear.style.transform = `translate(${(last.x + last.w - panelYear.offsetWidth).toFixed(1)}px, ${(fin[0].y - panelYear.offsetHeight - 10).toFixed(1)}px)`;
      panelYear.lastChild.textContent = 1981 + yr;
      panels.forEach((P, i) => {
        const R = rects[i], el = P.el;
        el.style.opacity = (ss(0.55, 1, i === 0 ? kS : R.k) * fA).toFixed(3);
        el.style.transform = `translate(${R.x.toFixed(1)}px, ${R.y.toFixed(1)}px)`;
        el.style.width = `${R.w.toFixed(1)}px`;
        el.style.height = `${R.h.toFixed(1)}px`;
        P.hEl.textContent = P.h(year).toFixed(1);
        P.agbEl.textContent = P.agb(year).toFixed(1);
        if (P.note) {
          const n = P.note(year);
          if (n && P.noteEl.textContent !== n) P.noteEl.textContent = n;
          P.noteEl.classList.toggle('on', !!n);
        }
      });
    }
    dom.flash.style.opacity = (ss(1.75, 1.96, u) * (1 - ss(1.98, 2.25, u)) * 0.55 + ss(6.47, 6.59, u) * (1 - ss(6.63, 6.85, u)) * 0.3).toFixed(3);
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

    const labA = ss(5.55, 5.8, u) * (1 - ss(6.25, 6.4, u));
    cohorts.forEach((c, i) => {
      const el = labelEls[i];
      if (labA < 0.01) { el.style.opacity = 0; return; }
      const p = project(tmp.set(c.cx, c.h / 10 + 0.5, c.cz), fCam);
      el.style.opacity = p.z < 1 ? labA : 0;
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    });

    // annotations appear with the parts they name
    const nlA = ss(8.4, 8.65, u) * (1 - ss(9.3, 9.5, u));
    for (const [k, el] of Object.entries(netLabelEls)) {
      const st = net.stages[k] ?? 0, o = nlA * ss(st, st + 0.12, build);
      if (o < 0.01) { el.style.opacity = 0; continue; }
      const p = project(net.group.localToWorld(tmp.copy(net.anchors[k])), gCam);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, ${BELOW.has(k) ? '0%' : '-100%'})`;
    }
  }

  return {render, resize, renderer, ready: Promise.all(grown.ready), dispose() { renderer.dispose(); }};
}
