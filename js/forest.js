// Props of the forest scenes: the ground grid and drifting motes of light.
import * as THREE from '../assets/vendor/three.module.js';

export function createGround(px) {
  const geo = new THREE.PlaneGeometry(120, 120, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {uOpacity: {value: 1}, uTime: {value: 0}, uShade: {value: 0}},
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uOpacity, uShade; varying vec3 vW;
      float grid(vec2 p, float s){ vec2 g = p / s; vec2 w = fwidth(g); vec2 f = abs(fract(g - 0.5) - 0.5) / w; return 1.0 - min(min(f.x, f.y), 1.0); }
      void main(){
        float r = length(vW.xz);
        float fade = smoothstep(42.0, 4.0, r);
        float g = grid(vW.xz, 1.0) * 0.12 + grid(vW.xz, 5.0) * 0.22;
        vec3 base = mix(vec3(0.02, 0.07, 0.06), vec3(0.01, 0.025, 0.03), smoothstep(0.0, 30.0, r));
        float sh = uShade > 0.0 ? smoothstep(uShade, uShade * 0.2, r) : 0.0;  // shade under a crown of radius uShade
        vec3 col = base * (1.0 - 0.45 * sh) + vec3(0.25, 0.9, 0.6) * g * fade * (1.0 - 0.7 * sh);
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
