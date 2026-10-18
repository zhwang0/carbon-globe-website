// "What if?" panel: ED reference rollouts conditioned on climate, starting age and (next) future forcing.
const NS = 'http://www.w3.org/2000/svg';
const AGES = [1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

const SITES = [
  ['amazon', '#4ade80'], ['congo', '#22d3ee'], ['savanna', '#fbbf24'],
  ['appalachia', '#a3e635'], ['boreal', '#a78bfa'], ['siberia', '#e2e8f0'],
];
const SHORT = {amazon: 'Amazon', congo: 'Congo', savanna: 'Zambia', appalachia: 'Eastern US', boreal: 'Finland', siberia: 'Siberia'};

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function createForecast({svg, tabs, caption, meta}) {
  const X0 = 46, X1 = 392, Y0 = 290, Y1 = 22;
  const groups = [];

  function frame(g, yMax, yTicks, unit, xMax = 2021) {
    const ax = el('g', {class: 'fc-axis'}, g);
    yTicks.forEach(v => {
      const y = Y0 - (v / yMax) * (Y0 - Y1);
      el('line', {x1: X0, x2: X1, y1: y, y2: y, 'stroke-dasharray': v ? '2 4' : ''}, ax);
      el('text', {x: X0 - 8, y: y + 3.5, 'text-anchor': 'end'}, ax).textContent = v;
    });
    const span = xMax - 1981;
    [1981, 2001, 2021, ...(xMax > 2021 ? [2060, 2100] : [])].forEach(yr => {
      el('text', {x: X0 + (yr - 1981) / span * (X1 - X0), y: Y0 + 18, 'text-anchor': 'middle'}, ax).textContent = yr;
    });
    el('text', {x: X0, y: Y1 - 8}, ax).textContent = unit;
  }
  const path = (series, yMax, xMax = 2021) => series.map((v, i) => `${i ? 'L' : 'M'}${(X0 + i / (xMax - 1981) * (X1 - X0)).toFixed(1)} ${(Y0 - clamp(v / yMax) * (Y0 - Y1)).toFixed(1)}`).join('');

  // A: six climates, 1-year-old forest, AGB
  const gA = el('g', {}, svg);
  frame(gA, 12, [0, 4, 8, 12], 'kgC m⁻²');
  const linesA = SITES.map(([k, c]) => {
    const s = meta.story[k], series = s.ages['1'].agb;
    const p = el('path', {d: path(series, 12), class: 'fc-line', stroke: c}, gA);
    const len = p.getTotalLength ? p.getTotalLength() : 1000;
    p.style.strokeDasharray = `${len} ${len}`;
    const dot = el('circle', {r: 4, fill: c}, gA);
    const lab = el('text', {class: 'fc-lab', fill: c}, gA);
    lab.textContent = `${SHORT[k]} · ${s.zone.toLowerCase()}`;
    return {p, len, dot, lab, series};
  });
  groups.push(gA);

  // B: fifteen starting ages at the Amazon site, AGB
  const gB = el('g', {opacity: 0}, svg);
  frame(gB, 24, [0, 8, 16, 24], 'kgC m⁻²');
  const linesB = AGES.map((a, i) => {
    const t = i / (AGES.length - 1);
    const c = `hsl(${Math.round(130 - t * 75)} 80% ${Math.round(68 - t * 22)}%)`;
    const series = meta.story.amazon.ages[String(a)].agb;
    const p = el('path', {d: path(series, 24), class: 'fc-line', stroke: c, 'stroke-width': 1.6}, gB);
    const len = p.getTotalLength ? p.getTotalLength() : 1000;
    p.style.strokeDasharray = `${len} ${len}`;
    return {p, len, a, c, series};
  });
  const labB1 = el('text', {class: 'fc-lab', fill: 'hsl(55 80% 46%)'}, gB); labB1.textContent = 'seeded at 500 yr';
  const labB2 = el('text', {class: 'fc-lab', fill: 'hsl(130 80% 68%)'}, gB); labB2.textContent = 'seeded at 1 yr';
  groups.push(gB);

  // C: future forcing. Observed CarbonGlobe CO2 (1981-2021) and illustrative SSP branches to 2100.
  const gC = el('g', {opacity: 0}, svg);
  const defs = el('defs', {}, svg);
  const lg = el('linearGradient', {id: 'fcfut', x1: 0, x2: 1}, defs);
  el('stop', {offset: 0, 'stop-color': '#35c6f4', 'stop-opacity': 0.0}, lg);
  el('stop', {offset: 1, 'stop-color': '#35c6f4', 'stop-opacity': 0.12}, lg);
  const yMaxC = 1200, xMaxC = 2100;
  frame(gC, yMaxC, [0, 400, 800, 1200], 'CO₂ ppm', xMaxC);
  const xAt = yr => X0 + (yr - 1981) / (xMaxC - 1981) * (X1 - X0);
  const yAt = v => Y0 - v / yMaxC * (Y0 - Y1);
  el('rect', {x: xAt(2021), y: Y1, width: X1 - xAt(2021), height: Y0 - Y1, class: 'fc-future'}, gC);
  el('text', {x: xAt(2021) + 8, y: Y1 + 14, class: 'fc-future-t'}, gC).textContent = 'future climate · next test sets';
  const co2 = meta.forcing.co2_ppm;  // 40 annual values, 1981-2020
  const hist = el('path', {d: co2.map((v, i) => `${i ? 'L' : 'M'}${xAt(1981 + i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(''), class: 'fc-line', stroke: '#ecf3ef'}, gC);
  const histLen = hist.getTotalLength ? hist.getTotalLength() : 600;
  hist.style.strokeDasharray = `${histLen} ${histLen}`;
  const last = co2[co2.length - 1], x2020 = xAt(2020);
  const hi = el('path', {d: `M${x2020} ${yAt(last)} C${xAt(2050)} ${yAt(560)} ${xAt(2080)} ${yAt(850)} ${xAt(2100)} ${yAt(1135)}`, class: 'fc-line', stroke: '#ff8f5a', 'stroke-dasharray': '5 6'}, gC);
  const lo = el('path', {d: `M${x2020} ${yAt(last)} C${xAt(2045)} ${yAt(450)} ${xAt(2075)} ${yAt(460)} ${xAt(2100)} ${yAt(445)}`, class: 'fc-line', stroke: '#35c6f4', 'stroke-dasharray': '5 6'}, gC);
  const tHi = el('text', {x: xAt(2100) - 4, y: yAt(1135) - 10, 'text-anchor': 'end', class: 'fc-lab', fill: '#ff8f5a'}, gC); tHi.textContent = 'SSP5-8.5 · ≈1,135 ppm';
  const tLo = el('text', {x: xAt(2100) - 4, y: yAt(445) + 20, 'text-anchor': 'end', class: 'fc-lab', fill: '#35c6f4'}, gC); tLo.textContent = 'SSP1-2.6';
  const tHist = el('text', {x: xAt(1984), y: yAt(last) - 14, class: 'fc-lab', fill: '#ecf3ef'}, gC); tHist.textContent = 'CarbonGlobe forcing';
  groups.push(gC);

  const CAPS = [
    'Aboveground biomass (kgC m⁻²) of ED rollouts from a 1-year-old forest at six sites, 1981–2021. Same model, different climate.',
    'Aboveground biomass at the central Amazon site for all 15 starting ages, 1981–2021. Same climate, different starting forest.',
    'Mean CO₂ forcing over CarbonGlobe sites, 1981–2020, with two CMIP6 pathways to 2100 (illustrative curves; SSP5-8.5 endpoint from Meinshausen et al., 2020). Future-scenario test sets are planned next.',
  ];
  let shown = -1;

  function update(u) {
    const phase = u < 8.62 ? 0 : u < 8.98 ? 1 : 2;
    const wA = 1 - ss(8.55, 8.68, u), wB = ss(8.55, 8.68, u) * (1 - ss(8.92, 9.04, u)), wC = ss(8.92, 9.04, u);
    gA.setAttribute('opacity', wA.toFixed(3));
    gB.setAttribute('opacity', wB.toFixed(3));
    gC.setAttribute('opacity', wC.toFixed(3));
    if (phase !== shown) {
      shown = phase;
      tabs.forEach((t, i) => t.classList.toggle('on', i === phase));
      caption.textContent = CAPS[phase];
    }
    const pA = clamp((u - 8.18) / 0.36);
    linesA.forEach(({p, len, dot, lab, series}) => {
      p.style.strokeDashoffset = (len * (1 - pA)).toFixed(1);
      const y = pA * 40, i = Math.floor(y), f = y - i;
      const v = i >= 40 ? series[40] : series[i] * (1 - f) + series[i + 1] * f;
      const x = X0 + y / 40 * (X1 - X0), yy = Y0 - clamp(v / 12) * (Y0 - Y1);
      dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', yy.toFixed(1));
      lab.setAttribute('x', (x + 8).toFixed(1)); lab.setAttribute('y', (yy + 4).toFixed(1));
      lab.setAttribute('opacity', ss(0.85, 1, pA).toFixed(2));
    });
    // Labels of overlapping endpoints: nudge apart vertically.
    if (pA > 0.85) {
      const ys = linesA.map(l => ({l, y: +l.lab.getAttribute('y')})).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ys.length; i++) if (ys[i].y - ys[i - 1].y < 13) ys[i].y = ys[i - 1].y + 13;
      ys.forEach(({l, y}) => l.lab.setAttribute('y', y.toFixed(1)));
    }
    const pB = clamp((u - 8.66) / 0.26);
    linesB.forEach(({p, len}) => { p.style.strokeDashoffset = (len * (1 - pB)).toFixed(1); });
    labB1.setAttribute('x', X1 + 6); labB1.setAttribute('y', (Y0 - linesB[14].series[40] / 24 * (Y0 - Y1) + 4).toFixed(1));
    labB2.setAttribute('x', X1 + 6); labB2.setAttribute('y', (Y0 - linesB[0].series[40] / 24 * (Y0 - Y1) + 4).toFixed(1));
    labB1.setAttribute('opacity', ss(0.8, 1, pB)); labB2.setAttribute('opacity', ss(0.8, 1, pB));
    const pC = clamp((u - 8.98) / 0.2);
    hist.style.strokeDashoffset = (histLen * (1 - pC)).toFixed(1);
    const pC2 = ss(9.08, 9.2, u);
    [hi, lo, tHi, tLo, tHist].forEach(e => e.setAttribute('opacity', (e === tHist ? ss(0.6, 1, pC) : pC2).toFixed(2)));
  }
  return {update};
}
