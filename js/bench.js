// Benchmark results from Table 1 of the paper (overall evaluation, noise-perturbation training).
const MODELS = ['LSTM', 'LSTNet', 'DeepED', 'Transformer', 'Informer', 'DLinear', 'Crossformer', 'TimeXer'];
const VARS = [
  ['height', 'Height', 'm'], ['agb', 'AGB', 'kgC m⁻²'], ['soil', 'Soil C', 'kgC m⁻²'], ['lai', 'LAI', 'm² m⁻²'],
  ['gpp', 'GPP', 'kgC m⁻²'], ['npp', 'NPP', 'kgC m⁻²'], ['rh', 'Rh', 'kgC m⁻²'],
];
const METRICS = [['rmse', 'RMSE'], ['mae', 'MAE'], ['delta', 'Δ error'], ['ce', 'Cumulative']];
// [model][variable] = [RMSE, MAE, delta, CE]
const T = {
  LSTM: [[3.352, 1.890, 0.433, 4.794], [1.363, 0.869, 0.183, 1.660], [1.942, 1.354, 0.188, 2.455], [0.708, 0.460, 0.413, 0.838], [0.281, 0.137, 0.289, 0.325], [0.139, 0.068, 0.145, 0.160], [0.161, 0.088, 0.179, 0.177]],
  LSTNet: [[2.887, 1.608, 0.421, 4.003], [1.228, 0.798, 0.189, 1.454], [1.284, 0.833, 0.150, 1.881], [0.661, 0.427, 0.404, 0.776], [0.270, 0.129, 0.280, 0.309], [0.135, 0.064, 0.142, 0.154], [0.149, 0.081, 0.166, 0.165]],
  DeepED: [[1.900, 0.891, 0.398, 2.424], [0.491, 0.248, 0.114, 0.604], [0.660, 0.354, 0.120, 0.955], [0.416, 0.210, 0.377, 0.475], [0.258, 0.128, 0.244, 0.299], [0.127, 0.059, 0.123, 0.143], [0.148, 0.084, 0.151, 0.187]],
  Transformer: [[2.888, 1.750, 0.419, 3.925], [1.154, 0.626, 0.131, 1.592], [1.710, 1.083, 0.148, 2.525], [0.449, 0.247, 0.287, 0.552], [0.217, 0.088, 0.169, 0.253], [0.107, 0.043, 0.085, 0.125], [0.121, 0.059, 0.113, 0.148]],
  Informer: [[2.915, 1.773, 0.420, 3.966], [1.266, 0.654, 0.135, 1.749], [1.803, 1.196, 0.150, 2.693], [0.461, 0.250, 0.284, 0.570], [0.234, 0.094, 0.168, 0.271], [0.116, 0.045, 0.085, 0.134], [0.124, 0.063, 0.111, 0.153]],
  DLinear: [[5.731, 4.124, 0.867, 5.905], [3.191, 2.284, 0.284, 3.457], [4.371, 3.383, 0.348, 4.404], [1.119, 0.814, 0.428, 1.270], [0.578, 0.389, 0.334, 0.675], [0.289, 0.193, 0.168, 0.336], [0.268, 0.186, 0.188, 0.309]],
  Crossformer: [[2.910, 1.563, 0.413, 3.904], [1.218, 0.614, 0.144, 1.616], [1.144, 0.637, 0.139, 1.770], [0.506, 0.298, 0.299, 0.640], [0.235, 0.114, 0.183, 0.285], [0.117, 0.056, 0.093, 0.142], [0.131, 0.065, 0.129, 0.159]],
  TimeXer: [[3.879, 2.301, 0.423, 5.634], [1.583, 1.046, 0.155, 2.328], [1.770, 1.317, 0.146, 2.713], [1.127, 0.701, 0.423, 1.898], [0.972, 0.477, 0.344, 2.009], [0.581, 0.237, 0.180, 1.430], [0.512, 0.284, 0.192, 0.920]],
};
// GPU-hours for a global 40-year forecast on one RTX A4500, read from Fig. 6 of the paper (approximate).
const RUNTIME = [['LSTM', 0.66], ['LSTNet', 0.66], ['DeepED', 1.17], ['Transformer', 0.8], ['Informer', 0.88], ['DLinear', 0.51], ['Crossformer', 3.07], ['TimeXer', 1.32]];
const ED_HOURS = 40.6 * 24;

