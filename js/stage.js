// The scroll-driven film: hero globe -> why emulators (forests under pressure, a warming planet, a slow
// simulator, the case for emulators) -> the primer (a dive to the Amazon, one forest, four forcings and fifteen
// ages in one frame, the satellite lidar's planet) -> planet -> emulator -> what if -> numbers.
import * as THREE from '../assets/vendor/three.module.js';
import {createGlobe, createCanopy, createForestCloud, createStars, createFlare, createMarkers, createGedi, equalEarth, facing, cellOf, latLonToVec3} from './globe.js';
import {WHY, VIEWS, VIEW, SLOW, SPEED, storyU} from './timeline.js';
import {createGround, createMotes, createWeather, createSky, createLidar} from './forest.js';
import {mulberry32} from './random.js';
import {growTrees, treePoints, createFlames, PRE_TAU} from './hero-tree.js';
import {createEmulator, NET} from './network.js';
import {createPost} from './post.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const ease = t => (t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const west = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);   // a turn toward the west, 0 to 2 pi
const AGES = [1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const HERO_D = 4.2;        // camera distance (globe radii) of the opening globe
const DIVE_ALT = 0.2;      // altitude (globe radii) the dive passes on its way down to the Amazon
const GROUND_ALT = 0.002;  // ... and where it ends, about 13 km above the forest
const GROUND = {lat: -3.29, lon: -63.68};   // the forest at the head of a lake, by the chapter's site

// The opening, on the page's own clock p: the globe unrolls into a still map of the world (FLAT: in, then back out),
// on which the events pop kind by kind (fire, drought, heat, clearing) and the planet warms (HEAT: fade in, five-year
// windows from 1981-85 to 2016-20, fade out). It rolls back into a globe facing the Atlantic, from where the dive turns
// to the Amazon. WHY_PATH: where the globe faces meanwhile, [p, lat, lon]; the map is centred on longitude 0.
const FLAT = [0.52, 0.86, 3.5, 3.9];
const WHY_PATH = [[0.62, 6, 0], [3.5, 6, 0], [WHY[1], 2, -35]];
const HEAT = [2.22, 2.45, 3.2, 3.4, 3.58];
// the forest-area mean of each window against 1981-90 (scripts/export_pressure.py)
const HEAT_MEAN = [-0.22, 0.22, 0.15, 0.38, 0.66, 0.46, 0.67, 0.82];
const whyKeys = (() => {
  let y = 0;
  return WHY_PATH.map(([p, lat, lon], i) => {
    const f = facing(lat, lon), d = west(f.y - y);
    y = i ? y + (d > 2 * Math.PI - 1e-6 ? 0 : d) : f.y;
    return {p, x: f.x, y};
  });
})();
function whyRot(p) {
  const K = whyKeys;
  for (let i = 1; i < K.length; i++) {
    if (p > K[i].p) continue;
    const t = ease(clamp((p - K[i - 1].p) / (K[i].p - K[i - 1].p)));
    return {x: lerp(K[i - 1].x, K[i].x, t), y: lerp(K[i - 1].y, K[i].y, t)};
  }
  return K[K.length - 1];
}

// Interpolate a 41-element annual series at fractional year index.
const at = (series, y) => { const i = Math.floor(y), f = y - i; return i >= 40 ? series[40] : series[i] * (1 - f) + series[i + 1] * f; };

// The primer's forest runs on its own clock v (js/timeline.js): a sapling sprouts in the full frame, which splits
// into three views (one forest, four forcings, fifteen ages), forty years run in all of them at once, and the
// fifteen-age view then takes the whole frame for the satellite's pass.
const {sprout: SPROUT, split: SPLIT, years: YEARS, merge: MERGE} = VIEW;
const viewYear = v => 40 * clamp((v - YEARS[0]) / (YEARS[1] - YEARS[0]));
// Year of a forcing view's own story at progress k (0..1): [[k, year], ...], linear in between.
const storyYear = (keys, k) => {
  for (let i = 1; i < keys.length; i++) if (k <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (k - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  return keys[keys.length - 1][1];
};

// The page's dive comes to rest over the region, where the page names the site, before it goes on down
// to the forest. The film dives in one motion: its u runs through the dive (0.55 to 1.96) linearly in log
// altitude, so the edit's easing alone sets the pace, and filmU maps it back to the page's u.
const DIVE = [0.55, 1.96];
const diveLog = u => lerp(lerp(Math.log(HERO_D - 1), Math.log(DIVE_ALT), ease(ss(0.55, 1.62, u))), Math.log(GROUND_ALT), ss(1.62, 1.96, u));
const DIVE_N = 2048, diveTable = Float64Array.from({length: DIVE_N + 1}, (_, i) => diveLog(lerp(DIVE[0], DIVE[1], i / DIVE_N)));
function filmU(u) {
  if (u <= DIVE[0] || u >= DIVE[1]) return u;
  const l = lerp(diveTable[0], diveTable[DIVE_N], (u - DIVE[0]) / (DIVE[1] - DIVE[0]));
  let lo = 0, hi = DIVE_N;   // the table falls as u rises
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (diveTable[m] > l) lo = m; else hi = m; }
  return lerp(DIVE[0], DIVE[1], (lo + (diveTable[lo] - l) / (diveTable[lo] - diveTable[hi])) / DIVE_N);
}

// Icons (24 x 24, stroked): the forcing views', the opening's kinds of event, and the primer's two other views.
const ICONS = {
  wet: '<path d="M6.8 15.2h9.9a3.7 3.7 0 0 0 .4-7.4 5.3 5.3 0 0 0-10.2-1.1 4.3 4.3 0 0 0-.1 8.5z"/><path d="M8.6 18 7.7 20.3M12.4 18l-.9 2.3M16.2 18l-.9 2.3"/>',
  drought: '<circle cx="12" cy="9.2" r="3.3"/><path d="M12 2.6v1.5M12 14.3v1.5M5.4 9.2H3.9M20.1 9.2h-1.5M7.3 4.5l1.1 1.1M16.7 4.5l-1.1 1.1M7.3 13.9l1.1-1.1M16.7 13.9l-1.1-1.1"/><path d="M3 19.6h18M6.8 19.6l1.7-1.5 1 1.1 1.6-1.6M14.6 19.6l1.3-1.2 1 .9"/>',
  fire: '<path d="M12 2.8c.7 3.3 5 5.3 5 10.1a5 5 0 0 1-10 0c0-2.3 1.1-3.9 2.3-5.1.2 1.6.9 2.6 2 3.1-.6-2.6-.1-5.5.7-8.1z"/><path d="M12 20.5a2.1 2.1 0 0 1-2.1-2.1c0-1.3 1.1-2.1 2.1-3.4 1 1.3 2.1 2.1 2.1 3.4a2.1 2.1 0 0 1-2.1 2.1z"/>',
  cold: [0, 60, 120, 180, 240, 300].map(a => {
    const r = Math.PI * a / 180, u = [Math.sin(r), -Math.cos(r)], v = [Math.cos(r), Math.sin(r)];
    const P2 = (d, w) => `${(12 + u[0] * d + v[0] * w).toFixed(2)} ${(12 + u[1] * d + v[1] * w).toFixed(2)}`;
    return `M12 12L${P2(9, 0)}M${P2(4.6, -2.4)}L${P2(6.6, 0)}L${P2(4.6, 2.4)}`;
  }).reduce((d, x) => d + x, '<path d="') + '"/><circle cx="12" cy="12" r="1.2"/>',
  heat: '<path d="M10 14.6V5.2a2 2 0 0 1 4 0v9.4a4 4 0 1 1-4 0z"/><path d="M12 9.5v7"/><path d="M17.2 5.5h2.6M17.2 8.8h2.6M17.2 12.1h1.8"/>',
  clear: '<path d="M4 20.5h16"/><path d="M8 20.5v-7h7v7"/><ellipse cx="11.5" cy="13.5" rx="3.5" ry="1.4"/><path d="M14 12.5l5.2-8"/><path d="M16.7 3.6l3.9 2.6-1.4 2.1"/>',
  tree: '<path d="M12 21v-6.2"/><path d="M12 14.8c-3.5 0-5.9-2.2-5.9-5.2 0-3.2 2.7-6.1 5.9-6.1s5.9 2.9 5.9 6.1c0 3-2.4 5.2-5.9 5.2z"/><path d="M9.5 20.8h5"/>',
  cohort: '<path d="M3 20.5h18M6 20.5v-4M12 20.5v-6.5M18 20.5v-3.4"/><circle cx="6" cy="13.8" r="2.6"/><circle cx="12" cy="8.6" r="4.4"/><circle cx="18" cy="14.9" r="2.1"/>',
};
const KIND_COLOR = {fire: '#ff7a45', drought: '#f5b544', heat: '#ff5a6e', clear: '#c99bff'};

// Particles flowing from land cells on the globe to the same place on the emulator's front map.
function createStreams(zones, net, px, count) {
  const cells = [];
  for (let i = 0; i < zones.data.length; i += 7) if (zones.data[i]) cells.push(i);
  const rng = mulberry32(11), v = new THREE.Vector3();
  const dir = new Float32Array(count * 3), end = new Float32Array(count * 3), ph = new Float32Array(count), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const c = cells[Math.floor(rng() * cells.length)], lat = 89.75 - Math.floor(c / 720) * 0.5, lon = -179.75 + (c % 720) * 0.5;
    latLonToVec3(lat, lon, 1, v);
    dir.set([v.x, v.y, v.z], i * 3);
    net.mapPoint(lat, lon, v);
    end.set([v.x, v.y, v.z], i * 3);
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
// film: the rendered video (js/cut.js), which clears the network away for the what-if charts and
// dims the planet further behind its big number.
export function createStage({canvas, meta, scen, tex, maps, dom, mobile, reduced = false, bloom = !mobile, film = false}) {
  // with bloom the frame is multisampled in its own target, so the canvas itself needs no antialiasing
  const renderer = new THREE.WebGLRenderer({canvas, antialias: !bloom, powerPreference: 'high-performance'});
  renderer.setClearColor(0x050a0c, 1);
  renderer.autoClear = false;
  // the rendered film draws at the full device resolution it is captured at
  const px = film ? (window.devicePixelRatio || 1) : Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(px);
  const post = bloom ? createPost(renderer) : null;

  const story = meta.story.amazon;
  const target = cellOf(story.lat, story.lon);
  const targetRot = facing(story.lat, story.lon), groundRot = facing(GROUND.lat, GROUND.lon);
  const ASIA = facing(10, 122), AMERICAS = facing(10, -80);

  // globe scene
  const gScene = new THREE.Scene();
  const gCam = new THREE.PerspectiveCamera(35, 1, 0.005, 200);
  // the photographic Earth, with ever sharper images of the Amazon for the dive: the region at 1 km, the grid
  // cell at 65 m and the ground where it ends at 11 m (boxes in step with prepare_textures.py)
  const G = createGlobe({day: tex.day, mask: tex.mask, zones: tex.zones.tex, data: tex.height.tex, segments: mobile ? 160 : 224,
    clouds: tex.clouds, lights: tex.lights, real: 1,
    details: [{tex: tex.amazon, box: [-76, 5, -52, -11]}, {tex: tex.amazonCell, box: [-64.35, -2.65, -63.15, -3.85]},
      {tex: tex.amazonGround, box: [-63.78, -3.19, -63.58, -3.39]}]});
  G.uniforms.uTarget.value.set(target.col, target.row);
  G.globe.renderOrder = 1; G.atmo.renderOrder = 2;
  // the planet chapter's forests in relief, rising over the globe as the years pass
  const canopy = createCanopy({data: tex.height.tex, ramp: G.uniforms.uRamp, sun: G.uniforms.uSun, segments: mobile ? 180 : 360});
  canopy.mesh.renderOrder = 1.5;
  G.spin.add(canopy.mesh);
  // data that brings its trees (the film's) shows the forest flat on the imagery, its trees standing only on the
  // skyline at the planet's edge, and glowing as they grow
  const forest = tex.height.trees && createForestCloud({data: tex.height.tex, trees: tex.height.trees, ramp: G.uniforms.uRamp, sun: G.uniforms.uSun});
  if (forest) {
    forest.group.children.forEach(o => { o.renderOrder = 1.5; });
    G.spin.add(forest.group);
  }
  const stars = createStars(mobile ? 1400 : 2800);
  stars.material.uniforms.uPx.value = px;
  gScene.add(stars, G.group);
  // the opening: the sun rises from behind the planet to its usual place, flaring as it clears the limb;
  // that place is high in front and to the left, so most of the disc is in daylight
  G.uniforms.uSun.value.set(-0.62, 0.36, 0.7).normalize();
  const SUN = G.uniforms.uSun.value.clone(), SUN0 = new THREE.Vector3(0.42, 0.5, -0.76).normalize();
  // the end card lights its planet from high above, so the horizon glows under the title
  const SUN_END = new THREE.Vector3(-0.3, 0.85, 0.42).normalize(), END_TILT = -1.45, END_RY = facing(0, -60).y;
  let endSpin = 0;
  const INTRO = reduced ? 0 : 3.4;
  const flare = createFlare();
  flare.renderOrder = 5;
  gScene.add(flare);
  // the opening's events: markers on the globe, named by the page's labels (each lists its kind and its points as
  // lat,lon;...), with the kind's icon and colour; the caption's legend lights each kind as its first event pops
  const whyLabels = [...dom.whyLabels.children].map(el => {
    const kind = el.dataset.k, color = KIND_COLOR[kind];
    el.style.setProperty('--c', color);
    el.querySelector('b').insertAdjacentHTML('afterbegin', `<svg class="ev-icon" viewBox="0 0 24 24">${ICONS[kind]}</svg>`);
    return {el, t: +el.dataset.t, kind, color, pts: el.dataset.pts.split(';').map(q => q.split(',').map(Number))};
  });
  const marks = createMarkers(whyLabels.flatMap(L => L.pts.map(([lat, lon]) => ({lat, lon, color: L.color, t: L.t, kind: L.kind}))), px, G.uniforms);
  G.spin.add(marks.points);
  const markOf = whyLabels.map((L, i) => whyLabels.slice(0, i).reduce((n, M) => n + M.pts.length, 0));
  const kindEls = [...(dom.kinds?.children ?? [])].map(el => {
    const kind = el.dataset.k;
    el.style.setProperty('--c', KIND_COLOR[kind]);
    el.insertAdjacentHTML('afterbegin', `<svg class="ev-icon" viewBox="0 0 24 24">${ICONS[kind]}</svg>`);
    return {el, t: Math.min(...whyLabels.filter(L => L.kind === kind).map(L => L.t))};
  });
  let whyFrom = null;   // the hero's rotation as the case began
  // the warming of the forests (CarbonGlobe's air temperature against 1981-90), and GEDI's tracks over the planet
  if (tex.heat) G.uniforms.uHeat.value = tex.heat;
  const gedi = createGedi(tex.zones.data, px);
  G.spin.add(gedi.group);
  const net = createEmulator(px, scen.maps, tex.mask);
  gScene.add(net.group);
  maps?.then(t => net.setMaps(t)).catch(() => {});
  const streams = createStreams(tex.zones, net, px, mobile ? 700 : 1400);
  streams.renderOrder = 3;
  gScene.add(streams);

  // forest scene
  const fScene = new THREE.Scene();
  const fCam = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
  const bg = createSky();
  fScene.add(bg);
  const ground = createGround(px);
  ground.renderOrder = -5;
  fScene.add(ground);
  const motes = createMotes(mobile ? 400 : 900, px);
  fScene.add(motes);
  const lidar = createLidar(px);
  fScene.add(lidar.group);
  // the four-forcing views' weather, shown only inside their viewports
  const weather = {rain: createWeather('rain', mobile ? 400 : 700, px), snow: createWeather('snow', mobile ? 400 : 700, px),
    dust: createWeather('dust', mobile ? 160 : 260, px), ash: createWeather('ash', mobile ? 260 : 420, px)};
  Object.values(weather).forEach(w => fScene.add(w));

  // Trees, grown in a worker, in the order they appear: chapter one's tree from ED's canopy-height
  // series (it stays on as the cohort chapter's 1-year-old stand at the centre); the three other
  // forcings (the 2015 drought, a sketched fire that restarts the stand in 2003, boreal cold); then
  // sparser variants for the fifteen-age forest, grown along the same curve stretched to the tallest cohort.
  // Each view starts from its own forest: a sapling in the wet Amazon, a mature 100-year-old stand at the
  // drought site, a 10-year-old stand that burns, and a boreal sapling.
  const h1 = story.ages['1'].height, dry = scen.drought.age100, cold = meta.story.boreal.ages['1'], young = story.ages['10'];
  const FIRE = 22;
  const VAR_HMAX = 31.5, varHeights = h1.map(h => h * VAR_HMAX / Math.max(...h1));
  const sp = mobile ? {leaf: 6, coarse: 1.4} : {leaf: 10, coarse: 1.15};
  const grown = growTrees([
    [{heights: h1, leaf: mobile ? 8 : 12}],
    [{heights: dry.height, seed: 21, ...sp, pre: 36}],                       // grown to maturity before 1981
    [{heights: young.height.slice(0, FIRE + 1), seed: 31, ...sp, pre: 20, span: FIRE / 40, burn: (FIRE + 0.3) / 40},
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
  // height (world units of 10 m) of the canopy at ground point (x, z): the tallest cohort tree within reach
  const canopyTop = (x, z) => {
    let h = 0.02;
    for (const c of cohorts) for (const t of c.trees) {
      const dx = t.position.x - x, dz = t.position.z - z;
      if (dx * dx + dz * dz < 2.6) h = Math.max(h, c.h * t.userData.scale / 10);
    }
    return h;
  };
  const lidarDir = new THREE.Vector3(1, 0, 0);
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
  // the fire view's stand before the fire, then a new one from age 1
  const afterFire = (pre, post, y) => (y <= FIRE ? at(pre, y) : at(post, Math.max(0, y - FIRE - 1)));
  const dryLoss = Math.round(100 * (1 - dry.agb[35] / dry.agb[34]));
  // the drought view's crown: leaves against the stand's leaf area before the drought, and dieback as deep
  // as its loss of biomass from the 2015 peak (a loss of 30% or more kills back 62% of the crown)
  const dryLai = dry.lai.slice(0, 34).reduce((a, b) => a + b) / 34, dryPeak = Math.max(...dry.agb.slice(0, 35));
  const dieMax = 0.62 * Math.min(1, (dryPeak - Math.min(...dry.agb.slice(34))) / (0.3 * dryPeak));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const where = s => `${Math.abs(s.lat).toFixed(2)}°${s.lat < 0 ? 'S' : 'N'}`;
  const degC = t => `${t >= 10 ? Math.round(t) : t.toFixed(1)} °C`;
  // Each view's climate, from its site's forcing: annual rain relative to the site's mean and the
  // temperature anomaly, on the trees' clock (the 40 forcing years, 1981-2020, then held for 2021).
  const series = Object.fromEntries(Object.entries(scen.climate).map(([k, c]) => {
    const pm = c.precip_mm.reduce((a, b) => a + b) / 40, tm = c.temp_c.reduce((a, b) => a + b) / 40;
    const pad = a => [...a, a[a.length - 1]];
    return [k, {rain: pad(c.precip_mm.map(p => p / pm)), anom: pad(c.temp_c.map(t => t - tm)), pm, tm}];
  }));
  // an event that lingers: the largest f(k) e^-(y-k)/tau over the years k up to y
  const lingering = (f, y, tau) => {
    let m = f(y);
    for (let k = 0; k <= Math.min(40, y); k++) m = Math.max(m, f(k) * Math.exp(-(y - k) / tau));
    return m;
  };
  const rainRate = p => clamp(0.1 + 0.6 * (p - 0.4) / 0.8);
  const dryness = (key, y) => lingering(k => clamp((0.85 - at(series[key].rain, k)) / 0.45), y, 1.6);
  // skies: gradient top and bottom, horizon glow, sun (u, v, size) and its colour, cloud cover and colour.
  // Each view has its own: rain clouds (wet), a hot clear sky (arid, scorching in the drought years),
  // fire-season haze (smoky, red at the burn) and a snowy night (cold).
  const SKY = {
    base: {top: [0.03, 0.09, 0.09], bot: [0.012, 0.03, 0.035], band: [0.02, 0.06, 0.04], sun: [0.7, 0.8, 0], sunCol: [0, 0, 0], cloud: 0, cloudCol: [0.06, 0.1, 0.11]},
    wet: {top: [0.03, 0.085, 0.1], bot: [0.012, 0.035, 0.04], band: [0.03, 0.085, 0.07], sun: [0.7, 0.8, 0], sunCol: [0, 0, 0], cloud: 0.8, cloudCol: [0.075, 0.11, 0.12]},
    arid: {top: [0.15, 0.11, 0.06], bot: [0.055, 0.038, 0.02], band: [0.24, 0.15, 0.06], sun: [0.72, 0.8, 0.16], sunCol: [0.95, 0.74, 0.42], cloud: 0, cloudCol: [0.2, 0.14, 0.07]},
    dry: {top: [0.25, 0.12, 0.04], bot: [0.09, 0.04, 0.015], band: [0.4, 0.18, 0.045], sun: [0.7, 0.8, 0.3], sunCol: [1, 0.62, 0.24], cloud: 0, cloudCol: [0.2, 0.13, 0.06]},
    haze: {top: [0.06, 0.042, 0.04], bot: [0.028, 0.019, 0.017], band: [0.32, 0.075, 0.02], sun: [0.3, 0.3, 0.07], sunCol: [0.6, 0.14, 0.03], cloud: 0.7, cloudCol: [0.1, 0.07, 0.06]},
    fire: {top: [0.16, 0.045, 0.02], bot: [0.05, 0.016, 0.01], band: [0.55, 0.15, 0.03], sun: [0.5, 0.2, 0.3], sunCol: [0.5, 0.12, 0.02], cloud: 0.9, cloudCol: [0.12, 0.06, 0.04]},
    smoke: {top: [0.085, 0.072, 0.065], bot: [0.032, 0.028, 0.025], band: [0.08, 0.05, 0.03], sun: [0.7, 0.8, 0], sunCol: [0, 0, 0], cloud: 0.85, cloudCol: [0.14, 0.12, 0.105]},
    cold: {top: [0.04, 0.065, 0.13], bot: [0.02, 0.032, 0.06], band: [0.05, 0.085, 0.15], sun: [0.26, 0.5, 0.09], sunCol: [0.26, 0.34, 0.5], cloud: 0.55, cloudCol: [0.13, 0.15, 0.2]},
  };
  const GRID = {base: [0.25, 0.9, 0.6], dry: [0.8, 0.52, 0.18], fire: [0.95, 0.42, 0.2], cold: [0.55, 0.78, 1]};
  const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const mixSky = (a, b, t) => ({top: mix3(a.top, b.top, t), bot: mix3(a.bot, b.bot, t), band: mix3(a.band, b.band, t), sun: mix3(a.sun, b.sun, t),
    sunCol: mix3(a.sunCol, b.sunCol, t), cloud: lerp(a.cloud, b.cloud, t), cloudCol: mix3(a.cloudCol, b.cloudCol, t)});
  const CALM = {sky: SKY.base, rain: 0, snow: 0, dust: 0, ash: 0, dry: 0, frost: 0, char: 0, wet: 0, heat: 0, grid: GRID.base, on: false};
  const boreal = meta.story.boreal;
  const panels = [
    // story: in the film each view runs its own compressed years, slowing for its key moment
    {key: 'wet', title: 'Warm & wet', color: '#b9f46b', site: story, cl: 'amazon', story: [[0, 0], [1, 40]],
      lines: [`Amazon, ${where(story)}`, `${degC(story.temp_c)} · ${fmt(story.precip_mm)} mm/yr`],
      tree: hero, h: y => at(h1, y), agb: y => at(agb1, y),
      clim: y => ({...CALM, sky: SKY.wet, rain: Math.max(0.35, rainRate(at(series.amazon.rain, y))), wet: 0.85})},
    {key: 'drought', title: 'Drought', color: '#f5b544', site: scen.drought, cl: 'drought', event: 34,
      lines: [`Amazon, ${where(scen.drought)}`, `${degC(scen.drought.temp_c)} · ${fmt(scen.drought.precip_mm)} mm/yr`],
      // a mature tree all along (its growth clock starts late); its leaves thin in dry years, then in 2015-16
      // brown and fall with those of the limbs the drought kills; the survivors slowly re-leaf
      story: [[0, 26], [0.36, 33.9], [0.9, 35.6], [1, 37.5]],
      clock: y => 0.72 + 0.28 * y / 40,
      h: y => at(dry.height, y), agb: y => at(dry.agb, y), min: 0.02,
      leaf: y => clamp(at(dry.lai, Math.min(y, 34)) / dryLai) * (1 - 0.3 * dryness('drought', Math.min(y, 34))),
      fall: y => ss(34.1, 35.4, y),
      keep: y => (y < 34.1 ? 1 : 0.22 + 0.5 * Math.max(0, clamp(at(dry.lai, y) / dryLai) - 0.6) * ss(35.4, 36.5, y)),
      dieback: y => (y < 34.1 ? 0 : dieMax),   // the dead limbs' leaves fall with the rest, and the limbs bleach as they go
      stress: y => (y < 34.1 ? clamp((1 - clamp(at(dry.lai, y) / dryLai) * (1 - 0.3 * dryness('drought', y))) * 3.5) : 0.75 - 0.35 * ss(36.5, 40, y)),
      note: y => (y >= 34.6 ? `2015 rain ${Math.round(scen.drought.precip_pct[34])}% of normal: the canopy sheds its leaves, biomass −${dryLoss}%` : ''),
      // hot and rainless in every year, so the view reads as drought from the start; the 2015-16
      // drought then scorches the sky, cracks the ground and fills the air with dust
      clim: y => {
        const d = dryness('drought', y);
        return {...CALM, sky: mixSky(SKY.arid, SKY.dry, d), dust: 0.3 + 0.7 * d, dry: 0.5 + 0.5 * d, heat: 0.5 + 0.5 * d,
          grid: GRID.dry, on: d > 0.35};
      }},
    {key: 'fire', title: 'Fire', tag: 'sketch', color: '#ff7a45', site: story, cl: 'amazon', event: FIRE,
      story: [[0, 12], [0.15, 21.8], [0.6, 24.2], [1, 40]],
      lines: [`Amazon, ${where(story)}`, `burnt in ${1981 + FIRE}`],
      h: y => (y > FIRE && y < FIRE + 1 ? 0 : afterFire(young.height, h1, y)), agb: y => (y > FIRE && y < FIRE + 1 ? 0 : afterFire(young.agb, agb1, y)),
      // the burning tree keeps its height in the shader until the new stand takes over
      top: y => (y < FIRE + 1 ? at(young.height, Math.min(y, FIRE)) : at(h1, y - FIRE - 1)),
      leaf: y => (y <= FIRE ? leafRatio(young.lai, y) : leafRatio(lai1, Math.max(0, y - FIRE - 1))), min: 0.35, burn: (FIRE + 0.3) / 40,
      note: y => (y > FIRE ? 'A fire resets the clock: the stand starts again at age 1' : ''),
      // fire-season haze with rising embers, the blaze, then smoke and ash over scorched ground
      clim: y => {
        const t = y - (FIRE + 0.3);
        const blaze = t > -0.15 ? ss(-0.15, 0.02, t) * Math.exp(-Math.max(0, t) / 0.45) : 0;
        const smoke = t > 0 ? ss(0, 0.25, t) * Math.exp(-t / 2.2) : 0;
        return {...CALM, sky: mixSky(mixSky(SKY.haze, SKY.smoke, smoke), SKY.fire, blaze), ash: Math.max(0.12, smoke, blaze * 0.7),
          char: t > 0 ? 0.3 + 0.7 * ss(0, 0.1, t) * Math.exp(-t / 3.5) : 0, dry: 0.25, heat: 0.25, grid: GRID.fire, on: blaze + smoke > 0.3};
      }},
    {key: 'cold', title: 'Cold', color: '#8fc7ff', site: boreal, cl: 'boreal', story: [[0, 0], [1, 40]],
      lines: [`Finland, ${where(boreal)}`, `${degC(boreal.temp_c)} · ${fmt(boreal.precip_mm)} mm/yr`],
      h: y => at(cold.height, y), agb: y => at(cold.agb, y), tint: [0.6, 0.92, 0.86],
      clim: y => ({...CALM, sky: SKY.cold, snow: clamp(0.6 - 0.14 * at(series.boreal.anom, y), 0.3, 0.95), frost: 0.85, grid: GRID.cold})},
  ];
  panels.forEach((P, i) => {
    P.cam = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
    P.state = CALM;
    if (i === 0) return;
    P.tree = treePoints(grown.geos[i], px, {glow: true});
    P.tree.scale.setScalar(0.1);
    P.tree.rotation.y = 0.4 + i * 1.7;
    if (P.tint) P.tree.material.uniforms.uTint.value.setRGB(...P.tint);
    if (P.burn) {
      P.tree.material.uniforms.uBurn.value = P.burn;
      P.flames = createFlames(px, mobile ? 450 : 900);
      P.flames.material.uniforms.uBurn.value = P.burn;
      P.tree.add(P.flames);
    }
    P.tree.visible = false;
    fScene.add(P.tree);
  });

  // Each view's header: an icon, the site, a regional climate map with the site pinned, and a strip of
  // its forcing year by year (rain bars, temperature-anomaly stripes) that fills in as the years pass.
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rampCss = (stops, t) => {
    const x = clamp(t) * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
    const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
  };
  const ANOM = ['#2b5fc9', '#7fa9e0', '#59636a', '#e89a6a', '#d23f33'];   // -2 .. +2 °C
  function strip(P) {
    const c = scen.climate[P.cl], S = series[P.cl];
    const bars = c.precip_mm.map((p, i) => {
      const h = Math.max(1.2, 17 * Math.min(1, p / 3000));
      return `<rect x="${i * 10 + 1.5}" y="${(18 - h).toFixed(1)}" width="7" height="${h.toFixed(1)}" fill="${p < 0.75 * S.pm ? '#f2a33a' : '#56d0e0'}"/>`;
    }).join('');
    const stripes = c.temp_c.map((t, i) => `<rect x="${i * 10}" y="21" width="10.6" height="8" fill="${rampCss(ANOM, (t - S.tm + 2) / 4)}"/>`).join('');
    const ev = P.event === undefined ? '' : `<rect class="ev" x="${P.event * 10 - 2}" y="0" width="14" height="29"/>`;
    const svg = cls => `<svg class="${cls}" viewBox="0 0 400 29" preserveAspectRatio="none">${ev}${bars}${stripes}</svg>`;
    // a faint copy for the years to come, and a bright one revealed up to the current year
    return svg('p-all') + svg('p-past');
  }
  function map(P) {
    const R = scen.regions[P.key], [la0, la1, lo0, lo1] = R.box;
    const x = (P.site.lon - lo0) / (lo1 - lo0) * 100, y = (la1 - P.site.lat) / (la1 - la0) * 100;
    const end = v => (P.key === 'drought' ? `${v}%` : fmt(v));
    return `<figure class="p-map"><span><img src="${R.file}" alt="" width="300" height="200" decoding="async"><i class="pin" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"></i><b>${R.title}</b></span>
      <figcaption><i style="background:linear-gradient(90deg,${R.ramp.join(',')})"></i><small>${end(R.lo)}</small><small>${R.unit}</small><small>${end(R.hi)}</small></figcaption></figure>`;
  }
  // the primer's frame: the tree's view (one forest), the four forcing views and the fifteen-age view, each with
  // its header and readout, under a label per column
  const frame = (cls, color, icon, title, lines, foot) => `<div class="panel ${cls}" style="--pc:${color}">
    <div class="p-top"><div class="p-head"><svg class="p-icon" viewBox="0 0 24 24">${ICONS[icon]}</svg>
      <p class="p-title"><b>${title}</b>${lines.map(l => `<span>${l}</span>`).join('')}</p></div></div>${foot}</div>`;
  dom.panels.innerHTML = '<div class="panels-year"><small>Year</small><b>1981</b></div>'
    + frame('v-tree', '#b9f46b', 'tree', 'Central Amazon', [`${where(story)} · age 1 in 1981`, 'ED reference run'],
      '<p class="p-stats"><span><small>Height</small><b>0</b> m</span><span><small>Biomass</small><b>0</b> kgC m⁻²</span><span><small>Leaf area</small><b>0</b> LAI</span></p>')
    + panels.map(P => `<div class="panel p-${P.key}" style="--pc:${P.color}">
    <div class="p-top"><div class="p-head"><svg class="p-icon" viewBox="0 0 24 24">${ICONS[P.key]}</svg>
      <p class="p-title"><b>${P.title}${P.tag ? `<i>${P.tag}</i>` : ''}</b><span>${P.lines[0]}</span><span>${P.lines[1]}</span></p></div>
      <div class="p-clim"><span class="p-key"><i>rain</i><i>temp</i></span><span class="p-strip">${strip(P)}<i class="p-cur"></i></span></div>
      ${map(P)}</div>
    <p class="p-note"></p>
    <p class="p-stats"><span><small>Canopy height</small><b>0</b> m</span><span><small>Biomass</small><b>0</b> kgC m⁻²</span></p></div>`).join('')
    + frame('v-cohort', '#3ee08f', 'cohort', 'Central Amazon', ['stands aged 1 to 500 years', 'canopy height by starting age'],
      `<div class="bars p-bars">${AGES.map(a => `<div><i></i><span>${a}</span></div>`).join('')}</div>`)
    + ['One forest', 'Four forcings', 'Fifteen ages'].map((t, i) => `<p class="v-label"><i>${i + 1}</i>${t}</p>`).join('');
  const panelYear = dom.panels.firstElementChild;
  const treeFrame = dom.panels.querySelector('.v-tree'), cohortFrame = dom.panels.querySelector('.v-cohort');
  const [treeH, treeAgb, treeLai] = treeFrame.querySelectorAll('.p-stats b');
  const barEls = [...cohortFrame.querySelectorAll('.p-bars i')];
  const colLabels = [...dom.panels.querySelectorAll('.v-label')];
  panels.forEach((P, i) => {
    P.el = dom.panels.children[i + 2];
    [P.hEl, P.agbEl] = P.el.querySelectorAll('.p-stats b');
    P.noteEl = P.el.querySelector('.p-note');
    P.iconEl = P.el.querySelector('.p-icon');
    P.curEl = P.el.querySelector('.p-cur');
    P.pastEl = P.el.querySelector('.p-past');
    P.cur = -1;
  });
  // Where the views sit: the tree's view shrinks out of the full frame into the left column while the forcing views
  // slide in to a 2 x 2 grid in the middle and the fifteen-age view to the right (kS); then the fifteen-age view
  // grows back over the others to the full frame (kM). Phones put the tree and the fifteen ages over the grid.
  function viewRects(kS, kM) {
    const n = L.narrow, gap = n ? 8 : 10, cg = n ? 10 : 22, lab = n ? 22 : 30;
    // the views fill the space below the caption (in the film, below its one-line title)
    const ax = n ? 12 : Math.round(W * 0.03), ay = (film ? Math.round(H * 0.25) : Math.max(Math.round(H * (n ? 0.3 : 0.27)), L.capBottom + 14)) + lab;
    const aw = W - 2 * ax, ah = H - ay - Math.round(H * 0.04);
    let tree, grid, coh;
    if (n) {
      const h1 = Math.round((ah - cg - lab) * 0.42), wT = Math.round((aw - cg) * 0.4);
      tree = {x: ax, y: ay, w: wT, h: h1};
      coh = {x: ax + wT + cg, y: ay, w: aw - wT - cg, h: h1};
      grid = {x: ax, y: ay + h1 + cg + lab, w: aw, h: ah - h1 - cg - lab};
    } else {
      const wT = Math.round((aw - 2 * cg) * 0.22), wG = Math.round((aw - 2 * cg) * 0.42);
      tree = {x: ax, y: ay, w: wT, h: ah};
      grid = {x: ax + wT + cg, y: ay, w: wG, h: ah};
      coh = {x: grid.x + wG + cg, y: ay, w: aw - wT - wG - 2 * cg, h: ah};
    }
    const pw = (grid.w - gap) / 2, ph = (grid.h - gap) / 2, full = {x: 0, y: 0, w: W, h: H};
    const slide = (fin, k) => ({...fin, x: lerp(fin.x + W * 0.3, fin.x, k), k});
    const grow = (a, b, k) => ({x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k), k: 1});
    return {
      tree: grow(full, tree, ease(kS)),
      panels: [0, 1, 2, 3].map(i => slide({x: grid.x + (i % 2) * (pw + gap), y: grid.y + Math.floor(i / 2) * (ph + gap), w: pw, h: ph}, ss(0.2 + 0.1 * i, 0.62 + 0.08 * i, kS))),
      cohort: kM > 0 ? grow(coh, full, ease(kM)) : slide(coh, ss(0.5, 1, kS)),
      cols: [tree, grid, coh], lab,
    };
  }

  // the fifteen-age forest's labels: a few of its ages
  dom.cohortLabels.innerHTML = AGES.map(a => `<span>${a} yr</span>`).join('');
  const labelEls = [...dom.cohortLabels.children];
  const LABELLED = new Set([1, 30, 100, 500]);
  const netLabelEls = Object.fromEntries([...dom.netLabels.children].map(el => [el.dataset.k, el]));
  const netVar = dom.netLabels.querySelector('.net-var');
  const BELOW = new Set(['state', 'heads', 'loop']);

  // interaction: drag the hero globe
  const drag = {active: false, x: 0, y: 0, vy: 0, dy: 0, tilt: 0};
  let heroY = facing(15, -35).y, heroTilt = 0.3;
  let u = 0, p = 0;   // the story's clock, and the scroll position it comes from (js/timeline.js)
  canvas.addEventListener('pointerdown', e => {
    if (p > WHY[0]) return;
    drag.active = true; drag.x = e.clientX; drag.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    canvas.style.cursor = p < WHY[0] ? (drag.active ? 'grabbing' : 'grab') : '';
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
    post?.setSize();
    gCam.aspect = fCam.aspect = aspect;
    gCam.updateProjectionMatrix(); fCam.updateProjectionMatrix();
    const proj = H * 0.5 / Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2);
    fScene.traverse(o => { if (o.material?.uniforms?.uProj) o.material.uniforms.uProj.value = proj; });
    const t = Math.tan(THREE.MathUtils.degToRad(gCam.fov) / 2);
    miniTree.material.uniforms.uProj.value = H * 0.5 / t;
    const narrow = aspect < 0.85;
    // hero: globe to the right of the title (or above it on phones)
    const dh = HERO_D, hh = dh * t, hw = hh * aspect;
    L.hero = narrow ? {x: 0, y: hh * 0.55, s: Math.min(0.82, hw * 0.78), d: dh} : {x: hw * 0.5, y: 0, s: 0.95, d: dh};
    // (the film's planet is a little smaller, clear of its corner tag)
    L.planet = narrow ? {x: 0, y: -hh * 0.18, s: Math.min(0.9, hw * 0.85), d: dh} : {x: hw * 0.36, y: 0, s: film ? 0.92 : 1, d: dh};
    // the opening's map of the world: below its captions (in the film, below its one-line titles), as wide as fits;
    // its 75 N to 60 S span (Equal Earth y from 1.247 to -1.088 on a unit sphere, 5.41 wide) on screen
    const capB = Math.max(0, ...(dom.mapCaps ?? []).map(c => c.offsetTop + c.offsetHeight));
    const top = film ? H * 0.27 : Math.max(H * (narrow ? 0.4 : 0.28), capB + 18), yTop = hh - 2 * hh * top / H;
    const ms = Math.min(2 * hw * (narrow ? 0.96 : 0.92) / 5.4132, 2 * hh * (1 - top / H - 0.04) / 2.335);
    L.map = {x: 0, y: yTop - 1.247 * ms, s: ms};
    // the case for emulators: the globe right of its captions, as the planet chapter's
    L.why = narrow ? {x: 0, y: -hh * 0.2, s: Math.min(0.86, hw * 0.8)} : aspect < 1.5 ? {x: hw * 0.42, y: 0, s: 0.88} : {x: hw * 0.36, y: 0, s: 1};
    // emulator: globe left, network right
    const dn = 4.4, nh = dn * t, nw = nh * aspect;
    L.net = narrow
      ? {gx: 0, gy: nh * 0.08, gs: nw * 0.42, nx: nw * 0.07, ny: -nh * 0.5, ns: nw * 0.52, d: dn}
      : {gx: -nw * 0.62, gy: -nh * 0.3, gs: Math.min(nh * 0.4, nw * 0.25), nx: nw * 0.5, ny: -nh * 0.1, ns: nw * 0.29, d: dn};
    L.netPx = L.net.ns * H * 0.5 / nh;
    if (!narrow && dom.netCap) {
      // fit the network and its labels into the space right of the chapter's caption; the film, which names
      // only the emulator and its three blocks, gives it most of the frame below its title and moves the
      // globe small into the corner
      const pxw = H * 0.5 / nh;   // pixels per world unit
      const NB = film ? {l: -1.95, r: 1.55, t: 0.95, b: -1.15} : {l: -1.95, r: 1.62, t: 1.3, b: -1.3};   // bounds in network units
      const x0 = film ? W * 0.2 : dom.netCap.offsetLeft + dom.netCap.offsetWidth + 14, x1 = W - (film ? W * 0.025 : 14);
      const y0 = film ? H * 0.21 : 64, y1 = H - 18;
      const sc = Math.min(film ? Infinity : L.netPx, (x1 - x0) / (NB.r - NB.l), (y1 - y0) / (NB.t - NB.b));
      const cx = x0 + (x1 - x0 - sc * (NB.r - NB.l)) / 2 - NB.l * sc, cy = y0 + (y1 - y0 - sc * (NB.t - NB.b)) / 2 + NB.t * sc;
      Object.assign(L.net, {nx: (cx - W / 2) / pxw, ny: (H / 2 - cy) / pxw, ns: sc / pxw});
      L.netPx = sc;
      if (film) Object.assign(L.net, {gx: -nw * 0.8, gy: -nh * 0.56, gs: nh * 0.3});
    }
    net.shared.uRes.value.set(W * px, H * px);
    // a small network keeps only its main annotations
    dom.netLabels.classList.toggle('few', L.netPx < 150);
    dom.netLabels.classList.toggle('tiny', L.netPx < 115);
    L.fc = narrow ? {gx: 0, gy: nh * 0.1, gs: nw * 0.6} : {gx: -nw * 0.62, gy: -nh * 0.62, gs: nh * 0.62};
    // end card: a planet rising from the bottom of the frame, its horizon below the title
    const de = 4.3, eh = de * t, ew = eh * aspect, er = narrow ? ew * 1.9 : Math.max(ew * 1.05, eh * 1.7);
    L.end = {d: de, s: er, y: -eh * (narrow ? 0.4 : 0.27) - er};
    L.narrow = narrow;
    whyLabels.forEach(M => { M.w = M.h = 0; M.narrow = narrow; });
    const cap = dom.viewsCap;
    L.capBottom = cap ? cap.offsetTop + cap.offsetHeight : 0;
    // narrow views get a one-line readout, and the narrowest drop their maps
    const pw = viewRects(1, 0).panels[0].w;
    dom.panels.classList.toggle('compact', narrow || pw < 300);
    dom.panels.classList.toggle('nomap', pw < 236);
  }
  resize();

  const tmp = new THREE.Vector3(), sunSide = new THREE.Vector3(), nrm = new THREE.Vector3(), eye = new THREE.Vector3();
  const PANEL_VIEW = 4.8;   // world units (10 m) of height each forcing view shows
  const PANEL_TGT = 2.2;    // height the views look at, leaving room for the headers above the crowns
  const TREE_VIEW = 3.9;    // ... and the height the tree's view shows
  // key light from the upper left of a camera at azimuth az, slightly in front of the subject
  const keyLight = (v, az) => v.set(-Math.sin(az) * 0.55 + Math.cos(az) * 0.4, 0.75, Math.cos(az) * 0.55 + Math.sin(az) * 0.4).normalize();
  // Set the sky, ground and weather of a view: its climate state st, blended in by k.
  const SU = bg.material.uniforms, GU = ground.material.uniforms;
  function applyClimate(st, k, aspect, proj, opacity) {
    const sky = mixSky(SKY.base, st.sky, k);
    SU.uTop.value.setRGB(...sky.top); SU.uBot.value.setRGB(...sky.bot); SU.uBand.value.setRGB(...sky.band);
    SU.uSun.value.set(...sky.sun); SU.uSunCol.value.setRGB(...sky.sunCol);
    SU.uCloud.value = sky.cloud; SU.uCloudCol.value.setRGB(...sky.cloudCol);
    SU.uAspect.value = aspect;
    GU.uDry.value = st.dry * k; GU.uSnow.value = st.frost * k; GU.uChar.value = st.char * k; GU.uWet.value = st.wet * k;
    SU.uHeat.value = st.heat * k;
    GU.uGrid.value.setRGB(...mix3(GRID.base, st.grid, k));
    for (const [kind, w] of Object.entries(weather)) {
      const rate = (kind === 'snow' ? st.snow : st[kind]) * k;
      w.visible = rate > 0.01 && opacity > 0.01;
      w.material.uniforms.uRate.value = rate;
      w.material.uniforms.uOpacity.value = opacity * Math.min(1, 0.4 + rate);
      w.material.uniforms.uProj.value = proj;
    }
  }
  // Draw each view into its own viewport, with only its trees visible. A view filling the frame keeps what is
  // drawn behind it (the globe, while the forest fades in or out); the others clear their box first.
  const treeCam = new THREE.PerspectiveCamera(40, 1, 0.05, 400), cohortCam = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
  const cohortTrees = cohorts.flatMap(c => c.trees);
  const allTrees = [hero, ...panels.slice(1).map(P => P.tree), ...cohortTrees];
  let lidarOn = false;
  function drawViews(views) {
    const opacity = bg.material.uniforms.uOpacity.value;
    renderer.setScissorTest(true);
    views.forEach(V => {
      const R = V.R;
      if (R.k < 0.002 || R.x >= W || R.x + R.w <= 0 || R.w < 2 || R.h < 2) return;
      renderer.setViewport(R.x, H - R.y - R.h, R.w, R.h);
      renderer.setScissor(R.x, H - R.y - R.h, R.w, R.h);
      if (R.w >= W - 0.5 && R.h >= H - 0.5) renderer.clearDepth(); else renderer.clear();
      allTrees.forEach(t => { t.visible = false; });
      V.trees.forEach(t => { t.visible = true; });
      lidar.group.visible = !!V.lidar && lidarOn;
      V.cam.aspect = R.w / R.h;
      V.cam.updateProjectionMatrix();
      const proj = R.h * 0.5 / Math.tan(THREE.MathUtils.degToRad(V.cam.fov) / 2);
      V.trees.forEach(t => { t.material.uniforms.uProj.value = proj; });
      motes.material.uniforms.uProj.value = proj;
      if (V.flames) V.flames.material.uniforms.uProj.value = proj;
      ground.material.uniforms.uShade.value = V.shade;
      bg.material.uniforms.uOpacity.value = opacity;   // a view keeps its sky while it slides, never a black box
      applyClimate(V.state, R.k, R.w / R.h, proj, opacity);
      renderer.render(fScene, V.cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    bg.material.uniforms.uOpacity.value = opacity;
    applyClimate(CALM, 0, aspect, H * 0.5 / Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2), 0);
    allTrees.forEach(t => { t.visible = false; });
  }
  function project(v, cam) {
    tmp.copy(v).project(cam);
    return {x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, z: tmp.z};
  }
  const amazon = story.ages;

  let last = performance.now(), time = 0;
  // opt.intro: the sunrise's progress (0..1), when the rendered film times it to its music; opt.dry: update
  // every state without drawing (a parallel renderer replays the film up to its first frame this way)
  function render(pNow, tFixed, opt = {}) {
    p = pNow;
    u = storyU(p);
    if (film) u = filmU(u);
    let dt;
    if (tFixed !== undefined) { dt = Math.max(0, tFixed - time); time = tFixed; }
    else { const now = performance.now(); dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt; }

    // ---------- globe state (a chain of eased keyframes)
    // Turn to the Amazon first, fly straight down onto the highlighted cell, then on into the forest inside it.
    const kDive = ease(ss(0.55, 1.62, u)), kRot = ease(ss(0.55, 1.45, u)), kGround = ss(1.62, 1.96, u);
    if (!drag.active) { heroY += (reduced ? 0 : dt * 0.06 * (1 - kRot)) + drag.vy; drag.vy *= 0.92; }
    // the case for emulators turns the globe along its own path, from wherever the hero left it; the dive then
    // sets off from where the path ends
    if (p > WHY[0] && p < WHY[1]) {
      if (!whyFrom) whyFrom = {x: heroTilt, y: heroY};
      const P = whyRot(p), k = ease(ss(WHY[0], whyKeys[0].p, p));
      heroY = whyFrom.y + wrapPi(P.y - whyFrom.y) * k;
      heroTilt = lerp(whyFrom.x, P.x, k);
      drag.vy = 0;
    } else if (p <= WHY[0]) whyFrom = null;
    let rx = lerp(heroTilt, targetRot.x, kRot) + (groundRot.x - targetRot.x) * kGround;
    let ry = heroY + wrapPi(targetRot.y - heroY) * kRot + (groundRot.y - targetRot.y) * kGround;
    let alt = Math.exp(lerp(Math.log(L.hero.d - 1), Math.log(DIVE_ALT), kDive));
    alt = Math.exp(lerp(Math.log(alt), Math.log(GROUND_ALT), kGround));
    const kWhy = ease(ss(WHY[0], WHY[0] + 0.3, p)), H0 = {x: lerp(L.hero.x, L.why.x, kWhy), y: lerp(L.hero.y, L.why.y, kWhy), s: lerp(L.hero.s, L.why.s, kWhy)};
    let gx = lerp(H0.x, 0, kRot), gy = lerp(H0.y, 0, kRot), gs = lerp(H0.s, 1, kRot);
    if (u > 6.45) {
      // pull back out to the planet, settling right of the caption
      const kOut = ease(ss(6.6, 7.3, u));
      alt = Math.exp(lerp(Math.log(DIVE_ALT), Math.log(L.planet.d - 1), kOut));
      // swinging west across the Pacific as it rises, it settles on East Asia and Australia, then turns west
      // while the forests grow, past India, Africa and Europe and over the Atlantic to the Americas in 2021
      const kSpin = ss(7.32, 7.97, u), drift = Math.max(0, u - 7.3) * 0.3;
      rx = lerp(lerp(targetRot.x, ASIA.x, kOut), AMERICAS.x, kSpin);
      ry = targetRot.y + west(ASIA.y - targetRot.y) * ease(ss(6.75, 7.3, u)) + (west(AMERICAS.y - ASIA.y) - 0.2) * kSpin + drift;
      gx = lerp(0, L.planet.x, kOut); gy = lerp(0, L.planet.y, kOut); gs = lerp(1, L.planet.s, kOut);
    }
    let dist = 1 + alt;
    // kNum brings the planet to the centre (where the film shows its digital twin), dimming it after
    const kNet = ease(ss(7.9, 8.45, u)), kFc = ease(ss(9.45, 9.9, u)), kNum = ease(ss(10.65, 10.95, u)), kEnd = ease(ss(11.7, 12.45, u));
    const kDim = ss(10.95, 11.1, u);
    if (u > 7.45) {
      dist = lerp(dist, L.net.d, kNet);
      gx = lerp(gx, L.net.gx, kNet); gy = lerp(gy, L.net.gy, kNet); gs = lerp(gs, L.net.gs, kNet);
      gx = lerp(gx, L.fc.gx, kFc); gy = lerp(gy, L.fc.gy, kFc); gs = lerp(gs, L.fc.gs, kFc);
      dist = lerp(dist, 4.3, kNum); gx = lerp(gx, 0, kNum); gy = lerp(gy, 0, kNum); gs = lerp(gs, L.narrow ? 0.95 : 1.3, kNum);
      dist = lerp(dist, L.end.d, kEnd); gx = lerp(gx, 0, kEnd); gy = lerp(gy, L.end.y, kEnd); gs = lerp(gs, L.end.s, kEnd);
      // the twin and the numbers face the Americas, still turning slowly; the end card faces the Amazon,
      // tilted so its horizon runs just north of the equator
      ry += wrapPi(END_RY - 0.4 - ry) * kNum + Math.max(0, u - 10.95) * 0.5;
      rx = lerp(rx, END_TILT, kEnd);
      endSpin = kEnd > 0 ? endSpin + Math.min(dt, 0.1) * 0.03 : 0;
      ry += wrapPi(END_RY - ry) * kEnd + endSpin;
    }
    G.group.position.set(gx, gy, 0);
    G.group.scale.setScalar(gs);
    G.spin.rotation.set(rx, ry, 0, 'XYZ');
    gCam.position.set(0, 0, dist);
    gCam.lookAt(0, 0, 0);
    gCam.updateMatrixWorld();
    gCam.near = Math.max(0.0002, (dist - gs) * 0.3);
    gCam.updateProjectionMatrix();

    const U = G.uniforms;
    U.uTime.value = time;
    // dark planet and a ring of light; the sun flares on the limb, then sweeps round to the front
    const kIn = opt.intro ?? (INTRO ? clamp(time / INTRO) : 1), kSun = ss(0.3, 1, kIn);
    U.uSun.value.copy(SUN0).lerp(SUN, kSun * kSun * (3 - 2 * kSun)).normalize();
    U.uNight.value = lerp(0.2, 1, ss(0.35, 1, kIn));
    G.atmoUniforms.uEclipse.value = 1 - ss(0.3, 0.85, kIn);
    U.uSun.value.lerp(SUN_END, kEnd).normalize();
    const I0 = ss(0.08, 0.3, kIn) * (1 - ss(0.4, 0.72, kIn)), I1 = 0.5 * ss(0.35, 1, kEnd);
    flare.visible = I0 + I1 > 0.003;
    if (I0 > 0.003) {
      // on the limb, toward the sun as seen from the camera
      const c = G.group.position, view = tmp.copy(c).sub(gCam.position).normalize();
      const side = sunSide.copy(U.uSun.value).addScaledVector(view, -U.uSun.value.dot(view)).normalize();
      flare.position.copy(c).addScaledVector(side, gs * 0.97);
      flare.position.z += gs * 0.2;
      flare.scale.setScalar(gs * 3.2);
      flare.material.uniforms.uI.value = I0;
    } else if (I1 > 0.003) {
      // on the horizon of the end card's planet: where the camera's line of sight grazes it
      const n = Math.hypot(gy, dist), uy = -gy / n, uz = dist / n, cp = gs / n, sp = Math.sqrt(Math.max(0, 1 - cp * cp));
      flare.position.set(gx, gy + gs * (cp * uy + sp * uz), gs * (cp * uz - sp * uy) + 0.05);
      flare.scale.setScalar(2.4);
      flare.material.uniforms.uI.value = I1;
    }
    stars.material.uniforms.uOpacity.value = ss(0, 0.45, kIn);
    // On the way down to the Amazon the real forest shows, untinted and a little brighter. While the
    // planet's forests grow they stand in relief instead of tinting the globe, and the clouds thin.
    // Clouds part as the camera nears the ground.
    const near = ss(0.8, 1.5, u) * (1 - ss(6.8, 7.15, u));
    const growing = ss(6.9, 7.3, u) * (1 - ss(7.95, 8.4, u));
    const relief = ss(6.95, 7.3, u) * (1 - ss(7.95, 8.3, u));
    U.uDataMix.value = (1 - 0.92 * near) * (1 - (forest ? 0 : 0.85) * relief);
    U.uGrowth.value = forest ? 0.6 * growing : 0;
    U.uExposure.value = 1 + 0.4 * near;
    // ... and thin on the opening's map, more while the planet warms
    const flatK = ease(ss(FLAT[0], FLAT[1], p)) * (1 - ease(ss(FLAT[2], FLAT[3], p)));
    const heatA = ss(HEAT[0], HEAT[1], p) * (1 - ss(HEAT[3], HEAT[4], p));
    U.uCloud.value = 0.62 * (1 - ss(0.9, 1.5, u) * (1 - ss(6.85, 7.2, u))) * (1 - 0.5 * growing) * (1 - 0.35 * flatK - 0.3 * heatA);
    U.uHeatMix.value = heatA;
    U.uHeatT.value = 7 * ss(HEAT[1], HEAT[2], p);
    U.uFlat.value = flatK;
    U.uMapC.value.set(L.map.x, L.map.y, 0);
    U.uMapS.value = L.map.s;
    const KU = marks.uniforms;
    KU.uP.value = p; KU.uTime.value = time; KU.uOut.value = 1 - ss(HEAT[3] - 0.05, HEAT[4] - 0.05, p);
    KU.uGain.value = 1 - 0.55 * ss(HEAT[0], HEAT[1], p);   // the events step back while the planet warms
    marks.points.visible = p > 0.6 && p < HEAT[4];
    // the satellite lidar's tracks build up as the planet pulls back from the forest: the station's pass over the
    // site, then orbit after orbit, faster and faster; they leave as the planet's own forests begin to grow
    gedi.update(0.06 * ss(6.62, 6.84, u) + (gedi.orbits - 0.06) * ss(6.82, 7.28, u) ** 1.7, ss(6.6, 6.68, u) * (1 - ss(7.28, 7.42, u)));
    canopy.mesh.visible = !forest && relief > 0.002;
    const CU = canopy.uniforms;
    CU.uOpacity.value = relief;
    CU.uLift.value = 0.05 * relief;
    U.uCloudShift.value = time * 0.0016;
    // the planet comes back in 1981, under the flash that ends the forest chapters, and grows to 2021
    U.uYear.value = u < 6.45 ? 40 : 40 * ss(7.32, 7.95, u);
    CU.uYear.value = U.uYear.value;
    if (forest) {
      const FU = forest.uniforms;
      forest.group.visible = relief > 0.002;
      FU.uOpacity.value = relief;
      FU.uLift.value = 0.035 * relief;
      FU.uYear.value = U.uYear.value;
      FU.uPx.value = px;
    }
    CU.uCenter.value.copy(G.group.position);
    // the dive goes straight down into the forest; the grid and its cell appear only on the way back up
    U.uGridMix.value = u > 6.6 && u < 7.05 ? 1 : 0;
    U.uTargetMix.value = ss(6.55, 6.7, u) * (1 - ss(6.75, 7, u));
    // what an emulator saves fills the frame over a dimmed planet and network
    const speedA = ss(SPEED[0] - 0.05, SPEED[0] + 0.12, p) * (1 - ss(SPEED[1] - 0.12, SPEED[1] + 0.05, p));
    U.uDim.value = lerp(lerp(1, film ? 0.3 : 0.45, kDim), 1, kEnd) * lerp(1, 0.6, kFc * (1 - kNum)) * (1 - 0.6 * speedA);
    // the photographic Earth gives way to its digital twin behind a scan line, and comes back for the end card
    U.uTwin.value = -1.25 + 2.5 * ss(10.68, 10.95, u);
    U.uTwinMix.value = u > 10.6 ? 1 - ss(11.7, 12.15, u) : 0;
    G.atmoUniforms.uOpacity.value = clamp((dist / gs - 1.25) / 0.6) * (1 - flatK);
    G.atmoUniforms.uCenter.value.copy(G.group.position);
    stars.material.uniforms.uTime.value = time;
    stars.rotation.y = time * 0.004;

    // network & streams
    const netA = ss(8.2, 8.55, u) * (1 - (film ? 1 : 0.7) * ss(9.55, 9.8, u)) * (1 - ss(10.6, 10.85, u)) * (1 - 0.8 * speedA);
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
    // the forest fades in at the end of the dive and out as the camera rises; in between it runs on its own clock
    const v = p - VIEWS[0], fA = ss(1.9, 2.06, u) * (1 - ss(6.53, 6.71, u));
    const kS = ss(SPLIT[0], SPLIT[1], v), kM = ss(MERGE[0], MERGE[1], v);
    const year = viewYear(v);
    const hMain = at(amazon['1'].height, year), lai = at(amazon['1'].lai, year);
    const Hm = hMain / 10;
    const rects = fA > 0.001 ? viewRects(kS, kM) : null;
    const cohortA = rects ? rects.cohort.k : 0;
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
      });
    });
    const sharedT = fScene.children;
    for (const o of sharedT) if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = time;
    // each view's year: its own story in the film, the shared years on the page
    const kF = year / 40;
    panels.forEach(P => { P.y = film && P.story ? storyYear(P.story, kF) : year; P.state = P.clim(P.y); });
    // the tree: sprouts as the forest appears, then follows the simulated years
    const HU = hero.material.uniforms, sprout = ss(SPROUT[0], SPROUT[1], v);
    HU.uT.value = v < YEARS[0] ? lerp(PRE_TAU, 0, sprout) : year / 40;
    HU.uTop.value = Math.max(0.5, hMain * (v < YEARS[0] ? sprout : 1));
    const leafR = leafRatio(amazon['1'].lai, year);
    HU.uLeaf.value = clamp(leafR * leafR, 0.35, 1);
    HU.uStress.value = clamp((1 - leafR) * 3.5);
    HU.uOpacity.value = fA;
    ground.material.uniforms.uOpacity.value = fA;
    motes.material.uniforms.uOpacity.value = fA;
    bg.material.uniforms.uOpacity.value = fA;

    // cameras, all slowly circling the site: the tree's view starts as the full frame's close-up of the sapling and
    // pulls back to frame a grown tree; the fifteen-age view looks over the whole stand, from further away in its
    // column, and at the end rises straight up away from the forest
    const az = 0.5 + 0.3 * v;
    const tyA = Hm * 0.5;
    const rA = L.narrow ? 1.6 + Hm * 4.6 : 1.3 + Hm * 2.4, cyA = 0.25 + Hm * 0.42;
    const viewDist = PANEL_VIEW / (2 * Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2)), kT = ease(kS);
    const treeDist = viewDist * TREE_VIEW / PANEL_VIEW;   // the tree's own column, without a header to clear, frames it closer
    treeCam.position.set(Math.cos(az) * lerp(rA, treeDist, kT), lerp(cyA, 1.0, kT), Math.sin(az) * lerp(rA, treeDist, kT));
    treeCam.lookAt(0, lerp(tyA, 1.75, kT), 0);
    keyLight(HU.uLight.value, az);
    const cR = rects ? rects.cols[2] : {w: 1, h: 1}, rC = clamp(9.5 / (cR.w / cR.h * 0.364), 18, 34);
    const kC = ease(kM), c = ease(ss(6.3, 6.7, u));
    const rF = lerp(lerp(rC, mobile ? 27 : 22, kC), 3, c), cyF = lerp(lerp(rC * 0.36, 8, kC), 48, c), tyF = lerp(lerp(1.2, 1.5, kC), 0, c);
    cohortCam.position.set(Math.cos(az) * rF, cyF, Math.sin(az) * rF);
    cohortCam.lookAt(0, tyF, 0);
    cohortCam.updateMatrixWorld();
    // a satellite lidar pass over the grown fifteen-age forest, across the frame
    const lk = opt.lidar ?? ss(6.2, 6.42, u);
    const lidarA = (lk > 0.001 ? 1 : 0) * fA * kM * (1 - ss(6.45, 6.6, u));
    if (lidarA > 0.002) lidarDir.setFromMatrixColumn(cohortCam.matrixWorld, 0).setY(0).normalize();
    lidar.update(lk, lidarA, lidarDir, canopyTop, time);
    lidarOn = lidarA > 0.002;

    // four forcings: every view shares one scale so heights compare directly
    panels.forEach((P, i) => {
      const U = P.tree.material.uniforms, pa = az + (i + 1) * 0.9;
      if (i > 0) {
        const y = P.y;
        U.uT.value = P.clock ? P.clock(y) : y / 40;
        U.uTop.value = Math.max(0.5, (P.top ?? P.h)(y));
        const lr = P.leaf ? P.leaf(y) : 1;
        U.uLeaf.value = clamp(lr * lr, P.min ?? 0.35, 1);
        U.uStress.value = P.stress ? P.stress(y) : clamp((1 - lr) * 3.5);
        U.uDieback.value = P.dieback ? P.dieback(y) : 0;
        U.uFall.value = P.fall ? P.fall(y) : 0;
        U.uKeep.value = P.keep ? P.keep(y) : 1;
        U.uOpacity.value = fA * (rects ? rects.panels[i].k : 0);
        keyLight(U.uLight.value, pa);
        if (P.flames) {
          const F = P.flames.material.uniforms;
          F.uT.value = y / 40; F.uTime.value = time; F.uH.value = young.height[FIRE]; F.uOpacity.value = U.uOpacity.value;
        }
      }
      P.cam.position.set(Math.cos(pa) * viewDist, 1.15, Math.sin(pa) * viewDist);
      P.cam.lookAt(0, PANEL_TGT, 0);
    });

    // the views, drawn in order: the tree's last while it shrinks out of the full frame, the fifteen-age view last
    // while it grows back over the others; once it fills the frame, only it
    let views = null;
    if (rects) {
      const hs = Math.max(0.2, hMain * 0.034);
      const tv = {R: rects.tree, cam: treeCam, state: CALM, trees: heroReady ? [hero] : [], shade: hs};
      const pv = panels.map((P, i) => ({R: rects.panels[i], cam: P.cam, state: P.state, flames: P.flames, shade: Math.max(0.2, P.h(P.y) * 0.034),
        trees: (i === 0 ? heroReady : panelsReady) ? [P.tree] : []}));
      const cv = {R: rects.cohort, cam: cohortCam, state: CALM, lidar: true, shade: hs,
        trees: [...(heroReady ? [hero] : []), ...(cohortsReady ? cohortTrees : [])]};
      views = kM >= 1 ? [cv] : kM > 0 ? [tv, ...pv, cv] : [...pv, cv, tv];
    }

    // ---------- draw
    if (!opt.dry) {
      post?.begin();
      renderer.clear();
      if (fA < 0.999) renderer.render(gScene, gCam);   // the globe, until the forest covers it
      if (views) drawViews(views);
      post?.end();
    }

    // ---------- DOM overlays
    dom.panels.style.visibility = rects ? 'visible' : 'hidden';
    if (rects) {
      // frames and headers show once the views have settled, so they never overlap as views move, and leave as the
      // fifteen-age view takes the frame
      const out = 1 - ss(0, 0.3, kM), settled = ss(0.9, 1, kS) * fA * out;
      const place = (el, R, a) => {
        el.style.opacity = a.toFixed(3);
        el.style.transform = `translate(${R.x.toFixed(1)}px, ${R.y.toFixed(1)}px)`;
        el.style.width = `${R.w.toFixed(1)}px`;
        el.style.height = `${R.h.toFixed(1)}px`;
      };
      place(treeFrame, rects.tree, settled);
      place(cohortFrame, rects.cohort, settled * ss(0.55, 1, cohortA));
      const cols = rects.cols;
      colLabels.forEach((el, i) => {
        el.style.opacity = (settled * (i === 1 ? ss(0.55, 1, rects.panels[0].k) : i === 2 ? ss(0.55, 1, cohortA) : 1)).toFixed(3);
        el.style.transform = `translate(${cols[i].x.toFixed(1)}px, ${(cols[i].y - rects.lab).toFixed(1)}px)`;
      });
      panelYear.style.opacity = (ss(0.6, 1, kS) * fA * out).toFixed(3);
      panelYear.style.transform = `translate(${(cols[2].x + cols[2].w - panelYear.offsetWidth).toFixed(1)}px, ${(cols[0].y - rects.lab - panelYear.offsetHeight - 4).toFixed(1)}px)`;
      panelYear.lastChild.textContent = 1981 + Math.round(year);
      treeH.textContent = hMain.toFixed(1);
      treeAgb.textContent = at(amazon['1'].agb, year).toFixed(1);
      treeLai.textContent = lai.toFixed(1);
      cohorts.forEach((c, i) => { barEls[i].style.height = `${clamp(c.h / 34) * 100}%`; });
      // the climate strip fills in up to the current year
      const cur = Math.round(clamp(year / 40) * 1000) / 10;
      panels.forEach((P, i) => {
        const R = rects.panels[i], el = P.el;
        place(el, R, settled * ss(0.55, 1, R.k));
        P.hEl.textContent = P.h(P.y).toFixed(1);
        P.agbEl.textContent = P.agb(P.y).toFixed(1);
        if (cur !== P.cur) { P.cur = cur; P.curEl.style.left = `${cur}%`; P.pastEl.style.clipPath = `inset(-2px ${(100 - cur).toFixed(1)}% -2px 0)`; }
        P.iconEl.classList.toggle('on', P.state.on);
        if (P.note) {
          const n = P.note(P.y);
          if (n && P.noteEl.textContent !== n) P.noteEl.textContent = n;
          P.noteEl.classList.toggle('on', !!n);
        }
      });
    }
    dom.flash.style.opacity = (ss(1.93, 1.975, u) * (1 - ss(1.99, 2.25, u)) * 0.55 + ss(6.47, 6.59, u) * (1 - ss(6.63, 6.85, u)) * 0.3).toFixed(3);

    // the fifteen-age forest's ages by their stands: a few in its column, all of them once it fills the frame,
    // gone before the satellite passes
    const labA = rects ? ss(0.75, 1, kS) * fA * (1 - ss(MERGE[1] - 0.3, MERGE[1] - 0.05, v)) : 0;
    cohorts.forEach((co, i) => {
      const el = labelEls[i], R = rects?.cohort;
      const a = labA * (LABELLED.has(co.age) ? 1 : ss(0.6, 1, kM));
      if (a < 0.01) { el.style.opacity = 0; return; }
      tmp.set(co.cx, co.h / 10 + 0.5, co.cz).project(cohortCam);
      const x = R.x + (tmp.x * 0.5 + 0.5) * R.w, y = R.y + (-tmp.y * 0.5 + 0.5) * R.h;
      const inside = tmp.z < 1 && x > R.x + 24 && x < R.x + R.w - 24 && y > R.y + 60 && y < R.y + R.h - 8;
      el.style.opacity = inside ? a.toFixed(3) : 0;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    });

    // the events' labels sit by their markers while they face the camera, kept on screen, each for a while after it
    // pops; a phone shows only the latest one. The caption's legend lights each kind with its first event.
    const latest = whyLabels.reduce((m, L, i) => (p >= L.t ? i : m), -1), map = L.map;
    whyLabels.forEach((L, i) => {
      const a = marks.points.visible && (!L.narrow || i === latest) ? ss(L.t + 0.02, L.t + 0.1, p) * (1 - ss(L.t + 0.42, L.t + 0.52, p)) * KU.uOut.value : 0;
      if (a < 0.01) { if (L.on) { L.el.style.opacity = 0; L.on = false; } return; }
      const q = markOf[i] * 3, f = marks.flat;
      G.spin.localToWorld(tmp.set(marks.positions[q], marks.positions[q + 1], marks.positions[q + 2]));
      const mu = lerp(nrm.copy(tmp).sub(G.group.position).normalize().dot(eye.copy(gCam.position).sub(tmp).normalize()), 1, flatK);
      tmp.lerp(nrm.set(map.x + f[q / 3 * 2] * map.s, map.y + f[q / 3 * 2 + 1] * map.s, 0.01), flatK);
      const s = project(tmp, gCam);
      L.el.style.opacity = (a * ss(0.15, 0.35, mu)).toFixed(3);
      const w = L.w || (L.w = L.el.offsetWidth), h = L.h || (L.h = L.el.offsetHeight);
      const x = clamp(L.el.dataset.side === 'left' || s.x + 20 + w > W - 8 ? s.x - 20 - w : s.x + 20, 8, W - w - 8);
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${(s.y - h / 2).toFixed(1)}px)`;
      L.on = true;
    });
    kindEls.forEach(K => K.el.classList.toggle('on', p >= K.t));
    const pulse = whyLabels.reduce((m, L) => (p >= L.t ? Math.max(m, Math.exp(-(p - L.t) / 0.035)) : m), 0) * KU.uOut.value;
    dom.alarm.style.opacity = Math.min(1, 0.5 * pulse + 0.55 * heatA * ss(0.5, 1, U.uHeatT.value / 7)).toFixed(3);
    // the warming's period and its mean over forests
    if (p > HEAT[0] && p < HEAT[4]) {
      const t = U.uHeatT.value, i = Math.min(6, Math.floor(t)), f = t - i, y0 = 1981 + 5 * Math.round(t);
      const m = lerp(HEAT_MEAN[i], HEAT_MEAN[i + 1], f);
      dom.heatYears.textContent = `${y0}–${String(y0 + 4).slice(2)}`;
      dom.heatMean.textContent = `${m < 0 ? '−' : '+'}${Math.abs(m).toFixed(2)}`;
    }
    // the clock of one global run, counting while the planet's forests grow, then what more would cost
    if (u > 7.2 && p < SLOW[1] + 0.3) {
      const k = U.uYear.value / 40;
      dom.simDays.textContent = (40.6 * k).toFixed(1);
      dom.simYear.textContent = 1981 + Math.round(U.uYear.value);
      dom.simBar.style.transform = `scaleX(${k.toFixed(4)})`;
      dom.sim.style.setProperty('--r1', ss(SLOW[0] + 0.12, SLOW[0] + 0.27, p).toFixed(3));
      dom.sim.style.setProperty('--r2', ss(SLOW[0] + 0.32, SLOW[0] + 0.47, p).toFixed(3));
    }
    // ED and its emulator race one global run: the clock runs on a log scale, so the emulator's 1.2 hours finish
    // early and ED's 974 hours fill the rest; then the bill
    if (p > SPEED[0] - 0.1 && p < SPEED[1] + 0.1) {
      const k = ss(SPEED[0] + 0.12, SPEED[0] + 0.62, p), T = Math.expm1(k * Math.log1p(974.4));
      dom.raceT.textContent = T < 48 ? `${T.toFixed(T < 10 ? 1 : 0)} h` : `${(T / 24).toFixed(1)} days`;
      dom.raceEd.style.transform = `scaleX(${(T / 974.4).toFixed(4)})`;
      dom.raceAi.style.transform = `scaleX(${Math.min(1, T / 1.2).toFixed(4)})`;
      dom.speed.classList.toggle('ai-done', T >= 1.2);
      dom.speed.classList.toggle('ed-done', k >= 1);
      dom.speed.style.setProperty('--bill', ss(SPEED[0] + 0.64, SPEED[0] + 0.8, p).toFixed(3));
    }

    // annotations appear with the parts they name; the forcing's names the map at the front of the deck
    const nlA = ss(8.4, 8.65, u) * (1 - ss(9.3, 9.5, u));
    if (nlA > 0.01 && netVar) {
      const t = net.frontLabel();
      if (t !== netVar.textContent) { netVar.textContent = t; netVar.style.color = scen.maps.vars[net.deck.front].ramp[3]; }
    }
    for (const [k, el] of Object.entries(netLabelEls)) {
      const st = net.stages[k] ?? 0, o = nlA * ss(st, st + 0.12, build);
      if (o < 0.01) { el.style.opacity = 0; continue; }
      const p = project(net.group.localToWorld(tmp.copy(net.anchors[k === 'title' && L.netPx < 150 ? 'titleFew' : k])), gCam);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, ${BELOW.has(k) ? '0%' : '-100%'})`;
    }
  }

  return {render, resize, renderer, ready: Promise.all(grown.ready), dispose() { renderer.dispose(); }};
}
