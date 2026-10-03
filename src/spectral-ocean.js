import { readFloatProbe } from "./float-readback.js";
export const FFT_SIZE = 256;
export const DOMAINS = [1024, 96, 9];
export const OCEAN_PARAMETERS = Object.freeze({
  gravity: 9.81,
  windSpeed: 15,
  windDirection: 1,
  peakWavelength: 47,
  gamma: 3.3,
  spread: 1.57,
  standing: 0.13,
  choppiness: 1.5,
  period: 8192,
});
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
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
export function dispersion(k) {
  const unit = (2 * Math.PI) / OCEAN_PARAMETERS.period;
  return (
    Math.round(Math.sqrt(OCEAN_PARAMETERS.gravity * (k + 1e-4)) / unit) * unit
  );
}
export function spectralDensity(
  kx,
  kz,
  domain,
  lower,
  upper,
  parameters = OCEAN_PARAMETERS,
) {
  const {
    gravity: g,
    windSpeed: U,
    windDirection: direction,
    peakWavelength: wave,
    gamma,
    spread,
    standing,
  } = parameters;
  const k = Math.max(Math.hypot(kx, kz), 1e-4),
    omega = Math.sqrt(g * k),
    peak = Math.sqrt((2 * Math.PI * g) / wave),
    ratio = omega / peak;
  const alpha = 0.076 * Math.pow((Math.max(U, 0.1) * peak) / (22 * g), 0.66),
    sigma = omega < peak ? 0.07 : 0.09;
  const peakShape = Math.exp(
    -Math.pow(omega - peak, 2) / (2 * sigma * sigma * peak * peak + 1e-4),
  );
  const energy =
    ((alpha * g * g) / Math.pow(omega, 5)) *
    Math.exp(-1.25 / Math.pow(ratio, 4)) *
    Math.pow(gamma, peakShape) *
    ((0.5 * Math.sqrt(g / k)) / k);
  const q = clamp(
      (kx * Math.cos(direction) + kz * Math.sin(direction)) / k,
      -1,
      1,
    ),
    s = Math.max(0.5, spread * 9.77 * Math.pow(ratio, omega < peak ? 5 : -2.5));
  const halfCos = Math.sqrt(Math.max((q + 1) * 0.5, 1e-4));
  const directional =
    ((Math.pow(halfCos, 2 * s) * Math.sqrt(s + 0.25)) /
      (2 * Math.sqrt(Math.PI))) *
    (0.07 + 0.93 * standing + (1 - (0.07 + 0.93 * standing)) * (q + 1) * 0.5);
  const band =
    smooth(lower / 1.5, lower * 1.5, k) *
    (1 - smooth(upper / 1.5, upper * 1.5, k));
  return energy * directional * Math.pow((2 * Math.PI) / domain, 2) * band;
}
export function generateSpectra(
  size = FFT_SIZE,
  domains = DOMAINS,
  parameters = OCEAN_PARAMETERS,
) {
  let lower = 1e-9,
    expectedVariance = 0;
  const cascades = [];
  for (let band = 0; band < domains.length; band++) {
    const domain = domains[band],
      dk = (2 * Math.PI) / domain,
      upper = (Math.PI * size) / domain / 1.5,
      data = new Float32Array(size * size * 4),
      raw = new Float64Array(size * size * 2),
      rng = randomGenerator(71831 + band * 13007);
    let power = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x,
          kx = (x - size / 2) * dk,
          kz = (y - size / 2) * dk;
        const P = spectralDensity(kx, kz, domain, lower, upper, parameters),
          radius = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-4))),
          phase = 2 * Math.PI * rng();
        raw[2 * i] = radius * Math.cos(phase) * Math.sqrt(P * 0.5);
        raw[2 * i + 1] = radius * Math.sin(phase) * Math.sqrt(P * 0.5);
        data[4 * i + 2] = kx;
        data[4 * i + 3] = kz;
        power += P;
      }
    const a = 1 - parameters.standing * 0.5,
      b = parameters.standing * 0.5;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x,
          j = ((size - y) % size) * size + ((size - x) % size);
        data[4 * i] = a * raw[2 * i] + b * raw[2 * j];
        data[4 * i + 1] = a * raw[2 * i + 1] - b * raw[2 * j + 1];
      }
    expectedVariance += power * (1 + Math.pow(1 - parameters.standing, 2));
    const frequency = Float32Array.from({ length: size * size }, (_, i) =>
      dispersion(Math.hypot(data[i * 4 + 2], data[i * 4 + 3])),
    );
    cascades.push({
      domain,
      lower,
      upper,
      data,
      raw,
      frequency,
      expectedTimeVariance: power * (1 + Math.pow(1 - parameters.standing, 2)),
    });
    lower = upper;
  }
  return { size, cascades, normalization: 1, expectedVariance, parameters };
}
export const QUAD_VERTEX = `precision highp float;in vec3 position;void main(){gl_Position=vec4(position.xy,0.,1.);}`;
export const EVOLVE_FRAGMENT = `precision highp float;precision highp int;
uniform sampler2D uInitial,uFrequency;uniform float uTime,uChop;uniform int uSize,uLogSize;out vec4 result;
int reverseIndex(int v){int r=0;for(int i=0;i<9;i++){if(i>=uLogSize)break;r=(r<<1)|(v&1);v>>=1;}return r;}
vec2 multiplyComplex(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
void main(){ivec2 outputIndex=ivec2(gl_FragCoord.xy),index=ivec2(reverseIndex(outputIndex.x),outputIndex.y);vec4 seed=texelFetch(uInitial,index,0);vec2 opposite=texelFetch(uInitial,(ivec2(uSize)-index)%uSize,0).xy;
 float k=length(seed.zw)+.0001;float omega=texelFetch(uFrequency,index,0).r;float phase=omega*uTime;vec2 e=vec2(cos(phase),-sin(phase));
 vec2 h=multiplyComplex(seed.xy,e)+multiplyComplex(vec2(opposite.x,-opposite.y),vec2(e.x,-e.y));
 result=vec4(h*(1.+seed.z/k),vec2(h.y,-h.x)*seed.w/k);
}`;
export const FFT_FRAGMENT = `precision highp float;precision highp int;
uniform sampler2D uInput;uniform int uStage,uLogSize;uniform bool uHorizontal,uFinalize,uPair,uReorderY;
out vec4 result;
vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec4 rotatePair(vec4 value,vec2 w){return vec4(cmul(value.xy,w),cmul(value.zw,w));}
int reverseIndex(int v){int r=0;for(int i=0;i<9;i++){if(i>=uLogSize)break;r=(r<<1)|(v&1);v>>=1;}return r;}
vec4 loadAt(ivec2 p,int index){ivec2 q=uHorizontal?ivec2(index,p.y):ivec2(p.x,index);if(uReorderY)q.y=reverseIndex(q.y);return texelFetch(uInput,q,0);}
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);int index=uHorizontal?p.x:p.y;int span=1<<uStage;int halfSpan=span>>1;
 if(uPair){
  int outerSpan=span<<1,j=index%span,j1=j%halfSpan,base=(index/outerSpan)*outerSpan+j1;
  float phase1=6.28318530718*float(j1)/float(span),phase2=6.28318530718*float(j)/float(outerSpan);
  vec2 w1=vec2(cos(phase1),sin(phase1)),w2=vec2(cos(phase2),sin(phase2));float sign1=j<halfSpan?1.:-1.;
  vec4 a=loadAt(p,base)+sign1*rotatePair(loadAt(p,base+halfSpan),w1);
  vec4 b=loadAt(p,base+span)+sign1*rotatePair(loadAt(p,base+span+halfSpan),w1);
  result=a+((index%outerSpan)<span?1.:-1.)*rotatePair(b,w2);
 }else{
  int j=index%halfSpan,base=(index/span)*span+j;float phase=6.28318530718*float(j)/float(span);vec2 w=vec2(cos(phase),sin(phase));
  vec4 a=loadAt(p,base),b=rotatePair(loadAt(p,base+halfSpan),w);result=a+((index%span)<halfSpan?b:-b);
 }
 if(uFinalize)result*=((p.x+p.y)&1)==0?1.:-1.;
}`;
export const BLEND_FRAGMENT = `precision highp float;precision highp int;
uniform sampler2D uField0,uField1;uniform float uAlpha,uAmplitude,uChop,uDomain;uniform int uSize;
layout(location=0) out vec4 field;layout(location=1) out vec4 normalFoam;
vec3 displacement(ivec2 p){p=(p+ivec2(uSize))%uSize;vec4 f=mix(texelFetch(uField0,p,0),texelFetch(uField1,p,0),uAlpha);return vec3(f.y*uChop,-f.x,f.z*uChop)*uAmplitude;}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);float cell=uDomain/float(uSize);vec3 d=displacement(p),dx=(displacement(p+ivec2(1,0))-displacement(p-ivec2(1,0)))/(2.*cell),dz=(displacement(p+ivec2(0,1))-displacement(p-ivec2(0,1)))/(2.*cell);
 vec3 tx=vec3(1,0,0)+dx,tz=vec3(0,0,1)+dz,n=normalize(cross(tz,tx));
 float eigen=.5*(tx.x+tz.z-sqrt(max((tx.x-tz.z)*(tx.x-tz.z)+4.*tx.z*tz.x,0.)));
 float compression=clamp(1.-eigen,0.,1.)*smoothstep(0.,.2,dot(n.xz,vec2(.540302306,.841470985)));
 field=vec4(d.y,d.x,d.z,0.);normalFoam=vec4(n*.5+.5,1.-compression);
}`;
export function createSpectralOcean(THREE, renderer) {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const spectrum = generateSpectra(),
    n = spectrum.size,
    log = Math.log2(n),
    chop = 1.5;
  const options = {
    type: THREE.FloatType,
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
  const evolve = material(EVOLVE_FRAGMENT, {
    uInitial: { value: null },
    uFrequency: { value: null },
    uTime: { value: 0 },
    uChop: { value: 1 },
    uSize: { value: n },
    uLogSize: { value: log },
  });
  const fft = material(FFT_FRAGMENT, {
    uInput: { value: null },
    uStage: { value: 1 },
    uHorizontal: { value: true },
    uFinalize: { value: false },
    uPair: { value: true },
    uReorderY: { value: false },
    uLogSize: { value: log },
  });
  const blend = material(BLEND_FRAGMENT, {
    uField0: { value: null },
    uField1: { value: null },
    uAlpha: { value: 0 },
    uAmplitude: { value: 1 },
    uChop: { value: chop },
    uDomain: { value: 0 },
    uSize: { value: n },
  });
  const cascades = spectrum.cascades.map((c) => {
    const initial = new THREE.DataTexture(
      c.data,
      n,
      n,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    initial.needsUpdate = true;
    const frequency = new THREE.DataTexture(
      c.frequency,
      n,
      n,
      THREE.RedFormat,
      THREE.FloatType,
    );
    frequency.needsUpdate = true;
    const ping = [
        new THREE.WebGLRenderTarget(n, n, options),
        new THREE.WebGLRenderTarget(n, n, options),
      ],
      snapshots = [
        new THREE.WebGLRenderTarget(n, n, options),
        new THREE.WebGLRenderTarget(n, n, options),
      ];
    const output = new THREE.WebGLRenderTarget(n, n, {
      ...options,
      type: THREE.HalfFloatType,
      count: 2,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      generateMipmaps: true,
    });
    return {
      domain: c.domain,
      original: c.data.slice(),
      initial,
      frequency,
      ping,
      snapshots,
      output,
    };
  });
  const gl = renderer.getContext(),
    checkedTargets = new WeakSet();
  const draw = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    if (!checkedTargets.has(target)) {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Spectral framebuffer is incomplete");
      checkedTargets.add(target);
    }
    renderer.render(scene, camera);
  };
  function validate() {
    for (const c of cascades)
      for (let attachment = 0; attachment < 2; attachment++) {
        const probe = readFloatProbe(
          renderer,
          c.output,
          31,
          47,
          4,
          4,
          0,
          attachment,
        );
        let energy = 0;
        for (const value of probe) {
          if (!Number.isFinite(value) || Math.abs(value) > 100)
            throw new Error("Invalid spectral target output");
          energy += Math.abs(value);
        }
        if (energy < 1e-7)
          throw new Error("Spectral target produced no signal");
      }
  }
  let phaseBase = -1;
  function transform(time, snapshotIndex) {
    const nextBase = Math.floor(time / 120) * 120;
    if (nextBase !== phaseBase) {
      for (const c of cascades) {
        const data = c.initial.image.data,
          source = c.original;
        for (let i = 0; i < data.length; i += 4) {
          const phase = -c.frequency.image.data[i / 4] * nextBase,
            cs = Math.cos(phase),
            sn = Math.sin(phase);
          data[i] = source[i] * cs - source[i + 1] * sn;
          data[i + 1] = source[i] * sn + source[i + 1] * cs;
        }
        c.initial.needsUpdate = true;
      }
      phaseBase = nextBase;
    }
    for (const c of cascades) {
      evolve.uniforms.uInitial.value = c.initial;
      evolve.uniforms.uFrequency.value = c.frequency;
      evolve.uniforms.uTime.value = time - phaseBase;
      draw(evolve, c.ping[0]);
      let read = 0;
      fft.uniforms.uHorizontal.value = true;
      fft.uniforms.uFinalize.value = false;
      fft.uniforms.uReorderY.value = false;
      for (let stage = 1; stage <= log; stage += 2) {
        fft.uniforms.uStage.value = stage;
        fft.uniforms.uPair.value = stage < log;
        fft.uniforms.uInput.value = c.ping[read].texture;
        draw(fft, c.ping[1 - read]);
        read = 1 - read;
      }
      fft.uniforms.uHorizontal.value = false;
      for (let stage = 1; stage <= log; stage += 2) {
        const final = stage + 1 >= log;
        fft.uniforms.uStage.value = stage;
        fft.uniforms.uPair.value = stage < log;
        fft.uniforms.uReorderY.value = stage === 1;
        fft.uniforms.uFinalize.value = final;
        fft.uniforms.uInput.value = c.ping[read].texture;
        draw(fft, final ? c.snapshots[snapshotIndex] : c.ping[1 - read]);
        if (!final) read = 1 - read;
      }
    }
  }
  let firstTime = null,
    nextTime = null,
    current = 0;
  function update(time, rate = 30, amplitude = 1) {
    const previous = renderer.getRenderTarget(),
      step = 1 / Math.max(10, Math.min(60, rate));
    try {
      if (firstTime === null || time < firstTime || time - nextTime > 0.25) {
        firstTime = time;
        nextTime = time + step;
        current = 0;
        transform(firstTime, 0);
        transform(nextTime, 1);
      } else if (time > nextTime) {
        firstTime = nextTime;
        current = 1 - current;
        nextTime = Math.max(firstTime + step, time + step * 0.5);
        transform(nextTime, 1 - current);
      }
      blend.uniforms.uAlpha.value = Math.max(
        0,
        Math.min(1, (time - firstTime) / (nextTime - firstTime)),
      );
      blend.uniforms.uAmplitude.value = amplitude;
      for (const c of cascades) {
        blend.uniforms.uField0.value = c.snapshots[current].texture;
        blend.uniforms.uField1.value = c.snapshots[1 - current].texture;
        blend.uniforms.uDomain.value = c.domain;
        draw(blend, c.output);
      }
    } finally {
      renderer.setRenderTarget(previous);
    }
  }
  return {
    cascades,
    update,
    validate,
    chop,
    size: n,
    dispose() {
      for (const c of cascades) {
        c.initial.dispose();
        c.frequency.dispose();
        for (const t of [...c.ping, ...c.snapshots, c.output]) t.dispose();
      }
      for (const m of [evolve, fft, blend]) m.dispose();
      quad.geometry.dispose();
    },
  };
}
