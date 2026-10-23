// Interactive globe explorer: variable x starting age x year, click land for a 40-year trajectory.
import * as THREE from '../assets/vendor/three.module.js';
import {createGlobe, createStars, VARS, ZONES, atlasValue, vec3ToLatLon, latLonToVec3, facing, cellOf, fmtLat, fmtLon} from './globe.js';

const NS = 'http://www.w3.org/2000/svg';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fmt = v => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-3))));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function createExplorer({canvas, meta, tex, ui, getAtlas, reduced}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const G = createGlobe({day: tex.day, mask: tex.mask, zones: tex.zones.tex, data: null});
  G.uniforms.uSun.value.set(-0.45, 0.5, 1).normalize();
  G.uniforms.uSpec.value = 0.08;
  scene.add(createStars(1500, 60), G.group);

  // selection marker: a dark halo for contrast on any colour, a bright ring and dot, and a ripple.
  // It lies flat on the surface, so it hides itself on the far side of the globe.
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({color, transparent: true, opacity, depthTest: false, depthWrite: false});
  const marker = new THREE.Group();
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.031, 48), mat(0xf2ffbf, 0));
  [new THREE.Mesh(new THREE.RingGeometry(0.014, 0.037, 48), mat(0x02080a, 0.6)),
    new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 48), mat(0xf2ffbf, 1)),
    new THREE.Mesh(new THREE.CircleGeometry(0.0075, 24), mat(0xf2ffbf, 1)), ripple].forEach((m, i) => { m.renderOrder = 5 + i; marker.add(m); });
  G.spin.add(marker);
  const UP = new THREE.Vector3(0, 0, 1);
  let pickT = 0;

  const state = {var: 'height', age: 1, year: 40, row: 0, col: 0, lat: 0, lon: 0, atlas: null, playing: false};
  let rx = 0.12, ry = facing(0, -62).y, vy = 0, dist = 4.5, autoSpin = !reduced, visible = false;

  // ---------- UI
  ui.vars.innerHTML = Object.entries(VARS).map(([k, v]) => `<button type="button" role="radio" data-v="${k}" aria-checked="${k === state.var}">${v.short}</button>`).join('');
  ui.ages.innerHTML = meta.grid.ages.map(a => `<button type="button" role="radio" data-a="${a}" aria-checked="${a === state.age}">${a} yr</button>`).join('');
  ui.vars.addEventListener('click', e => { const b = e.target.closest('button'); if (b) select({var: b.dataset.v}); });
  ui.ages.addEventListener('click', e => { const b = e.target.closest('button'); if (b) select({age: +b.dataset.a}); });
  ui.year.addEventListener('input', () => { stopPlay(); setYear(+ui.year.value); });
  ui.play.addEventListener('click', () => (state.playing ? stopPlay() : startPlay()));

  function setYear(y) {
    state.year = y;
    G.uniforms.uYear.value = y;
    ui.year.value = Math.round(y);
    ui.year.style.setProperty('--p', `${(y / 40) * 100}%`);
    ui.yearOut.textContent = 1981 + Math.round(y);
    ui.year.setAttribute('aria-valuetext', `${1981 + Math.round(y)}`);
    drawCursor();
  }
  let playT = 0;
  function startPlay() {
    state.playing = true;
    if (state.year >= 40) setYear(0);
    playT = performance.now();
    ui.play.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 4h3v12h-3zM11.5 4h3v12h-3z" fill="currentColor"/></svg>';
    ui.play.setAttribute('aria-label', 'Pause years');
  }
  function stopPlay() {
    state.playing = false;
    ui.play.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5v11l9-5.5z" fill="currentColor"/></svg>';
    ui.play.setAttribute('aria-label', 'Play years');
  }

  function legend() {
    const v = VARS[state.var], show = meta.vars[state.var].show;
    ui.legendLabel.textContent = `${v.label} · ${v.unit}`;
    ui.ramp.style.background = `linear-gradient(90deg, ${v.ramp.join(', ')})`;
    // Color uses a square-root scale: the midpoint of the ramp is a quarter of the maximum.
    ui.legendMid.textContent = fmt(show / 4);
    ui.legendMax.textContent = `${show}+`;
  }

  let token = 0;
  async function select(change) {
    Object.assign(state, change);
    [...ui.vars.children].forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === state.var)));
    [...ui.ages.children].forEach(b => b.setAttribute('aria-checked', String(+b.dataset.a === state.age)));
    legend();
    const my = ++token;
    ui.loading.classList.remove('done');
    ui.loading.textContent = 'Loading 41 global grids…';
    try {
      const atlas = await getAtlas(state.var, state.age);
      if (my !== token) return;
      state.atlas = atlas;
      G.setData(atlas.tex);
      G.setRamp(state.var);
      ui.loading.classList.add('done');
      drawChart();
    } catch (err) {
      ui.loading.textContent = 'Could not load this layer.';
      console.error(err);
    }
  }

  function pickSite(lat, lon, label) {
    const c = cellOf(lat, lon);
    state.row = c.row; state.col = c.col;
    state.lat = 89.75 - c.row * 0.5; state.lon = -179.75 + c.col * 0.5;
    const p = latLonToVec3(state.lat, state.lon, 1.003);
    marker.position.copy(p);
    marker.quaternion.setFromUnitVectors(UP, p.clone().normalize());
    pickT = time;
    // a new site replays its forty years from the start
    if (state.playing) setYear(0);
    const z = tex.zones.data[c.row * 720 + c.col];
    ui.siteName.textContent = label || (z ? `${ZONES[z]} site` : 'No simulation here');
    ui.siteMeta.textContent = `${fmtLat(state.lat)}, ${fmtLon(state.lon)}${z ? ' · ' + ZONES[z].toLowerCase() : ''}`;
    drawChart();
  }

  // ---------- chart
  const X0 = 36, X1 = 350, Y0 = 146, Y1 = 14;
  let chartMax = 1, series = null;
  function drawChart() {
    const svg = ui.chart;
    svg.innerHTML = '';
    if (!state.atlas) return;
    const vmax = meta.vars[state.var].vmax, gamma = meta.grid.gamma;
    series = Array.from({length: 41}, (_, y) => atlasValue(state.atlas, vmax, gamma, state.row, state.col, y));
    const v = VARS[state.var];
    if (series[0] === null) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', 180); t.setAttribute('y', 86); t.setAttribute('text-anchor', 'middle');
      t.textContent = 'No simulation at this cell. Pick a vegetated land cell.';
      svg.appendChild(t);
      ui.readout.textContent = '—';
      return;
    }
    chartMax = niceMax(Math.max(...series) * 1.08);
    const ax = document.createElementNS(NS, 'g'); ax.setAttribute('class', 'ax'); svg.appendChild(ax);
    [0, 0.5, 1].forEach(f => {
      const y = Y0 - f * (Y0 - Y1);
      ax.insertAdjacentHTML('beforeend', `<line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" stroke-dasharray="${f ? '2 4' : ''}"/><text x="${X0 - 6}" y="${y + 3.5}" text-anchor="end">${fmt(chartMax * f)}</text>`);
    });
    [[0, '1981'], [20, '2001'], [40, '2021']].forEach(([i, l]) => ax.insertAdjacentHTML('beforeend', `<text x="${X0 + i / 40 * (X1 - X0)}" y="${Y0 + 16}" text-anchor="middle">${l}</text>`));
    const pts = series.map((s, i) => [X0 + i / 40 * (X1 - X0), Y0 - clamp(s / chartMax) * (Y0 - Y1)]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const gid = `exg-${state.var}`;
    svg.insertAdjacentHTML('beforeend', `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${v.ramp[3]}" stop-opacity=".35"/><stop offset="1" stop-color="${v.ramp[3]}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d}L${X1} ${Y0}L${X0} ${Y0}Z" fill="url(#${gid})"/>
      <path d="${d}" fill="none" stroke="${v.ramp[3]}" stroke-width="2.2" stroke-linejoin="round"/>
      <line id="ex-cur" y1="${Y1}" y2="${Y0}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3"/>
      <circle id="ex-dot" r="4.5" fill="${v.ramp[4]}" stroke="#050a0c" stroke-width="2"/>`);
    drawCursor();
  }
  function drawCursor() {
    if (!series || series[0] === null) return;
    const cur = ui.chart.querySelector('#ex-cur'), dot = ui.chart.querySelector('#ex-dot');
    if (!cur) return;
    const y = state.year, i = Math.min(39, Math.floor(y)), f = y - i;
    const val = series[i] * (1 - f) + series[i + 1] * f;
    const x = X0 + y / 40 * (X1 - X0);
    cur.setAttribute('x1', x); cur.setAttribute('x2', x);
    dot.setAttribute('cx', x); dot.setAttribute('cy', Y0 - clamp(val / chartMax) * (Y0 - Y1));
    ui.readout.textContent = `${1981 + Math.round(y)} · ${VARS[state.var].label}: ${fmt(val)} ${VARS[state.var].unit}`;
  }

  // ---------- interaction
  const pointers = new Map();
  let down = null, pinch = 0;
  const hit = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
    const o = ray.ray.origin, d = ray.ray.direction;
    const b = o.dot(d), c = o.lengthSq() - 1, disc = b * b - c;
    if (disc < 0) return null;
    const p = o.clone().addScaledVector(d, -b - Math.sqrt(disc));
    G.spin.updateMatrixWorld();
    return G.spin.worldToLocal(p);
  };
  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    canvas.setPointerCapture(e.pointerId);
    down = {x: e.clientX, y: e.clientY, t: performance.now(), moved: 0};
    autoSpin = false; vy = 0;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) { hover(e); return; }
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) dist = clamp(dist * pinch / d, 1.6, 6);
      pinch = d;
      return;
    }
    if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.005 * (dist - 1) / 2.7;
    ry += dx * k; vy = dx * k;
    rx = clamp(rx + dy * k, -1.2, 1.2);
    tip.hidden = true;
  });
  const up = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (down && down.moved < 8 && performance.now() - down.t < 800) {
      const p = hit(e.clientX, e.clientY);
      if (p) { const {lat, lon} = vec3ToLatLon(p); pickSite(lat, lon); }
    }
    down = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); dist = clamp(dist * Math.exp(e.deltaY * 0.0012), 1.6, 6); }, {passive: false});
  canvas.addEventListener('keydown', e => {
    const k = {ArrowLeft: [0, -0.12], ArrowRight: [0, 0.12], ArrowUp: [-0.1, 0], ArrowDown: [0.1, 0]}[e.key];
    if (k) { e.preventDefault(); rx = clamp(rx + k[0], -1.2, 1.2); ry += k[1]; autoSpin = false; }
    if (e.key === '+' || e.key === '=') dist = clamp(dist * 0.9, 1.6, 5);
    if (e.key === '-') dist = clamp(dist * 1.1, 1.6, 5);
  });

  const tip = document.createElement('div');
  tip.className = 'ex-tip'; tip.hidden = true;
  canvas.parentElement.appendChild(tip);
  function hover(e) {
    if (!state.atlas) return;
    const p = hit(e.clientX, e.clientY);
    if (!p) { tip.hidden = true; return; }
    const {lat, lon} = vec3ToLatLon(p), c = cellOf(lat, lon);
    const val = atlasValue(state.atlas, meta.vars[state.var].vmax, meta.grid.gamma, c.row, c.col, Math.round(state.year));
    if (val === null) { tip.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    tip.hidden = false;
    tip.textContent = `${fmt(val)} ${VARS[state.var].unit}`;
    tip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top - 10}px)`;
  }
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

  // ---------- loop
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  let last = performance.now(), time = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) { last = performance.now(); return; }
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now; time += dt;
    if (state.playing) {
      const y = Math.min(40, state.year + dt * 5);
      setYear(y);
      if (y >= 40) stopPlay();
    }
    if (autoSpin) ry += dt * 0.05;
    else if (!pointers.size) { ry += vy; vy *= 0.93; }
    G.spin.rotation.set(rx, ry, 0, 'XYZ');
    // Keep the globe left of centre on wide layouts so the panel never covers it.
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);
    G.uniforms.uTime.value = time;
    G.atmoUniforms.uOpacity.value = clamp((dist - 1.3) / 0.6);
    // the marker keeps one size on screen, pops when placed, then ripples
    const pop = clamp((time - pickT) / 0.35), rip = ((time - pickT) % 1.6) / 1.6;
    marker.scale.setScalar((dist - 1) / 3.5 * (1 + 0.9 * (1 - pop) ** 3));
    ripple.scale.setScalar(1 + 1.4 * rip);
    ripple.material.opacity = 0.75 * (1 - rip) * pop;
    renderer.render(scene, cam);
  }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible && !state.played && !reduced) { state.played = true; setTimeout(startPlay, 600); }
  }, {threshold: 0.25}).observe(canvas);
  resize();
  legend();
  setYear(40);
  const s = meta.story.amazon;
  pickSite(s.lat, s.lon, 'Central Amazon');
  select({});
  requestAnimationFrame(frame);
  return {select, pickSite};
}
