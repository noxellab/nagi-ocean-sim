import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FFT_SIZE,
  DOMAINS,
  OCEAN_PARAMETERS,
  generateSpectra,
  dispersion,
  spectralDensity,
} from "../src/spectral-ocean.js";
import { createOceanMotion } from "../src/ocean-motion.js";
import { createSeabedGeometryData, sampleSeabed } from "../src/seabed.js";

test("spectra are deterministic, finite, and split across three domains", () => {
  const a = generateSpectra(),
    b = generateSpectra();
  assert.equal(FFT_SIZE, 256);
  assert.deepEqual(DOMAINS, [1024, 96, 9]);
  assert(a.expectedVariance > 0 && Number.isFinite(a.expectedVariance));
  for (let i = 0; i < a.cascades.length; i++) {
    const c = a.cascades[i];
    assert.deepEqual(c.data, b.cascades[i].data);
    assert.equal(c.data.length, FFT_SIZE ** 2 * 4);
    assert(c.data.every(Number.isFinite));
    assert(c.frequency.every(Number.isFinite));
    assert(c.expectedTimeVariance > 0);
  }
});

test("dispersion is quantized to the simulation period", () => {
  const unit = (2 * Math.PI) / OCEAN_PARAMETERS.period;
  for (const k of [0, 0.001, 0.1, 1, 10, 100]) {
    const frequency = dispersion(k);
    assert(frequency >= 0 && Number.isFinite(frequency));
    assert(Math.abs(frequency / unit - Math.round(frequency / unit)) < 1e-9);
  }
});

test("spectral energy increases with wind speed", () => {
  const parameters = { ...OCEAN_PARAMETERS };
  const atWind = (windSpeed) =>
    spectralDensity(0.1, 0.12, 1024, 1e-9, 0.5, { ...parameters, windSpeed });
  assert(atWind(5) > 0);
  assert(atWind(17.5) > atWind(5));
});

test("motion rejects invalid deltas and keeps phases bounded", () => {
  const motion = createOceanMotion();
  for (const dt of [0, -1, NaN, Infinity]) motion.advance(dt, 0.8, 1);
  assert(motion.uniforms.uWavePhase.value.every((value) => value === 0));
  for (let i = 0; i < 1000; i++) motion.advance(100, 0.8, i % 2);
  for (const key of ["uWavePhase", "uRipplePhase"]) {
    assert(
      motion.uniforms[key].value.every(
        (value) => Number.isFinite(value) && Math.abs(value) <= Math.PI + 1e-6,
      ),
    );
  }
  assert(Number.isFinite(motion.uniforms.uRippleWarpPhase.value));
});

test("seabed geometry contains finite positions and unit normals", () => {
  const data = createSeabedGeometryData({ segments: 32 });
  assert(data.positions.every(Number.isFinite));
  assert(data.normals.every(Number.isFinite));
  for (let i = 0; i < data.normals.length; i += 3) {
    assert(Math.abs(Math.hypot(...data.normals.slice(i, i + 3)) - 1) < 1e-5);
  }
  assert(Number.isFinite(sampleSeabed(0, 0).height));
});
