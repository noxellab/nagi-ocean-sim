from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image
import OpenEXR

WIDTH, HEIGHT = 4096, 2048
GAIN_MAX = 15.99
GAIN_WEIGHT = 0.42399845327747504
SUN_DIRECTION = np.array([0.5542598486859208, 0.7418088572248551, 0.3775124361890805])
SUN_BASELINE = np.array(
    [9.655837059020996, 10.09691047668457, 12.554890632629395], dtype=np.float32
)


def decode_sky(base, gain):

    code = (base.astype(np.float32) + 1.0) * np.exp2(
        GAIN_MAX * gain.astype(np.float32) / 255.0 * GAIN_WEIGHT
    ) - 1.0
    lookup = np.where(code < 1024.0, np.floor(code), code)
    linear = np.where(
        code / 255.0 < 0.04045,
        code / 255.0 * 0.0773993808,
        (lookup / 255.0 * 0.9478672986 + 0.0521327014) ** 2.4,
    )
    return np.clip(linear, 0.0, 65504.0)


def remove_solar_core(radiance):
    latitude = (0.5 - (np.arange(HEIGHT) + 0.5) / HEIGHT) * np.pi
    longitude = ((np.arange(WIDTH) + 0.5) / WIDTH - 0.5) * 2 * np.pi
    cos_lat = np.cos(latitude)[:, None]
    dot = (
        cos_lat * np.cos(longitude)[None, :] * SUN_DIRECTION[0]
        + np.sin(latitude)[:, None] * SUN_DIRECTION[1]
        + cos_lat * np.sin(longitude)[None, :] * SUN_DIRECTION[2]
    )
    angle = np.rad2deg(np.arccos(np.clip(dot, -1.0, 1.0)))
    t = np.clip((angle - 1.0) / 0.25, 0.0, 1.0)
    amount = (1.0 - t * t * (3.0 - 2.0 * t)).astype(np.float32)
    return radiance - np.maximum(radiance - SUN_BASELINE, 0.0) * amount[:, :, None]


def fallback_rgba16f(radiance):

    edges = np.arange(HEIGHT + 1) * (np.pi / HEIGHT)
    weight = (np.cos(edges[:-1]) - np.cos(edges[1:])).astype(np.float32)
    weighted = radiance * weight[:, None, None]
    reduced = weighted.reshape(512, 4, 1024, 4, 3).sum(axis=(1, 3))
    reduced /= (weight.reshape(512, 4).sum(axis=1) * 4)[:, None, None]
    rgba = np.ones((512, 1024, 4), dtype="<f2")
    rgba[:, :, :3] = np.clip(reduced[::-1], 0.0, 65504.0)
    return rgba


def generate(source, output):
    output.mkdir(parents=True, exist_ok=True)
    channels = OpenEXR.File(str(source)).channels()
    rgb = (
        channels["RGBA" if "RGBA" in channels else "RGB"]
        .pixels[:, :, :3]
        .astype(np.float32)
    )
    if rgb.shape != (HEIGHT, WIDTH, 3) or not np.all(np.isfinite(rgb)):
        raise ValueError("Expected a finite 4096 x 2048 RGB EXR")
    rgb = np.clip(rgb, 0.0, 65504.0)
    sdr_linear = np.minimum(rgb, 1.0)
    sdr = np.where(
        sdr_linear <= 0.0031308,
        12.92 * sdr_linear,
        1.055 * sdr_linear ** (1.0 / 2.4) - 0.055,
    )
    gain = np.log2((rgb + 1.0 / 64.0) / (sdr_linear + 1.0 / 64.0)) / GAIN_MAX
    for name, data in [("sky-base.jpg", sdr), ("sky-gain.jpg", gain)]:
        data = np.rint(np.clip(data, 0.0, 1.0) * 255.0).astype(np.uint8)
        Image.fromarray(data).save(
            output / name, quality=95, subsampling=0, optimize=True
        )
    base = np.asarray(Image.open(output / "sky-base.jpg").convert("RGB"))
    gain = np.asarray(Image.open(output / "sky-gain.jpg").convert("RGB"))
    radiance = remove_solar_core(decode_sky(base, gain))
    fallback_rgba16f(radiance).tofile(output / "sky-radiance.bin")
    files = [
        source,
        *(output / n for n in ["sky-base.jpg", "sky-gain.jpg", "sky-radiance.bin"]),
    ]
    result = {
        p.name: {
            "bytes": p.stat().st_size,
            "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
        }
        for p in files
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate sky textures from a 4096 x 2048 RGB EXR"
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public"))
    args = parser.parse_args()
    generate(args.source, args.output)
