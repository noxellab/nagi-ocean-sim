export const SEABED_EXTENT = 200;
export const SEABED_SEGMENTS = 512;
export const SEABED_CENTER_Z = 8;
export const SEABED_ROCKS = Object.freeze([
  [-8.1, 0.8, 3.45, 2.16, 2.08, 0.46],
  [-10.5, -0.5, 2.45, 1.63, 1.53, -0.29],
  [-6.0, -1.3, 2.4, 1.34, 1.54, -0.63],
  [-11.8, 1.8, 1.35, 1.04, 0.83, 0.17],
  [3.4, -8.8, 3.2, 2.4, 2.18, -0.34],
  [5.5, -10.2, 2.34, 1.68, 1.76, 0.73],
  [1.0, -9.6, 2.26, 1.22, 1.21, -0.18],
  [4.1, -6.4, 1.74, 1.13, 1.22, 0.84],
  [7.2, -11.1, 1.48, 1.04, 0.69, -0.12],
  [12.0, 3.2, 3.2, 2.16, 1.81, -0.68],
  [14.5, 1.9, 2.23, 1.77, 1.36, 0.12],
  [10.2, 4.9, 1.84, 1.2, 1.12, -0.25],
  [15.6, 4.7, 1.33, 0.96, 0.65, 0.81],
  [-11.2, -12.8, 3.15, 1.9, 1.83, -0.71],
  [-13.9, -11.9, 2.56, 1.25, 1.2, 0.28],
  [-9.1, -14.4, 1.94, 1.27, 0.94, -0.29],
  [-15.7, -13.6, 1.4, 1.07, 0.81, -0.57],
  [-3.6, 19.0, 3.03, 1.99, 1.69, 0.64],
  [-6.0, 18.2, 2.0, 1.43, 1.35, -0.18],
  [-1.4, 20.3, 1.84, 1.06, 0.83, -0.46],
  [17.1, 23.4, 3.16, 1.75, 1.4, 0.82],
  [19.1, 24.6, 2.3, 1.56, 1.01, -0.37],
  [-19.8, -29.2, 4.5, 2.65, 2.08, 0.64],
  [-16.9, -27.3, 2.2, 1.24, 1.07, -0.43],
  [-29.4, 11.7, 3.15, 2.26, 1.58, -0.18],
  [32.7, -41.1, 4.15, 2.46, 1.85, 0.36],
]);

function hash(x, z) {
  let h = (Math.imul(x | 0, 0x9e3779b9) ^ Math.imul(z | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 9) + 0.5) / 8388608;
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function smoothstep(a, b, x) {
  return smooth(Math.max(0, Math.min(1, (x - a) / (b - a))));
}
function mix(a, b, t) {
  return a + (b - a) * t;
}
function noise(x, z) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    tx = smooth(x - ix),
    tz = smooth(z - iz);
  return mix(
    mix(hash(ix, iz), hash(ix + 1, iz), tx),
    mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), tx),
    tz,
  );
}
function sandHeight(x, z) {
  const qx = x * 0.92 + 4.5 * (noise(x * 0.025 + 19, z * 0.025 - 7) - 0.5);
  const qz =
    (z - SEABED_CENTER_Z) * 1.035 +
    4 * (noise(x * 0.022 - 4, z * 0.022 + 13) - 0.5);
  const r = Math.hypot(qx, qz);
  const depth = 8.68 + 0.022 * r + 20 * smoothstep(14, 102, r);
  const broad = 1.25 * (noise(x * 0.037 + 12.6, z * 0.037 - 8.2) - 0.5);
  const medium =
    0.39 *
    (noise(0.093 * x + 0.027 * z - 6, -0.027 * x + 0.093 * z + 17) - 0.5);
  const fine =
    0.085 * (noise(0.34 * x - 0.13 * z + 13, 0.13 * x + 0.34 * z - 3) - 0.5);
  const mound1 = 4.8 * Math.exp(-((x + 8) ** 2 / 59 + (z + 1) ** 2 / 43));
  const mound2 = 3.7 * Math.exp(-((x - 11) ** 2 / 89 + (z - 4) ** 2 / 67));
  const mound3 = 0.98 * Math.exp(-((x - 1) ** 2 / 174 + (z + 34) ** 2 / 76));
  const mound4 = 2.75 * Math.exp(-((x - 3.8) ** 2 / 66 + (z + 8.4) ** 2 / 46));
  const mound5 =
    1.45 * Math.exp(-((x + 11.4) ** 2 / 52 + (z + 12.8) ** 2 / 49));
  const mound6 = 1.65 * Math.exp(-((x + 3.6) ** 2 / 65 + (z - 19) ** 2 / 48));
  return (
    -depth +
    broad +
    medium +
    fine +
    mound1 +
    mound2 +
    mound3 +
    mound4 +
    mound5 +
    mound6
  );
}
function rockSurface(x, z) {
  let height = 0,
    mask = 0;
  for (let i = 0; i < SEABED_ROCKS.length; i++) {
    const [cx, cz, rx, rz, peak, angle] = SEABED_ROCKS[i];
    const dx = x - cx,
      dz = z - cz;
    if (Math.abs(dx) > rx + rz || Math.abs(dz) > rx + rz) continue;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const u = (c * dx + s * dz) / rx,
      v = (-s * dx + c * dz) / rz;
    const erosion = 0.19 * (noise(x * 0.31 + 41, z * 0.31 - 21) - 0.5);
    const q = u * u + v * v + erosion;
    const body = Math.pow(Math.max(1 - q, 0), 1.12);
    const n = noise(x * 0.62 + i * 17, z * 0.62 - i * 11);
    height = Math.max(height, peak * body * (0.84 + 0.22 * n));
    mask = Math.max(mask, 1 - smoothstep(0.72, 1.15, q));
  }
  return [height, mask];
}
export function sampleSeabed(x, z) {
  const [rockHeight, rock] = rockSurface(x, z);
  return { height: sandHeight(x, z) + rockHeight, rock };
}