// Rank colors: best = bright lime, worst = deep teal-grey.
const RANK = ['#b9f46b', '#6fe08a', '#3cc490', '#2f9e86', '#2a7c75', '#265f63', '#234a52', '#203a43'];

export function createBench({heat, bars, metrics, title, runtime}) {
  let metric = 0, variable = 0;
  metrics.innerHTML = METRICS.map(([, l], i) => `<button type="button" role="radio" aria-checked="${i === metric}" data-m="${i}">${l}</button>`).join('');
  metrics.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; metric = +b.dataset.m; draw(); });

  function ranks(vi) {
    const vals = MODELS.map(m => T[m][vi][metric]);
    const order = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const r = new Array(MODELS.length);
    order.forEach((mi, k) => { r[mi] = k; });
    return {vals, r};
  }

  function draw() {
    [...metrics.children].forEach((b, i) => b.setAttribute('aria-checked', String(i === metric)));
    let html = '<div></div>' + VARS.map(([, l], vi) => `<button type="button" class="h-col${vi === variable ? ' on' : ''}" data-v="${vi}">${l}</button>`).join('');
    const R = VARS.map((_, vi) => ranks(vi));
    MODELS.forEach((m, mi) => {
      html += `<div class="h-row">${m}</div>`;
      VARS.forEach((v, vi) => {
        const k = R[vi].r[mi];
        html += `<div class="h-cell${vi === variable ? ' sel' : ''}" data-v="${vi}" role="cell" title="${m} · ${v[1]}: ${R[vi].vals[mi]}" style="background:${RANK[k]};color:${k < 3 ? '#06130c' : 'rgba(255,255,255,.85)'}">${k + 1}</div>`;
      });
    });
    heat.innerHTML = html;
    const [, vl, unit] = VARS[variable];
    title.textContent = `${vl} · ${METRICS[metric][1]} (${unit})`;
    const {vals, r} = R[variable];
    const max = Math.max(...vals);
    const order = MODELS.map((m, i) => i).sort((a, b) => vals[a] - vals[b]);
    bars.innerHTML = order.map(i => `<div class="hbar${r[i] === 0 ? ' best' : r[i] === 1 ? ' second' : ''}"><span>${MODELS[i]}</span><div class="t"><i data-w="${(vals[i] / max) * 100}"></i></div><span class="v">${vals[i].toFixed(3)}</span></div>`).join('');
    requestAnimationFrame(() => bars.querySelectorAll('i').forEach(el => { el.style.width = `${el.dataset.w}%`; }));
  }
  heat.addEventListener('click', e => {
    const t = e.target.closest('[data-v]');
    if (!t) return;
    variable = +t.dataset.v;
    draw();
  });
  draw();

  // runtime on a log axis: 0.1 h .. 1000 h
  const lo = Math.log10(0.3), hi = Math.log10(1200);
  const w = h => ((Math.log10(h) - lo) / (hi - lo)) * 100;
  const rows = [['ED (20 CPUs)', ED_HOURS, true], ...RUNTIME.slice().sort((a, b) => a[1] - b[1])];
  runtime.innerHTML = rows.map(([n, h, ed]) => `<div class="rt-row${ed ? ' ed' : ''}"><span>${n}</span><div class="t"><i data-w="${w(h)}"></i></div><span class="v">${ed ? '40.6 days' : `≈${h.toFixed(1)} h`}</span></div>`).join('')
    + `<div class="rt-axis"><span></span><div>${[[0.3, '0.3 h'], [3, '3 h'], [24, '1 day'], [240, '10 days'], [1200, '50 days']].map(([h, l]) => `<span style="left:${w(h)}%">${l}</span>`).join('')}</div><span></span></div>`
    + '<p class="rt-note">Wall-clock time for a 40-year global forecast, log scale. Emulator times are read from Fig. 6 of the paper.</p>';
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    runtime.querySelectorAll('i').forEach((el, i) => setTimeout(() => { el.style.width = `${el.dataset.w}%`; }, i * 70));
    io.disconnect();
  }, {threshold: 0.3});
  io.observe(runtime);
}
