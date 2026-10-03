import { readFloatProbe } from "./float-readback.js";
export const PREFILTER_GLSL = `
uniform sampler2D uPrefilterA,uPrefilterB;
uniform vec3 uPrefilterSizeA,uPrefilterSizeB;
uniform float uPrefilterReady;

	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float nagiGetFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 nagiGetUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 nagiBilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt, vec3 cubeUVSize ) {
		float face = nagiGetFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = nagiGetUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( cubeUVSize.z ) - faceSize );
		uv.x *= cubeUVSize.x;
		uv.y *= cubeUVSize.y;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float nagiRoughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 nagiTextureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness, vec3 cubeUVSize ) {
		float mip = clamp( nagiRoughnessToMip( max(roughness,.001) ), cubeUV_m0, cubeUVSize.z );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = nagiBilinearCubeUV( envMap, sampleDir, mipInt, cubeUVSize );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = nagiBilinearCubeUV( envMap, sampleDir, mipInt + 1.0, cubeUVSize );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}

vec3 prefilteredEnvironment(vec3 direction,float roughness){
 if(uEnvironmentMix>.999)return nagiTextureCubeUV(uPrefilterB,direction,roughness,uPrefilterSizeB).rgb;
 vec3 a=nagiTextureCubeUV(uPrefilterA,direction,roughness,uPrefilterSizeA).rgb;
 if(uEnvironmentMix<.001)return a;
 return mix(a,nagiTextureCubeUV(uPrefilterB,direction,roughness,uPrefilterSizeB).rgb,uEnvironmentMix);
}
`;
export function installPrefilterUniforms(THREE, uniforms) {
  const defaults = {
    uPrefilterA: { value: null },
    uPrefilterB: { value: null },
    uPrefilterSizeA: { value: new THREE.Vector3(1 / 384, 1 / 512, 7) },
    uPrefilterSizeB: { value: new THREE.Vector3(1 / 384, 1 / 512, 7) },
    uPrefilterReady: { value: 0 },
  };
  for (const [name, value] of Object.entries(defaults))
    if (!uniforms[name]) uniforms[name] = value;
}
const COPY_VERTEX = `varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const COPY_FRAGMENT = `uniform samplerCube uSource;uniform float uSourceLod;varying vec3 vDirection;void main(){gl_FragColor=textureLod(uSource,normalize(vDirection),uSourceLod);}`;
export function createEnvironmentPrefilter(
  THREE,
  renderer,
  uniforms,
  { onError = console.warn } = {},
) {
  installPrefilterUniforms(THREE, uniforms);
  const size = (renderer.domElement?.width || 1280) > 1000 ? 256 : 128,
    gl = renderer.getContext();
  let disposed = false,
    failed = false;
  const outputs = [null, null],
    validated = [false, false];
  const staging = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  staging.texture.name = "NAGI.PMREM.staging";
  const copyUniforms = { uSource: { value: null }, uSourceLod: { value: 0 } };
  const scene = new THREE.Scene(),
    geometry = new THREE.BoxGeometry(2, 2, 2),
    material = new THREE.ShaderMaterial({
      uniforms: copyUniforms,
      vertexShader: COPY_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.CubeCamera(0.1, 10, staging);
  camera.coordinateSystem = THREE.WebGLCoordinateSystem;
  camera.updateCoordinateSystem();
  camera.updateMatrixWorld(true);
  const ownedTargets = new Set();
  const trackedRenderer = new Proxy(renderer, {
    get(target, key) {
      if (key === "setRenderTarget")
        return (renderTarget, ...args) => {
          if (renderTarget?.texture?.mapping === THREE.CubeUVReflectionMapping)
            ownedTargets.add(renderTarget);
          return target.setRenderTarget(renderTarget, ...args);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
  let generator;
  const checked = new Set();
  try {
    generator = new THREE.PMREMGenerator(trackedRenderer);
  } catch (error) {
    for (const target of ownedTargets) target.dispose();
    staging.dispose();
    geometry.dispose();
    material.dispose();
    clearBindings();
    throw error;
  }
  const shape = new THREE.Vector3(
    1 / (3 * size),
    1 / (4 * size),
    Math.log2(size),
  );
  function clearBindings() {
    uniforms.uPrefilterReady.value = 0;
    uniforms.uPrefilterA.value = null;
    uniforms.uPrefilterB.value = null;
  }
  function release() {
    if (disposed) return;
    disposed = true;
    clearBindings();
    generator.dispose();
    for (const target of ownedTargets) target.dispose();
    ownedTargets.clear();
    staging.dispose();
    geometry.dispose();
    material.dispose();
    copyUniforms.uSource.value = null;
  }
  function validate(output) {
    renderer.setRenderTarget(output);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Prefilter framebuffer is incomplete");
    for (const [x, y] of [
      [64, 64],
      [296, 456],
    ]) {
      const data = readFloatProbe(renderer, output, x, y, 2, 2);
      let energy = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v) || v < 0 || v > 10000)
          throw new Error("Invalid prefiltered radiance");
        if (i % 4 < 3) energy += v;
      }
      if (energy < 1e-6) throw new Error("Prefilter contains no radiance");
    }
  }
  function capture(index, rawTarget) {
    if (disposed || failed) return false;
    const previous = renderer.getRenderTarget(),
      oldFace = renderer.getActiveCubeFace(),
      oldLevel = renderer.getActiveMipmapLevel(),
      oldAutoClear = renderer.autoClear,
      oldXr = renderer.xr.enabled;
    try {
      copyUniforms.uSource.value = rawTarget.texture;
      copyUniforms.uSourceLod.value = Math.max(
        0,
        Math.log2(rawTarget.width / size),
      );
      renderer.xr.enabled = false;
      for (let face = 0; face < 6; face++) {
        renderer.setRenderTarget(staging, face);
        if (!checked.has(face)) {
          if (
            gl.checkFramebufferStatus(gl.FRAMEBUFFER) !==
            gl.FRAMEBUFFER_COMPLETE
          )
            throw new Error("Prefilter staging cube is incomplete");
          checked.add(face);
        }
        renderer.render(scene, camera.children[face]);
      }
      outputs[index] = generator.fromCubemap(staging.texture, outputs[index]);
      if (!validated[index]) {
        validate(outputs[index]);
        validated[index] = true;
      }
      return true;
    } catch (error) {
      failed = true;
      release();
      onError(
        "Environment prefilter unavailable; keeping raw HDR atmosphere",
        error,
      );
      return false;
    } finally {
      renderer.autoClear = oldAutoClear;
      renderer.xr.enabled = oldXr;
      renderer.setRenderTarget(previous, oldFace, oldLevel);
    }
  }
  function publish(a, b) {
    if (disposed || failed || !outputs[a] || !outputs[b]) {
      clearBindings();
      return;
    }
    uniforms.uPrefilterA.value = outputs[a].texture;
    uniforms.uPrefilterB.value = outputs[b].texture;
    uniforms.uPrefilterSizeA.value.copy(shape);
    uniforms.uPrefilterSizeB.value.copy(shape);
    uniforms.uPrefilterReady.value = 1;
  }
  return {
    capture,
    publish,
    dispose: release,
    get available() {
      return !disposed && !failed;
    },
  };
}
