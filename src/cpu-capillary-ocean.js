const SIZE = 64,
  DOMAINS = [9.113, 2.173],
  RATE = 20,
  TAU = 2 * Math.PI;
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
export function generateCpuCapillarySpectra() {
  let variance = 0;
  const bands = [];
  for (let index = 0; index < 2; index++) {
    const size = SIZE,
      domain = DOMAINS[index],
      data = new Float64Array(size * size * 4),
      dk = TAU / domain,
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
          split = smooth(11, 17, k);
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
          angle = TAU * rng(),
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
function inversePlan(size) {
  const reverse = new Uint16Array(size),
    cos = new Float64Array(size / 2),
    sin = new Float64Array(size / 2);
  for (let i = 0; i < size; i++) {
    let j = i,
      r = 0;
    for (let n = size; n > 1; n >>= 1) {
      r = r * 2 + (j & 1);
      j >>= 1;
    }
    reverse[i] = r;
  }
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((TAU * i) / size);
    sin[i] = Math.sin((TAU * i) / size);
  }
  return function inverse(real, imag) {
    for (let axis = 0; axis < 2; axis++) {
      const stride = axis === 0 ? 1 : size;
      for (let line = 0; line < size; line++) {
        const offset = axis === 0 ? line * size : line;
        for (let i = 0; i < size; i++) {
          const j = reverse[i];
          if (j > i) {
            const a = offset + i * stride,
              b = offset + j * stride;
            let v = real[a];
            real[a] = real[b];
            real[b] = v;
            v = imag[a];
            imag[a] = imag[b];
            imag[b] = v;
          }
        }
        for (let span = 2; span <= size; span *= 2) {
          const half = span / 2,
            twiddleStep = size / span;
          for (let base = 0; base < size; base += span)
            for (let j = 0; j < half; j++) {
              const a = offset + (base + j) * stride,
                b = a + half * stride,
                w = j * twiddleStep,
                cs = cos[w],
                sn = sin[w];
              const re = real[b] * cs - imag[b] * sn,
                im = real[b] * sn + imag[b] * cs;
              real[b] = real[a] - re;
              imag[b] = imag[a] - im;
              real[a] += re;
              imag[a] += im;
            }
        }
      }
    }
  };
}
export function createCpuCapillaryOcean(THREE, renderer) {
  const generated = generateCpuCapillarySpectra(),
    inverse = inversePlan(SIZE),
    toHalf = THREE.DataUtils.toHalfFloat;
  const bands = generated.bands.map((b) => {
    const n = b.size * b.size,
      omega = new Float64Array(n),
      partner = new Uint16Array(n),
      active = b.data.slice();
    for (let y = 0; y < b.size; y++)
      for (let x = 0; x < b.size; x++) {
        const i = y * b.size + x,
          k = Math.hypot(b.data[i * 4 + 2], b.data[i * 4 + 3]);
        omega[i] = Math.sqrt(9.81 * k + 0.000074 * k * k * k);
        partner[i] = ((b.size - y) % b.size) * b.size + ((b.size - x) % b.size);
      }
    const levels = [];
    for (let size = b.size; size >= 1; size >>= 1)
      levels.push({
        width: size,
        height: size,
        data: new Uint16Array(size * size * 4),
        values: new Float32Array(size * size * 4),
      });
    const texture = new THREE.DataTexture(
      levels[0].data,
      b.size,
      b.size,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    texture.internalFormat = "RGBA16F";
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.mipmaps = levels.map(({ width, height, data }) => ({
      width,
      height,
      data,
    }));
    return {
      ...b,
      omega,
      partner,
      active,
      levels,
      real: new Float64Array(n),
      imag: new Float64Array(n),
      snapshots: [new Float32Array(n * 4), new Float32Array(n * 4)],
      output: { texture },
    };
  });
  let epoch = -1,
    first = null,
    next = null,
    current = 0,
    lastTime = null,
    disposed = false;
  function transform(time, index) {
    const nextEpoch = Math.floor(time / 120) * 120;
    if (nextEpoch !== epoch) {
      for (const b of bands)
        for (let i = 0; i < b.omega.length; i++) {
          const a = i * 4,
            phase = -b.omega[i] * nextEpoch,
            cs = Math.cos(phase),
            sn = Math.sin(phase),
            re = b.data[a],
            im = b.data[a + 1];
          b.active[a] = re * cs - im * sn;
          b.active[a + 1] = re * sn + im * cs;
        }
      epoch = nextEpoch;
    }
    for (const b of bands) {
      const { real, imag, active, partner, omega, size } = b;
      for (let i = 0; i < real.length; i++) {
        const a = i * 4,
          o = partner[i] * 4,
          phase = omega[i] * (time - epoch),
          cs = Math.cos(phase),
          sn = Math.sin(phase);
        const re =
            (active[a] + active[o]) * cs + (active[a + 1] + active[o + 1]) * sn,
          im =
            (active[a + 1] - active[o + 1]) * cs + (active[o] - active[a]) * sn;
        real[i] = -active[a + 2] * im - active[a + 3] * re;
        imag[i] = active[a + 2] * re - active[a + 3] * im;
      }
      inverse(real, imag);
      const output = b.snapshots[index];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = y * size + x,
            a = i * 4,
            sign = (x + y) & 1 ? -1 : 1,
            sx = real[i] * sign,
            sz = imag[i] * sign;
          output[a] = sx;
          output[a + 1] = sz;
          output[a + 2] = sx * sx + sz * sz;
        }
    }
  }
  function update(time) {
    if (disposed) throw new Error("CPU capillary spectrum is disposed");
    if (!Number.isFinite(time) || time < 0)
      throw new Error("Invalid CPU capillary time");
    if (time === lastTime) return;
    const step = 1 / RATE;
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
    const alpha = Math.max(0, Math.min(1, (time - first) / (next - first)));
    for (const b of bands) {
      const a = b.snapshots[current],
        c = b.snapshots[1 - current],
        base = b.levels[0].values;
      for (let i = 0; i < base.length; i += 4) {
        base[i] = a[i] + (c[i] - a[i]) * alpha;
        base[i + 1] = a[i + 1] + (c[i + 1] - a[i + 1]) * alpha;
        base[i + 2] = a[i + 2] + (c[i + 2] - a[i + 2]) * alpha;
      }
      for (let level = 0; level < b.levels.length; level++) {
        const mip = b.levels[level],
          v = mip.values;
        if (level > 0) {
          const previous = b.levels[level - 1],
            p = previous.values,
            width = previous.width;
          for (let y = 0; y < mip.height; y++)
            for (let x = 0; x < mip.width; x++) {
              const i = (y * mip.width + x) * 4,
                j = (y * 2 * width + x * 2) * 4;
              for (let channel = 0; channel < 3; channel++)
                v[i + channel] =
                  (p[j + channel] +
                    p[j + 4 + channel] +
                    p[j + width * 4 + channel] +
                    p[j + (width + 1) * 4 + channel]) *
                  0.25;
            }
        }
        for (let i = 0; i < v.length; i += 4) {
          mip.data[i] = toHalf(v[i]);
          mip.data[i + 1] = toHalf(v[i + 1]);
          mip.data[i + 2] = toHalf(v[i + 2]);
        }
      }
      b.output.texture.needsUpdate = true;
    }
    lastTime = time;
  }
  function validate() {
    for (const b of bands) {
      let power = 0;
      for (const v of b.levels[0].values) {
        if (!Number.isFinite(v) || Math.abs(v) > 100)
          throw new Error("Invalid CPU capillary output");
        power += Math.abs(v);
      }
      if (power < 1e-7) throw new Error("Empty CPU capillary output");
    }
    if (renderer) {
      const gl = renderer.getContext();
      let clean = false;
      for (let i = 0; i < 8; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) {
          clean = true;
          break;
        }
        if (error === gl.CONTEXT_LOST_WEBGL)
          throw new Error("WebGL context lost before CPU capillary upload");
      }
      if (!clean)
        throw new Error(
          "WebGL error state did not clear before CPU capillary upload",
        );
      for (const b of bands) renderer.initTexture(b.output.texture);
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error("CPU capillary texture upload failed");
    }
  }
  return {
    bands,
    isCpu: true,
    update,
    validate,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of bands) b.output.texture.dispose();
    },
  };
}
