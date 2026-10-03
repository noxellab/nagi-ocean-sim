import { SKY_DECODE_GLSL } from "./photo-sky.js";
import { readFloatProbe } from "./float-readback.js";
import { createEnvironmentPrefilter } from "./prefiltered-environment.js";
export const ATMOSPHERE_GLSL = `${SKY_DECODE_GLSL}
uniform float uPhotoSkyReady;
uniform float uAtmosSun,uAtmosMood,uAtmosTime;
uniform sampler2D uSkyPhoto;
const float ATMOS_PI=3.14159265359;
vec3 atmosphereSun(){return vec3(-.79863551*cos(uAtmosSun),sin(uAtmosSun),-.60181502*cos(uAtmosSun));}
vec4 atmosphereRadiance(vec3 direction){
 vec3 rd=normalize(direction);float below=max(-rd.y,0.);vec3 q=normalize(vec3(rd.x,max(abs(rd.y),.0001),rd.z));
 const float rotation=3.093747;float c=cos(rotation),s=sin(rotation);q.xz=mat2(c,s,-s,c)*q.xz;
 q=normalize(vec3(q.x,q.y*tan(.835763)/max(tan(uAtmosSun),.025),q.z));
 vec2 uv=vec2(atan(q.z,q.x)/(2.*ATMOS_PI)+.5,asin(clamp(q.y,-1.,1.))/ATMOS_PI+.5);
 vec3 color=(uPhotoSkyReady>.5?sampleSkyImageFast(q,true):textureLod(uSkyPhoto,uv,0.).rgb)*.7;
 float sunset=1.-smoothstep(.12,.58,uAtmosSun);color*=mix(vec3(1),vec3(1.28,.75,.48),sunset);
 float storm=clamp(uAtmosMood-1.,0.,1.);float luminance=dot(color,vec3(.2126,.7152,.0722));color=mix(color,vec3(.72,.79,.84)*(.15+luminance*.35),storm*.92);
 vec3 haze=mix(vec3(.258,.275,.287),vec3(.33,.206,.138),sunset);haze=mix(haze,vec3(.18,.205,.22),storm);
 color=mix(haze,color,smoothstep(.0,mix(.025,.065,sunset),max(rd.y,0.)));
 if(below>0.){float F=.0180094+.9819906*pow(1.-min(below,1.),5.);color=color*F+vec3(.0159963,.0612461,.0998987)*(1.-F);}
 return vec4(max(color,vec3(0)),1.-storm*.97);
}
`;
export const ATMOSPHERE_VERTEX = `varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const ATMOSPHERE_FRAGMENT = `${ATMOSPHERE_GLSL}\nvarying vec3 vDirection;void main(){gl_FragColor=atmosphereRadiance(normalize(vDirection));}`;
export function solarColor(THREE, sun, mood) {
  const warm = Math.max(0, Math.min(1, (sun - 0.08) / 0.7));
  return new THREE.Vector3(1, 0.58 + 0.39 * warm, 0.3 + 0.62 * warm);
}
export function createAtmosphere(
  THREE,
  renderer,
  uniforms,
  initial,
  noiseBytes,
) {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  if (!noiseBytes || noiseBytes.length !== 1024 * 512 * 4 * 2)
    throw new Error("Sky radiance data is incomplete");
  const noise = new THREE.DataTexture(
    new Uint16Array(
      noiseBytes.buffer,
      noiseBytes.byteOffset,
      noiseBytes.byteLength / 2,
    ),
    1024,
    512,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  noise.wrapS = THREE.RepeatWrapping;
  noise.wrapT = THREE.ClampToEdgeWrapping;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.magFilter = THREE.LinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;
  const resolutionFor = (quality) => {
    const extent = Math.max(
      renderer.domElement?.width || 1280,
      renderer.domElement?.height || 800,
    );
    return quality === "high"
      ? extent > 1100
        ? 1024
        : 512
      : quality === "light"
        ? 128
        : extent > 1000
          ? 512
          : 256;
  };
  const makeTarget = (size) =>
    new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
  const targets = [0, 1].map(() => makeTarget(resolutionFor("balanced")));
  const captureUniforms = {
    uAtmosSun: { value: initial.sun },
    uAtmosMood: { value: initial.mood },
    uAtmosTime: { value: initial.time },
    uSkyPhoto: { value: noise },
    uSkyImageSDR: uniforms.uSkyImageSDR,
    uSkyImageGain: uniforms.uSkyImageGain,
    uPhotoSkyReady: uniforms.uPhotoSkyReady,
  };
  const scene = new THREE.Scene(),
    geometry = new THREE.BoxGeometry(2, 2, 2),
    material = new THREE.ShaderMaterial({
      uniforms: captureUniforms,
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.CubeCamera(0.1, 10, targets[0]);
  camera.coordinateSystem = THREE.WebGLCoordinateSystem;
  camera.updateCoordinateSystem();
  camera.updateMatrixWorld(true);
  let prefilter = null;
  try {
    prefilter = createEnvironmentPrefilter(THREE, renderer, uniforms);
  } catch (error) {
    console.warn(
      "Environment prefilter unavailable; keeping raw HDR atmosphere",
      error,
    );
  }
  const gl = renderer.getContext(),
    checked = [new Set(), new Set()],
    validated = [false, false];
  let current = 0,
    building = false,
    face = 0,
    blending = false,
    progress = 1,
    currentParams = { ...initial },
    nextParams = { ...initial },
    blendDuration = 0.35;
  function releaseTarget(index) {
    targets[index]?.dispose();
    targets[index] = null;
    checked[index].clear();
    validated[index] = false;
  }
  function captureParams(p) {
    captureUniforms.uAtmosSun.value = p.sun;
    captureUniforms.uAtmosMood.value = p.mood;
    captureUniforms.uAtmosTime.value = p.time;
  }
  function renderFace(index, which) {
    const previous = renderer.getRenderTarget(),
      oldFace = renderer.getActiveCubeFace(),
      oldLevel = renderer.getActiveMipmapLevel();
    try {
      targets[index].texture.generateMipmaps = which === 5;
      renderer.setRenderTarget(targets[index], which);
      if (!checked[index].has(which)) {
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw new Error("Atmosphere cube face is incomplete");
        checked[index].add(which);
      }
      renderer.render(scene, camera.children[which]);
    } finally {
      renderer.setRenderTarget(previous, oldFace, oldLevel);
    }
  }
  function validate(index) {
    for (let which = 0; which < 6; which++) {
      const data = readFloatProbe(
        renderer,
        targets[index],
        31,
        47,
        2,
        2,
        which,
      );
      let energy = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v) || v < 0 || v > 10000)
          throw new Error("Invalid atmosphere radiance");
        if (i % 4 < 3) energy += v;
      }
      if (energy < 1e-6) throw new Error("Atmosphere capture has no radiance");
    }
  }
  function publishLighting(a, b, mix) {
    prefilter?.publish(a, b);
    uniforms.uEnvironmentA.value = targets[a].texture;
    uniforms.uEnvironmentB.value = targets[b].texture;
    uniforms.uEnvironmentMix.value = mix;
    uniforms.uEnvironmentSizeA.value = targets[a].width;
    uniforms.uEnvironmentSizeB.value = targets[b].width;
    uniforms.uSkySun.value =
      currentParams.sun + (nextParams.sun - currentParams.sun) * mix;
    uniforms.uSkyMood.value =
      currentParams.mood + (nextParams.mood - currentParams.mood) * mix;
    uniforms.uSolarColor.value.copy(
      solarColor(THREE, uniforms.uSkySun.value, uniforms.uSkyMood.value),
    );
    uniforms.uEnvironmentReady.value = 1;
  }
  try {
    captureParams(initial);
    for (let i = 0; i < 6; i++) renderFace(0, i);
    validate(0);
    validated[0] = true;
    prefilter?.capture(0, targets[0]);
    publishLighting(0, 0, 1);
  } catch (error) {
    prefilter?.dispose();
    for (let index = 0; index < targets.length; index++) releaseTarget(index);
    noise.dispose();
    geometry.dispose();
    material.dispose();
    throw error;
  }
  function update(params, dt, quality = "balanced", paused = false) {
    const desiredResolution = resolutionFor(quality),
      resolutionMismatch =
        targets[current].width !== desiredResolution ||
        (blending && targets[1 - current].width !== desiredResolution);
    if (
      paused &&
      !resolutionMismatch &&
      Math.abs(params.sun - uniforms.uSkySun.value) < 0.003 &&
      Math.abs(params.mood - uniforms.uSkyMood.value) < 0.015
    )
      return;
    const interval = Infinity;
    if (blending) {
      const urgent =
        Math.abs(params.sun - nextParams.sun) > 0.01 ||
        Math.abs(params.mood - nextParams.mood) > 0.04;
      progress = Math.min(1, progress + dt / (urgent ? 0.2 : blendDuration));
      publishLighting(current, 1 - current, progress);
      if (progress >= 1) {
        current = 1 - current;
        currentParams = { ...nextParams };
        blending = false;
        publishLighting(current, current, 1);
        if (targets[1 - current]?.width !== desiredResolution)
          releaseTarget(1 - current);
      }
      return true;
    }
    if (building) {
      renderFace(1 - current, face++);
      if (face === 6) {
        if (!validated[1 - current]) {
          validate(1 - current);
          validated[1 - current] = true;
        }
        prefilter?.capture(1 - current, targets[1 - current]);
        building = false;
        blending = true;
        progress = 0;
        publishLighting(current, 1 - current, 0);
        return true;
      }
      return false;
    }
    const lightingChange =
      Math.abs(params.sun - currentParams.sun) > 0.003 ||
      Math.abs(params.mood - currentParams.mood) > 0.015;
    if (
      lightingChange ||
      resolutionMismatch ||
      Math.abs(params.time - currentParams.time) >= interval
    ) {
      if (targets[1 - current]?.width !== desiredResolution) {
        const replacement = makeTarget(desiredResolution);
        releaseTarget(1 - current);
        targets[1 - current] = replacement;
      }
      nextParams = { ...params };
      captureParams(nextParams);
      building = true;
      face = 0;
      blendDuration = lightingChange ? 0.3 : 0.35;
    }
  }
  return {
    update,
    validate: () => validate(current),
    dispose() {
      prefilter?.dispose();
      for (let index = 0; index < targets.length; index++) releaseTarget(index);
      noise.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
