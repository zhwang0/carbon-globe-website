// CarbonGlobe site bootstrap: scroll film, reveals, explorer, benchmarks.
import {loadTexture, loadAtlas, loadZones, loadTiles} from './globe.js';
import {createForecast} from './forecast.js';
import {createBench} from './bench.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const PARAMS = new URLSearchParams(location.search);
const RENDER = PARAMS.has('render');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (RENDER) document.documentElement.classList.add('render');
const mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const U_END = 12.6;

function webgl2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

// ------------------------------------------------------------------ data
const metaP = fetch('assets/data/meta.json').then(r => r.json());
const scenP = fetch('assets/data/scenarios.json').then(r => r.json());
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
      loadTexture('assets/tex/clouds.webp'),
      loadTexture('assets/tex/night-lights.webp'),
      loadTexture('assets/tex/amazon.webp'),
    ]).then(([day, mask, zones, clouds, lights, amazon]) => ({day, mask, zones, clouds, lights, amazon}));
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

// Chapter headlines rise word by word as their caption fades in (CSS reads --k, --i and --n).
function splitWords(el) {
  let i = 0;
  const walk = node => [...node.childNodes].forEach(n => {
    if (n.nodeType === 1) {
      if (n.classList.contains('count')) { n.classList.add('w'); n.style.setProperty('--i', i++); } else walk(n);
      return;
    }
    if (n.nodeType !== 3) return;
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) { frag.append(part); return; }
      const w = document.createElement('span');
      w.className = 'w';
      w.style.setProperty('--i', i++);
      w.textContent = part;
      frag.append(w);
    });
    n.replaceWith(frag);
  });
  walk(el);
  el.style.setProperty('--n', i);
}
fades.forEach(f => { if (f.isCap) f.el.querySelectorAll('h2').forEach(splitWords); });

// The opening: the hero's lines arrive in turn (CSS reads --in, in seconds since the page started).
const heroEl = $('.hero');
const T0 = performance.now();
let introDone = false;
function applyIntro(s) {
  if (introDone) return;
  if (reduced || s > 3.2) { heroEl.style.setProperty('--in', '9'); introDone = !RENDER; return; }
  heroEl.style.setProperty('--in', Math.max(0, s).toFixed(3));
}

let captionShown = 0;
function applyFades(u) {
  captionShown = 0;
  for (const f of fades) {
    const [a, b, c, d] = f.k;
    const o = (a < 0 ? 1 : ss(a, b, u)) * (1 - ss(c, d, u));
    if (f.isCap) captionShown = Math.max(captionShown, o);
    f.el.style.setProperty('--k', (reduced || a < 0 || u >= (b + c) / 2 ? 1 : ss(a, b, u)).toFixed(3));
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
  const marks = [0, 2.0, 3.55, 5.25, 6.75, 8.2, 9.55, 10.85, 11.9];
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
    // Linger while a caption is fully on screen, move faster through transitions and the years
    // of growth.
    const growing = (uS > 2.15 && uS < 3.45) || (uS > 5.4 && uS < 6.4);
    const speed = (growing ? 1.45 : 1) * vh / (3.8 + 3.0 * captionShown);
    playY += speed * dt;
    window.scrollTo(0, playY);
    if ((playY - top) / vh >= U_END - 0.05) stopPlay();
  }
  applyIntro((now - T0) / 1000);
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

// the statement lights up word by word while it is pinned on screen
{
  const track = $('#statement'), text = track.querySelector('.statement-text');
  splitWords(text);
  let queued = false;
  const update = () => {
    queued = false;
    const r = track.getBoundingClientRect(), vh = innerHeight;
    const p = reduced ? 1 : clamp((vh * 0.2 - r.top) / (vh * 0.2 + 0.8 * (r.height - vh)));
    text.style.setProperty('--p', p.toFixed(3));
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, {passive: true});
  addEventListener('resize', update);
  update();
}

// cards with a light that follows the pointer
$$('.spot').forEach(el => el.addEventListener('pointermove', e => {
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
  el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
}));

// quick start: tabs and copy
{
  const tabs = $$('.code-tabs [role=tab]');
  const show = t => tabs.forEach(o => {
    const on = o === t;
    o.setAttribute('aria-selected', String(on));
    o.tabIndex = on ? 0 : -1;
    $(`#${o.getAttribute('aria-controls')}`).hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', e => {
      const d = {ArrowRight: 1, ArrowLeft: -1}[e.key];
      if (!d) return;
      const n = tabs[(i + d + tabs.length) % tabs.length];
      show(n); n.focus();
    });
  });
  show(tabs[0]);
  $('.code-copy').addEventListener('click', async e => {
    const btn = e.currentTarget, pane = $$('.code-body').find(el => !el.hidden);
    try { await navigator.clipboard.writeText(pane.innerText); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Select & copy'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  });
}

// the film plays in a lightbox; without <dialog> the link opens the MP4
{
  const box = $('#lightbox'), video = box.querySelector('video');
  $('#film-open').addEventListener('click', e => {
    if (typeof box.showModal !== 'function') return;
    e.preventDefault();
    box.showModal();
    video.play().catch(() => {});
  });
  box.addEventListener('close', () => video.pause());
  box.addEventListener('click', e => { if (e.target === box) box.close(); });
}

// the top bar marks the section on screen
{
  const links = $$('.topbar nav a');
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.hash === `#${e.target.id}`));
  }), {rootMargin: '-45% 0px -50% 0px'});
  $$('main > section').forEach(sec => io.observe(sec));
}

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
  const [{createStage}, tex, height, scen] = await Promise.all([import('./stage.js'), textures(), getAtlas('height', 1), scenP]);
  // the emulator's forcing maps: six drivers x twelve months, needed only from chapter five on
  const M = scen.maps, nv = M.vars.length;
  const maps = loadTiles(M.file, M.tile[0], M.tile[1], nv * 12, i => [i % 12 % M.cols, 2 * Math.floor(i / 12) + Math.floor(i % 12 / M.cols)]);
  stage = createStage({
    canvas, meta, scen, maps, mobile, reduced, bloom: !mobile && !PARAMS.has('nobloom'), film: RENDER,
    tex: {...tex, height},
    dom: {
      flash: $('#flash'), bars: $('#cohort-bars'), cohortLabels: $('#cohort-labels'), netLabels: $('#net-labels'),
      treeYear: $('#tree-year'), cohortYear: $('#cohort-year'), treeH: $('#tree-h'), treeAgb: $('#tree-agb'), treeLai: $('#tree-lai'),
      globeYear: $('#globe-year'), panels: $('#panels'),
      forcingCap: $('.cap-forcing'), netCap: $('.cap-net'),
    },
  });
  canvas.classList.add('ready');
  addEventListener('resize', () => stage.resize());
  if (RENDER) {
    // Deterministic frame stepping for scripts/render_film.py, once the trees have grown: the film's
    // edit maps video time t to a film position and draws its own titles.
    const [{createCut}] = await Promise.all([import('./cut.js'), stage.ready, maps]);
    const cut = await createCut({titles: $('#titles'), fade: $('#film-fade'), panels: $('#panels'), finale: $('.finale')});
    window.__cg = {
      duration: cut.duration,
      frame(t) {
        const {u, intro} = cut.at(t);
        const {vh, top} = filmMetrics();
        window.scrollTo(0, top + u * vh);
        applyFades(u);
        forecast.update(u);
        stage.render(u, t, {intro});
        cut.apply(t);
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
