// Chapter one's tree, grown once and accretively. A space-colonisation model (Runions et al. 2007)
// fills a crown envelope that follows ED's simulated canopy height year by year. Leaves die when the
// tree's own newer foliage shades them (shadow propagation, Palubicki et al. 2009) or when the rising
// crown base leaves them behind; a branch dies after its last leaf; wood thickens with the leaf area it
// carries (pipe model). Plain JS without three.js, so it can run in a worker.
import {mulberry32} from './random.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
export const PRE_TAU = -0.06;   // growth clock of the seedling, before the first simulated year
const DI = 6;                    // influence radius of attraction points, in node spacings
const ATTR = 0.08;               // attraction points per cubic node spacing
const ITER = 4;                  // colonisation iterations per growth step
const SHADOW_B = 1.6, SHADOW_MAX = 12;

// Crown of a tree H metres tall. A young tree has one ellipsoid; with maturity it opens into several
// lobes, one per major limb, which gives the broad, clumpy crown of an Amazon canopy tree.
function makeLobes(rng) {
  const K = 7, lobes = [];
  for (let j = 0; j < K; j++) {
    const top = j === K - 1;
    lobes.push({
      a: (j / (K - 1)) * Math.PI * 2 + (rng() - 0.5) * 0.8,
      r: top ? 0.1 : 0.5 + rng() * 0.22,       // centre distance from the stem, fraction of crown radius
      h: top ? 0.62 : 0.3 + rng() * 0.3,       // centre height, fraction of crown depth
      sa: top ? 0.5 : 0.38 + rng() * 0.12,     // horizontal radius, fraction of crown radius
      sb: top ? 0.36 : 0.26 + rng() * 0.12,    // vertical radius, fraction of crown depth
    });
  }
  return lobes;
}
function crownAt(H, Hmax, lobes) {
  const m = clamp((H - 5) / (Hmax - 9));
  const cb = H * lerp(0.28, 0.58, m), cr = H * lerp(0.27, 0.34, m), dep = H - cb;
  const L = lobes.map(l => {
    const rr = l.r * m * cr;
    return {x: Math.cos(l.a) * rr, z: Math.sin(l.a) * rr, y: cb + dep * lerp(0.6, l.h, m), a: cr * lerp(1, l.sa, m), b: dep * lerp(0.44, l.sb, m)};
  });
  let R = 0, y0 = H, y1 = 0;
  for (const l of L) { R = Math.max(R, Math.hypot(l.x, l.z) + l.a); y0 = Math.min(y0, l.y - l.b); y1 = Math.max(y1, l.y + l.b); }
  return {H, m, cb, cr, dep, L, R, y0, y1};
}
// Squared, normalised distance to the nearest lobe (< 1 inside the crown).
function crownF(c, x, y, z) {
  let f = 1e9;
  for (const l of c.L) {
    const v = ((x - l.x) ** 2 + (z - l.z) ** 2) / (l.a * l.a) + (y - l.y) ** 2 / (l.b * l.b);
    if (v < f) f = v;
  }
  return f;
}

class Grid {
  constructor(cell) { this.c = cell; this.m = new Map(); }
  add(i, x, y, z) {
    const k = (Math.floor(x / this.c) + 512) + (Math.floor(y / this.c) + 64) * 1024 + (Math.floor(z / this.c) + 512) * 131072;
    const a = this.m.get(k);
    if (a) a.push(i); else this.m.set(k, [i]);
  }
  // Calls fn(i) for every item in the cells overlapping a cube of half-size r.
  near(x, y, z, r, fn) {
    const c = this.c, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.m.get((ix + 512) + (iy + 64) * 1024 + (iz + 512) * 131072);
      if (a) for (let k = 0; k < a.length; k++) fn(a[k]);
    }
  }
}

