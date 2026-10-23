// Shared globe: textures, data atlases and the luminous globe material.
import * as THREE from '../assets/vendor/three.module.js';

export const VARS = {
  height: {label: 'Canopy height', short: 'Height', unit: 'm', ramp: ['#06231f', '#0c4d3b', '#168257', '#5cc46c', '#dcf7a4']},
  agb: {label: 'Aboveground biomass', short: 'AGB', unit: 'kgC m⁻²', ramp: ['#091d1d', '#124842', '#22876a', '#7ccc6c', '#eefdc0']},
  soil: {label: 'Soil carbon', short: 'Soil C', unit: 'kgC m⁻²', ramp: ['#24150a', '#6a3a12', '#b5671f', '#eaa94a', '#ffeab0']},
  lai: {label: 'Leaf area index', short: 'LAI', unit: 'm² m⁻²', ramp: ['#0d2418', '#1f5a2c', '#3f9a3a', '#a6d94a', '#f4ffb0']},
  gpp: {label: 'Gross primary production', short: 'GPP', unit: 'kgC m⁻² yr⁻¹', ramp: ['#081d2b', '#0d4b5c', '#139a8a', '#6fdc9a', '#e6ffc4']},
  npp: {label: 'Net primary production', short: 'NPP', unit: 'kgC m⁻² yr⁻¹', ramp: ['#0a1830', '#163f7a', '#2b7fc0', '#5fd0d8', '#dcfff6']},
  rh: {label: 'Heterotrophic respiration', short: 'Rh', unit: 'kgC m⁻² yr⁻¹', ramp: ['#200d22', '#5a1a4a', '#a8325e', '#f07a4a', '#ffe0a0']},
};
export const ZONE_COLORS = ['#000000', '#3b82f6', '#f59e0b', '#4ade80', '#a78bfa', '#cbd5e1'];
export const ZONES = ['', 'Tropical', 'Arid', 'Temperate', 'Cold', 'Polar'];

export const D2R = Math.PI / 180;

