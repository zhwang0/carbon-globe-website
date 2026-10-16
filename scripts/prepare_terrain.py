#!/usr/bin/env python3
"""Build the globe's geographic backdrop from Natural Earth I raster data.

Requires Pillow. From this workspace:
    .tools/venv/bin/python website/scripts/prepare_terrain.py

Downloads are cached inside the project under .tools/terrain-source. No source
files are deleted or modified. The generated texture preserves the source's
geography and applies a uniform display grade (gamma 1.7, saturation 1.15),
then WebP compression. The website masks oceans separately to retain its fixed
blue ocean because this Natural Earth variant uses an uncolored ocean background.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile

import PIL
from PIL import Image, ImageEnhance

WEBSITE_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = (
    WEBSITE_DIR.parent
    if (WEBSITE_DIR.parent / "initial_plans.md").is_file()
    else WEBSITE_DIR
)
SOURCE_URL = "https://naturalearth.s3.amazonaws.com/50m_raster/NE1_50M_SR.zip"
SOURCE_PAGE = "https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/"
DETAIL_PAGE = "https://www.naturalearthdata.com/downloads/50m-natural-earth-1/50m-natural-earth-i-with-shaded-relief/"
TERMS_URL = "https://www.naturalearthdata.com/about/terms-of-use/"
ARCHIVE_NAME = "NE1_50M_SR.zip"
ARCHIVE_SHA256 = "ae930744c0cf3d10e73c292726b74c81a40490a75829f8299dec9069e5d0e934"
RASTER_MEMBER = "NE1_50M_SR/NE1_50M_SR.tif"
WORLD_FILE_MEMBER = "NE1_50M_SR/NE1_50M_SR.tfw"


def stream_hash(stream) -> str:
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return stream_hash(stream)


def prepare(cache_dir: Path, output_dir: Path, width: int) -> dict:
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / ARCHIVE_NAME
    if not archive.is_file():
        temporary = archive.with_suffix(".zip.download")
        request = Request(SOURCE_URL, headers={"User-Agent": "CarbonGlobe-terrain-preparation/1.0"})
        with urlopen(request, timeout=90) as response, temporary.open("wb") as target:
            shutil.copyfileobj(response, target, length=1024 * 1024)
        if file_hash(temporary) != ARCHIVE_SHA256:
            raise RuntimeError("Downloaded archive differs from the verified source; inspect it before use.")
        temporary.replace(archive)
    if file_hash(archive) != ARCHIVE_SHA256:
        raise RuntimeError("Cached archive differs from the verified Natural Earth source.")

    with ZipFile(archive) as package:
        with package.open(RASTER_MEMBER) as source:
            raster_hash = stream_hash(source)
        world_file_text = package.read(WORLD_FILE_MEMBER).decode("utf-8")
        world_file = [float(value) for value in world_file_text.split()]
        expected_world_file = [1 / 30, 0, 0, -1 / 30, -180 + 1 / 60, 90 - 1 / 60]
        if any(abs(a - b) > 1e-10 for a, b in zip(world_file, expected_world_file)):
            raise RuntimeError("Unexpected georeferencing; texture orientation must be reviewed.")
        with package.open(RASTER_MEMBER) as source:
            with Image.open(source) as original:
                if original.size != (10800, 5400):
                    raise RuntimeError(f"Unexpected raster dimensions: {original.size}")
                texture = original.convert("RGB").resize(
                    (width, width // 2), Image.Resampling.LANCZOS
                )

    # A uniform photographic display grade strengthens Natural Earth I
    # desert tones and relief without classifying or recoloring regions.
    gamma = 1.7
    saturation = 1.15
    curve = [round(255 * (channel / 255) ** gamma) for channel in range(256)]
    texture = ImageEnhance.Color(texture.point(curve * 3)).enhance(saturation)

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "earth-terrain.webp"
    texture.save(output, format="WEBP", quality=85, method=6)
    if output.stat().st_size > 1_000_000:
        raise RuntimeError("Texture exceeded the intended 1 MB delivery budget.")

    metadata = {
        "title": "Natural Earth I with Shaded Relief",
        "description": "Satellite-derived land-cover colors and geographic shaded relief; contextual basemap, not CarbonGlobe simulation values.",
        "version": "3.2.0",
        "scale": "1:50m",
        "credit": "Made with Natural Earth.",
        "authors": ["Tom Patterson", "Nathaniel Vaughn Kelso", "Natural Earth contributors"],
        "license": "Public domain",
        "licenseUrl": TERMS_URL,
        "sourcePage": SOURCE_PAGE,
        "sourceDetailPage": DETAIL_PAGE,
        "downloadUrl": SOURCE_URL,
        "sourceArchive": {
            "filename": ARCHIVE_NAME,
            "bytes": archive.stat().st_size,
            "sha256": ARCHIVE_SHA256,
        },
        "sourceRaster": {
            "filename": RASTER_MEMBER,
            "sha256": raster_hash,
            "width": 10800,
            "height": 5400,
            "worldFile": WORLD_FILE_MEMBER,
            "worldFileValues": world_file,
        },
        "georeferencing": {
            "projection": "Geographic / equirectangular",
            "datum": "WGS84",
            "bounds": {"west": -180, "east": 180, "north": 90, "south": -90},
            "orientation": "North at top; longitude increases left to right; -180 degrees at left edge; 0 degrees at center; +180 degrees at right edge.",
            "pixelSampling": "Pixel centers; latitude = 90 - (y + 0.5) * 180 / height; longitude = -180 + (x + 0.5) * 360 / width.",
        },
        "processing": {
            "operations": [
                "Convert to RGB",
                "Lanczos downsampling",
                "Uniform per-channel gamma 1.7",
                "Uniform saturation factor 1.15",
                "WebP encoding: quality 85, method 6",
            ],
            "colorAdjustment": {
                "gamma": gamma,
                "channelFormula": "output = round(255 * (input / 255) ** 1.7)",
                "saturation": saturation,
                "saturationMethod": "Pillow ImageEnhance.Color",
                "scope": "Identical adjustment for every pixel, without geographic or land-cover classification",
            },
            "pillowVersion": PIL.__version__,
            "script": "scripts/prepare_terrain.py",
            "note": "No synthetic land classes, latitude-based recoloring, added snow, or generative imagery.",
        },
        "output": {
            "filename": output.name,
            "width": width,
            "height": width // 2,
            "bytes": output.stat().st_size,
            "sha256": file_hash(output),
        },
        "displayNotes": [
            "The natural-color terrain is geographic context and must remain distinguishable from the simulated ecosystem overlay.",
            "This variant has an uncolored ocean background; use the renderer's geographic land mask to retain the fixed blue ocean.",
            "Shaded relief is already baked into the raster. Snow/ice, deserts, vegetation, and mountain colors come from the Natural Earth source.",
        ],
        "verifiedOn": "2026-10-16",
    }
    (output_dir / "earth-terrain.attribution.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output_dir / "ATTRIBUTION.txt").write_text(
        "Made with Natural Earth.\n"
        "Natural Earth I with Shaded Relief, 1:50m, version 3.2.0.\n"
        "Public domain raster data by Tom Patterson, Nathaniel Vaughn Kelso, and contributors.\n"
        f"Product: {SOURCE_PAGE}\n"
        f"Terms of use: {TERMS_URL}\n"
        f"Download: {SOURCE_URL}\n"
        f"Source archive: {ARCHIVE_NAME}\n"
        f"Archive SHA-256: {ARCHIVE_SHA256}\n"
        f"Raster member: {RASTER_MEMBER}\n"
        f"Raster SHA-256: {raster_hash}\n"
        f"Derivative: {output.name}, {width} x {width // 2}, {output.stat().st_size} bytes.\n"
        f"Derivative SHA-256: {metadata['output']['sha256']}\n"
        "Processing: RGB conversion; Lanczos resizing; uniform per-channel gamma 1.7; saturation x1.15; WebP quality 85, method 6.\n"
        "The same display grade is applied to every pixel; no geographic or land-cover categories are invented.\n"
        "Equirectangular WGS84: west -180, east 180, north 90, south -90; north is up.\n"
        "This geographic backdrop does not encode CarbonGlobe simulation values.\n"
        "Use the globe's land mask to retain its separately rendered fixed blue ocean.\n"
        "Regenerate with scripts/prepare_terrain.py (requires Pillow).\n",
        encoding="utf-8",
    )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=PROJECT_DIR / ".tools" / "terrain-source")
    parser.add_argument("--output-dir", type=Path, default=WEBSITE_DIR / "assets" / "textures")
    parser.add_argument("--width", type=int, choices=[2048, 4096], default=4096)
    args = parser.parse_args()
    result = prepare(args.cache_dir.resolve(), args.output_dir.resolve(), args.width)
    print(json.dumps({"output": str(args.output_dir.resolve() / result['output']['filename']), **result['output']}, indent=2))


if __name__ == "__main__":
    main()
