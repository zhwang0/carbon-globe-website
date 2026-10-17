import * as THREE from './assets/vendor/three.module.js';
import {createPointGlobe} from './globe-fallback.js';

const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const radians = Math.PI / 180;
const caps = {agb: 12, height: 40};
const labels = {agb: 'Aboveground biomass', height: 'Canopy height'};
const ramp = [0x448466, 0xa4c268, 0xe0ed8b].map(hex => new THREE.Color(hex));
const terrainPlaceholder = 0xb9aa8e;
function colorAt(value) {
  const t = Math.max(0, Math.min(1, value));
  return ramp[t < .5 ? 0 : 1].clone().lerp(ramp[t < .5 ? 1 : 2], t < .5 ? t * 2 : (t - .5) * 2);
}
function bytes(base64) { return Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
function fallback(canvas) {
  all('[data-globe-mode]').forEach(button => {
    button.disabled = button.dataset.globeMode !== 'points';
    button.setAttribute('aria-pressed', String(!button.disabled));
  });
  $('#globe-variable').value = 'agb'; $('#globe-variable').disabled = true;
  $('#globe-elevation-control').hidden = true; $('#globe-gap-key').hidden = true;
  $('#globe-opacity-control').hidden = true;
  $('#globe-mode-note').textContent = 'Original dots are available in this browser. Smooth, 3D, and terrain views need WebGL 2.';
  canvas.dataset.renderer = 'canvas2d'; canvas.dataset.ocean = 'blue';
  return {...createPointGlobe(canvas), setSurface() {}, surfaceError() {}};
}

export function createGlobe(canvas) {
  // Older shared links may contain the retired ocean-color setting.
  const url = new URL(location.href);
  if (url.searchParams.has('ocean')) {
    url.searchParams.delete('ocean'); history.replaceState(null, '', url);
  }
  let renderer;
  try {
    const context = canvas.getContext('webgl2', {alpha: true, antialias: true});
    if (!context) return fallback(canvas);
    renderer = new THREE.WebGLRenderer({canvas, context, alpha: true, antialias: true});
  } catch (error) {
    console.warn('Using the original globe view:', error.message);
    const replacement = canvas.cloneNode(); canvas.replaceWith(replacement);
    return fallback(replacement);
  }
  canvas.dataset.renderer = 'webgl';
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.23, 1.23, 1.23, -1.23, .1, 20);
  camera.position.z = 5;
  const tiltGroup = new THREE.Group(), globe = new THREE.Group();
  scene.add(tiltGroup); tiltGroup.add(globe);
  scene.add(new THREE.AmbientLight(0xffffff, .9));
  const sunlight = new THREE.DirectionalLight(0xffffff, 1.3);
  sunlight.position.set(-3, 5, 6); scene.add(sunlight);

  const params = new URLSearchParams(location.search);
  let mode = ['surface', 'relief', 'points'].includes(params.get('globe')) ? params.get('globe') : 'surface';
  let variable = params.get('variable') === 'height' ? 'height' : 'agb';
  const opacityParameter = params.get('opacity');
  let opacity = opacityParameter !== null && /^\d{1,3}$/.test(opacityParameter)
    ? Math.max(0, Math.min(100, Number(opacityParameter))) : 60;
  let emphasis = 50, longitude = -28 * radians, tilt = .16;
  let rawPoints = [], pointsMesh, columnsMesh, surfaceReady = false, failedSurface = false;
  let terrainReady = false, failedTerrain = false;
  let coastlineReady = false, failedCoastline = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches, dragging = false, visible = true, dirty = true, lastPointer, lastFrame = 0;

  const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  empty.needsUpdate = true;
  const uniforms = {
    fields: {value: empty}, classes: {value: empty}, hasSurface: {value: false},
    terrain: {value: empty}, hasTerrain: {value: false},
    coastline: {value: empty}, hasCoastline: {value: false}, dataOpacity: {value: opacity / 100},
    variable: {value: 0}, viewMode: {value: 0}, oceanColor: {value: new THREE.Color(0x19465e)},
    lowColor: {value: ramp[0]}, midColor: {value: ramp[1]}, highColor: {value: ramp[2]},
    landColor: {value: new THREE.Color(terrainPlaceholder)}
  };
  const surfaceMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 localPosition; varying vec3 viewNormal;
      void main() { localPosition = position; viewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
      varying vec3 localPosition; varying vec3 viewNormal;
      uniform sampler2D fields; uniform sampler2D classes; uniform sampler2D terrain; uniform sampler2D coastline;
      uniform bool hasSurface; uniform bool hasTerrain; uniform bool hasCoastline; uniform int variable; uniform int viewMode;
      uniform float dataOpacity;
      uniform vec3 oceanColor; uniform vec3 lowColor; uniform vec3 midColor; uniform vec3 highColor; uniform vec3 landColor;
      void main() {
        vec3 n = normalize(localPosition);
        vec2 uv = vec2(atan(n.x, n.z) / 6.28318530718 + .5, .5 - asin(clamp(n.y, -1., 1.)) / 3.14159265359);
        float kind = texture2D(classes, uv).r;
        // Geographic edges are independent of the 0.5-degree simulation grid.
        float land = hasCoastline ? texture2D(coastline, uv).r : (kind > .1 ? 1. : 0.);
        vec3 ground = hasTerrain ? texture2D(terrain, uv).rgb : landColor;
        if (hasSurface && viewMode != 2 && kind > .5 && (viewMode != 1 || kind < .9)) {
            vec4 data = texture2D(fields, uv);
            float value = (variable == 0 ? data.r : data.g) / max(data.b, .001);
            vec3 dataColor = value < .5 ? mix(lowColor, midColor, value * 2.) : mix(midColor, highColor, (value - .5) * 2.);
            // Feather only inside supported cells. No data colors extend into nodata.
            float coverage = smoothstep(.5, 1., data.b);
            float opacity = hasTerrain ? dataOpacity : 1.;
            ground = viewMode == 1 ? lowColor * .65 : mix(ground, dataColor, opacity * coverage);
        }
        vec3 color = mix(oceanColor, ground, land);
        vec3 normal = normalize(viewNormal);
        vec3 lightDirection = normalize(vec3(-.45, .6, 1.));
        float light = .55 + .45 * max(0., dot(normal, lightDirection));
        float rim = .78 + .22 * pow(max(normal.z, 0.), .35);
        float oceanSheen = pow(max(0., dot(reflect(-lightDirection, normal), vec3(0., 0., 1.))), 48.) * .035;
        gl_FragColor = vec4(color * light * rim + vec3(.22, .42, .58) * oceanSheen * (1. - land), 1.);
        #include <colorspace_fragment>
      }`
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), surfaceMaterial);
  globe.add(sphere);
  // A restrained atmospheric rim adds depth without obscuring the data surface.
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.018, 96, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 viewNormal;
      void main() { viewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 viewNormal;
      void main() { float edge = pow(1. - abs(normalize(viewNormal).z), 3.);
        gl_FragColor = vec4(.25, .55, .76, edge * .23);
        #include <colorspace_fragment>
      }`
  }));
  globe.add(atmosphere);

  // Subtle latitude / longitude lines, depth-tested against the globe.
  const gridPositions = [];
  const xyz = (lat, lon, radius = 1.001) => [radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.cos(lon)];
  function addLine(coordinates) {
    for (let i = 1; i < coordinates.length; i++) gridPositions.push(...coordinates[i - 1], ...coordinates[i]);
  }
  for (let lat = -60; lat <= 60; lat += 30) addLine(Array.from({length: 181}, (_, i) => xyz(lat * radians, i * 2 * radians)));
  for (let lon = 0; lon < 360; lon += 30) addLine(Array.from({length: 91}, (_, i) => xyz((-90 + i * 2) * radians, lon * radians)));
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  globe.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({color: 0xd7e7ca, transparent: true, opacity: .09, depthWrite: false})));
  const rings = new THREE.Group(); scene.add(rings);
  const ringMaterial = new THREE.LineBasicMaterial({color: 0xbdc8b9, transparent: true, opacity: .38});
  for (const radius of [1.11, 1.20]) {
    const ring = new THREE.BufferGeometry().setFromPoints(Array.from({length: 192}, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 96) * radius, Math.sin(i * Math.PI / 96) * radius, -.3)));
    rings.add(new THREE.LineLoop(ring, ringMaterial));
  }
  const tickPositions = [];
  for (let i = 0; i < 72; i++) {
    const angle = i * Math.PI / 36;
    for (const radius of [1.16, 1.16 + (i % 6 === 0 ? .022 : .008)]) tickPositions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, -.3);
  }
  const tickGeometry = new THREE.BufferGeometry(); tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
  rings.add(new THREE.LineSegments(tickGeometry, ringMaterial));

  function updateDataGeometry() {
    if (!rawPoints.length) return;
    const positions = new Float32Array(rawPoints.length * 3), colors = new Float32Array(rawPoints.length * 3);
    if (!columnsMesh) {
      columnsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), rawPoints.length);
      columnsMesh.frustumCulled = false; globe.add(columnsMesh);
    }
    const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
    rawPoints.forEach(([lat, lon, agb, height], index) => {
      const normal = new THREE.Vector3(...xyz(lat * radians, lon * radians, 1));
      const value = (variable === 'height' ? height : agb) / caps[variable];
      const color = colorAt(value);
      positions.set(normal.clone().multiplyScalar(1.003).toArray(), index * 3);
      colors.set(color.toArray(), index * 3);
      const length = .001 + Math.min(1, Math.max(0, value)) * (.0034 * emphasis);
      dummy.position.copy(normal).multiplyScalar(1 + length / 2);
      dummy.quaternion.setFromUnitVectors(up, normal);
      dummy.scale.set(.012 * Math.max(.2, Math.cos(lat * radians)), length, .012);
      dummy.updateMatrix(); columnsMesh.setMatrixAt(index, dummy.matrix); columnsMesh.setColorAt(index, color);
    });
    columnsMesh.instanceMatrix.needsUpdate = true; columnsMesh.instanceColor.needsUpdate = true;
    if (pointsMesh) { globe.remove(pointsMesh); pointsMesh.geometry.dispose(); pointsMesh.material.dispose(); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pointsMesh = new THREE.Points(geometry, new THREE.PointsMaterial({vertexColors: true, size: 1.85, sizeAttenuation: false}));
    globe.add(pointsMesh); dirty = true;
  }
  function syncUI(saveURL = false) {
    all('[data-globe-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.globeMode === mode));
      button.disabled = failedSurface && button.dataset.globeMode === 'surface';
    });
    $('#globe-variable').value = variable;
    const terrainOnly = mode === 'surface' && terrainReady && opacity === 0;
    const displayOpacity = terrainReady ? opacity : 100;
    $('#globe-opacity-control').hidden = mode !== 'surface';
    $('#globe-opacity').disabled = !terrainReady;
    $('#globe-opacity').value = displayOpacity;
    $('#globe-opacity').style.setProperty('--progress', `${displayOpacity}%`);
    $('#globe-opacity').setAttribute('aria-valuetext', `${displayOpacity}% data opacity${displayOpacity === 0 ? ', terrain only' : displayOpacity === 100 ? ', full data colors' : ', blended with terrain'}`);
    $('#globe-opacity-value').value = `${displayOpacity}%`;
    $('#globe-elevation-control').hidden = mode !== 'relief';
    $('label[for="globe-elevation"]').textContent = variable === 'height' ? 'Height emphasis' : 'Column emphasis';
    $('#globe-gap-key').hidden = !surfaceReady && !coastlineReady;
    $('#globe-gap-key').classList.toggle('terrain-unavailable', !terrainReady);
    $('#globe-gap-label').textContent = terrainReady ? (terrainOnly ? 'Natural Earth' : 'Terrain background') : 'Land background';
    $('#globe-legend-title').textContent = terrainOnly ? 'GEOGRAPHIC TERRAIN' : labels[variable].toUpperCase();
    $('#globe-color-ramp').hidden = terrainOnly;
    $('.globe-legend-scale').hidden = terrainOnly;
    $('.globe-legend small').hidden = terrainOnly;
    $('#globe-max').textContent = variable === 'height' ? '40 m' : '12+ kg C m⁻²';
    $('#globe-mode-note').textContent = mode === 'surface'
      ? (surfaceReady ? (terrainOnly ? 'Terrain only. Increase data opacity to reveal the simulation layer.' : opacity === 100 || !terrainReady
        ? 'Full data colors over a 0.5° simulation grid, with nearby land gaps interpolated.'
        : 'Data colors blend with terrain. Set opacity to 100% for full data colors; source resolution stays 0.5°.') : 'Preparing the full grid and interpolated land surface…')
      : mode === 'relief' ? 'Original sampled cells. Column heights are exaggerated for comparison; they are not Earth-scale vegetation.'
      : 'Original 1° display sample over a geographic background, without gap filling.';
    if (failedSurface) $('#globe-mode-note').textContent += ' The smooth surface could not load; reload to try again.';
    if (failedTerrain) $('#globe-mode-note').textContent += ' Terrain imagery could not load; plain land is shown instead.';
    if (failedCoastline) $('#globe-mode-note').textContent += ' Detailed coastlines could not load; the original grid outlines are shown.';
    $('#globe-terrain-note').hidden = !terrainReady || (!surfaceReady && !coastlineReady);
    canvas.setAttribute('aria-label', `${labels[variable]} globe, ${mode === 'surface' ? (terrainOnly ? 'geographic terrain only' : `smooth surface with ${displayOpacity}% data opacity and local land interpolation`) : mode === 'relief' ? 'exaggerated 3D columns' : 'original sampled dots'}, midnight blue ocean${terrainReady && (surfaceReady || coastlineReady) ? ' and a geographic terrain background' : ''}. Year 40, initial forest age 10 years. Drag or use arrow keys to rotate.`);
    canvas.dataset.mode = mode; canvas.dataset.variable = variable; canvas.dataset.ocean = 'blue'; canvas.dataset.opacity = displayOpacity;
    uniforms.variable.value = variable === 'height' ? 1 : 0;
    uniforms.viewMode.value = mode === 'points' ? 2 : mode === 'relief' ? 1 : 0;
    uniforms.dataOpacity.value = opacity / 100;
    if (pointsMesh) pointsMesh.visible = mode === 'points' || (mode === 'surface' && !surfaceReady);
    if (columnsMesh) columnsMesh.visible = mode === 'relief';
    if (saveURL) {
      const url = new URL(location.href); url.searchParams.set('globe', mode); url.searchParams.set('variable', variable);
      url.searchParams.set('opacity', opacity);
      history.replaceState(null, '', url);
    }
    resize(); dirty = true;
  }
  all('[data-globe-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.globeMode; syncUI(true); }));
  $('#globe-variable').addEventListener('change', event => { variable = event.target.value; updateDataGeometry(); syncUI(true); });
  $('#globe-opacity').addEventListener('input', event => { opacity = Number(event.target.value); syncUI(); });
  $('#globe-opacity').addEventListener('change', () => syncUI(true));
  $('#globe-elevation').addEventListener('input', event => {
    emphasis = Number(event.target.value); event.target.style.setProperty('--progress', `${emphasis}%`);
    event.target.setAttribute('aria-valuetext', `${emphasis}% visual height emphasis`); updateDataGeometry(); syncUI();
  });
  const toggle = $('#globe-toggle');
  const renderedSize = new THREE.Vector2();
  function updateRotationButton() {
    toggle.setAttribute('aria-pressed', String(paused)); toggle.setAttribute('aria-label', paused ? 'Resume globe rotation' : 'Pause globe rotation');
    $('#globe-play-icon').textContent = paused ? '▶' : 'Ⅱ';
  }
  toggle.addEventListener('click', () => { paused = !paused; updateRotationButton(); dirty = true; });
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; updateRotationButton(); });
  canvas.addEventListener('pointerdown', event => {
    dragging = true; lastPointer = {x: event.clientX, y: event.clientY}; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    longitude -= (event.clientX - lastPointer.x) * .006;
    tilt = Math.max(-.8, Math.min(.8, tilt + (event.clientY - lastPointer.y) * .004));
    lastPointer = {x: event.clientX, y: event.clientY}; dirty = true;
  });
  const release = () => { dragging = false; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); paused = true; updateRotationButton();
    if (event.key === 'ArrowLeft') longitude -= .13;
    if (event.key === 'ArrowRight') longitude += .13;
    if (event.key === 'ArrowUp') tilt = Math.min(.8, tilt + .08);
    if (event.key === 'ArrowDown') tilt = Math.max(-.8, tilt - .08);
    dirty = true;
  });
  function resize() {
    const {width, height} = canvas.getBoundingClientRect(), shortest = Math.min(width, height) || 1;
    // Leave space for the tallest columns at every rotation and emphasis.
    const framing = mode === 'relief' ? 1 + Math.max(0, emphasis - 50) * .0032 : 1;
    const halfX = width / shortest / .814 * framing, halfY = height / shortest / .814 * framing;
    camera.left = -halfX; camera.right = halfX; camera.top = halfY; camera.bottom = -halfY; camera.updateProjectionMatrix();
    tiltGroup.position.y = rings.position.y = halfY * .04;
    renderer.getSize(renderedSize);
    if (renderedSize.x !== width || renderedSize.y !== height) renderer.setSize(width, height, false);
    dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; dirty = true; }).observe(canvas);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); $('#globe-status').textContent = 'Globe rendering paused. Reload to restore the interactive view.'; $('#globe-status').hidden = false;
  });
  canvas.addEventListener('webglcontextrestored', () => { dirty = true; $('#globe-status').hidden = true; });
  function frame(time) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden || time - lastFrame < 32) return;
    const elapsed = Math.min(time - lastFrame, 64); lastFrame = time;
    if (!paused && !dragging) { longitude += elapsed * .000035; dirty = true; }
    if (!dirty) return;
    tiltGroup.rotation.x = tilt; globe.rotation.y = -longitude;
    renderer.render(scene, camera); dirty = false;
  }
  syncUI(); updateRotationButton(); requestAnimationFrame(frame);
  new THREE.TextureLoader().load('assets/textures/earth-terrain.webp', texture => {
    // The shader addresses north at v=0, matching the scientific grid's rows.
    texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    uniforms.terrain.value = texture; uniforms.hasTerrain.value = true;
    terrainReady = true; canvas.dataset.terrainReady = 'true'; syncUI();
  }, undefined, () => {
    failedTerrain = true; canvas.dataset.terrainReady = 'false'; syncUI();
  });
  new THREE.TextureLoader().load('assets/textures/earth-land-mask.png', texture => {
    texture.flipY = false; texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); texture.needsUpdate = true;
    uniforms.coastline.value = texture; uniforms.hasCoastline.value = true;
    coastlineReady = true; canvas.dataset.coastlineReady = 'true'; syncUI();
  }, undefined, () => {
    failedCoastline = true; canvas.dataset.coastlineReady = 'false'; syncUI();
  });
  return {
    setPoints(points) {
      rawPoints = points; updateDataGeometry(); syncUI(); $('#globe-status').hidden = true;
    },
    setSurface(data) {
      const {width, height, scale, offset, nodata} = data.meta;
      if (width !== 720 || height !== 360 || scale !== .01 || offset !== 0 || nodata !== 65535) throw new Error('Unsupported globe surface format');
      const agb = bytes(data.agb), heightBytes = bytes(data.height), mask = bytes(data.mask), count = width * height;
      if (agb.length !== count * 2 || heightBytes.length !== count * 2 || mask.length !== count) throw new Error('Incomplete globe surface');
      const agbView = new DataView(agb.buffer), heightView = new DataView(heightBytes.buffer);
      const fields = new Uint8Array(count * 4), classes = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        const known = mask[i] >= 2;
        fields[i * 4] = known ? Math.round(Math.min(1, agbView.getUint16(i * 2, true) * scale / caps.agb) * 255) : 0;
        fields[i * 4 + 1] = known ? Math.round(Math.min(1, heightView.getUint16(i * 2, true) * scale / caps.height) * 255) : 0;
        fields[i * 4 + 2] = known ? 255 : 0; fields[i * 4 + 3] = 255;
        classes[i * 4] = mask[i] * 85; classes[i * 4 + 3] = 255;
      }
      const fieldTexture = new THREE.DataTexture(fields, width, height);
      fieldTexture.minFilter = fieldTexture.magFilter = THREE.LinearFilter; fieldTexture.wrapS = THREE.RepeatWrapping; fieldTexture.needsUpdate = true;
      const classTexture = new THREE.DataTexture(classes, width, height); classTexture.wrapS = THREE.RepeatWrapping; classTexture.needsUpdate = true;
      if (uniforms.fields.value !== empty) uniforms.fields.value.dispose();
      if (uniforms.classes.value !== empty) uniforms.classes.value.dispose();
      uniforms.fields.value = fieldTexture; uniforms.classes.value = classTexture; uniforms.hasSurface.value = true;
      surfaceReady = true; failedSurface = false; canvas.dataset.surfaceReady = 'true'; syncUI(); $('#globe-status').hidden = true;
    },
    surfaceError() { failedSurface = true; if (mode === 'surface') mode = 'points'; syncUI(); }
  };
}
