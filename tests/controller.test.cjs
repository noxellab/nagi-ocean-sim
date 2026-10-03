const { test } = require("node:test");
const assert = require("node:assert/strict");
const { boot, modules, flush } = require("./runtime-harness.cjs");
const names = [
  "uFieldLarge",
  "uFieldSmall",
  "uFieldFine",
  "uNormalLarge",
  "uNormalSmall",
  "uNormalFine",
];
async function check(name, fn) {
  await test(name, fn);
}
function spectralRecords(h, s = h.instances.spectral) {
  return s.cascades
    .flatMap((c) => [...c.ping, ...c.snapshots, c.output])
    .map((t) => h.records.find((r) => r.target === t));
}
function bindingsCleared(h) {
  for (const name of names)
    assert.equal(
      h.uniforms[name].value,
      null,
      name + " still publishes a released spectral texture",
    );
}
(async () => {
  await check(
    "startup binds three cascades and six MRT outputs",
    async () => {
      const h = await boot({ reduced: true });
      try {
        h.frames(1);
        assert.deepEqual(h.errors, []);
        assert.equal(h.uniforms.uSpectral.value, 1);
        assert.equal(h.uniforms.uCapillaryReady.value, 0);
        assert.equal(h.get("capillary"), null);
        const s = h.get("spectral");
        assert.deepEqual(
          s.cascades.map((c) => c.domain),
          [1024, 96, 9],
        );
        assert.equal(s.size, h.uniforms.uSpectralSize.value);
        assert.equal(s.cascades.length, 3);
        for (const [i, c] of s.cascades.entries()) {
          assert.equal(c.output.textures.length, 2);
          assert.equal(c.snapshots.length, 2);
          for (const target of [...c.ping, ...c.snapshots])
            assert.equal(
              target.texture.type,
              h.three.FloatType,
              "FFT intermediates must retain Float32",
            );
          assert.equal(c.output.texture.type, h.three.HalfFloatType);
          assert(c.frequency?.isDataTexture);
          assert.equal(c.frequency.type, h.three.FloatType);
          assert.equal(c.frequency.image.data.length, s.size * s.size);
          assert.equal(h.uniforms[names[i]].value, c.output.textures[0]);
          assert.equal(h.uniforms[names[i + 3]].value, c.output.textures[1]);
        }
        assert.equal(h.calls.gpuCapillary.length, 0);
        assert.equal(h.calls.cpuCapillary.length, 0);
        assert.equal(h.renderer.stats.main, 1);
        return {
          domains: s.cascades.map((c) => c.domain),
          MRTAttachments: 2,
          liveSpectralTargets: spectralRecords(h).length,
        };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "paused wave/wind edits refresh displacement and normal outputs without advancing time",
    async () => {
      const h = await boot({ reduced: true });
      try {
        h.frames(5);
        const t = h.uniforms.uTime.value;
        const waveTarget = Math.min(
          1.8,
          Number(h.d.getElementById("wave").max),
        );
        h.input("wave", waveTarget);
        h.input("wind", 0.1);
        h.frames(260);
        assert.equal(h.uniforms.uTime.value, t);
        const expected =
            h.uniforms.uWave.value *
            Math.pow((5 + 12.5 * h.uniforms.uWind.value) / 15, 0.33),
          last = h.calls.spectral.at(-1);
        assert.equal(last[0], t);
        assert(Math.abs(last[2] - expected) < 1e-8);
        assert.equal(h.uniforms.uWave.value, waveTarget);
        assert.equal(h.uniforms.uWind.value, 0.1);
        assert(h.calls.spectral.length > 5);
        const n = h.calls.spectral.length,
          stats = { ...h.renderer.stats };
        h.frames(120);
        assert.equal(h.calls.spectral.length, n);
        assert.deepEqual(h.renderer.stats, stats);
        return { frozenTime: t, amplitude: expected, settledIdleFrames: 120 };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "pause and hidden/resume preserve phase and skip offscreen work",
    async () => {
      const h = await boot();
      try {
        h.frames(5);
        h.click("pause");
        h.frames(200);
        const t = h.uniforms.uTime.value,
          counts = { ...h.renderer.stats };
        h.frames(120);
        assert.equal(h.uniforms.uTime.value, t);
        assert.deepEqual(h.renderer.stats, counts);
        h.click("pause");
        h.hidden(true);
        h.frames(120);
        assert.equal(h.uniforms.uTime.value, t);
        assert.deepEqual(h.renderer.stats, counts);
        h.hidden(false);
        h.frames(1, 60000);
        assert(
          h.uniforms.uTime.value > t && h.uniforms.uTime.value - t <= 0.0400001,
        );
        return { pausedFrames: 120, hiddenFrames: 120, maxResumeStep: 0.04 };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "quality changes preserve spectral resources and rebuild/dispose concentric geometry",
    async () => {
      const h = await boot({ reduced: true });
      try {
        h.frames(1);
        const targets = spectralRecords(h).map((r) => r.target),
          textures = names.map((k) => h.uniforms[k].value),
          out = [];
        for (const [name, rate, rings, segments] of [
          ["high", 60, 512, 768],
          ["light", 20, 256, 384],
          ["balanced", 30, 384, 512],
        ]) {
          const old = h.get("sea").geometry;
          let disposed = 0;
          old.addEventListener("dispose", () => disposed++);
          h.click("quality");
          h.frames(180);
          assert.equal(h.get("quality"), name);
          assert.equal(disposed, 1);
          assert.equal(
            h.get("sea").geometry.attributes.position.count,
            1 + rings * segments,
          );
          assert.equal(h.calls.spectral.at(-1)[1], rate);
          assert.deepEqual(
            names.map((k) => h.uniforms[k].value),
            textures,
          );
          assert.deepEqual(
            spectralRecords(h).map((r) => r.target),
            targets,
          );
          assert(spectralRecords(h).every((r) => r.disposals === 0));
          assert.equal(h.uniforms.uEnvironmentMix.value, 1);
          out.push({ name, rate, vertices: 1 + rings * segments });
        }
        return out;
      } finally {
        h.close();
      }
    },
  );
  await check(
    "steady spectral updates reuse all 15 render targets",
    async () => {
      const h = await boot();
      try {
        h.frames(1);
        const resources = spectralRecords(h),
          created = h.records.length;
        h.frames(120);
        assert.equal(h.records.length, created);
        assert.equal(resources.length, 15);
        assert(resources.every((r) => r.disposals === 0));
        return { targets: 15, frames: 120 };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "runtime spectrum failure releases all targets and starts CPU capillary fallback",
    async () => {
      const h = await boot();
      try {
        h.frames(2);
        const resources = spectralRecords(h),
          dataTextures = h.instances.spectral.cascades.flatMap((c) =>
            [c.initial, c.frequency].filter(Boolean),
          ),
          releasedTextures = new Map(dataTextures.map((t) => [t, 0]));
        for (const t of dataTextures)
          t.addEventListener("dispose", () =>
            releasedTextures.set(t, releasedTextures.get(t) + 1),
          );
        h.renderer.fault.spectral = true;
        h.frames(1);
        assert.equal(h.get("spectral"), null);
        assert.equal(h.uniforms.uSpectral.value, 0);
        assert.equal(h.uniforms.uCapillaryReady.value, 2);
        assert.equal(h.get("capillary").isCpu, true);
        assert(resources.every((r) => r.disposals === 1));
        assert([...releasedTextures.values()].every((n) => n === 1));
        bindingsCleared(h);
        assert.equal(h.renderer.getRenderTarget(), null);
        assert.equal(h.errors.length, 0);
        h.frames(3);
        assert(h.calls.cpuCapillary.length > 1);
        return {
          releasedTargets: resources.length,
          releasedDataTextures: dataTextures.length,
          warnings: h.warnings,
        };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "startup spectrum failure releases targets and keeps GPU capillary fallback",
    async () => {
      const h = await boot({ failSpectralInit: true, reduced: true });
      try {
        h.frames(1);
        assert.equal(h.get("spectral"), null);
        assert.equal(h.uniforms.uSpectral.value, 0);
        assert.equal(h.uniforms.uCapillaryReady.value, 1);
        assert(spectralRecords(h).every((r) => r.disposals === 1));
        bindingsCleared(h);
        assert.equal(h.errors.length, 0);
        assert.equal(h.renderer.stats.main, 1);
        return { releasedTargets: spectralRecords(h).length };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "startup spectrum and GPU-capillary failure falls back to CPU",
    async () => {
      const h = await boot({
        failSpectralInit: true,
        failGpuCapillaryInit: true,
        reduced: true,
      });
      try {
        h.frames(1);
        assert.equal(h.uniforms.uSpectral.value, 0);
        assert.equal(h.uniforms.uCapillaryReady.value, 2);
        assert.equal(h.get("capillary").isCpu, true);
        assert.equal(h.errors.length, 0);
        assert.equal(h.renderer.stats.main, 1);
        return { warnings: h.warnings };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "CPU failure after lost spectrum keeps analytic fallback drawing",
    async () => {
      const h = await boot();
      try {
        h.frames(1);
        h.renderer.fault.spectral = true;
        h.renderer.fault.cpuUpload = true;
        h.frames(1);
        assert.equal(h.uniforms.uSpectral.value, 0);
        assert.equal(h.uniforms.uCapillaryReady.value, 0);
        assert.equal(h.get("capillary"), null);
        assert.equal(h.uniforms.uCapillary0.value, null);
        assert.equal(h.uniforms.uCapillary1.value, null);
        bindingsCleared(h);
        assert.equal(h.errors.length, 0);
        const n = h.renderer.stats.main;
        h.frames(2);
        assert(h.renderer.stats.main > n);
        return { warnings: h.warnings };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "no-float capability starts CPU capillary and RGBA8 refraction",
    async () => {
      const h = await boot({ float: false, reduced: true });
      try {
        h.frames(1);
        assert.equal(h.uniforms.uSpectral.value, 0);
        assert.equal(h.uniforms.uCapillaryReady.value, 2);
        assert.equal(h.uniforms.uRefractionReady.value, 1);
        assert.equal(
          h.records.find(
            (r) => r.target.texture === h.uniforms.uSceneColor.value,
          ).target.texture.type,
          h.three.UnsignedByteType,
        );
        assert.equal(h.errors.length, 0);
        return { cpu: true, refraction: "RGBA8" };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "foam quality resizing disposes old pair and publishes matching dimensions",
    async () => {
      const h = await boot();
      try {
        h.frames(3);
        const changes = [];
        for (const [quality, size] of [
          ["high", 1024],
          ["light", 256],
          ["balanced", 512],
        ]) {
          const old = h.records.filter(
            (r) =>
              r.target.width ===
                h.renderer.foamPass.uniforms.uFoamResolution.value &&
              !r.target.depthBuffer &&
              !r.target.isWebGLCubeRenderTarget &&
              r.disposals === 0 &&
              (r.target.texture === h.uniforms.uFoamTex.value ||
                r.target.texture ===
                  h.renderer.foamPass.uniforms.uPreviousFoam.value),
          );
          const before = h.records.length;
          h.click("quality");
          assert.equal(h.get("quality"), quality);
          h.frames(2);
          const current = h.records.find(
            (r) => r.target.texture === h.uniforms.uFoamTex.value,
          );
          assert.equal(current.target.width, size);
          assert.equal(
            h.renderer.foamPass.uniforms.uFoamResolution.value,
            size,
          );
          assert(old.every((r) => r.disposals === 1));
          const fresh = h.records
            .slice(before)
            .filter(
              (r) =>
                r.target.width === size &&
                !r.target.depthBuffer &&
                !r.target.isWebGLCubeRenderTarget,
            );
          assert.equal(fresh.length, 2);
          assert(fresh.every((r) => r.disposals === 0));
          changes.push({ quality, size });
        }
        return changes;
      } finally {
        h.close();
      }
    },
  );
  await check(
    "foam resize failure releases partial/new/old targets and preserves water",
    async () => {
      const h = await boot();
      try {
        h.frames(3);
        const oldTexture = h.uniforms.uFoamTex.value,
          old = h.records.find((r) => r.target.texture === oldTexture),
          before = h.records.length;
        h.renderer.fault.framebuffer = (t) =>
          t?.width === 1024 && !t.depthBuffer && !t.isWebGLCubeRenderTarget;
        h.click("quality");
        h.renderer.fault.framebuffer = false;
        assert.equal(h.uniforms.uFoamReady.value, 0);
        assert.equal(h.uniforms.uFoamTex.value, null);
        assert.equal(old.disposals, 1);
        const partial = h.records
          .slice(before)
          .filter(
            (r) => r.target.width === 1024 && !r.target.isWebGLCubeRenderTarget,
          );
        assert(partial.length > 0 && partial.every((r) => r.disposals === 1));
        const n = h.renderer.stats.main;
        h.frames(2);
        assert(h.renderer.stats.main > n);
        assert.equal(h.errors.length, 0);
        return { partialReleased: partial.length };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "foam draw failure clears bindings and keeps the scene drawing",
    async () => {
      const h = await boot();
      try {
        h.frames(3);
        const old = h.records.find(
          (r) => r.target.texture === h.uniforms.uFoamTex.value,
        );
        h.renderer.fault.foam = true;
        h.frames(1);
        assert.equal(h.uniforms.uFoamReady.value, 0);
        assert.equal(h.uniforms.uFoamTex.value, null);
        assert.equal(old.disposals, 1);
        assert.equal(h.errors.length, 0);
        const n = h.renderer.stats.main;
        h.frames(2);
        assert(h.renderer.stats.main > n);
        return { fallback: "instantaneous foam" };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "paused camera moves reproject foam on integer texels without advancing history time",
    async () => {
      const h = await boot({ reduced: true });
      try {
        h.frames(2);
        const foamClears = () =>
          h.calls.clears.filter(
            (c) =>
              c.target?.width === 512 &&
              !c.target.isWebGLCubeRenderTarget &&
              !c.target.depthBuffer,
          ).length;
        const time = h.uniforms.uTime.value,
          clears = foamClears();
        h.pointer("pointerdown", 1, 0, 0);
        h.pointer("pointermove", 1, 240, 0);
        h.pointer("pointerup", 1, 240, 0);
        h.frames(220);
        assert.equal(h.uniforms.uTime.value, time);
        assert(h.calls.foam.length > 0);
        for (const call of h.calls.foam) {
          assert.equal(call.dt, 0);
          const cell = 400 / call.resolution;
          for (const value of call.delta)
            assert(Math.abs(value / cell - Math.round(value / cell)) < 1e-8);
        }
        assert.equal(foamClears(), clears);
        const n = h.calls.foam.length;
        h.frames(120);
        assert.equal(h.calls.foam.length, n);
        return { reprojectionDraws: n, dt: 0 };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "initial and large-jump foam windows clear both history targets",
    async () => {
      const h = await boot({ reduced: true });
      try {
        const initialClears = h.calls.clears.length;
        h.frames(1);
        assert.equal(h.uniforms.uFoamReady.value, 1);
        const initial = h.calls.clears
          .slice(initialClears)
          .filter(
            (c) =>
              c.target?.width === 512 &&
              !c.target.isWebGLCubeRenderTarget &&
              !c.target.depthBuffer,
          );
        assert.equal(initial.length, 2);
        const prior = h.calls.clears.length,
          draws = h.calls.foam.length;
        h.set("camera.position.set(1000,4.2,8);camera.lookAt(1000,0,-20)");
        h.get("updateFoam")(1 / 60);
        const cleared = h.calls.clears.slice(prior);
        assert.equal(cleared.length, 2);
        assert.equal(h.calls.foam.length, draws);
        assert(Math.abs(h.uniforms.uFoamAnchor.value.x - 1000) < 1);
        return { initialClears: 2, largeJumpClears: 2 };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "packed foam success publishes raw repeat/mipmap texture before first frame",
    async () => {
      const h = await boot({ reduced: true });
      try {
        h.frames(1);
        assert.equal(h.uniforms.uFoamPatternReady.value, 1);
        const t = h.uniforms.uFoamPattern.value;
        assert.equal(t.colorSpace, h.three.NoColorSpace);
        assert.equal(t.wrapS, h.three.RepeatWrapping);
        assert.equal(t.wrapT, h.three.RepeatWrapping);
        assert.equal(t.minFilter, h.three.LinearMipmapLinearFilter);
        assert.equal(t.magFilter, h.three.LinearFilter);
        assert.equal(h.renderer.stats.main, 1);
        return { url: t.userData.url };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "packed foam failure uses procedural fallback and renders",
    async () => {
      const h = await boot({ badPattern: true, reduced: true });
      try {
        h.frames(1);
        assert.equal(h.uniforms.uFoamPatternReady.value, 0);
        assert.equal(h.uniforms.uFoamPattern.value, null);
        const t = h.imageJobs[0].texture;
        assert(t.userData.disposed >= 1);
        assert.equal(h.renderer.stats.main, 1);
        assert.equal(h.errors.length, 0);
        return { fallback: "procedural" };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "packed foam timeout releases startup and disposes late success",
    async () => {
      const h = await boot({ hangPattern: true, reduced: true });
      try {
        h.frames(1);
        assert.equal(h.renderer.stats.main, 0);
        h.timer(8000);
        await flush();
        h.frames(1);
        assert.equal(h.renderer.stats.main, 1);
        assert.equal(h.uniforms.uFoamPatternReady.value, 0);
        h.imageJobs[0].finish();
        await flush();
        assert.equal(h.uniforms.uFoamPatternReady.value, 0);
        assert.equal(h.uniforms.uFoamPattern.value, null);
        assert(h.imageJobs[0].texture.userData.disposed >= 1);
        return { lateAssetPublished: false };
      } finally {
        h.close();
      }
    },
  );
  await check(
    "RGBA8 foam history uses 2.1 range and keeps frozen reprojection undithered",
    async () => {
      const h = await boot({ float: false, reduced: true });
      try {
        h.frames(2);
        assert.equal(h.uniforms.uFoamScale.value, 2.1);
        h.pointer("pointerdown", 1, 0, 0);
        h.pointer("pointermove", 1, 240, 0);
        h.pointer("pointerup", 1, 240, 0);
        h.frames(220);
        assert(h.calls.foam.length > 0);
        for (const call of h.calls.foam) {
          assert.equal(call.dt, 0);
          assert.equal(call.scale, 2.1);
          assert.equal(call.target.texture.type, h.three.UnsignedByteType);
        }
        return { scale: 2.1, pausedReprojectionDraws: h.calls.foam.length };
      } finally {
        h.close();
      }
    },
  );
  await check("all shader stages are composed", async () => {
    const h = await boot({ reduced: true });
    try {
      h.frames(1);
      const { bindings } = await modules();
      const shaders = {
        waterVertex: h.get("vertex"),
        waterFragment: h.get("fragment"),
        foamVertex:
          "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
        foamFragment: h.get("foamFragment"),
        skyVertex: h.get("skyMesh").material.vertexShader,
        skyFragment: h.get("skyMesh").material.fragmentShader,
        seabedVertex: h.get("seabed").material.vertexShader,
        seabedFragment: h.get("seabed").material.fragmentShader,
        displaySeabedVertex: h.get("seabed").displayMesh.material.vertexShader,
        displaySeabedFragment:
          h.get("seabed").displayMesh.material.fragmentShader,
        atmosphereVertex: bindings.ATMOSPHERE_VERTEX,
        atmosphereFragment: bindings.ATMOSPHERE_FRAGMENT,
        spectralVertex: bindings.QUAD_VERTEX,
        spectralEvolveFragment: bindings.EVOLVE_FRAGMENT,
        spectralFFTFragment: bindings.FFT_FRAGMENT,
        spectralBlendFragment: bindings.BLEND_FRAGMENT,
      };
      for (const shader of Object.values(shaders))
        assert.equal(typeof shader, "string");
      return Object.keys(shaders);
    } finally {
      h.close();
    }
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
