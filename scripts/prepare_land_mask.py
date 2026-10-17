#!/usr/bin/env python3
"""Prepare an antialiased display coastline from the pinned Natural Earth source.

Requires Pillow. From the project workspace:
    .tools/venv/bin/python website/scripts/prepare_land_mask.py

This creates only a rendering mask. It does not resample, remove, or replace
CarbonGlobe source values, interpolation provenance, or the scientific grid.
No downloads are needed: the pinned GeoJSON is already included in the website.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import PIL
from PIL import Image, ImageDraw

WEBSITE_DIR = Path(__file__).resolve().parents[1]
LAND_FILE = WEBSITE_DIR / "assets" / "data" / "ne_50m_land.geojson"
LAND_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19"
LAND_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{LAND_COMMIT}/geojson/ne_50m_land.geojson"
LAND_SHA256 = "e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b"
LAND_PAGE = "https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/"
TERMS_URL = "https://www.naturalearthdata.com/about/terms-of-use/"


def polygons(geojson):
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        if geometry["type"] == "Polygon":
            yield geometry["coordinates"]
        elif geometry["type"] == "MultiPolygon":
            yield from geometry["coordinates"]
        else:
            raise ValueError(f"Unexpected geometry: {geometry['type']}")


def prepare(source: Path, output_dir: Path, width: int = 4096, supersample: int = 2) -> dict:
    raw = source.read_bytes()
    actual_source_hash = hashlib.sha256(raw).hexdigest()
    if actual_source_hash != LAND_SHA256:
        raise ValueError("Source GeoJSON differs from the pinned, verified Natural Earth land geometry.")
    geojson = json.loads(raw)
    height = width // 2
    raster_width, raster_height = width * supersample, height * supersample
    high = Image.new("L", (raster_width, raster_height), 0)
    polygon_count = hole_count = 0
    max_jump = 0.0

    for rings in polygons(geojson):
        polygon_count += 1
        hole_count += len(rings) - 1
        transformed = []
        for ring in rings:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Unexpected non-closed polygon ring.")
            for previous, current in zip(ring, ring[1:]):
                max_jump = max(max_jump, abs(current[0] - previous[0]))
            # The pinned source has already been cut at the date line. Its
            # Antarctic boundary crosses the bottom gradually, rather than
            # using a spurious segment between +180 and -180 degrees.
            if any(abs(a[0] - b[0]) > 180 for a, b in zip(ring, ring[1:])):
                raise ValueError("Unexpected date-line crossing; review source geometry before rendering.")
            transformed.append([
                ((lon + 180) / 360 * raster_width - 0.5,
                 (90 - lat) / 180 * raster_height - 0.5)
                for lon, lat, *_ in ring
            ])

        outer = transformed[0]
        left = max(0, math.floor(min(x for x, _ in outer)))
        top = max(0, math.floor(min(y for _, y in outer)))
        right = min(raster_width, math.ceil(max(x for x, _ in outer)) + 1)
        bottom = min(raster_height, math.ceil(max(y for _, y in outer)) + 1)
        if right <= left or bottom <= top:
            continue
        polygon = Image.new("L", (right - left, bottom - top), 0)
        draw = ImageDraw.Draw(polygon)
        draw.polygon([(x - left, y - top) for x, y in outer], fill=255)
        for hole in transformed[1:]:
            draw.polygon([(x - left, y - top) for x, y in hole], fill=0)
        # Masked union keeps islands from another polygon intact even if they
        # lie inside a hole; polygon ordering cannot erase earlier land.
        high.paste(255, (left, top, right, bottom), polygon)

    # Wrap longitude during Lanczos filtering. Otherwise the antimeridian
    # could develop a false seam from one-sided edge filtering.
    pad = 4 * supersample
    periodic = Image.new("L", (raster_width + 2 * pad, raster_height), 0)
    periodic.paste(high, (pad, 0))
    periodic.paste(high.crop((raster_width - pad, 0, raster_width, raster_height)), (0, 0))
    periodic.paste(high.crop((0, 0, pad, raster_height)), (pad + raster_width, 0))
    mask = periodic.resize((width + 8, height), Image.Resampling.LANCZOS).crop((4, 0, width + 4, height))

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "earth-land-mask.png"
    mask.save(output, format="PNG", optimize=True, compress_level=9)
    if output.stat().st_size > 500_000:
        raise RuntimeError("Display coastline exceeded the intended 500 KB transfer budget.")
    histogram = mask.histogram()
    metadata = {
        "title": "Natural Earth antialiased display land mask",
        "credit": "Made with Natural Earth.",
        "purpose": "High-resolution display coastline for the globe renderer, not a change to the scientific data resolution or support mask.",
        "license": "Public domain",
        "licenseUrl": TERMS_URL,
        "sourcePage": LAND_PAGE,
        "source": {
            "file": "assets/data/ne_50m_land.geojson",
            "url": LAND_URL,
            "commit": LAND_COMMIT,
            "sha256": LAND_SHA256,
            "scale": "1:50m",
            "features": len(geojson["features"]),
            "polygons": polygon_count,
            "holes": hole_count,
            "maximumRingLongitudeStepDegrees": max_jump,
        },
        "georeferencing": {
            "projection": "Geographic / equirectangular",
            "datum": "WGS84",
            "bounds": {"west": -180, "east": 180, "north": 90, "south": -90},
            "orientation": "North at top; west-to-east columns; north-to-south rows; same registration as earth-terrain.webp.",
            "pixelSampling": "Pixel centers; latitude = 90 - (y + 0.5) * 180 / height; longitude = -180 + (x + 0.5) * 360 / width.",
        },
        "encoding": {
            "format": "PNG",
            "mode": "L",
            "bitsPerPixel": 8,
            "ocean": 0,
            "land": 255,
            "intermediate": "Antialiased display coverage at geographic boundaries; not a scientific confidence or fraction variable.",
        },
        "processing": {
            "script": "scripts/prepare_land_mask.py",
            "pillowVersion": PIL.__version__,
            "supersample": supersample,
            "rasterDimensions": [raster_width, raster_height],
            "resampling": "Lanczos downsampling with periodic horizontal padding",
            "polygons": "Union of source polygons, with holes removed within each polygon; source date-line and polar geometry retained.",
            "newGeometry": False,
        },
        "output": {
            "filename": output.name,
            "width": width,
            "height": height,
            "bytes": output.stat().st_size,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "landPixels": histogram[255],
            "oceanPixels": histogram[0],
            "edgePixels": sum(histogram[1:255]),
        },
        "displayNotes": [
            "Use as a rendering coastline only; do not use this mask to redefine or remove CarbonGlobe source cells.",
            "Original ED data exports and the Original dots view retain all source cells, including coastal cells outside this cartographic outline.",
            "Higher raster dimensions improve display edges; the scientific dataset remains on its original 0.5-degree grid.",
            "Only holes present in the pinned land polygons are removed; this is not a comprehensive separate inland-water dataset.",
        ],
    }
    (output_dir / "earth-land-mask.attribution.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (output_dir / "LAND_MASK_ATTRIBUTION.txt").write_text(
        "Made with Natural Earth.\n"
        "Natural Earth 1:50m land polygons; public domain.\n"
        f"Source: {LAND_URL}\n"
        f"Source SHA-256: {LAND_SHA256}\n"
        f"Official page: {LAND_PAGE}\n"
        f"Terms of use: {TERMS_URL}\n"
        f"Derivative: {output.name}, {width} x {height}, grayscale PNG.\n"
        f"Derivative SHA-256: {metadata['output']['sha256']}\n"
        f"Preparation: polygon/holes union at {supersample}x resolution; periodic longitude padding; Lanczos downsampling.\n"
        "Encoding: 0 = ocean; 255 = land; intermediate values antialias cartographic boundaries.\n"
        "North-up equirectangular WGS84; west -180, east 180, north 90, south -90.\n"
        "This mask is for display only and does not increase scientific resolution, alter ED values, or remove original coastal samples.\n"
        "Source polygon holes are retained; additional inland-water geometry is not synthesized.\n"
        "Regenerate with scripts/prepare_land_mask.py (Pillow required).\n",
        encoding="utf-8",
    )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=LAND_FILE)
    parser.add_argument("--output-dir", type=Path, default=WEBSITE_DIR / "assets" / "textures")
    parser.add_argument("--width", type=int, choices=[2048, 4096], default=4096)
    parser.add_argument("--supersample", type=int, choices=[2, 4], default=2)
    args = parser.parse_args()
    metadata = prepare(args.source.resolve(), args.output_dir.resolve(), args.width, args.supersample)
    print(json.dumps({"path": str(args.output_dir.resolve() / metadata['output']['filename']), **metadata['output']}, indent=2))


if __name__ == "__main__":
    main()
