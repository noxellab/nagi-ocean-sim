const { test } = require("node:test");
const assert = require("node:assert/strict");
const { boot, flush } = require("./runtime-harness.cjs");

for (const hangPattern of [false, true]) {
  test(`asset timeout releases startup, foam stalled: ${hangPattern}`, async () => {
    const h = await boot({ hangJPEG: true, hangPattern, reduced: true });
    try {
      h.frames(1);
      assert.equal(h.renderer.stats.main, 0);
      assert.equal(h.uniforms.uFoamPatternReady.value, hangPattern ? 0 : 1);
      h.timer(8000);
      await flush();
      await flush();
      h.frames(1);
      assert.equal(h.renderer.stats.main, 1);
      assert.equal(h.uniforms.uPhotoSkyReady.value, 0);
      assert.equal(h.uniforms.uEnvironmentReady.value, 1);
      assert.equal(h.errors.length, 0);
      if (hangPattern) {
        h.imageJobs[0].finish();
        await flush();
        assert.equal(h.uniforms.uFoamPatternReady.value, 0);
        assert(h.imageJobs[0].texture.userData.disposed >= 1);
      }
    } finally {
      h.close();
    }
  });
}

test("wave controls clamp to the supported range and presets fit every slider", async () => {
  const h = await boot({ reduced: true });
  try {
    const wave = h.d.getElementById("wave");
    assert.equal(wave.type, "range");
    assert.equal(wave.min, "0.25");
    assert.equal(wave.max, "1.5");
    assert.equal(wave.step, "0.05");
    for (const [name, preset] of Object.entries(h.get("presets"))) {
      h.preset(name);
      for (const key of ["wave", "wind", "light"]) {
        const el = h.d.getElementById(key),
          value = preset[key];
        assert(value >= Number(el.min) && value <= Number(el.max));
        assert(
          Math.abs(
            (value - Number(el.min)) / Number(el.step) -
              Math.round((value - Number(el.min)) / Number(el.step)),
          ) < 1e-8,
        );
        assert.equal(Number(el.value), value);
      }
    }
    h.input("wave", 2);
    h.input("wind", 1);
    h.frames(280);
    assert.equal(wave.value, "1.5");
    assert.equal(h.uniforms.uWave.value, 1.5);
    assert.equal(h.uniforms.uWind.value, 1);
    assert.equal(h.uniforms.uTime.value, 0);
    h.input("wave", -1);
    h.frames(280);
    assert.equal(wave.value, "0.25");
    assert.equal(h.uniforms.uWave.value, 0.25);
    wave.stepUp(100);
    assert.equal(wave.value, "1.5");
    wave.stepDown(100);
    assert.equal(wave.value, "0.25");
    assert.deepEqual(h.errors, []);
  } finally {
    h.close();
  }
});
