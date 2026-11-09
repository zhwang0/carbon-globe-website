// Film post-processing: the frame renders into a multisampled target, its bright parts bloom
// (a threshold, a chain of 13-tap downsamples and tent upsamples), and the sum goes to the screen.
// The glow is gathered from the quarter-resolution level down, so it haloes bright things
// without washing out the things themselves.
import * as THREE from '../assets/vendor/three.module.js';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 13-tap downsample (Jimenez 2014); the first level also applies a soft threshold
const DOWN = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee; uniform bool uFirst;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
    vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    if (uFirst) {
      float br = max(col.r, max(col.g, col.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      col *= max(soft, br - uThreshold) / max(br, 1e-4);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

// 9-tap tent upsample, added onto the next larger level
const UP = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel * uRadius).rgb; }
  void main() {
    vec3 col = s(vec2(0, 0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, 1)) + s(vec2(0, -1))) * 2.0
      + s(vec2(-1, 1)) + s(vec2(1, 1)) + s(vec2(-1, -1)) + s(vec2(1, -1));
    gl_FragColor = vec4(col / 16.0, 1.0);
  }`;

const COMPOSITE = `uniform sampler2D tScene, tBloom; uniform vec2 uTexel; uniform float uStrength; varying vec2 vUv;
  vec3 b(vec2 o) { return texture2D(tBloom, vUv + o * uTexel).rgb; }
  void main() {
    vec3 bloom = (b(vec2(0, 0)) * 4.0 + (b(vec2(-1, 0)) + b(vec2(1, 0)) + b(vec2(0, 1)) + b(vec2(0, -1))) * 2.0
      + b(vec2(-1, 1)) + b(vec2(1, 1)) + b(vec2(-1, -1)) + b(vec2(1, -1))) / 16.0;
    // screen the glow over the frame, so it lifts dark surroundings without flattening highlights
    vec3 col = texture2D(tScene, vUv).rgb, add = min(bloom * uStrength, 1.0);
    gl_FragColor = vec4(col + add - col * add, 1.0);
  }`;

export function createPost(renderer, {levels = 6, strength = 0.55, threshold = 0.62, knee = 0.22} = {}) {
  const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const scene = new THREE.WebGLRenderTarget(1, 1, {samples: 4, type: THREE.UnsignedByteType, depthBuffer: true});
  const chain = Array.from({length: levels}, () => new THREE.WebGLRenderTarget(1, 1, {type, depthBuffer: false}));
  [scene, ...chain].forEach(t => { t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; t.texture.generateMipmaps = false; });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const qScene = new THREE.Scene().add(quad), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false, ...extra});
  const down = mat(DOWN, {tSrc: {value: null}, uTexel: {value: new THREE.Vector2()}, uThreshold: {value: threshold}, uKnee: {value: knee}, uFirst: {value: true}});
  const up = mat(UP, {tSrc: {value: null}, uTexel: {value: new THREE.Vector2()}, uRadius: {value: 1}},
    {blending: THREE.AdditiveBlending, transparent: true});
  const comp = mat(COMPOSITE, {tScene: {value: scene.texture}, tBloom: {value: chain[1].texture}, uTexel: {value: new THREE.Vector2()}, uStrength: {value: strength}});
  const size = new THREE.Vector2();

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  }
  return {
    uniforms: {strength: comp.uniforms.uStrength, threshold: down.uniforms.uThreshold},
    setSize() {
      renderer.getDrawingBufferSize(size);
      scene.setSize(size.x, size.y);
      chain.forEach((t, i) => t.setSize(Math.max(1, size.x >> (i + 1)), Math.max(1, size.y >> (i + 1))));
    },
    // everything drawn between begin() and end() lands in the multisampled scene target
    begin() { renderer.setRenderTarget(scene); },
    end() {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setScissorTest(false);
      let src = scene;
      chain.forEach((t, i) => {
        down.uniforms.tSrc.value = src.texture;
        down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        down.uniforms.uFirst.value = i === 0;
        pass(down, t);
        src = t;
      });
      for (let i = chain.length - 1; i > 1; i--) {
        up.uniforms.tSrc.value = chain[i].texture;
        up.uniforms.uTexel.value.set(1 / chain[i].width, 1 / chain[i].height);
        pass(up, chain[i - 1]);
      }
      comp.uniforms.uTexel.value.set(1 / chain[1].width, 1 / chain[1].height);
      pass(comp, null);
      renderer.autoClear = auto;
    },
    dispose() { scene.dispose(); chain.forEach(t => t.dispose()); },
  };
}
