// CarbonGlobe site bootstrap: scroll film, reveals, explorer, benchmarks.
import {loadTexture, loadAtlas, loadZones} from './globe.js';
import {createForecast} from './forecast.js';
import {createBench} from './bench.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const RENDER = new URLSearchParams(location.search).has('render');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (RENDER) document.documentElement.classList.add('render');
const mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const U_END = 10;

function webgl2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

// ------------------------------------------------------------------ data
const metaP = fetch('assets/data/meta.json').then(r => r.json());
// Decoded 41-year grids are ~30 MB each: keep the film's grid plus the few most recently used.
const atlases = new Map();
const KEEP = 'height_a1', MAX_ATLASES = 3;
function getAtlas(name, age) {
  const key = `${name}_a${age}`;
  let p = atlases.get(key);
  if (p) atlases.delete(key);
  else p = metaP.then(meta => loadAtlas(`assets/data/grid/${key}.png`, meta));
  atlases.set(key, p);
  for (const [k, old] of atlases) {
    if (atlases.size <= MAX_ATLASES + 1) break;
    if (k === KEEP || k === key) continue;
    atlases.delete(k);
    old.then(a => a.tex.dispose()).catch(() => {});
  }
  return p;
}
let texP = null;
function textures() {
  if (!texP) {
    texP = Promise.all([
      loadTexture(mobile ? 'assets/tex/earth-day-2k.webp' : 'assets/tex/earth-day.webp'),
      loadTexture('assets/tex/land-mask.png'),
      loadZones('assets/data/climate.png'),
    ]).then(([day, mask, zones]) => ({day, mask, zones}));
  }
  return texP;
}

// ------------------------------------------------------------------ film
const film = $('#top'), stageEl = $('#stage'), canvas = $('#stage-canvas');
const fades = $$('[data-u]').map(el => ({el, k: el.dataset.u.split(',').map(Number), isCap: el.classList.contains('cap')}));
const chapterBtns = $$('#chapters button');
const progress = $('#film-progress');
const topbar = $('#topbar');
let stage = null, forecast = null;
let uT = 0, uS = 0, snap = false;

function filmMetrics() {
  const vh = stageEl.clientHeight || innerHeight;
  return {vh, top: film.offsetTop, max: (film.offsetHeight - vh) / vh};
}
function readU() {
  const {vh, top, max} = filmMetrics();
  return clamp((scrollY - top) / vh, 0, max);
}

// Counters follow the fade-in of their container, so they are scroll-driven and reversible.
const counters = fades.map(f => [...f.el.querySelectorAll('.count')].map(el => ({el, n: +el.dataset.count})));
const fmtN = n => n.toLocaleString('en-US');

let captionShown = 0;
function applyFades(u) {
  captionShown = 0;
  for (const f of fades) {
    const [a, b, c, d] = f.k;
    const o = (a < 0 ? 1 : ss(a, b, u)) * (1 - ss(c, d, u));
    if (f.isCap) captionShown = Math.max(captionShown, o);
    const vis = o > 0.002;
    f.el.style.opacity = o.toFixed(3);
    // Captions stay in the accessibility tree; blocks with links are hidden so focus never lands on them.
    if (!f.isCap) f.el.style.visibility = vis ? 'visible' : 'hidden';
    if (!reduced) f.el.style.translate = `0 ${((1 - o) * (u < (b + c) / 2 ? 18 : -18)).toFixed(1)}px`;
  }
  fades.forEach((f, i) => {
    if (!counters[i].length) return;
    const [a, b, c] = f.k, u0 = a < 0 ? 0 : a;
    const k = reduced || u >= (b + c) / 2 ? 1 : clamp((u - u0) / Math.max(0.05, b - u0 + 0.25));
    const e = 1 - Math.pow(1 - k, 3);
    counters[i].forEach(({el, n}) => { el.textContent = fmtN(Math.round(n * e)); });
  });
  const marks = [0, 2.0, 3.8, 5.3, 6.7, 8.1, 9.4];
  let cur = 0;
  marks.forEach((m, i) => { if (u >= m - 0.05) cur = i; });
  chapterBtns.forEach((b, i) => b.classList.toggle('on', i === cur));
  progress.style.width = `${clamp(u / U_END) * 100}%`;
  topbar.classList.toggle('show', u > 0.75);
}

function goto(u) {
  const {vh, top} = filmMetrics();
  snap = true;
  window.scrollTo({top: top + u * vh, behavior: 'instant'});
}
chapterBtns.forEach(b => b.addEventListener('click', () => { stopPlay(); goto(+b.dataset.goto); }));

