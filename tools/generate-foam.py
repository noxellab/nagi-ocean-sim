from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

OUTPUT = Path(__file__).resolve().parents[1] / "public" / "foam-pattern.png"
SIZE = 1024


def periodic_noise(rng, sigma):
    x = gaussian_filter(
        rng.normal(size=(SIZE, SIZE)).astype(np.float32), sigma, mode="wrap"
    )
    return (x - x.mean()) / max(float(x.std()), 1e-7)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def pores(rng, count, median_radius, spread, density, wall):

    first = np.full((SIZE, SIZE), 1e4, dtype=np.float32)
    second = first.copy()
    for _ in range(count):
        for _attempt in range(32):
            cx, cy = rng.uniform(0, SIZE, 2)
            if rng.random() < density[int(cy) % SIZE, int(cx) % SIZE]:
                break
        radius = np.clip(
            rng.lognormal(np.log(median_radius), spread), 0.45, median_radius * 3.5
        )
        eccentricity = np.exp(rng.uniform(-0.25, 0.25))
        angle = rng.uniform(0, 2 * np.pi)
        cs, sn = np.cos(angle), np.sin(angle)
        phase = rng.uniform(0, 2 * np.pi, 3)
        extent = int(
            np.ceil(radius * max(eccentricity, 1 / eccentricity) * 1.4 + wall * 3)
        )
        xx = np.arange(int(cx) - extent, int(cx) + extent + 1)
        yy = np.arange(int(cy) - extent, int(cy) + extent + 1)
        x, y = np.meshgrid(xx - cx, yy - cy)
        ex = (x * cs + y * sn) * eccentricity
        ey = (-x * sn + y * cs) / eccentricity
        theta = np.arctan2(ey, ex)
        irregular = (
            1
            + 0.04 * np.sin(3 * theta + phase[0])
            + 0.025 * np.sin(5 * theta + phase[1])
            + 0.015 * np.sin(8 * theta + phase[2])
        )
        signed = (np.hypot(ex, ey) / irregular - radius).astype(np.float32)
        index = np.ix_(yy % SIZE, xx % SIZE)
        old = first[index]
        second[index] = np.minimum(second[index], np.maximum(old, signed))
        first[index] = np.minimum(old, signed)
    interior = 1 - smoothstep(-wall, wall, first)
    membrane = (1 - smoothstep(wall * 0.5, wall * 1.7, second - first)) * interior
    interior *= 1 - 0.78 * membrane
    meniscus = np.exp(-0.5 * (first / max(wall, 0.3)) ** 2)
    return interior.astype(np.float32), meniscus.astype(np.float32)


def make_field(name, seed, target_mean, target_std):
    rng = np.random.default_rng(seed)
    feature_scale = 0.28 if name == "breaking" else 0.53
    pocket = periodic_noise(rng, 39 * feature_scale)
    film = (
        periodic_noise(rng, 63 * feature_scale) * 0.52
        + periodic_noise(rng, 15 * feature_scale) * 0.30
        + periodic_noise(rng, 3.5 * feature_scale) * 0.18
    )
    density = np.clip(0.48 + 0.23 * pocket, 0.04, 1.0)
    ridge_field = periodic_noise(rng, 74 * feature_scale) + 0.25 * periodic_noise(
        rng, 23 * feature_scale
    )
    ridges = np.exp(-0.5 * (ridge_field / 0.13) ** 2)
    if name == "breaking":
        big, brim = pores(
            rng, round(350 / feature_scale**2), 8.1 * feature_scale, 0.62, density, 0.55
        )
        fine, frim = pores(
            rng,
            round(5700 / feature_scale**2),
            2.2 * feature_scale,
            0.52,
            density,
            0.36,
        )
        micro, mrim = pores(
            rng, 18500, 0.70, 0.35, np.clip(0.68 + 0.1 * pocket, 0.2, 1.0), 0.3
        )
        result = (
            0.75
            + 0.060 * film
            - 0.22 * big
            - 0.145 * fine
            - 0.080 * micro
            + 0.065 * brim
            + 0.030 * frim
            + 0.125 * ridges
        )
    else:
        big, brim = pores(
            rng,
            round(470 / feature_scale**2),
            11.5 * feature_scale,
            0.68,
            density,
            0.60,
        )
        fine, frim = pores(
            rng,
            round(3900 / feature_scale**2),
            2.7 * feature_scale,
            0.60,
            density,
            0.38,
        )
        micro, mrim = pores(
            rng, 12500, 0.77, 0.40, np.clip(0.7 + 0.1 * pocket, 0.2, 1.0), 0.3
        )
        result = (
            0.77
            + 0.062 * film
            - 0.38 * big
            - 0.205 * fine
            - 0.078 * micro
            + 0.075 * brim
            + 0.035 * frim
            + 0.112 * ridges
        )
    result += 0.025 * periodic_noise(rng, 0.55) + 0.010 * rng.normal(size=result.shape)
    warp_x = feature_scale * (
        8 * periodic_noise(rng, 57 * feature_scale)
        + 2 * periodic_noise(rng, 16 * feature_scale)
    )
    warp_y = feature_scale * (
        8 * periodic_noise(rng, 57 * feature_scale)
        + 2 * periodic_noise(rng, 16 * feature_scale)
    )
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    result = map_coordinates(
        result, [yy + warp_y, xx + warp_x], order=1, mode="grid-wrap"
    )
    for _ in range(8):
        result = np.clip(
            (result - result.mean()) * (target_std / result.std()) + target_mean, 0, 1
        )
    return np.round(result * 255).astype(np.uint8)


if __name__ == "__main__":
    breaking = make_field("breaking", 824661, 0.657, 0.0965)
    surface = make_field("surface", 927413, 0.635, 0.155)
    packed = np.stack([breaking, surface, np.zeros_like(breaking)], axis=-1)
    Image.fromarray(packed).save(OUTPUT)
    print(OUTPUT.name)
