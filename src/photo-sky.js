export const SKY_DECODE_GLSL = `
uniform sampler2D uSkyImageSDR;
uniform sampler2D uSkyImageGain;

const vec2 SKY_IMAGE_SIZE = vec2(4096.0, 2048.0);
const float SKY_PI = 3.14159265358979323846;
const float SKY_GAIN_WEIGHT = 0.42399845327747504;
const vec3 SKY_SUN_DIRECTION = vec3(0.5542598486859208, 0.7418088572248551, 0.3775124361890805);
const vec3 SKY_SUN_BASELINE = vec3(9.655837059020996, 10.09691047668457, 12.554890632629395);
float skyCodeToLinear(float code255) {
    if (code255 / 255.0 < 0.04045) {
        return (code255 / 255.0) * 0.0773993808;
    }
    float lookupCode = code255 < 1024.0 ? floor(code255) : code255;
    return pow((lookupCode / 255.0) * 0.9478672986 + 0.0521327014, 2.4);
}

vec3 decodeSkyCodes(vec3 sdr255, vec3 gain01) {
    vec3 logBoost = 15.99 * gain01;
    vec3 boostedCode = (sdr255 + 1.0) * exp2(logBoost * SKY_GAIN_WEIGHT) - 1.0;
    vec3 linearRGB = vec3(skyCodeToLinear(boostedCode.r),
                          skyCodeToLinear(boostedCode.g),
                          skyCodeToLinear(boostedCode.b));
    return clamp(linearRGB, vec3(0.0), vec3(65504.0));
}

vec2 skyImageUV(vec3 unrotatedDirection) {
    vec3 d = normalize(unrotatedDirection);
    return vec2(atan(d.z, d.x) / (2.0 * SKY_PI) + 0.5,
                asin(clamp(d.y, -1.0, 1.0)) / SKY_PI + 0.5);
}

vec3 skyImageDirection(vec2 uv) {
    float longitude = (uv.x - 0.5) * 2.0 * SKY_PI;
    float latitude = (uv.y - 0.5) * SKY_PI;
    return vec3(cos(latitude) * cos(longitude), sin(latitude),
                cos(latitude) * sin(longitude));
}

vec3 removeSkySun(vec3 linearRGB, vec3 unrotatedDirection) {
    float angleDegrees = acos(clamp(dot(normalize(unrotatedDirection),
                                         SKY_SUN_DIRECTION), -1.0, 1.0)) * (180.0 / SKY_PI);
    float t = clamp((angleDegrees - 1.0) / 0.25, 0.0, 1.0);
    float amount = 1.0 - t * t * (3.0 - 2.0 * t);
    return linearRGB - max(linearRGB - SKY_SUN_BASELINE, vec3(0.0)) * amount;
}
vec3 skyImageTexel(vec2 pixel, bool removeSun) {
    pixel.x = mod(pixel.x, SKY_IMAGE_SIZE.x);
    pixel.y = clamp(pixel.y, 0.0, SKY_IMAGE_SIZE.y - 1.0);
    vec2 uv = (pixel + 0.5) / SKY_IMAGE_SIZE;
    vec3 sdr255 = floor(texture2D(uSkyImageSDR, uv).rgb * 255.0 + 0.5);
    vec3 gain255 = floor(texture2D(uSkyImageGain, uv).rgb * 255.0 + 0.5);
    vec3 result = decodeSkyCodes(sdr255, gain255 / 255.0);
    if (removeSun) result = removeSkySun(result, skyImageDirection(uv));
    return result;
}
vec3 sampleSkyImage(vec3 unrotatedDirection, bool removeSun) {
    vec2 uv = skyImageUV(unrotatedDirection);
    vec2 pixel = uv * SKY_IMAGE_SIZE - 0.5;
    vec2 base = floor(pixel);
    vec2 f = fract(pixel);
    vec3 a = skyImageTexel(base, removeSun);
    vec3 b = skyImageTexel(base + vec2(1.0, 0.0), removeSun);
    vec3 c = skyImageTexel(base + vec2(0.0, 1.0), removeSun);
    vec3 d = skyImageTexel(base + vec2(1.0, 1.0), removeSun);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 sampleSkyImageFast(vec3 unrotatedDirection, bool removeSun) {
    vec2 uv = skyImageUV(unrotatedDirection);
    vec3 result = decodeSkyCodes(texture2D(uSkyImageSDR, uv).rgb * 255.0,
                                          texture2D(uSkyImageGain, uv).rgb);
    if (removeSun) result = removeSkySun(result, unrotatedDirection);
    return result;
}
`;
export const PHOTO_SKY_GLSL = `${SKY_DECODE_GLSL}
uniform float uPhotoSkyReady;
vec3 photographicSky(vec3 direction){
 vec3 rd=normalize(direction),q=normalize(vec3(rd.x,max(abs(rd.y),.0001),rd.z));
 float sun=mix(uSun,uSkySun,uEnvironmentReady),mood=mix(uMood,uSkyMood,uEnvironmentReady);
 const float rotation=3.093747;float c=cos(rotation),s=sin(rotation);q.xz=mat2(c,s,-s,c)*q.xz;
 q=normalize(vec3(q.x,q.y*tan(.835763)/max(tan(sun),.025),q.z));
 vec3 color=sampleSkyImageFast(q,true)*.7;
 float sunset=1.-smoothstep(.12,.58,sun);color*=mix(vec3(1),vec3(1.28,.75,.48),sunset);
 float storm=clamp(mood-1.,0.,1.),luminance=dot(color,vec3(.2126,.7152,.0722));color=mix(color,vec3(.72,.79,.84)*(.15+luminance*.35),storm*.92);
 vec3 haze=mix(vec3(.258,.275,.287),vec3(.33,.206,.138),sunset);haze=mix(haze,vec3(.18,.205,.22),storm);color=mix(haze,color,smoothstep(.0,mix(.025,.065,sunset),max(rd.y,0.)));
 color+=sunlight()*4.5*smoothstep(.999955,.999985,dot(rd,sunDir()))*(1.-storm*.97);
 return color;
}
`;
export function installPhotoSkyUniforms(u) {
  u.uPhotoSkyReady = { value: 0 };
  u.uSkyImageSDR = { value: null };
  u.uSkyImageGain = { value: null };
}
export async function loadPhotoSky(
  THREE,
  u,
  { timeoutMs = 6000, signal = null } = {},
) {
  const loader = new THREE.TextureLoader(),
    loaded = [];
  let cancelled = false,
    timer,
    abortHandler;
  const pending = ["./sky-base.jpg", "./sky-gain.jpg"].map((url) =>
    loader.loadAsync(url).then((texture) => {
      if (cancelled) {
        texture.dispose();
        throw Error("Sky image load cancelled");
      }
      loaded.push(texture);
      return texture;
    }),
  );
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Error("Sky image load timed out")),
      timeoutMs,
    );
  });
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    abortHandler = () => reject(Error("Sky image load aborted"));
    if (signal.aborted) abortHandler();
    else signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    const textures = await Promise.race([
      Promise.all(pending),
      timeout,
      aborted,
    ]);
    for (const t of textures) {
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = true;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }
    u.uSkyImageSDR.value = textures[0];
    u.uSkyImageGain.value = textures[1];
    u.uPhotoSkyReady.value = 1;
    return {
      dispose() {
        for (const t of textures) t.dispose();
        u.uPhotoSkyReady.value = 0;
      },
    };
  } catch (error) {
    cancelled = true;
    for (const t of loaded) t.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal && abortHandler)
      signal.removeEventListener("abort", abortHandler);
  }
}
