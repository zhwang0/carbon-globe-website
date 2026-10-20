// Props of the forest scenes: the ground grid, drifting motes of light, and the weather of the
// four-forcing views (rain, snow, dust and ash, with ground that dries, freezes or burns).
import * as THREE from '../assets/vendor/three.module.js';
import {mulberry32} from './random.js';

const NOISE = /* glsl */`
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }`;

// Ground: a grid that fades into the dark. uWet darkens it with rings where raindrops land, uDry
// cracks it into baked mud, uSnow covers it and uChar leaves it burnt with a few glowing embers.
export function createGround(px) {
  const geo = new THREE.PlaneGeometry(120, 120, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 1}, uTime: {value: 0}, uShade: {value: 0}, uGrid: {value: new THREE.Color(0.25, 0.9, 0.6)},
      uDry: {value: 0}, uSnow: {value: 0}, uChar: {value: 0}, uWet: {value: 0}},
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uOpacity, uShade, uTime, uDry, uSnow, uChar, uWet; uniform vec3 uGrid; varying vec3 vW;
      ${NOISE}
      float grid(vec2 p, float s){ vec2 g = p / s; vec2 w = fwidth(g); vec2 f = abs(fract(g - 0.5) - 0.5) / w; return 1.0 - min(min(f.x, f.y), 1.0); }
      // borders of a Voronoi tiling: the cracks of drying mud
      float cracks(vec2 x) {
        vec2 n = floor(x), f = fract(x);
        float d1 = 8.0, d2 = 8.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          float d = length(g + hash2(n + g) - f);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return 1.0 - smoothstep(0.0, 0.05 + 1.5 * fwidth(x.x), d2 - d1);
      }
      void main(){
        float r = length(vW.xz);
        float fade = smoothstep(42.0, 4.0, r), near = smoothstep(30.0, 3.0, r);
        float g = grid(vW.xz, 1.0) * 0.12 + grid(vW.xz, 5.0) * 0.22;
        vec3 base = mix(vec3(0.02, 0.07, 0.06), vec3(0.01, 0.025, 0.03), smoothstep(0.0, 30.0, r));
        float n = noise(vW.xz * 0.45) * 0.6 + noise(vW.xz * 2.1) * 0.4;
        if (uDry > 0.0) {
          vec3 mud = vec3(0.15, 0.095, 0.045) * (0.7 + 0.6 * n) * (1.0 - 0.75 * cracks(vW.xz * 1.4));
          base = mix(base, mud, uDry * near);
        }
        if (uSnow > 0.0) base = mix(base, vec3(0.34, 0.41, 0.5) * (0.75 + 0.35 * n), uSnow * near * smoothstep(0.2, 0.45, n + 0.25));
        if (uChar > 0.0) base = mix(base, vec3(0.03, 0.024, 0.02) * (0.6 + 0.8 * n), uChar * near);
        base *= 1.0 - 0.3 * uWet * near;
        float sh = uShade > 0.0 ? smoothstep(uShade, uShade * 0.2, r) : 0.0;  // shade under a crown of radius uShade
        vec3 col = base * (1.0 - 0.45 * sh) + uGrid * g * fade * (1.0 - 0.7 * sh) * (1.0 - 0.55 * uChar);
        if (uChar > 0.0) {
          vec2 c = floor(vW.xz * 2.5);
          float e = hash(c), on = step(0.965, e) * near * smoothstep(0.35, 0.0, length(fract(vW.xz * 2.5) - 0.5));
          col += vec3(1.0, 0.38, 0.06) * on * uChar * (0.55 + 0.45 * sin(uTime * (2.0 + 3.0 * e) + e * 40.0));
        }
        if (uWet > 0.0) {
          // a drop lands in some cells each cycle and its ring spreads and fades
          vec2 q = vW.xz * 1.6, cell = floor(q);
          float h = hash(cell), t = fract(uTime * (0.55 + 0.5 * h) + h * 7.0);
          float d = length(fract(q) - 0.5 - (hash2(cell + 3.1) - 0.5) * 0.4), aa = fwidth(d) * 1.5;
          float ring = smoothstep(0.03 + aa, 0.0, abs(d - t * 0.42)) * (1.0 - t) * step(0.35, h);
          col += vec3(0.5, 0.75, 0.9) * ring * uWet * near * 0.3;
        }
        gl_FragColor = vec4(col, uOpacity * (0.25 + 0.75 * fade));
      }`,
    transparent: true, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

export function createMotes(count, px) {
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 26;
    pos.set([Math.cos(a) * r, Math.random() * 10, Math.sin(a) * r], i * 3);
    rnd[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uOpacity: {value: 1}, uPx: {value: px}, uProj: {value: 1000}},
    vertexShader: `attribute float aRnd; uniform float uTime; uniform float uPx; uniform float uProj; varying float vA;
      void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.08 + aRnd * 0.12), 10.0); p.x += sin(uTime * 0.3 + aRnd * 20.0) * 0.4;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
      vA = smoothstep(0.0, 1.5, p.y) * smoothstep(10.0, 7.0, p.y) * (0.3 + 0.7 * aRnd);
      gl_PointSize = uPx * (0.6 + aRnd * 1.2) * 0.025 * uProj / -mv.z; }`,
    fragmentShader: `uniform float uOpacity; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.75, 1.0, 0.7, smoothstep(0.5, 0.0, d) * vA * uOpacity * 0.6); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

