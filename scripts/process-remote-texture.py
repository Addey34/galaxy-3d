"""Process a large remote raster into bounded JPEG LODs.

The source is opened through GDAL /vsicurl/ range requests. It is never copied
to disk. The script is dry-run by default and only writes with --apply.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "texture-sources.json"
TEXTURE_ROOT = ROOT / "public" / "assets" / "textures"
STAGING_ROOT = ROOT / "tmp" / "texture-processing"
QUALITY_WIDTHS = {"1k": 1024, "2k": 2048, "4k": 4096, "8k": 8192}
BODY_RADII = {
    "mercury": 2_439_400.0,
    "venus": 6_051_000.0,
    "earth": 6_378_137.0,
    "moon": 1_737_400.0,
    "mars": 3_389_500.0,
    "jupiter": 71_492_000.0,
    "saturn": 60_268_000.0,
    "uranus": 25_559_000.0,
    "neptune": 24_622_000.0,
    "pluto": 1_188_300.0,
}


def fail(message: str) -> None:
    raise SystemExit(f"Remote texture processing aborted: {message}")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--body", required=True)
    parser.add_argument("--url")
    parser.add_argument("--max-quality", choices=QUALITY_WIDTHS, default="8k")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = arguments()
    if not args.body.islower() or not all(
        character.isalnum() or character == "-" for character in args.body
    ):
        fail("body must contain lowercase letters, numbers or hyphens")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entry = next(
        (
            review
            for review in manifest["reviews"]
            if review["body"] == args.body and review["layer"] == "surface"
        ),
        None,
    )
    if args.body not in BODY_RADII:
        fail(f"no physical radius registered for {args.body}")
    if not entry or entry.get("processing") != "gdal-required":
        fail(f"{args.body} is not registered as a remote GDAL source")

    url = args.url or entry.get("downloadUrl")
    if not url or not url.startswith("https://"):
        fail("the source must be an HTTPS URL")

    width = QUALITY_WIDTHS[args.max_quality]
    height = width // 2
    output_dir = TEXTURE_ROOT / args.body
    fallback_path = output_dir / f"{args.body}Surface_8k.jpg"

    print(f"Source: {url}")
    print(f"Target: {width}x{height} equirectangular, body={args.body}")
    print("The source is streamed through /vsicurl/; no raw TIFF is saved.")
    if not args.apply:
        print("Dry-run: no output will be written. Add --apply after review.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    remote_path = f"/vsicurl/{url}"
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF",
        GDAL_CACHEMAX=512,
    ):
        with rasterio.open(remote_path) as source:
            radius = BODY_RADII[args.body]
            target_transform = from_bounds(
                -math.pi * radius,
                -math.pi * radius / 2,
                math.pi * radius,
                math.pi * radius / 2,
                width,
                height,
            )
            source_band = np.zeros((height, width), dtype=np.uint8)
            reproject(
                source=rasterio.band(source, 1),
                destination=source_band,
                src_transform=source.transform,
                src_crs=source.crs,
                dst_transform=target_transform,
                dst_crs=source.crs,
                resampling=Resampling.average,
                num_threads=4,
            )
            source_bounds = source.bounds

    # The source has no global polar coverage. Keep the current local texture in
    # those rows rather than inventing pixels or displaying black caps.
    if fallback_path.exists():
        fallback = np.asarray(
            Image.open(fallback_path).convert("RGB").resize(
                (width, height), Image.Resampling.LANCZOS
            )
        )
    else:
        fallback = np.zeros((height, width, 3), dtype=np.uint8)

    target_y = np.linspace(
        math.pi * radius / 2,
        -math.pi * radius / 2,
        height,
        endpoint=False,
    )
    covered = (target_y <= source_bounds.top) & (target_y >= source_bounds.bottom)
    output = fallback.copy()
    output[covered] = np.repeat(source_band[covered, :, None], 3, axis=2)

    for quality, output_width in QUALITY_WIDTHS.items():
        if output_width > width:
            continue
        output_path = output_dir / f"{args.body}Surface_{quality}.jpg"
        if output_path.exists() and not args.force:
            fail(f"{output_path} exists; add --force to replace it")
        image = Image.fromarray(output, mode="RGB")
        if output_width != width:
            image = image.resize(
                (output_width, output_width // 2), Image.Resampling.LANCZOS
            )
        image.save(
            output_path,
            format="JPEG",
            quality=90,
            subsampling=0,
            optimize=True,
            progressive=True,
        )
        print(f"Wrote {output_path}")

    metadata = {
        "body": args.body,
        "sourceUrl": url,
        "sourcePage": entry["sourcePage"],
        "sourceResolution": entry["sourceResolution"],
        "sourceProjection": entry["projection"],
        "outputProjection": "equirectangular",
        "coveragePolicy": "remote mosaic plus existing local fallback for uncovered latitudes",
        "maxQuality": args.max_quality,
        "processedAt": datetime.now(timezone.utc).isoformat(),
        "tool": "rasterio/GDAL /vsicurl/ + Pillow",
    }
    staging = STAGING_ROOT / args.body
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "processing.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {staging / 'processing.json'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Remote texture processing failed: {error}", file=sys.stderr)
        raise