// Matches THREE.SphereGeometry's UV layout: u = 0 at 180°W, u = 0.5 at the prime meridian (+X).
export function latLonToVec3(lat, lon, r = 1, out = new THREE.Vector3()) {
  const phi = (lon + 180) * D2R, theta = (90 - lat) * D2R;
  return out.set(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
}
export function vec3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)) / D2R;
  let lon = Math.atan2(n.z, -n.x) / D2R - 180;
  if (lon < -180) lon += 360;
  return {lat, lon};
}
// Euler (XYZ) that brings (lat, lon) to face +Z.
export function facing(lat, lon) {
  const p = latLonToVec3(0, lon);
  return {x: lat * D2R, y: -Math.atan2(p.x, p.z)};
}
export function cellOf(lat, lon) {
  return {row: Math.min(359, Math.max(0, Math.floor((90 - lat) / 0.5))), col: Math.min(719, Math.max(0, Math.floor((lon + 180) / 0.5)))};
}
export function fmtLat(lat) { return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}`; }
export function fmtLon(lon) { return `${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`; }

const loader = new THREE.TextureLoader();
export function loadTexture(url, {srgb = false, mips = true} = {}) {
  return new Promise((resolve, reject) => loader.load(url, t => {
    t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = mips;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    resolve(t);
  }, undefined, reject));
}

async function decodePNG(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), {width: bmp.width, height: bmp.height});
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();
  return img;
}

// A packed atlas (7 x 6 tiles of 720 x 360, one per year) -> raw bytes + RG8 array texture.
// R holds the gamma-encoded value, G marks data coverage so filtering stays clean at coastlines.
// The bytes span the variable's full range (vmax); R is rescaled to its colour scale (show), saturating above.
export async function loadAtlas(url, meta, name) {
  const {width: W, height: H, cols, years, gamma} = meta.grid;
  const v = meta.vars[name], k = Math.pow(v.vmax / (v.show || v.vmax), gamma) * 255 / 254;
  const img = await decodePNG(url);
  const raw = new Uint8Array(W * H * years);
  const rg = new Uint8Array(W * H * years * 2);
  const src = img.data, stride = img.width * 4;
  for (let y = 0; y < years; y++) {
    const ox = (y % cols) * W, oy = Math.floor(y / cols) * H;
    for (let r = 0; r < H; r++) {
      let s = (oy + r) * stride + ox * 4;
      let d = (y * H + r) * W;
      for (let c = 0; c < W; c++, s += 4, d++) {
        const b = src[s];
        raw[d] = b;
        if (b) { rg[d * 2] = Math.min(255, Math.round((b - 1) * k)); rg[d * 2 + 1] = 255; }
      }
    }
  }
  const tex = new THREE.DataArrayTexture(rg, W, H, years);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return {tex, raw, W, H, years};
}
// Tiles of an 8-bit atlas (byte 0 = no data) -> RG8 array texture, one layer per tile, with R the
// value and G the data coverage. where(i) gives the column and row of tile i in the atlas.
export async function loadTiles(url, W, H, n, where) {
  const img = await decodePNG(url);
  const rg = new Uint8Array(W * H * n * 2), src = img.data, stride = img.width * 4;
  for (let i = 0; i < n; i++) {
    const [tc, tr] = where(i);
    for (let r = 0; r < H; r++) {
      let s = (tr * H + r) * stride + tc * W * 4, d = (i * H + r) * W;
      for (let c = 0; c < W; c++, s += 4, d++) {
        const b = src[s];
        if (b) { rg[d * 2] = Math.min(255, Math.round((b - 1) * k)); rg[d * 2 + 1] = 255; }
      }
    }
  }
  const tex = new THREE.DataArrayTexture(rg, W, H, n);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// Physical value at (row, col, year) from raw atlas bytes.
export function atlasValue(atlas, vmax, gamma, row, col, year) {
  const b = atlas.raw[(year * atlas.H + row) * atlas.W + col];
  if (!b) return null;
  return vmax * Math.pow((b - 1) / 254, 1 / gamma);
}

export async function loadZones(url) {
  const img = await decodePNG(url);
  const n = img.width * img.height, z = new Uint8Array(n);
  for (let i = 0; i < n; i++) z[i] = img.data[i * 4];
  const tex = new THREE.DataTexture(z, img.width, img.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return {tex, data: z, W: img.width, H: img.height};
}

const colorVec = hex => new THREE.Color(hex);
export function rampUniform(name) { return VARS[name].ramp.map(colorVec); }

const VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uDay;
uniform sampler2D uMask;
uniform sampler2D uZones;
uniform sampler2D uClouds;
uniform sampler2D uLights;
uniform sampler2D uDetail, uDetail2, uDetail3;
uniform sampler2DArray uData;
uniform float uYear, uDataMix, uZoneMix, uOpacity, uTime, uGridMix, uTargetMix, uDim, uHasData, uBase, uSpec, uNight;
uniform float uReal, uCloud, uCloudShift, uDetailMix, uExposure, uTwin, uTwinMix;
uniform vec4 uDetailBox, uDetailBox2, uDetailBox3;
uniform vec3 uSun;
uniform vec3 uRamp[5];
uniform vec3 uZone[6];
uniform vec2 uTarget;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  float i = min(floor(t), 3.0);
  float f = t - i;
  vec3 a = uRamp[0], b = uRamp[1];
  if (i > 2.5) { a = uRamp[3]; b = uRamp[4]; }
  else if (i > 1.5) { a = uRamp[2]; b = uRamp[3]; }
  else if (i > 0.5) { a = uRamp[1]; b = uRamp[2]; }
  return mix(a, b, f);
}

// a sharper image of a region (box: west, south, east, north in texture space), feathered into img
vec3 detail(vec3 img, sampler2D tex, vec4 box) {
  vec2 dq = (vUv - box.xy) / (box.zw - box.xy);
  if (dq.x <= 0.0 || dq.x >= 1.0 || dq.y <= 0.0 || dq.y >= 1.0) return img;
  float edge = smoothstep(0.0, 0.08, min(min(dq.x, 1.0 - dq.x), min(dq.y, 1.0 - dq.y)));
  return mix(img, texture2D(tex, dq).rgb, edge);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float day = smoothstep(-0.2, 0.45, ndl);

  vec3 base = texture2D(uDay, vUv).rgb;
  float land = texture2D(uMask, vUv).r;
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 landCol = mix(vec3(lum), base, 0.5) * 0.62 * uBase;
  vec3 oceanCol = vec3(0.012, 0.035, 0.06) + base * vec3(0.10, 0.20, 0.30);
  vec3 col = mix(oceanCol, landCol, land);
  col *= mix(0.07 * uNight, 1.0, day);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 140.0) * (1.0 - land) * day;
  col += vec3(0.55, 0.75, 0.95) * spec * uSpec;

  vec2 duv = vec2(vUv.x, 1.0 - vUv.y);
  float t = 0.0, cov = 0.0;
  if (uHasData > 0.5) {
    float y0 = floor(uYear);
    float y1 = min(y0 + 1.0, 40.0);
    vec2 a = texture(uData, vec3(duv, y0)).rg;
    vec2 b = texture(uData, vec3(duv, y1)).rg;
    vec2 d = mix(a, b, uYear - y0);
    cov = smoothstep(0.2, 0.75, d.g) * smoothstep(0.25, 0.65, land);
    t = d.r / max(d.g, 1e-3);
  }
  vec3 dc = ramp(t);
  vec3 dataCol = dc * mix(0.22 * uNight, 1.0, day) * (0.82 + 0.3 * t) + dc * t * t * 0.22 * (1.0 - day) * uNight;
  col = mix(col, dataCol, cov * uDataMix * 0.94);
  // the digital twin: left of a scan line that sweeps across the disc, the photographic Earth gives way to
  // its data twin, the forest layer over muted imagery under a fine graticule
  float sx = dot(N, vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  float twin = uTwinMix * (1.0 - smoothstep(uTwin - 0.015, uTwin + 0.015, sx));

  // The photographic globe of the film: the daylit Blue Marble with drifting clouds and their shadows,
  // sun glint on the sea, blue haze toward the limb and city lights at night. Forest data is laid over
  // the imagery only where forest stands, more opaque the taller it is, so bare land stays as it looks.
  if (uReal > 0.001) {
    float lit = smoothstep(-0.1, 0.2, ndl);
    float sun = pow(max(ndl, 0.0), 0.7);
    // sharper images of the film's dive into the Amazon, each nested in the last: the region, the grid
    // cell, the ground where it ends
    vec3 img = base;
    if (uDetailMix > 0.0) img = detail(detail(detail(img, uDetail, uDetailBox), uDetail2, uDetailBox2), uDetail3, uDetailBox3);
    vec3 alb = pow(img, vec3(1.08)) * 1.18;
    // a green tint that keeps the imagery's texture, deepening as the canopy grows
    alb = mix(alb, ramp(t * 0.82) * 0.92 + alb * 0.22, cov * smoothstep(0.06, 0.6, t) * uDataMix * 0.78);
    vec2 cuv = vec2(vUv.x + uCloudShift, vUv.y);
    float cl = texture2D(uClouds, cuv).r * uCloud;
    float shade = texture2D(uClouds, cuv + vec2(0.0022, 0.0018)).r * uCloud;
    vec3 real = alb * (1.0 - 0.4 * shade) * (0.02 + 1.22 * sun);
    vec3 Hh = normalize(L + V);
    float nh = max(dot(N, Hh), 0.0);
    real += (vec3(1.0, 0.95, 0.86) * pow(nh, 260.0) * 0.32 + vec3(0.45, 0.62, 0.85) * pow(nh, 14.0) * 0.035) * (1.0 - land) * lit * (1.0 - cl);
    real = mix(real, vec3(0.03) + vec3(1.02, 1.02, 1.0) * sun, cl);
    real *= uExposure;
    float dark = 1.0 - smoothstep(-0.2, 0.06, ndl);
    real += vec3(1.0, 0.72, 0.4) * texture2D(uLights, vUv).r * dark * (1.0 - 0.8 * cl) * 1.2;
    float fh = pow(1.0 - max(dot(N, V), 0.0), 2.3);
    real = mix(real, vec3(0.36, 0.6, 1.0) * (0.06 + 0.9 * sun), fh * (0.18 + 0.5 * lit));
    vec2 gg = duv * vec2(72.0, 36.0), gwid = fwidth(gg), gfr = abs(fract(gg) - 0.5);
    vec2 gl2 = smoothstep(0.5 - gwid * 1.1, vec2(0.5), gfr);
    col += vec3(0.4, 0.95, 0.85) * max(gl2.x, gl2.y) * twin * 0.28 * (0.3 + 0.7 * day);
    col = mix(col, real, uReal * (1.0 - twin));
    col += vec3(0.45, 1.0, 0.85) * exp(-pow((sx - uTwin) / 0.012, 2.0)) * uTwinMix * step(-1.0, uTwin) * step(uTwin, 1.0) * 0.9;
  }

  float z = texture2D(uZones, duv).r * 255.0;
  int zi = int(z + 0.5);
  vec3 zc = uZone[0];
  if (zi == 1) zc = uZone[1]; else if (zi == 2) zc = uZone[2]; else if (zi == 3) zc = uZone[3]; else if (zi == 4) zc = uZone[4]; else if (zi == 5) zc = uZone[5];
  float zcov = step(0.5, z) * smoothstep(0.25, 0.65, land);
  col = mix(col, zc * mix(0.45, 1.0, day), zcov * uZoneMix * 0.85);

  vec2 g = duv * vec2(720.0, 360.0);
  vec2 gw = fwidth(g);
  vec2 gf = abs(fract(g) - 0.5);
  vec2 ll = smoothstep(0.5 - gw * 1.2, vec2(0.5), gf);
  float line = max(ll.x, ll.y) * smoothstep(0.6, 0.12, max(gw.x, gw.y));
  vec2 cell = floor(g);
  // the photographic globe draws the 0.5° grid only around the target cell, fainter, so the forest shows
  float local = mix(1.0, (1.0 - smoothstep(3.0, 8.0, length(cell - uTarget))) * 0.55, uReal);
  col += vec3(0.55, 1.0, 0.75) * line * uGridMix * 0.35 * local * smoothstep(0.2, 0.6, land);
  float isT = 1.0 - step(0.5, length(cell - uTarget));
  float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
  col = mix(col, col * 1.6 + vec3(0.06, 0.12, 0.06), isT * uTargetMix * 0.5);
  vec2 inner = smoothstep(0.5 - gw * 3.0, vec2(0.5), gf);
  float edge = max(inner.x, inner.y) * isT;
  col += vec3(0.85, 1.0, 0.7) * edge * uTargetMix * pulse;

  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  col += vec3(0.22, 0.72, 0.95) * fr * (0.12 + 0.55 * day) * max(1.0 - uReal, twin);
  col *= uDim;
  gl_FragColor = vec4(col, uOpacity);
}`;

const ATMO_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ATMO_FRAG = /* glsl */`
uniform vec3 uSun;
uniform float uOpacity, uEclipse, uReal;
uniform vec3 uCenter;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  // Back faces of a 1.16x shell: strongest at the planet's limb, fading outward; the photographic
  // globe keeps a thinner, bluer rim, lit on the day side.
  float k = clamp(-dot(N, V) / 0.51, 0.0, 1.0);
  float a = pow(k, mix(2.6, 6.5, uReal));
  vec3 S = normalize(uSun), rel = normalize(vW - uCenter);
  float lit = mix(0.3 + 0.7 * smoothstep(-0.45, 0.8, dot(rel, S)), 0.06 + 0.94 * smoothstep(-0.35, 0.55, dot(rel, S)), uReal);
  // with the sun behind the planet, the ring gathers on the sun's side of the limb
  vec3 vc = normalize(cameraPosition - uCenter);
  float side = dot(normalize(rel - vc * dot(rel, vc)), normalize(S - vc * dot(S, vc) + 1e-4));
  lit *= mix(1.0, 0.08 + 1.3 * pow(max(side * 0.5 + 0.5, 0.0), 4.0), uEclipse);
  gl_FragColor = vec4(mix(vec3(0.26, 0.8, 1.0), vec3(0.42, 0.68, 1.0), uReal) * lit * mix(1.25, 1.6, uReal), a * uOpacity);
}`;

// real: 0 for the stylised data globe (the explorer), 1 for the photographic Earth of the film, which
// also takes clouds and night lights.
// details: up to three {tex, box: [west, north, east, south] in degrees}, sharper images of nested regions.
export function createGlobe({day, mask, zones, data = null, segments = 192, clouds = null, lights = null, real = 0, details = []}) {
  const boxVec = d => (d ? new THREE.Vector4((d.box[0] + 180) / 360, (d.box[3] + 90) / 180, (d.box[2] + 180) / 360, (d.box[1] + 90) / 180) : new THREE.Vector4(2, 2, 3, 3));   // unused: a box off the globe
  const uniforms = {
    uDay: {value: day}, uMask: {value: mask}, uZones: {value: zones},
    uClouds: {value: clouds || mask}, uLights: {value: lights || mask},
    uDetail: {value: details[0]?.tex || mask}, uDetail2: {value: details[1]?.tex || mask}, uDetail3: {value: details[2]?.tex || mask},
    uDetailBox: {value: boxVec(details[0])}, uDetailBox2: {value: boxVec(details[1])}, uDetailBox3: {value: boxVec(details[2])},
    uDetailMix: {value: details.length ? 1 : 0}, uTwin: {value: -2}, uTwinMix: {value: 0},
    uReal: {value: real}, uCloud: {value: clouds ? 0.6 : 0}, uCloudShift: {value: 0}, uExposure: {value: 1},
    uData: {value: data || new THREE.DataArrayTexture(new Uint8Array(2), 1, 1, 1)},
    uHasData: {value: data ? 1 : 0},
    uYear: {value: 40}, uDataMix: {value: 1}, uZoneMix: {value: 0}, uOpacity: {value: 1},
    uTime: {value: 0}, uGridMix: {value: 0}, uTargetMix: {value: 0}, uDim: {value: 1}, uBase: {value: 1}, uSpec: {value: 0.22}, uNight: {value: 1},
    uSun: {value: new THREE.Vector3(-0.85, 0.38, 0.55).normalize()},
    uRamp: {value: rampUniform('height')},
    uZone: {value: ZONE_COLORS.map(colorVec)},
    uTarget: {value: new THREE.Vector2(-10, -10)},
  };
  if (!data) uniforms.uData.value.format = THREE.RGFormat;
  const material = new THREE.ShaderMaterial({uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true});
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, segments, segments / 2), material);
  const atmoU = {uSun: uniforms.uSun, uOpacity: {value: 1}, uEclipse: {value: 0}, uCenter: {value: new THREE.Vector3()}, uReal: uniforms.uReal};
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.16, 96, 48), new THREE.ShaderMaterial({
    uniforms: atmoU, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const group = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(globe);
  group.add(spin, atmo);
  return {group, spin, globe, atmo, uniforms, atmoUniforms: atmoU,
    setData(tex) { uniforms.uData.value = tex; uniforms.uHasData.value = tex ? 1 : 0; },
    setRamp(name) { uniforms.uRamp.value = rampUniform(name); },
  };
}

// The planet's forests in relief, for the film: a shell over the globe raised by each site's canopy height
// in the given year (exaggerated: lift is the height of a 35 m canopy, in globe radii), coloured by it, and
// see-through where little or no forest stands, so the forests visibly rise as the years pass.
const CANOPY_VERT = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uData;
uniform float uYear, uLift;
varying float vT;
varying float vH;
varying vec3 vW;
void main() {
  vec2 duv = vec2(uv.x, 1.0 - uv.y);
  float y0 = floor(uYear), y1 = min(y0 + 1.0, 40.0);
  vec2 d = mix(texture(uData, vec3(duv, y0)).rg, texture(uData, vec3(duv, y1)).rg, uYear - y0);
  float cov = smoothstep(0.3, 0.85, d.g);
  vT = d.r / max(d.g, 1e-3);
  vH = vT * vT * cov;                       // canopy height / 35 m (values are stored as its square root)
  vec4 w = modelMatrix * vec4(position * (1.0015 + vH * uLift), 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CANOPY_FRAG = /* glsl */`
uniform vec3 uSun;
uniform vec3 uRamp[5];
uniform vec3 uCenter;
uniform float uOpacity;
varying float vT;
varying float vH;
varying vec3 vW;
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  float i = min(floor(t), 3.0);
  float f = t - i;
  vec3 a = uRamp[0], b = uRamp[1];
  if (i > 2.5) { a = uRamp[3]; b = uRamp[4]; }
  else if (i > 1.5) { a = uRamp[2]; b = uRamp[3]; }
  else if (i > 0.5) { a = uRamp[1]; b = uRamp[2]; }
  return mix(a, b, f);
}
void main() {
  float a = smoothstep(0.03, 0.2, vH) * uOpacity;
  if (a < 0.01) discard;
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(N, vW - uCenter) < 0.0) N = -N;
  float diff = max(dot(N, normalize(uSun)), 0.0);
  gl_FragColor = vec4(ramp(0.25 + 0.7 * vT) * (0.12 + 1.05 * diff), a);
}`;

export function createCanopy({data, ramp, sun, segments = 360}) {
  const uniforms = {uData: {value: data}, uYear: {value: 0}, uLift: {value: 0}, uOpacity: {value: 0},
    uRamp: ramp, uSun: sun, uCenter: {value: new THREE.Vector3()}};
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, segments / 2), new THREE.ShaderMaterial({
    uniforms, vertexShader: CANOPY_VERT, fragmentShader: CANOPY_FRAG, transparent: true,
  }));
  mesh.visible = false;
  return {mesh, uniforms};
}

export function createStars(count = 2400, radius = 60) {
  const pos = new Float32Array(count * 3), size = new Float32Array(count), tw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * radius, u * radius, Math.sin(a) * s * radius], i * 3);
    size[i] = Math.pow(Math.random(), 6) * 2.4 + 0.6;
    tw[i] = Math.random() * 6.28;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aTw', new THREE.BufferAttribute(tw, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uOpacity: {value: 1}, uPx: {value: 1}},
    vertexShader: `attribute float aSize; attribute float aTw; uniform float uTime; uniform float uPx; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
      vA = 0.55 + 0.45 * sin(uTime * 1.3 + aTw); gl_PointSize = aSize * uPx; }`,
    fragmentShader: `uniform float uOpacity; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vec3(0.8, 0.92, 1.0), a * vA * uOpacity * 0.85); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

// A sun flare for the moment the sun clears the planet's limb: a hot core, a soft halo and a thin
// anamorphic streak. Drawn additively on top, as a quad facing a camera that looks down -Z.
export function createFlare() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {uI: {value: 0}},
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uI; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r2 = dot(p, p);
        float core = exp(-r2 * 140.0), halo = exp(-r2 * 9.0) * 0.32;
        float streak = exp(-p.y * p.y * 3000.0) * exp(-p.x * p.x * 3.2) * 0.6;
        vec3 c = vec3(1.0, 0.98, 0.92) * core * 1.6 + vec3(0.55, 0.88, 1.0) * (halo + streak);
        gl_FragColor = vec4(c * uI, 1.0);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false;
  m.visible = false;
  return m;
}