// Weather around a tree, in world units (1 = 10 m) inside a box of half-width 3.6 and height 6.
// kind: 'rain' (slanted streaks), 'snow' (drifting flakes), 'dust' (warm motes in hot air) or
// 'ash' (grey flakes and a few embers). uRate is the share of particles shown, so light rain has
// fewer drops rather than fainter ones.
const WEATHER = {
  rain: {fall: 7.5, size: 0.36, color: '0.62, 0.8, 0.98', alpha: 0.3},
  snow: {fall: 0.45, size: 0.075, color: '0.86, 0.92, 1.0', alpha: 0.75},
  dust: {fall: -0.12, size: 0.05, color: '1.0, 0.72, 0.32', alpha: 0.7},
  ash: {fall: 0.3, size: 0.06, color: '0.62, 0.58, 0.55', alpha: 0.6},
};
export function createWeather(kind, count, px) {
  const K = WEATHER[kind], rng = mulberry32(kind.length * 97 + count);
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos.set([(rng() * 2 - 1) * 3.6, rng() * 6, (rng() * 2 - 1) * 3.6], i * 3);
    rnd.set([rng(), rng()], i * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aR', new THREE.BufferAttribute(rnd, 2));
  const mat = new THREE.ShaderMaterial({
    defines: {[kind.toUpperCase()]: 1},
    uniforms: {uTime: {value: 0}, uOpacity: {value: 0}, uRate: {value: 1}, uPx: {value: px}, uProj: {value: 1000}, uWind: {value: 0.18}},
    vertexShader: `attribute vec2 aR; uniform float uTime, uRate, uPx, uProj, uWind; varying float vA; varying float vE;
      void main(){
        vec3 p = position;
        float speed = ${K.fall.toFixed(2)} * (0.75 + 0.5 * aR.y);
        p.y = mod(p.y - uTime * speed, 6.0);
        float h = 6.0 - p.y;
#ifndef RAIN
        p.x += uWind * h + sin(uTime * (0.7 + aR.x) + aR.y * 30.0) * 0.25;
        p.z += cos(uTime * (0.5 + aR.y) + aR.x * 20.0) * 0.2;
#endif
        vE = 0.0;
#ifdef ASH
        // one particle in eight is an ember, rising instead of falling
        if (aR.x < 0.125) { p.y = mod(position.y + uTime * 0.55 * (0.6 + aR.y), 6.0); vE = 1.0; }
#endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // drops and flakes right in front of the lens fade, so the weather stays around the tree
        vA = step(aR.x, uRate) * smoothstep(0.0, 0.6, p.y) * smoothstep(6.0, 4.8, p.y) * (0.55 + 0.45 * aR.y) * smoothstep(3.6, 6.0, -mv.z);
        gl_PointSize = vA > 0.0 ? uPx * ${K.size.toFixed(3)} * (0.7 + 0.6 * aR.y) * uProj / -mv.z : 0.0;
      }`,
    fragmentShader: `uniform float uOpacity; varying float vA; varying float vE;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float a;
#ifdef RAIN
        a = smoothstep(0.035, 0.0, abs(c.x)) * smoothstep(0.5, 0.1, abs(c.y));
#else
        a = smoothstep(0.5, 0.05, length(c));
#endif
        vec3 col = vec3(${K.color});
#ifdef ASH
        col = mix(col, vec3(1.0, 0.45, 0.08) * 1.6, vE);
#endif
        gl_FragColor = vec4(col * a * vA * uOpacity * ${K.alpha.toFixed(2)}, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 3;
  return pts;
}

// The sky behind the forest views: a vertical gradient with a glow on the horizon, an optional
// sun, a band of drifting cloud (or smoke) and heat shimmer over the horizon. Drawn as a
// full-viewport quad behind everything.
export function createSky() {
  const C = (r, g, b) => new THREE.Color(r, g, b);
  const uniforms = {
    uOpacity: {value: 0}, uTime: {value: 0}, uAspect: {value: 1},
    uTop: {value: C(0.03, 0.09, 0.09)}, uBot: {value: C(0.012, 0.03, 0.035)}, uBand: {value: C(0.02, 0.06, 0.04)},
    uSun: {value: new THREE.Vector3(0.7, 0.8, 0.0)}, uSunCol: {value: C(0, 0, 0)},
    uCloud: {value: 0}, uCloudCol: {value: C(0.06, 0.1, 0.11)}, uHeat: {value: 0},
  };
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform float uOpacity, uTime, uAspect, uCloud, uHeat; uniform vec3 uTop, uBot, uBand, uSun, uSunCol, uCloudCol; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec3 c = mix(uBot, uTop, smoothstep(0.1, 0.95, vUv.y)) + uBand * exp(-pow((vUv.y - 0.42) * 4.0, 2.0));
        if (uSun.z > 0.0) {
          float r = length((vUv - uSun.xy) * vec2(uAspect, 1.0));
          c += uSunCol * (exp(-r * r / (uSun.z * uSun.z)) * 0.55 + exp(-r * r / (uSun.z * uSun.z * 0.012)) * 0.9);
        }
        if (uCloud > 0.0) {
          vec2 q = vec2(vUv.x * uAspect * 1.6 + uTime * 0.025, vUv.y * 2.6);
          float n = fbm(q + vec2(fbm(q * 0.7 - uTime * 0.01), 0.0));
          float cl = smoothstep(0.42, 0.78, n) * smoothstep(0.38, 0.85, vUv.y);
          c = mix(c, uCloudCol * (0.8 + 0.5 * n), cl * uCloud);
        }
        if (uHeat > 0.0) {
          float hb = exp(-pow((vUv.y - 0.4) * 6.0, 2.0));
          float w = noise(vec2(vUv.x * uAspect * 16.0, vUv.y * 80.0 - uTime * 3.0));
          c += vec3(1.0, 0.62, 0.28) * uHeat * hb * (0.04 + 0.1 * w);
        }
        gl_FragColor = vec4(c, uOpacity);
      }`,
    depthTest: false, depthWrite: false, transparent: true,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

// A satellite lidar pass over the fifteen-age forest, the way NASA's GEDI measures forests from orbit: a beam
// crosses the plot along a ground track and leaves a footprint on top of the canopy every few metres, tracing
// its height profile.
export function createLidar(px, count = 40) {
  const group = new THREE.Group();
  const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8, 1, true);
  beamGeo.translate(0, 0.5, 0);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 0}},
    vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uOpacity; varying float vY;
      void main(){ gl_FragColor = vec4(vec3(0.6, 1.0, 0.9), uOpacity * (1.0 - vY) * (1.0 - vY)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  const pos = new Float32Array(count * 3), show = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aShow', new THREE.BufferAttribute(show, 1));
  const dots = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: {uPx: {value: px}, uProj: {value: 800}, uOpacity: {value: 0}},
    vertexShader: `attribute float aShow; uniform float uPx, uProj; varying float vS;
      void main(){ vS = aShow; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.2 + 0.3 * (1.0 - aShow) * aShow * 4.0 + 0.12 * aShow) * uProj * uPx / -mv.z; }`,
    fragmentShader: `uniform float uOpacity; varying float vS;
      void main(){ if (vS <= 0.0) discard; float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(0.75, 1.0, 0.92), smoothstep(0.5, 0.12, d) * uOpacity * min(1.0, vS * 2.0)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  dots.frustumCulled = false;
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({color: 0x7dffd8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}));
  line.frustumCulled = false;
  group.add(beam, line, dots);
  group.visible = false;
  // k: progress of the pass (0..1); a: opacity; dir: unit direction of the ground track; top(x, z): canopy height there
  function update(k, a, dir, top) {
    group.visible = a > 0.002;
    if (!group.visible) return;
    const L = 17, s = -L + 2 * L * k;
    let passed = 0;
    for (let i = 0; i < count; i++) {
      const si = -L + 2 * L * (i + 0.5) / count, x = dir.x * si, z = dir.z * si;
      pos.set([x, top(x, z) + 0.06, z], i * 3);
      show[i] = Math.min(1, Math.max(0, (s - si) / 1.5));
      if (s >= si) passed = i + 1;
    }
    geo.attributes.position.needsUpdate = geo.attributes.aShow.needsUpdate = true;
    geo.setDrawRange(0, passed);
    const bx = dir.x * s, bz = dir.z * s;
    beam.position.set(bx, top(bx, bz), bz);
    beam.scale.set(1, 60, 1);
    beamMat.uniforms.uOpacity.value = a * (k > 0.001 && k < 0.999 ? 1 : 0);
    dots.material.uniforms.uOpacity.value = a;
    line.material.opacity = 0.75 * a;
  }
  return {group, update};
}
