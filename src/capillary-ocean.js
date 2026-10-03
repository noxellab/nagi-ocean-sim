import { readFloatProbe } from "./float-readback.js";
import { QUAD_VERTEX, FFT_FRAGMENT } from "./spectral-ocean.js";
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateCapillarySpectra() {
  let variance = 0;
  const bands = [];
  for (const [index, size, domain] of [
    [0, 256, 17.82],
    [1, 128, 2.173],
  ]) {
    const data = new Float32Array(size * size * 4),
      dk = (2 * Math.PI) / domain,
      rng = randomGenerator(90321 + index * 7907),
      limit = (Math.PI * size) / domain;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const kx = (x - size / 2) * dk,
          kz = (y - size / 2) * dk,
          k = Math.hypot(kx, kz),
          i = (y * size + x) * 4;
        if (k < 1e-8 || x === 0 || y === 0) continue;
        const direction = (kx * 0.35 + kz * 0.93675) / k,
          split = smooth(17, 29, k);
        const P =
          (0.42 + 0.58 * direction * direction) *
          (1 + Math.tanh(direction * 3) * 0.35) *
          Math.pow(k, -4.947) *
          smooth(2.5, 4.3, k) *
          (1 - smooth(limit * 0.55, limit * 0.9, k)) *
          (index === 0 ? 1 - split : split) *
          dk *
          dk;
        const radius = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-8))),
          angle = 2 * Math.PI * rng(),
          a = Math.sqrt(P * 0.5) * radius;
        data[i] = Math.cos(angle) * a;
        data[i + 1] = Math.sin(angle) * a;
        data[i + 2] = kx;
        data[i + 3] = kz;
        variance += 2 * P * k * k;
      }
    bands.push({ size, domain, data });
  }
  const normalization = 1 / Math.sqrt(variance);
  for (const b of bands)
    for (let i = 0; i < b.data.length; i += 4) {
      b.data[i] *= normalization;
      b.data[i + 1] *= normalization;
    }
  return { bands, normalization, expectedSlopeVariance: 1 };
}
export const CAPILLARY_EVOLVE = `precision highp float;precision highp int;
uniform sampler2D uInitial;uniform float uTime;uniform int uSize,uLogSize;out vec4 result;
int reverseIndex(int v){int r=0;for(int i=0;i<9;i++){if(i>=uLogSize)break;r=(r<<1)|(v&1);v>>=1;}return r;}
vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
void main(){ivec2 p=ivec2(gl_FragCoord.xy),q=ivec2(reverseIndex(p.x),p.y);vec4 seed=texelFetch(uInitial,q,0);float k=length(seed.zw);if(k<1e-8){result=vec4(0);return;}
 vec2 opposite=texelFetch(uInitial,(ivec2(uSize)-q)%uSize,0).xy;float phase=sqrt(9.81*k+.000074*k*k*k)*uTime;vec2 e=vec2(cos(phase),-sin(phase));vec2 h=cmul(seed.xy,e)+cmul(vec2(opposite.x,-opposite.y),vec2(e.x,-e.y));
 result=vec4(-seed.z*h.y-seed.w*h.x,seed.z*h.x-seed.w*h.y,0.,0.);
}`;
export const CAPILLARY_MOMENTS = `precision highp float;precision highp int;uniform sampler2D uInput;out vec4 result;void main(){vec2 s=texelFetch(uInput,ivec2(gl_FragCoord.xy),0).xy;result=vec4(s,dot(s,s),0.);}`;
export const CAPILLARY_BLEND = `precision highp float;precision highp int;uniform sampler2D uInput0,uInput1;uniform float uAlpha;out vec4 result;void main(){ivec2 p=ivec2(gl_FragCoord.xy);result=mix(texelFetch(uInput0,p,0),texelFetch(uInput1,p,0),uAlpha);}`;
export function createCapillaryOcean(THREE, renderer) {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const generated = generateCapillarySpectra(),
    options = {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
  const scene = new THREE.Scene(),
    camera = new THREE.Camera(),
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);
  const material = (fragmentShader, uniforms) =>
    new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  const evolve = material(CAPILLARY_EVOLVE, {
    uInitial: { value: null },
    uTime: { value: 0 },
    uSize: { value: 128 },
    uLogSize: { value: 7 },
  });
  const fft = material(FFT_FRAGMENT, {
    uInput: { value: null },
    uStage: { value: 1 },
    uHorizontal: { value: true },
    uFinalize: { value: false },
    uPair: { value: true },
    uReorderY: { value: false },
    uLogSize: { value: 7 },
  });
  const moments = material(CAPILLARY_MOMENTS, { uInput: { value: null } }),
    blend = material(CAPILLARY_BLEND, {
      uInput0: { value: null },
      uInput1: { value: null },
      uAlpha: { value: 0 },
    });
  const bands = generated.bands.map((b) => {
    const initial = new THREE.DataTexture(
      b.data,
      b.size,
      b.size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    initial.needsUpdate = true;
    const target = (format = THREE.RGBAFormat) =>
      new THREE.WebGLRenderTarget(b.size, b.size, { ...options, format });
    return {
      ...b,
      original: b.data.slice(),
      initial,
      ping: [target(THREE.RGFormat), target(THREE.RGFormat)],
      snapshots: [target(), target()],
      output: new THREE.WebGLRenderTarget(b.size, b.size, {
        ...options,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        generateMipmaps: true,
      }),
    };
  });
  const gl = renderer.getContext(),
    checked = new WeakSet();
  const draw = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    if (!checked.has(target)) {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Capillary framebuffer is incomplete");
      checked.add(target);
    }
    renderer.render(scene, camera);
  };
  let epoch = -1;
  function transform(time, index) {
    const nextEpoch = Math.floor(time / 120) * 120;
    if (epoch !== nextEpoch) {
      for (const b of bands) {
        const d = b.initial.image.data,
          s = b.original;
        for (let i = 0; i < d.length; i += 4) {
          const k = Math.hypot(s[i + 2], s[i + 3]),
            phase = -Math.sqrt(9.81 * k + 0.000074 * k * k * k) * nextEpoch,
            cs = Math.cos(phase),
            sn = Math.sin(phase);
          d[i] = s[i] * cs - s[i + 1] * sn;
          d[i + 1] = s[i] * sn + s[i + 1] * cs;
        }
        b.initial.needsUpdate = true;
      }
      epoch = nextEpoch;
    }
    for (const b of bands) {
      const log = Math.log2(b.size);
      evolve.uniforms.uInitial.value = b.initial;
      evolve.uniforms.uTime.value = time - epoch;
      evolve.uniforms.uSize.value = b.size;
      evolve.uniforms.uLogSize.value = log;
      draw(evolve, b.ping[0]);
      let read = 0;
      fft.uniforms.uLogSize.value = log;
      fft.uniforms.uHorizontal.value = true;
      fft.uniforms.uFinalize.value = false;
      fft.uniforms.uReorderY.value = false;
      for (let stage = 1; stage <= log; stage += 2) {
        fft.uniforms.uStage.value = stage;
        fft.uniforms.uPair.value = stage < log;
        fft.uniforms.uInput.value = b.ping[read].texture;
        draw(fft, b.ping[1 - read]);
        read = 1 - read;
      }
      fft.uniforms.uHorizontal.value = false;
      for (let stage = 1; stage <= log; stage += 2) {
        fft.uniforms.uStage.value = stage;
        fft.uniforms.uPair.value = stage < log;
        fft.uniforms.uReorderY.value = stage === 1;
        fft.uniforms.uFinalize.value = stage + 1 >= log;
        fft.uniforms.uInput.value = b.ping[read].texture;
        draw(fft, b.ping[1 - read]);
        read = 1 - read;
      }
      moments.uniforms.uInput.value = b.ping[read].texture;
      draw(moments, b.snapshots[index]);
    }
  }
  let first = null,
    next = null,
    current = 0;
  function update(time, rate = 30) {
    const previous = renderer.getRenderTarget(),
      step = 1 / Math.max(10, Math.min(60, rate));
    try {
      if (first === null || time < first || time - next > 0.25) {
        first = time;
        next = time + step;
        current = 0;
        transform(first, 0);
        transform(next, 1);
      } else if (time > next) {
        first = next;
        current = 1 - current;
        next = Math.max(first + step, time + step * 0.5);
        transform(next, 1 - current);
      }
      blend.uniforms.uAlpha.value = Math.max(
        0,
        Math.min(1, (time - first) / (next - first)),
      );
      for (const b of bands) {
        blend.uniforms.uInput0.value = b.snapshots[current].texture;
        blend.uniforms.uInput1.value = b.snapshots[1 - current].texture;
        draw(blend, b.output);
      }
    } finally {
      renderer.setRenderTarget(previous);
    }
  }
  function validate() {
    for (const b of bands) {
      const a = readFloatProbe(renderer, b.output, 31, 47, 4, 4);
      let power = 0;
      for (const v of a) {
        if (!Number.isFinite(v) || Math.abs(v) > 100)
          throw new Error("Invalid capillary output");
        power += Math.abs(v);
      }
      if (power < 1e-7) throw new Error("Empty capillary output");
    }
  }
  return {
    bands,
    update,
    validate,
    dispose() {
      for (const b of bands) {
        b.initial.dispose();
        for (const t of [...b.ping, ...b.snapshots, b.output]) t.dispose();
      }
      for (const m of [evolve, fft, moments, blend]) m.dispose();
      quad.geometry.dispose();
    },
  };
}
