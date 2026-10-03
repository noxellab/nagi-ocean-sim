"use strict";

function prepareRendererForPMREM(renderer) {
  if (renderer.__pmremHarnessStats) return renderer.__pmremHarnessStats;
  const stats = { staging: 0, pmrem: 0 };
  const original = renderer.render.bind(renderer);
  renderer.xr ??= { enabled: false };
  renderer.autoClear ??= true;
  renderer.compile ??= () => {};
  renderer.getActiveMipmapLevel ??= () => 0;
  renderer.render = function (scene, camera) {
    const material = scene.material;
    if (
      [
        "CubemapToCubeUV",
        "EquirectangularToCubeUV",
        "SphericalGaussianBlur",
      ].includes(material?.name)
    ) {
      stats.pmrem++;
      return;
    }
    if (scene.children?.some((child) => child.material?.uniforms?.uSource)) {
      stats.staging++;
      return;
    }
    return original(scene, camera);
  };
  Object.defineProperty(renderer, "__pmremHarnessStats", { value: stats });
  return stats;
}

module.exports = { prepareRendererForPMREM };