// Grow the tree. heights: annual canopy height (m). Returns per-node arrays on a growth clock
// tau = year index / (years - 1); the seedling grows during PRE_TAU..0.
export function growHeroTree(heights, {seed = 7, sub = 2, pre = 8} = {}) {
  const rng = mulberry32(seed);
  const years = heights.length - 1, T = years * sub, Hmax = Math.max(...heights);
  const hAt = k => {
    if (k < 0) return lerp(heights[0], 0.5, -k / pre);
    const y = k / sub, i = Math.min(years - 1, Math.floor(y));
    return lerp(heights[i], heights[i + 1], y - i);
  };
  const tauAt = k => (k < 0 ? PRE_TAU * -k / pre : k / T);
  const dAt = H => Math.max(0.08, 0.5 * Math.pow(H / Hmax, 0.62));   // node spacing scales with the tree
  const lobes = makeLobes(rng);

  const CAP = 40000;
  const nx = new Float32Array(CAP), ny = new Float32Array(CAP), nz = new Float32Array(CAP), nb = new Float32Array(CAP);
  const dx = new Float32Array(CAP), dy = new Float32Array(CAP), dz = new Float32Array(CAP), nd = new Float32Array(CAP);
  const par = new Int32Array(CAP), kids = new Uint8Array(CAP), lead = new Uint8Array(CAP), attach = new Float32Array(CAP);
  let N = 0;
  const nodeGrid = new Grid(DI * dAt(Hmax)), attrGrid = new Grid(DI * dAt(Hmax));
  function addNode(x, y, z, p, b, ddx, ddy, ddz, d, isLead) {
    nx[N] = x; ny[N] = y; nz[N] = z; par[N] = p; nb[N] = b; dx[N] = ddx; dy[N] = ddy; dz[N] = ddz; nd[N] = d; lead[N] = isLead;
    // height at which a lateral's branch system leaves the stem (-1 on the stem itself)
    attach[N] = isLead || p < 0 ? -1 : lead[p] ? ny[p] : attach[p];
    if (p >= 0) kids[p]++;
    nodeGrid.add(N, x, y, z);
    return N++;
  }
  // attraction points; `act` lists the live ones
  const ax = [], ay = [], az = [], close = [], cd2 = [], alive = [];
  let act = [];
  let apex = addNode(0, 0, 0, -1, PRE_TAU, 0, 1, 0, dAt(0.5), 1);

  let prev = null;
  const acc = new Float32Array(CAP * 3), touched = [];
  for (let k = -pre; k <= T; k++) {
    const tau = tauAt(k), tNext = tauAt(k + 1), H = hAt(k), c = crownAt(H, Hmax, lobes);
    const D = dAt(H), di = DI * D, dk = 1.9 * D;
    // a lateral may only claim space this far above the point where it leaves the stem, so the
    // upper crown is built from new laterals and old low ones can be shed
    const climb = lerp(0.18, 0.75, c.m) * c.dep;
    const reach = (j, ya) => attach[j] < 0 || ya - attach[j] <= climb;
    // a new node removes the attraction points it reaches and becomes the nearest for others
    const claim = n => attrGrid.near(nx[n], ny[n], nz[n], di, i => {
      if (!alive[i]) return;
      const d2 = (ax[i] - nx[n]) ** 2 + (ay[i] - ny[n]) ** 2 + (az[i] - nz[n]) ** 2;
      if (d2 < dk * dk) alive[i] = 0;
      else if (d2 < cd2[i] && reach(n, ay[i])) { cd2[i] = d2; close[i] = n; }
    });

    // the leader keeps the stem straight and near the top until the crown starts to spread
    const leadTop = H - c.dep * lerp(0.1, 0.42, c.m);
    while (ny[apex] < leadTop && N < CAP - 1) {
      let ddx = dx[apex] * 0.6 + (rng() - 0.5) * 0.05, ddy = dy[apex] * 0.6 + 1, ddz = dz[apex] * 0.6 + (rng() - 0.5) * 0.05;
      const l = Math.hypot(ddx, ddy, ddz); ddx /= l; ddy /= l; ddz /= l;
      apex = addNode(nx[apex] + ddx * D, ny[apex] + ddy * D, nz[apex] + ddz * D, apex, tau, ddx, ddy, ddz, D, 1);
      claim(apex);
    }

    // seed attraction points in the part of the crown that is new this step
    const nCand = Math.round(ATTR * Math.PI * c.R * c.R * (c.y1 - c.y0) / (D * D * D));
    for (let i = 0; i < nCand; i++) {
      const a = rng() * Math.PI * 2, r = c.R * Math.sqrt(rng()), x = Math.cos(a) * r, z = Math.sin(a) * r, y = lerp(c.y0, c.y1, rng());
      if (y < c.cb || crownF(c, x, y, z) > 1 || (prev && crownF(prev, x, y, z) <= 1)) continue;
      let best = -1, bd = di * di, dead = false;
      nodeGrid.near(x, y, z, di, j => {
        const d2 = (nx[j] - x) ** 2 + (ny[j] - y) ** 2 + (nz[j] - z) ** 2;
        if (d2 < dk * dk) dead = true;
        if (d2 < bd && reach(j, y)) { bd = d2; best = j; }
      });
      if (dead) continue;
      const id = ax.length;
      ax.push(x); ay.push(y); az.push(z); close.push(best); cd2.push(bd); alive.push(1);
      attrGrid.add(id, x, y, z);
      act.push(id);
    }
    // points the rising crown base has left behind no longer attract growth
    for (const i of act) if (ay[i] < c.cb - D) alive[i] = 0;

    const up = lerp(0.16, 0.04, c.m), capY = lerp(0.55, 0.72, c.m);
    for (let it = 0; it < ITER; it++) {
      act = act.filter(i => alive[i]);
      touched.length = 0;
      for (const i of act) {
        if (close[i] < 0 || cd2[i] > di * di) continue;
        const j = close[i], l = Math.sqrt(cd2[i]) || 1;
        if (acc[j * 3] === 0 && acc[j * 3 + 1] === 0 && acc[j * 3 + 2] === 0) touched.push(j);
        acc[j * 3] += (ax[i] - nx[j]) / l; acc[j * 3 + 1] += (ay[i] - ny[j]) / l; acc[j * 3 + 2] += (az[i] - nz[j]) / l;
      }
      const born = [], b = lerp(tau, tNext, (it + 0.5) / ITER);
      for (const j of touched) {
        let gx = acc[j * 3], gy = acc[j * 3 + 1], gz = acc[j * 3 + 2];
        acc[j * 3] = acc[j * 3 + 1] = acc[j * 3 + 2] = 0;
        const gl = Math.hypot(gx, gy, gz);
        if (gl < 0.2 || kids[j] >= (lead[j] ? 4 : 3) || N >= CAP - 1) continue;
        const mo = lead[j] ? 0.15 : 0.55;
        gx = gx / gl + dx[j] * mo; gy = gy / gl + dy[j] * mo + up; gz = gz / gl + dz[j] * mo;
        const l = Math.hypot(gx, gy, gz); gx /= l; gy /= l; gz /= l;
        if (!lead[j] && (gy > capY || gy < -0.2)) {
          // laterals spread rather than chase the rising crown straight up, or curl down
          const cy = gy > capY ? capY : -0.2, hl = Math.hypot(gx, gz);
          if (hl < 1e-3) { const a = rng() * 6.283; gx = Math.cos(a); gz = Math.sin(a); }
          const s2 = Math.sqrt(1 - cy * cy) / (hl < 1e-3 ? 1 : hl);
          gx *= s2; gz *= s2; gy = cy;
        }
        born.push(addNode(nx[j] + gx * D, ny[j] + gy * D, nz[j] + gz * D, j, b, gx, gy, gz, D, 0));
      }
      if (!born.length) break;
      born.forEach(claim);
    }
    prev = c;
  }

  // ---- lifetimes
  const steps = [];
  for (let k = -pre; k <= T; k++) steps.push({tau: tauAt(k), c: crownAt(hAt(k), Hmax, lobes)});
  const leafDeath = new Float32Array(N).fill(9);
  // the stand shades out whatever the rising crown base leaves behind
  for (let i = 0; i < N; i++) {
    for (const s of steps) if (s.tau > nb[i] && ny[i] < s.c.cb + 0.25 * nd[i]) { leafDeath[i] = s.tau; break; }
  }
  // self-shading: every living leaf cluster casts a shadow pyramid into the voxels below it
  const live = [];
  for (let k = 0; k < steps.length; k += 2) {
    const {tau, c} = steps[k], v = 1.6 * dAt(c.H), R = c.R + 3 * v;
    const gx = Math.ceil(2 * R / v) + 1, gy = Math.ceil((c.H + 3 * v) / v) + 1, grid = new Float32Array(gx * gx * gy);
    const cx = i => clamp(Math.floor((nx[i] + R) / v), 0, gx - 1), cy = i => clamp(Math.floor(ny[i] / v), 0, gy - 1), cz = i => clamp(Math.floor((nz[i] + R) / v), 0, gx - 1);
    live.length = 0;
    for (let i = 0; i < N; i++) if (nb[i] <= tau && leafDeath[i] > tau) live.push(i);
    for (const i of live) {
      const I = cx(i), J = cy(i), K = cz(i);
      for (let q = 0; q <= 4 && J - q >= 0; q++) {
        const w = Math.pow(SHADOW_B, -q), row = (J - q) * gx * gx;
        for (let kk = Math.max(0, K - q); kk <= Math.min(gx - 1, K + q); kk++) {
          for (let ii = Math.max(0, I - q); ii <= Math.min(gx - 1, I + q); ii++) grid[row + kk * gx + ii] += w;
        }
      }
    }
    for (const i of live) if (grid[cy(i) * gx * gx + cz(i) * gx + cx(i)] - 1 > SHADOW_MAX) leafDeath[i] = tau;
  }
  // a branch dies a little after its last leaf; the stem never does
  const woodDeath = new Float32Array(N), last = leafDeath.slice();
  for (let i = N - 1; i > 0; i--) if (last[i] > last[par[i]]) last[par[i]] = last[i];
  for (let i = 0; i < N; i++) woodDeath[i] = lead[i] ? 9 : last[i] + 0.025;
  // pipe model: wood radius follows the leaf area each node carries, and never shrinks
  const area = new Float32Array(N), rad = new Float32Array(N), radT = new Float32Array(N);
  for (let k = 0; k < steps.length; k += 2) {
    const {tau} = steps[k];
    area.fill(0);
    for (let i = 0; i < N; i++) if (nb[i] <= tau && leafDeath[i] > tau) area[i] = Math.pow(0.035 * nd[i], 2.5);
    for (let i = N - 1; i > 0; i--) if (nb[i] <= tau && woodDeath[i] > tau) area[par[i]] += area[i];
    for (let i = 0; i < N; i++) {
      if (area[i] === 0) continue;
      const r = Math.pow(area[i], 1 / 2.5);
      if (r > rad[i] * 1.001) { rad[i] = r; radT[i] = tau; }
    }
  }
  for (let i = 0; i < N; i++) rad[i] = Math.max(rad[i], 0.03 * nd[i]);

  // smooth the colonisation zigzag along unbranched runs
  const next = new Int32Array(N).fill(-1);
  for (let i = 1; i < N; i++) next[par[i]] = kids[par[i]] === 1 ? i : -2;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N; i++) {
      const c = next[i];
      if (c < 0 || lead[i]) continue;
      const p = par[i];
      nx[i] = 0.5 * nx[i] + 0.25 * (nx[p] + nx[c]); ny[i] = 0.5 * ny[i] + 0.25 * (ny[p] + ny[c]); nz[i] = 0.5 * nz[i] + 0.25 * (nz[p] + nz[c]);
    }
  }
  const crown = tau => crownAt(hAt(tau < 0 ? -tau / PRE_TAU * pre : tau * T), Hmax, lobes);
  return {N, x: nx, y: ny, z: nz, dx, dy, dz, d: nd, par, lead, birth: nb, leafDeath, woodDeath, rad, radT, crown};
}