// Play the film: scroll at a steady pace, stop on any user input.
const pauseBtn = $('#film-pause');
let playing = false, playY = 0;
function startPlay() {
  const {vh, top} = filmMetrics();
  if (readU() > U_END - 0.2) goto(0);
  playing = true;
  playY = Math.max(scrollY, top);
  pauseBtn.hidden = false;
  if (readU() < 0.05) playY = top + vh * 0.05;
}
function stopPlay() { playing = false; pauseBtn.hidden = true; }
$('#play-film').addEventListener('click', startPlay);
pauseBtn.addEventListener('click', stopPlay);
['wheel', 'touchstart', 'keydown'].forEach(ev => addEventListener(ev, e => {
  if (playing && !(ev === 'keydown' && e.key === 'Tab')) stopPlay();
}, {passive: true}));

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    const {vh, top} = filmMetrics();
    // Linger while a caption is fully on screen, move faster through transitions.
    const speed = vh / (3.8 + 3.0 * captionShown);
    playY += speed * dt;
    window.scrollTo(0, playY);
    if ((playY - top) / vh >= U_END - 0.05) stopPlay();
  }
  uT = readU();
  if (snap || reduced) { uS = uT; snap = false; }
  else { uS += (uT - uS) * (1 - Math.exp(-dt * 6)); if (Math.abs(uT - uS) < 1e-4) uS = uT; }
  const filmVisible = scrollY < film.offsetTop + film.offsetHeight;
  if (!filmVisible) { topbar.classList.add('show'); return; }
  applyFades(uS);
  forecast?.update(uS);
  stage?.render(uS);
}

// ------------------------------------------------------------------ reveals
const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), {threshold: 0.12, rootMargin: '0px 0px -6% 0px'});
$$('.reveal').forEach(el => io.observe(el));
$$('[data-stack]').forEach(el => new IntersectionObserver(([e]) => el.classList.toggle('open', e.intersectionRatio > 0.6), {threshold: [0, 0.6, 1]}).observe(el));

// scenario mini-graphics
{
  const g = $('#mini-grid');
  let html = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 16; c++) {
    const train = r % 4 === 1 && c % 4 === 1;
    html += `<rect x="${c * 10 + 1}" y="${r * 17 + 2}" width="7" height="13" rx="2" fill="${train ? '#b9f46b' : 'rgba(255,255,255,.1)'}"/>`;
  }
  g.innerHTML = html;
}

// copy BibTeX
$('#copy-bib').addEventListener('click', async e => {
  const btn = e.currentTarget;
  try { await navigator.clipboard.writeText($('#bib').innerText); btn.textContent = 'Copied'; }
  catch { btn.textContent = 'Select & copy'; }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
});

createBench({heat: $('#bench-heat'), bars: $('#bench-bars'), metrics: $('#bench-metrics'), title: $('#bench-title'), runtime: $('#runtime')});

// ------------------------------------------------------------------ boot
async function boot() {
  const meta = await metaP;
  forecast = createForecast({svg: $('#fc-svg'), tabs: [$('#fc-tab-a'), $('#fc-tab-b'), $('#fc-tab-c')], caption: $('#fc-cap'), meta});
  {
    const bars = $('#agebar'), v = meta.ages.map(a => meta.global_mean[String(a)].agb[40]), m = Math.max(...v);
    bars.innerHTML = v.map(x => `<i style="height:${Math.max(8, x / m * 100)}%"></i>`).join('');
  }
  if (!RENDER) requestAnimationFrame(loop);
  if (!webgl2()) {
    document.documentElement.classList.add('no-webgl');
    $('#ex-loading').textContent = 'The interactive globe needs WebGL 2.';
    return;
  }
  const [{createStage}, tex, height] = await Promise.all([import('./stage.js'), textures(), getAtlas('height', 1)]);
  stage = createStage({
    canvas, meta, mobile, reduced,
    tex: {...tex, height},
    dom: {
      flash: $('#flash'), bars: $('#cohort-bars'), cohortLabels: $('#cohort-labels'), netLabels: $('#net-labels'),
      treeYear: $('#tree-year'), cohortYear: $('#cohort-year'), treeH: $('#tree-h'), treeAgb: $('#tree-agb'), treeLai: $('#tree-lai'),
      globeYear: $('#globe-year'), zoneLegend: $('#zone-legend'), globeGrowth: $('#globe-growth'),
    },
  });
  canvas.classList.add('ready');
  addEventListener('resize', () => stage.resize());
  if (RENDER) {
    // Deterministic frame stepping for scripts/render_film.py, once the tree has grown.
    await stage.ready;
    window.__cg = {
      frame(u, t) {
        const {vh, top} = filmMetrics();
        window.scrollTo(0, top + u * vh);
        applyFades(u);
        forecast.update(u);
        stage.render(u, t);
      },
    };
    return;
  }

  // explorer, created when it approaches the viewport
  const exIO = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    exIO.disconnect();
    const {createExplorer} = await import('./explorer.js');
    createExplorer({
      canvas: $('#ex-canvas'), meta, tex, getAtlas, reduced,
      ui: {
        vars: $('#ex-vars'), ages: $('#ex-ages'), year: $('#ex-year'), yearOut: $('#ex-year-out'), play: $('#ex-play'),
        loading: $('#ex-loading'), legendLabel: $('#ex-legend-label'), ramp: $('#ex-ramp'), legendMid: $('#ex-legend-mid'), legendMax: $('#ex-legend-max'),
        chart: $('#ex-chart'), readout: $('#ex-readout'), siteName: $('#ex-site-name'), siteMeta: $('#ex-site-meta'),
      },
    });
  }, {rootMargin: '600px 0px'});
  exIO.observe($('#explore'));
}
boot().catch(err => {
  console.error(err);
  document.documentElement.classList.add('no-webgl');
});
