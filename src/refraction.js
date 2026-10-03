export const REFRACTION_GLSL = `
uniform sampler2D uSceneColor,uSceneDepth;
uniform mat4 uRefractionView,uRefractionProjection;
uniform vec2 uViewport,uCameraNearFar;
uniform float uRefractionReady,uWaterIOR,uRefractionStrength;
float linearEyeDepth(float z){float n=uCameraNearFar.x,f=uCameraNearFar.y;return n*f/(f-z*(f-n));}
vec3 transmittedScene(vec3 P,vec3 N,vec3 V,out float path,out float valid){
 path=32.;valid=0.;if(uRefractionReady<.5)return vec3(0.);
 vec3 eye=(uRefractionView*vec4(P,1)).xyz;vec2 uv=gl_FragCoord.xy/uViewport;
 float waterZ=-eye.z;float baseDepth=texture2D(uSceneDepth,uv).r;
 if(baseDepth>=.999999)return vec3(0.);
 float baseZ=linearEyeDepth(baseDepth);if(baseZ<=waterZ)return vec3(0.);
 float thickness=baseZ-waterZ;
 vec3 bent=refract(-V,N,1./uWaterIOR),flatRay=refract(-V,vec3(0,1,0),1./uWaterIOR);
 vec3 delta=(uRefractionView*vec4(bent-flatRay,0)).xyz;
 vec2 offset=delta.xy*uRefractionStrength*smoothstep(0.,4.,thickness)*clamp(6./max(waterZ,1.),.15,1.);
 offset*=.035/(.035+length(offset));
 float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));offset*=smoothstep(.0,.055,edge);
 for(int i=0;i<2;i++){
  vec2 probe=clamp(uv+offset,vec2(.001),vec2(.999));
  float probeZ=linearEyeDepth(texture2D(uSceneDepth,probe).r);
  float tolerance=.45+.12*thickness;
  float continuity=min(1.,tolerance/max(abs(probeZ-baseZ),.0001));
  float behind=smoothstep(waterZ+.02,waterZ+.20,probeZ);
  offset*=continuity*behind;
 }
 vec2 displaced=clamp(uv+offset,vec2(.001),vec2(.999));
 float sampled=texture2D(uSceneDepth,displaced).r;float displacedZ=linearEyeDepth(sampled);
 if(sampled>=.999999||displacedZ<=waterZ+.03){displaced=uv;displacedZ=baseZ;}
 path=clamp(displacedZ-waterZ,0.,120.);valid=1.;return texture2D(uSceneColor,displaced).rgb;
}
`;
export function installRefractionUniforms(THREE, u) {
  Object.assign(u, {
    uSceneColor: { value: null },
    uSceneDepth: { value: null },
    uRefractionView: { value: new THREE.Matrix4() },
    uRefractionProjection: { value: new THREE.Matrix4() },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uCameraNearFar: { value: new THREE.Vector2(0.1, 5000) },
    uRefractionReady: { value: 0 },
    uWaterIOR: { value: 1.31 },
    uRefractionStrength: { value: 0.25 },
  });
}
export function createRefractionPass(THREE, renderer, scene, u) {
  let target = null,
    failed = false,
    checked = false;
  const size = new THREE.Vector2();
  function resize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.round(size.x)),
      h = Math.max(1, Math.round(size.y));
    if (target?.width === w && target?.height === h) return;
    const next = new THREE.WebGLRenderTarget(w, h, {
      type: renderer.extensions.has("EXT_color_buffer_float")
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    next.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    next.depthTexture.format = THREE.DepthFormat;
    target?.dispose();
    target = next;
    checked = false;
    u.uSceneColor.value = target.texture;
    u.uSceneDepth.value = target.depthTexture;
    u.uViewport.value.set(w, h);
  }
  function render(camera) {
    if (failed) return;
    const previous = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    const color = renderer.getClearColor(new THREE.Color()),
      alpha = renderer.getClearAlpha();
    try {
      resize();
      camera.updateMatrixWorld(true);
      u.uRefractionView.value.copy(camera.matrixWorldInverse);
      u.uRefractionProjection.value.copy(camera.projectionMatrix);
      u.uCameraNearFar.value.set(camera.near, camera.far);
      renderer.setRenderTarget(target);
      const gl = renderer.getContext();
      if (!checked) {
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw Error("Refraction framebuffer incomplete");
        checked = true;
      }
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      u.uRefractionReady.value = 1;
    } catch (error) {
      failed = true;
      u.uRefractionReady.value = 0;
      console.warn(
        "Seabed refraction unavailable; retaining water volume",
        error,
      );
    } finally {
      renderer.setClearColor(color, alpha);
      renderer.setRenderTarget(previous, face, mip);
      if (failed) {
        target?.dispose();
        target = null;
        u.uSceneColor.value = null;
        u.uSceneDepth.value = null;
      }
    }
  }
  return {
    render,
    dispose() {
      target?.dispose();
      u.uRefractionReady.value = 0;
    },
  };
}