export function createSeabedGeometryData({
  segments = SEABED_SEGMENTS,
  extent = SEABED_EXTENT,
} = {}) {
  if (!Number.isInteger(segments) || segments < 8 || segments > 1024)
    throw new RangeError("Seabed segments must be an integer in [8,1024]");
  if (!(extent > 0) || !Number.isFinite(extent))
    throw new RangeError("Seabed extent must be positive and finite");
  const count = (segments + 1) ** 2;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const rock = new Float32Array(count);
  const indices = new Uint32Array(segments * segments * 6);
  const coords = new Float64Array(segments + 1);
  const innerScale = 8,
    logarithm = Math.log(1 + (extent * 0.5) / innerScale);
  for (let i = 0; i <= segments; i++) {
    const u = (i * 2) / segments - 1;
    coords[i] = Math.sign(u) * innerScale * Math.expm1(Math.abs(u) * logarithm);
  }
  let minY = Infinity,
    maxY = -Infinity;
  for (let iz = 0; iz <= segments; iz++)
    for (let ix = 0; ix <= segments; ix++) {
      const i = iz * (segments + 1) + ix,
        x = coords[ix],
        z = coords[iz] + SEABED_CENTER_Z;
      const p = sampleSeabed(x, z);
      positions.set([x, p.height, z], i * 3);
      rock[i] = p.rock;
      minY = Math.min(minY, p.height);
      maxY = Math.max(maxY, p.height);
    }
  let k = 0;
  for (let iz = 0; iz < segments; iz++)
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix,
        b = a + 1,
        c = a + segments + 1,
        d = c + 1;
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const j of [a, b, c]) {
      normals[j] += nx;
      normals[j + 1] += ny;
      normals[j + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return {
    positions,
    normals,
    rock,
    indices,
    segments,
    extent,
    bounds: {
      min: [-extent * 0.5, minY, SEABED_CENTER_Z - extent * 0.5],
      max: [extent * 0.5, maxY, SEABED_CENTER_Z + extent * 0.5],
    },
  };
}

export const SEABED_VERTEX_SHADER = `
attribute float aRock;
uniform float uSeabedDepth;
varying vec3 vSeabedPosition;
varying vec3 vSeabedNormal;
varying float vRock;
void main() {
  vec3 p = position; p.y -= uSeabedDepth - 8.0;
  vSeabedPosition = p;
  vSeabedNormal = normal;
  vRock = aRock;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const ROCK_MASK_GLSL =
  "float seabedExactRockMask(vec2 p){float q=100000.;float erosion=.19*(seabedNoise(p*.31+vec2(41.,-21.))-.5);\n" +
  SEABED_ROCKS.map(([x, z, rx, rz, peak, a]) => {
    const f = (v) => Number(v).toFixed(12),
      c = Math.cos(a),
      t = Math.sin(a);
    return `{vec2 d=p-vec2(${f(x)},${f(z)});vec2 v=vec2(dot(d,vec2(${f(c / rx)},${f(t / rx)})),dot(d,vec2(${f(-t / rz)},${f(c / rz)})));q=min(q,dot(v,v)+erosion);}`;
  }).join("\n") +
  "return 1.-smoothstep(.72,1.15,q);}\n";

export const SEABED_FRAGMENT_SHADER = `
uniform float uSeabedDisplay;
uniform float uTime, uSun, uSkySun, uEnvironmentReady, uMood, uSkyMood;
uniform vec3 uSolarColor, uSunDirection;
uniform float uSeabedUseSunDirection, uSeabedBrightness, uSeabedCaustics, uSeabedIOR;
uniform vec3 uSeabedLightAbsorption, uSeabedAmbient;
varying vec3 vSeabedPosition;
varying vec3 vSeabedNormal;
varying float vRock;
float seabedHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 0x9e3779b9u ^ q.y * 0x85ebca6bu;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return (float(h >> 9) + .5) * (1.0 / 8388608.0);
}
float seabedNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(seabedHash(i), seabedHash(i + vec2(1,0)), f.x),
             mix(seabedHash(i + vec2(0,1)), seabedHash(i + vec2(1,1)), f.x), f.y);
}
${ROCK_MASK_GLSL}
float seabedFilteredNoise(vec2 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float resolved = exp(-1.1 * footprint * footprint);
  if (resolved < .015) return .5;
  return mix(.5, seabedNoise(p), resolved);
}
void seabedLens(inout vec3 H, vec2 p, vec2 direction, float k, float amplitude, float phase) {
  float angle = dot(p, direction) * k - uTime * sqrt(9.81 * k) * .64 + phase;
  float footprint = max(abs(dFdx(angle)), abs(dFdy(angle)));
  float h = amplitude * sin(angle) * exp(-.55 * footprint * footprint);
  H += h * vec3(direction.x * direction.x, direction.x * direction.y, direction.y * direction.y);
}
float seabedCausticFocus(vec2 p, float depth) {
  vec2 drift = uTime * vec2(.025,-.017);
  vec2 warp = vec2(seabedNoise(p * .39 + drift + vec2(4.1,19.7)),
                   seabedNoise(p * .43 - drift + vec2(13.3,1.2)));
  p += (warp - .5) * 2.4;
  vec3 H = vec3(0.0);
  seabedLens(H, p, vec2(.9578,.2874), 2.71, .21, .81);
  seabedLens(H, p, vec2(-.3420,.9397), 3.83, .16, 3.21);
  seabedLens(H, p, vec2(.7431,-.6691), 4.93, .12, 1.63);
  seabedLens(H, p, vec2(-.8829,-.4695), 1.93, .17, 5.13);
  seabedLens(H, p, vec2(.1392,.9903), 6.17, .075, 4.02);
  seabedLens(H, p, vec2(.6157,.7880), 3.19, .10, 2.36);
  float lens = min(depth, 9.0) * .31;
  float determinant = abs((1.0 + lens * H.x) * (1.0 + lens * H.z) - lens * lens * H.y * H.y);
  return clamp(.83 / max(determinant, .28), .62, 2.25);
}
void main() {
  vec3 p = vSeabedPosition;
  vec3 N = normalize(vSeabedNormal);
  float elevation = mix(uSun, uSkySun, uEnvironmentReady);
  vec3 sun = normalize(vec3(-.26, sin(elevation), -cos(elevation)));
  if (uSeabedUseSunDirection > .5) sun = normalize(uSunDirection);
  float mood = mix(uMood, uSkyMood, uEnvironmentReady);
  float storm = clamp(mood - 1.0, 0.0, 1.0);
  float depth = max(-p.y, 0.0);
  vec2 uv = p.xz;
  vec2 warp = vec2(seabedNoise(uv * .052 + vec2(12.3,4.7)), seabedNoise(uv * .047 - vec2(1.9,7.8)));
  float sandPatch = seabedFilteredNoise(uv * .21 + warp * 1.1);
  float grain = seabedFilteredNoise(uv * 14.7 + vec2(9.1,3.6));
  float mineral = seabedFilteredNoise(uv * 2.43 - warp * 2.3);
  vec3 sand = mix(vec3(.54,.505,.407), vec3(.72,.684,.565), .28 + .60 * sandPatch);
  sand *= .96 + .07 * grain;
  float stoneTexture = .70 * seabedFilteredNoise(uv * 1.71 + warp) + .30 * mineral;
  vec3 stone = mix(vec3(.024,.029,.027), vec3(.078,.083,.074), stoneTexture);
  float rock = smoothstep(.08,.84,seabedExactRockMask(uv));
  vec3 albedo = mix(sand, stone, rock);
  vec3 incident = -sun;
  vec3 sunUnderwater = -refract(incident, vec3(0,1,0), 1.0 / max(uSeabedIOR, 1.01));
  float incidence = max(dot(N, sunUnderwater), 0.0);
  float sunPath = depth / max(sunUnderwater.y, .28);
  vec3 sunTransmission = exp(-uSeabedLightAbsorption * sunPath);
  float caustic = seabedCausticFocus(uv - sunUnderwater.xz * depth / max(sunUnderwater.y,.28), depth);
  float causticStrength = uSeabedCaustics * exp(-depth * .032) * (1.0 - storm) * (1.0 - .45 * rock);
  float focusing = 1.0 + causticStrength * (caustic - 1.0);
  vec3 direct = uSolarColor * incidence * 1.10 * (1.0 - .91 * storm) * sunTransmission * focusing;
  vec3 ambient = uSeabedAmbient * mix(1.0, .60, storm);
  ambient *= exp(-vec3(.017,.007,.004) * depth);
  float occlusion = mix(1.0, .90, rock * (1.0 - clamp(N.y, 0.0, 1.0)));
  vec3 radiance = albedo * (ambient + direct) * occlusion * uSeabedBrightness;
  vec3 outputColor=max(radiance,vec3(0.0));
  if(uSeabedDisplay>.5)outputColor=pow(clamp((outputColor*(2.51*outputColor+.03))/(outputColor*(2.43*outputColor+.59)+.14),0.,1.),vec3(1./2.2));
  gl_FragColor = vec4(outputColor, 1.0);
}
`;

export function createSeabed(THREE, sharedUniforms = {}) {
  const data = createSeabedGeometryData();
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("aRock", new THREE.BufferAttribute(data.rock, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const scalar = (key, fallback) => sharedUniforms[key] || { value: fallback };
  const direction = sharedUniforms.uSunDirection || {
    value: new THREE.Vector3(-0.26, 0.53, -0.848).normalize(),
  };
  const uniforms = {
    uSeabedDisplay: { value: 0 },
    uTime: scalar("uTime", 0),
    uSun: scalar("uSun", 0.5585053606),
    uSkySun: sharedUniforms.uSkySun ||
      sharedUniforms.uSun || { value: 0.5585053606 },
    uEnvironmentReady: scalar("uEnvironmentReady", 0),
    uMood: scalar("uMood", 1),
    uSkyMood: sharedUniforms.uSkyMood || sharedUniforms.uMood || { value: 1 },
    uSolarColor: sharedUniforms.uSolarColor || {
      value: new THREE.Vector3(1, 0.95, 0.84),
    },
    uSunDirection: direction,
    uSeabedUseSunDirection: { value: sharedUniforms.uSunDirection ? 1 : 0 },
    uSeabedBrightness: scalar("uSeabedBrightness", 1),
    uSeabedDepth: scalar("uSeabedDepth", 8),
    uSeabedIOR: scalar("uSeabedIOR", 1.31),
    uSeabedAmbient: sharedUniforms.uSeabedAmbient || {
      value: new THREE.Vector3(0.38, 0.455, 0.49),
    },
    uSeabedCaustics: scalar("uSeabedCaustics", 0.1),
    uSeabedLightAbsorption: sharedUniforms.uSeabedLightAbsorption || {
      value: new THREE.Vector3(0.047, 0.016, 0.009),
    },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SEABED_VERTEX_SHADER,
    fragmentShader: SEABED_FRAGMENT_SHADER,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    toneMapped: false,
  });
  material.name = "Seabed radiance";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Procedural submerged sand shelf and stones";
  mesh.frustumCulled = false;
  scene.add(mesh);
  const displayMaterial = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uSeabedDisplay: { value: 1 } },
    vertexShader: SEABED_VERTEX_SHADER,
    fragmentShader: SEABED_FRAGMENT_SHADER,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  const displayMesh = new THREE.Mesh(geometry, displayMaterial);
  displayMesh.frustumCulled = false;
  return {
    scene,
    mesh,
    displayMesh,
    geometry,
    material,
    uniforms,
    bounds: data.bounds,
    dispose() {
      geometry.dispose();
      material.dispose();
      displayMaterial.dispose();
    },
  };
}
