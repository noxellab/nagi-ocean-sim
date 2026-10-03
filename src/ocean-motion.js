const TAU = 2 * Math.PI;
const waveOmega = Float64Array.from([31, 17.3, 9.8, 6.1, 3.7, 2.2, 1.37], (w) =>
  Math.sqrt((9.81 * TAU) / w),
);
const rippleOmega = (base) =>
  Float64Array.from({ length: 12 }, (_, i) =>
    Math.sqrt(9.81 * base * 1.52 ** i),
  );
const fallbackRippleOmega = rippleOmega(2.5),
  spectralRippleOmega = rippleOmega(3.8);
function wrap(phase) {
  if (phase > Math.PI || phase < -Math.PI) {
    phase %= TAU;
    if (phase > Math.PI) phase -= TAU;
    else if (phase < -Math.PI) phase += TAU;
  }
  return phase;
}
export function createOceanMotion() {
  const wavePhase = new Float64Array(7),
    ripplePhase = new Float64Array(12),
    foamOffset = new Float64Array(2);
  let warpPhase = 0;
  const uniforms = {
    uWavePhase: { value: new Float32Array(7) },
    uRipplePhase: { value: new Float32Array(12) },
    uRippleWarpPhase: { value: 0 },
    uFoamOffset: { value: new Float32Array(2) },
  };
  function advance(dt, wind, spectral) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const windDt = dt * (0.72 + wind * 0.38),
      omega = spectral > 0.5 ? spectralRippleOmega : fallbackRippleOmega;
    for (let i = 0; i < 7; i++)
      uniforms.uWavePhase.value[i] = wavePhase[i] = wrap(
        wavePhase[i] + waveOmega[i] * windDt,
      );
    for (let i = 0; i < 12; i++)
      uniforms.uRipplePhase.value[i] = ripplePhase[i] = wrap(
        ripplePhase[i] + omega[i] * windDt,
      );
    const foamDt = dt * (0.25 + wind);
    uniforms.uFoamOffset.value[0] = foamOffset[0] += 0.12 * foamDt;
    uniforms.uFoamOffset.value[1] = foamOffset[1] += 0.24 * foamDt;
    uniforms.uRippleWarpPhase.value = warpPhase = wrap(warpPhase + dt * 0.37);
  }
  return { uniforms, advance };
}