// Point attributes: bark points on each segment's cylinder, leaves in flattened clumps around nodes.
// position, normal (bark: radial; leaves: shading normal), a = (birth, death, kind 0/1, random),
// b = (bark radius, time it is reached, point size, 1 on the stem) — all in metres and growth time.
export function heroTreeArrays(s, {leaf = 12} = {}) {
  const {N, x, y, z, d, par, lead, birth, leafDeath, woodDeath, rad, radT} = s;
  const nBark = new Int32Array(N);
  let total = 0;
  for (let i = 1; i < N; i++) {
    const p = par[i], len = Math.hypot(x[i] - x[p], y[i] - y[p], z[i] - z[p]), size = Math.max(0.3 * d[i], 0.5 * rad[i]);
    // enough points to close the bark: along the segment, and around it once it is wider than a point
    const around = Math.max(1, Math.round(2 * Math.PI * rad[i] * 1.15 / size)), along = Math.max(1, Math.round(len / (0.55 * size)));
    nBark[i] = around * along * (lead[i] && y[i] < 4 ? 4 : 1);
    total += nBark[i] + (leafDeath[i] > birth[i] + 0.012 ? leaf : 0);
  }
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), A = new Float32Array(total * 4), B = new Float32Array(total * 4);
  let o = 0;
  const put = (px, py, pz, qx, qy, qz, a0, a1, a2, a3, b0, b1, b2, b3) => {
    pos[o * 3] = px; pos[o * 3 + 1] = py; pos[o * 3 + 2] = pz;
    nrm[o * 3] = qx; nrm[o * 3 + 1] = qy; nrm[o * 3 + 2] = qz;
    A[o * 4] = a0; A[o * 4 + 1] = a1; A[o * 4 + 2] = a2; A[o * 4 + 3] = a3;
    B[o * 4] = b0; B[o * 4 + 1] = b1; B[o * 4 + 2] = b2; B[o * 4 + 3] = b3;
    o++;
  };
  const rng = mulberry32(99);
  for (let i = 1; i < N; i++) {
    const p = par[i];
    let ax = x[i] - x[p], ay = y[i] - y[p], az = z[i] - z[p];
    const len = Math.hypot(ax, ay, az) || 1;
    ax /= len; ay /= len; az /= len;
    // u, v: unit vectors across the segment
    const rx = Math.abs(ay) > 0.9 ? 1 : 0, ry = 1 - rx;
    let ux = ry * az, uy = -rx * az, uz = rx * ay - ry * ax;
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const rT = Math.max(radT[i], birth[i] + 0.02);
    for (let k = 0; k < nBark[i]; k++) {
      const f = rng(), th = rng() * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      put(x[p] + (x[i] - x[p]) * f, y[p] + (y[i] - y[p]) * f, z[p] + (z[i] - z[p]) * f,
        ux * c + vx * sn, uy * c + vy * sn, uz * c + vz * sn,
        lerp(birth[p], birth[i], f), woodDeath[i], 0, rng(),
        lead[i] ? lerp(rad[p], rad[i], f) : rad[i], rT, d[i] * 0.3, lead[i]);
    }
  }
  for (let i = 1; i < N; i++) {
    if (leafDeath[i] <= birth[i] + 0.012) continue;
    const c = s.crown(birth[i]), cy = lerp(c.cb, c.H, 0.42);
    const ox = x[i] + s.dx[i] * d[i] * 0.35, oy = y[i] + s.dy[i] * d[i] * 0.25, oz = z[i] + s.dz[i] * d[i] * 0.35;
    // crown-scale normal, away from the crown centre, so the lit side of the crown reads as a volume
    let wx = x[i], wy = (y[i] - cy) * 1.4, wz = z[i];
    const wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
    const rr = d[i] * 1.05;
    for (let k = 0; k < leaf; k++) {
      const uu = rng() * 2 - 1, a = rng() * Math.PI * 2, sq = Math.sqrt(1 - uu * uu), q = Math.cbrt(rng());
      const tx = Math.cos(a) * sq, ty = uu * 0.5, tz = Math.sin(a) * sq, tl = Math.hypot(tx, ty, tz);
      let qx = tx / tl * 0.45 + wx * 0.75, qy = ty / tl * 0.45 + wy * 0.75, qz = tz / tl * 0.45 + wz * 0.75;
      const ql = Math.hypot(qx, qy, qz); qx /= ql; qy /= ql; qz /= ql;
      put(ox + tx * rr * q, oy + ty * rr * q, oz + tz * rr * q, qx, qy, qz,
        birth[i] + 0.004 + rng() * 0.012, leafDeath[i] + rng() * 0.02, 1, rng(),
        0, 0, d[i] * (0.38 + 0.3 * rng()), 0);
    }
  }
  return {position: pos, normal: nrm, a: A, b: B};
}
