"""Process a remote planetary DEM into bounded grayscale bump-map LODs.

The source is opened through GDAL /vsicurl/ range requests. It is never copied
to disk. The script is dry-run by default and only writes with --apply.

A DEM is data, not an sRGB image: valid elevations are rescaled to a robust
1st/99th percentile range for a grayscale bump map. The chosen range is stored
in tmp/texture-processing/<body>/dem-processing.json.
"""

from __future__ import annotations

import argparse
import json
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
    raise SystemExit(f"Remote DEM processing aborted: {message}")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--body", required=True)
    parser.add_argument("--max-quality", choices=QUALITY_WIDTHS, default="4k")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = arguments()
    if not args.body.islower() or not all(
        character.isalnum() or character == "-" for character in args.body
    ):
        fail("body must contain lowercase letters, numbers or hyphens")
    if args.body not in BODY_RADII:
        fail(f"no physical radius registered for {args.body}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entry = next(
        (
            review
            for review in manifest["reviews"]
            if review["body"] == args.body and review["layer"] == "bump"
        ),
        None,
    )
    if not entry or entry.get("processing") != "dem-linear":
        fail(f"{args.body}:bump is not registered as a dem-linear source")

    url = entry.get("downloadUrl")
    if not url or not url.startswith("https://"):
        fail("the DEM source must be an HTTPS URL")

    width = QUALITY_WIDTHS[args.max_quality]
    height = width // 2
    output_dir = TEXTURE_ROOT / args.body
    print(f"Source: {url}")
    print(f"Target: {width}x{height} equirectangular DEM, body={args.body}")
    print("The DEM is streamed through /vsicurl/; no raw TIFF is saved.")
    if not args.apply:
        print("Dry-run: no output will be written. Add --apply after review.")
        return

    remote_path = f"/vsicurl/{url}"
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF",
        GDAL_CACHEMAX=512,
    ):
        with rasterio.open(remote_path) as source:
            target_transform = from_bounds(
                -np.pi * BODY_RADII[args.body],
                -np.pi * BODY_RADII[args.body] / 2,
                np.pi * BODY_RADII[args.body],
                np.pi * BODY_RADII[args.body] / 2,
                width,
                height,
            )
            elevations = np.full((height, width), np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(source, 1),
                destination=elevations,
                src_transform=source.transform,
                src_crs=source.crs,
                dst_transform=target_transform,
                dst_crs=source.crs,
                src_nodata=source.nodata,
                dst_nodata=np.nan,
                resampling=Resampling.bilinear,
                num_threads=4,
            )
            units = source.units[0] if source.units else None

    valid = np.isfinite(elevations)
    if not np.any(valid):
        fail("the DEM contains no valid elevation cells")
    low, high = np.nanpercentile(elevations, [1, 99])
    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        fail("the DEM has no usable elevation range")

    normalized = np.zeros((height, width), dtype=np.uint8)
    normalized[valid] = np.clip(
        (elevations[valid] - low) / (high - low) * 255.0,
        0,
        255,
    ).astype(np.uint8)

    output_dir.mkdir(parents=True, exist_ok=True)
    for quality, output_width in QUALITY_WIDTHS.items():
        if output_width > width:
            continue
        output_path = output_dir / f"{args.body}Bump_{quality}.jpg"
        if output_path.exists() and not args.force:
            fail(f"{output_path} exists; add --force to replace it")
        image = Image.fromarray(normalized, mode="L")
        if output_width != width:
            image = image.resize(
                (output_width, output_width // 2), Image.Resampling.LANCZOS
            )
        image.save(
            output_path,
            format="JPEG",
            quality=95,
            subsampling=0,
            optimize=True,
            progressive=True,
        )
        print(f"Wrote {output_path}")

    metadata = {
        "body": args.body,
        "layer": "bump",
        "sourceUrl": url,
        "sourcePage": entry["sourcePage"],
        "sourceResolution": entry["sourceResolution"],
        "sourceProjection": entry["projection"],
        "outputProjection": "equirectangular",
        "sourceUnits": units,
        "sourceScale": entry.get("note"),
        "normalization": "valid elevations mapped to the 1st/99th percentile range",
        "elevationRangeUsed": {"low": float(low), "high": float(high)},
        "maxQuality": args.max_quality,
        "processedAt": datetime.now(timezone.utc).isoformat(),
        "tool": "rasterio/GDAL /vsicurl/ + Pillow",
    }
    staging = STAGING_ROOT / args.body
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "dem-processing.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {staging / 'dem-processing.json'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Remote DEM processing failed: {error}", file=sys.stderr)
        raise
