// The scroll-driven film: hero globe -> one forest -> four forcings -> fifteen ages -> planet -> emulator -> what if -> numbers.
import * as THREE from '../assets/vendor/three.module.js';
import {createGlobe, createCanopy, createStars, createFlare, facing, cellOf, latLonToVec3} from './globe.js';
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
const AGES = [1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const DIVE_ALT = 0.2;      // altitude (globe radii) the dive passes on its way down to the Amazon
const GROUND_ALT = 0.002;  // ... and where it ends, about 13 km above the forest
const GROUND = {lat: -3.29, lon: -63.68};   // the forest at the head of a lake, by the chapter's site

// Interpolate a 41-element annual series at fractional year index.
const at = (series, y) => { const i = Math.floor(y), f = y - i; return i >= 40 ? series[40] : series[i] * (1 - f) + series[i + 1] * f; };

// Year index (0..40) of the forest chapters as a function of film position u. Each return to 1981
// happens at the bottom of a short dip to dark, so trees never visibly shrink.
const DIPS = [3.5, 5.32];
const dipAt = u => DIPS.reduce((m, c) => Math.max(m, ss(c - 0.06, c, u) * (1 - ss(c, c + 0.09, u))), 0);
function forestYear(u) {
  if (u < 2.15) return 0;
  if (u < 3.45) return 40 * (u - 2.15) / 1.3;          // one forest
  if (u < DIPS[0]) return 40;
  if (u < 3.9) return 0;
  if (u < 4.9) return 40 * (u - 3.9);                  // four forcings
  if (u < DIPS[1]) return 40;                          // the views merge back into one
  if (u < 5.4) return 0;
  return 40 * clamp(u - 5.4);                          // fifteen ages
}
// Year of a forcing view's own story at progress k (0..1): [[k, year], ...], linear in between.
const storyYear = (keys, k) => {
  for (let i = 1; i < keys.length; i++) if (k <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (k - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  return keys[keys.length - 1][1];
};
// Split of the forest view into four: 0 = one view, 1 = four.
const splitK = u => ease(ss(3.5, 3.8, u)) * (1 - ease(ss(5.0, 5.25, u)));

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
  const ICONS = {
    wet: '<path d="M6.8 15.2h9.9a3.7 3.7 0 0 0 .4-7.4 5.3 5.3 0 0 0-10.2-1.1 4.3 4.3 0 0 0-.1 8.5z"/><path d="M8.6 18 7.7 20.3M12.4 18l-.9 2.3M16.2 18l-.9 2.3"/>',
    drought: '<circle cx="12" cy="9.2" r="3.3"/><path d="M12 2.6v1.5M12 14.3v1.5M5.4 9.2H3.9M20.1 9.2h-1.5M7.3 4.5l1.1 1.1M16.7 4.5l-1.1 1.1M7.3 13.9l1.1-1.1M16.7 13.9l-1.1-1.1"/><path d="M3 19.6h18M6.8 19.6l1.7-1.5 1 1.1 1.6-1.6M14.6 19.6l1.3-1.2 1 .9"/>',
    fire: '<path d="M12 2.8c.7 3.3 5 5.3 5 10.1a5 5 0 0 1-10 0c0-2.3 1.1-3.9 2.3-5.1.2 1.6.9 2.6 2 3.1-.6-2.6-.1-5.5.7-8.1z"/><path d="M12 20.5a2.1 2.1 0 0 1-2.1-2.1c0-1.3 1.1-2.1 2.1-3.4 1 1.3 2.1 2.1 2.1 3.4a2.1 2.1 0 0 1-2.1 2.1z"/>',
    cold: [0, 60, 120, 180, 240, 300].map(a => {
      const r = Math.PI * a / 180, u = [Math.sin(r), -Math.cos(r)], v = [Math.cos(r), Math.sin(r)];
      const P2 = (d, w) => `${(12 + u[0] * d + v[0] * w).toFixed(2)} ${(12 + u[1] * d + v[1] * w).toFixed(2)}`;
      return `M12 12L${P2(9, 0)}M${P2(4.6, -2.4)}L${P2(6.6, 0)}L${P2(4.6, 2.4)}`;
    }).reduce((d, x) => d + x, '<path d="') + '"/><circle cx="12" cy="12" r="1.2"/>',
  };
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
  dom.panels.innerHTML = '<div class="panels-year"><small>Year</small><b>1981</b></div>' + panels.map(P => `<div class="panel p-${P.key}" style="--pc:${P.color}">
    <div class="p-top"><div class="p-head"><svg class="p-icon" viewBox="0 0 24 24">${ICONS[P.key]}</svg>
      <p class="p-title"><b>${P.title}${P.tag ? `<i>${P.tag}</i>` : ''}</b><span>${P.lines[0]}</span><span>${P.lines[1]}</span></p></div>
      <div class="p-clim"><span class="p-key"><i>rain</i><i>temp</i></span><span class="p-strip">${strip(P)}<i class="p-cur"></i></span></div>
      ${map(P)}</div>
    <p class="p-note"></p>
    <p class="p-stats"><span><small>Canopy height</small><b>0</b> m</span><span><small>Biomass</small><b>0</b> kgC m⁻²</span></p></div>`).join('');
  const panelYear = dom.panels.firstElementChild;
  panels.forEach((P, i) => {
    P.el = dom.panels.children[i + 1];
    [P.hEl, P.agbEl] = P.el.querySelectorAll('.p-stats b');
    P.noteEl = P.el.querySelector('.p-note');
    P.iconEl = P.el.querySelector('.p-icon');
    P.curEl = P.el.querySelector('.p-cur');
    P.pastEl = P.el.querySelector('.p-past');
    P.cur = -1;
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
  const netVar = dom.netLabels.querySelector('.net-var');
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
    post?.setSize();
    gCam.aspect = fCam.aspect = aspect;
    gCam.updateProjectionMatrix(); fCam.updateProjectionMatrix();
    const proj = H * 0.5 / Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2);
    fScene.traverse(o => { if (o.material?.uniforms?.uProj) o.material.uniforms.uProj.value = proj; });
    const t = Math.tan(THREE.MathUtils.degToRad(gCam.fov) / 2);
    miniTree.material.uniforms.uProj.value = H * 0.5 / t;
    const narrow = aspect < 0.85;
    // hero: globe to the right of the title (or above it on phones)
    const dh = 4.2, hh = dh * t, hw = hh * aspect;
    L.hero = narrow ? {x: 0, y: hh * 0.55, s: Math.min(0.82, hw * 0.78), d: dh} : {x: hw * 0.5, y: 0, s: 0.95, d: dh};
    L.planet = narrow ? {x: 0, y: -hh * 0.18, s: Math.min(0.9, hw * 0.85), d: dh} : {x: hw * 0.36, y: 0, s: 1, d: dh};
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
    const cap = dom.forcingCap;
    L.capBottom = cap ? cap.offsetTop + cap.offsetHeight : 0;
    // narrow views get a one-line readout, and the narrowest drop their maps
    const pw = panelRects(1)[0].w;
    dom.panels.classList.toggle('compact', narrow || pw < 300);
    dom.panels.classList.toggle('nomap', pw < 236);
  }
  resize();

  const tmp = new THREE.Vector3(), mainTgt = new THREE.Vector3(), sunSide = new THREE.Vector3();
  const PANEL_VIEW = 4.8;   // world units (10 m) of height each forcing view shows
  const PANEL_TGT = 2.2;    // height the views look at, leaving room for the headers above the crowns
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
  // Draw each forcing view into its own viewport, with only its tree visible. Chapter one's view goes
  // last, so as it shrinks into the first panel it uncovers the others, and covers them as it grows back.
  const DRAW_ORDER = [1, 2, 3, 0];
  function drawPanels(rects) {
    const full = H * 0.5 / Math.tan(THREE.MathUtils.degToRad(fCam.fov) / 2);
    const trees = panels.map(P => P.tree), opacity = bg.material.uniforms.uOpacity.value;
    renderer.setScissorTest(true);
    DRAW_ORDER.forEach(i => {
      const R = rects[i];
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
      ground.material.uniforms.uShade.value = Math.max(0.2, P.h(P.y) * 0.034);
      bg.material.uniforms.uOpacity.value = opacity;   // a view keeps its sky while it slides, never a black box
      applyClimate(P.state, R.k, R.w / R.h, proj, opacity);
      renderer.render(fScene, P.cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    hero.material.uniforms.uProj.value = full;
    motes.material.uniforms.uProj.value = full;
    bg.material.uniforms.uOpacity.value = opacity;
    applyClimate(CALM, 0, aspect, full, 0);
    trees.forEach(t => { t.visible = false; });
  }
  function project(v, cam) {
    tmp.copy(v).project(cam);
    return {x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, z: tmp.z};
  }
  const amazon = story.ages;

  let last = performance.now(), time = 0;
  // opt.intro: the sunrise's progress (0..1), when the rendered film times it to its music
  function render(uNow, tFixed, opt = {}) {
    u = uNow;
    let dt;
    if (tFixed !== undefined) { dt = Math.max(0, tFixed - time); time = tFixed; }
    else { const now = performance.now(); dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt; }

    // ---------- globe state (a chain of eased keyframes)
    // Turn to the Amazon first, fly straight down onto the highlighted cell, then on into the forest inside it.
    const kDive = ease(ss(0.55, 1.62, u)), kRot = ease(ss(0.55, 1.45, u)), kGround = ss(1.62, 1.96, u);
    if (!drag.active) { heroY += (reduced ? 0 : dt * 0.06 * (1 - kRot)) + drag.vy; drag.vy *= 0.92; }
    let rx = lerp(heroTilt, targetRot.x, kRot) + (groundRot.x - targetRot.x) * kGround;
    let ry = heroY + wrapPi(targetRot.y - heroY) * kRot + (groundRot.y - targetRot.y) * kGround;
    let alt = Math.exp(lerp(Math.log(L.hero.d - 1), Math.log(DIVE_ALT), kDive));
    alt = Math.exp(lerp(Math.log(alt), Math.log(GROUND_ALT), kGround));
    let gx = lerp(L.hero.x, 0, kRot), gy = lerp(L.hero.y, 0, kRot), gs = lerp(L.hero.s, 1, kRot);
    if (u > 6.45) {
      // pull back out to the planet, settling right of the caption
      const kOut = ease(ss(6.6, 7.3, u));
      alt = Math.exp(lerp(Math.log(DIVE_ALT), Math.log(L.planet.d - 1), kOut));
      rx = lerp(targetRot.x, 0.32, kOut);
      // one unhurried full turn while the forests grow, so every continent comes past
      ry = targetRot.y + kOut * 0.7 + 2 * Math.PI * ss(7.3, 8.0, u) + Math.max(0, u - 7.3) * 0.3;
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
    U.uDataMix.value = (1 - 0.92 * near) * (1 - 0.85 * relief);
    U.uExposure.value = 1 + 0.4 * near;
    U.uCloud.value = 0.62 * (1 - ss(0.9, 1.5, u) * (1 - ss(6.85, 7.2, u))) * (1 - 0.5 * growing);
    canopy.mesh.visible = relief > 0.002;
    const CU = canopy.uniforms;
    CU.uOpacity.value = relief;
    CU.uLift.value = 0.05 * relief;
    U.uCloudShift.value = time * 0.0016;
    // the planet comes back in 1981, under the flash that ends the forest chapters, and grows to 2021
    U.uYear.value = u < 6.45 ? 40 : 40 * ss(7.32, 7.95, u);
    CU.uYear.value = U.uYear.value;
    CU.uCenter.value.copy(G.group.position);
    // the dive goes straight down into the forest; the grid and its cell appear only on the way back up
    U.uGridMix.value = u > 6.6 && u < 7.05 ? 1 : 0;
    U.uTargetMix.value = ss(6.55, 6.7, u) * (1 - ss(6.75, 7, u));
    U.uDim.value = lerp(lerp(1, film ? 0.3 : 0.45, kDim), 1, kEnd) * lerp(1, 0.6, kFc * (1 - kNum));
    // the photographic Earth gives way to its digital twin behind a scan line, and comes back for the end card
    U.uTwin.value = -1.25 + 2.5 * ss(10.68, 10.95, u);
    U.uTwinMix.value = u > 10.6 ? 1 - ss(11.7, 12.15, u) : 0;
    G.atmoUniforms.uOpacity.value = clamp((dist / gs - 1.25) / 0.6);
    G.atmoUniforms.uCenter.value.copy(G.group.position);
    stars.material.uniforms.uTime.value = time;
    stars.rotation.y = time * 0.004;

    // network & streams
    const netA = ss(8.2, 8.55, u) * (1 - (film ? 1 : 0.7) * ss(9.55, 9.8, u)) * (1 - ss(10.6, 10.85, u));
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
    const fBase = ss(1.9, 2.06, u) * (1 - ss(6.53, 6.71, u)), fA = fBase * (1 - dipAt(u));
    const year = forestYear(u);
    const hMain = at(amazon['1'].height, year), lai = at(amazon['1'].lai, year);
    const Hm = hMain / 10;
    const cohortA = ss(DIPS[1], 5.55, u);
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
    // each view's year: its own story in the film, the scroll's shared years on the page
    const kF = clamp(forestYear(u) / 40);
    panels.forEach(P => { P.y = film && P.story ? storyYear(P.story, kF) : forestYear(u); P.state = P.clim(P.y); });
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
    // a satellite lidar pass over the grown fifteen-age forest, across the screen
    const lk = opt.lidar ?? ss(6.2, 6.42, u);
    const lidarA = (lk > 0.001 ? 1 : 0) * cohortA * fA * (1 - ss(6.45, 6.6, u));
    if (lidarA > 0.002) {
      fCam.updateMatrixWorld();
      lidarDir.setFromMatrixColumn(fCam.matrixWorld, 0).setY(0).normalize();
    }
    lidar.update(lk, lidarA, lidarDir, canopyTop);

    // four forcings: every view shares one scale so heights compare directly
    const kS = splitK(u), rects = kS > 0.001 ? panelRects(kS) : null;
    panels.forEach((P, i) => {
      const U = P.tree.material.uniforms, pa = az + i * 0.9;
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
        U.uOpacity.value = fA * (rects ? rects[i].k : 0);
        keyLight(U.uLight.value, pa);
        if (P.flames) {
          const F = P.flames.material.uniforms;
          F.uT.value = y / 40; F.uTime.value = time; F.uH.value = young.height[FIRE]; F.uOpacity.value = U.uOpacity.value;
        }
      }
      if (!rects) return;
      const dist = PANEL_VIEW / (2 * Math.tan(THREE.MathUtils.degToRad(P.cam.fov) / 2));
      P.cam.position.set(Math.cos(pa) * dist, 1.15, Math.sin(pa) * dist);
      tmp.set(0, PANEL_TGT, 0);
      if (i === 0) {
        // the first view keeps chapter one's camera until the split completes
        P.cam.position.lerpVectors(fCam.position, P.cam.position, kS);
        tmp.lerpVectors(mainTgt, tmp, kS);
      }
      P.cam.lookAt(tmp);
    });

    // ---------- draw
    post?.begin();
    renderer.clear();
    if (fBase < 0.999) renderer.render(gScene, gCam);   // a dip fades the forest to dark, not to the globe
    if (fA > 0.001) {
      if (rects) drawPanels(rects);
      else { renderer.clearDepth(); renderer.render(fScene, fCam); }
    }
    post?.end();

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
        // headers show only once the views have settled, so they never overlap as views move
        el.style.opacity = (ss(0.9, 1, kS) * ss(0.55, 1, i === 0 ? kS : R.k) * fA).toFixed(3);
        el.style.transform = `translate(${R.x.toFixed(1)}px, ${R.y.toFixed(1)}px)`;
        el.style.width = `${R.w.toFixed(1)}px`;
        el.style.height = `${R.h.toFixed(1)}px`;
        P.hEl.textContent = P.h(P.y).toFixed(1);
        P.agbEl.textContent = P.agb(P.y).toFixed(1);
        // the climate strip fills in up to the current year
        const cur = Math.round(clamp(year / 40) * 1000) / 10;
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
    const yr = Math.round(year);
    dom.treeYear.textContent = 1981 + yr;
    dom.cohortYear.textContent = 1981 + yr;
    dom.treeH.textContent = at(amazon['1'].height, year).toFixed(1);
    dom.treeAgb.textContent = at(amazon['1'].agb, year).toFixed(1);
    dom.treeLai.textContent = lai.toFixed(1);
    cohorts.forEach((c, i) => { barEls[i].style.height = `${clamp(c.h / 34) * 100}%`; });
    dom.globeYear.textContent = 1981 + Math.round(U.uYear.value);

    const labA = ss(5.55, 5.8, u) * (1 - ss(6.25, 6.4, u));
    cohorts.forEach((c, i) => {
      const el = labelEls[i];
      if (labA < 0.01) { el.style.opacity = 0; return; }
      const p = project(tmp.set(c.cx, c.h / 10 + 0.5, c.cz), fCam);
      el.style.opacity = p.z < 1 ? labA : 0;
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    });

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
