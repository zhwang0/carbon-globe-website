#!/usr/bin/env python3
"""Export the original ED grid with conservative land-only display interpolation.

Requires NumPy. Example, from a standalone website checkout:
python scripts/export_globe_surface.py --source /path/to/CarbonGlobe/datasets
The pinned Natural Earth source is downloaded only when absent.
"""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.request

import numpy as np


SITE = Path(__file__).resolve().parents[1]
DATA = SITE / "assets" / "data"
LAND_FILE = DATA / "ne_50m_land.geojson"
LAND_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19"
LAND_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{LAND_COMMIT}/geojson/ne_50m_land.geojson"
LAND_SHA256 = "e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b"
WIDTH, HEIGHT, STEP = 720, 360, 0.5
LATS = 89.75 - np.arange(HEIGHT) * STEP
LONS = -179.75 + np.arange(WIDTH) * STEP
RADIUS = 2.0
SCALE = 0.01
NODATA = 65535


def rasterize_land(geojson):
    """Even-odd polygon intersection at exact grid cell centers, including holes."""
    land = np.zeros((HEIGHT, WIDTH), dtype=bool)
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for rings in polygons:
            coordinates = np.concatenate([np.asarray(ring, dtype=float) for ring in rings])
            active_rows = np.flatnonzero((LATS >= coordinates[:, 1].min()) & (LATS <= coordinates[:, 1].max()))
            for row in active_rows:
                intersections = []
                for ring in rings:
                    points = np.asarray(ring, dtype=float)
                    start, end = points[:-1], points[1:]
                    crosses = (start[:, 1] > LATS[row]) != (end[:, 1] > LATS[row])
                    a, b = start[crosses], end[crosses]
                    intersections.extend((a[:, 0] + (LATS[row] - a[:, 1]) * (b[:, 0] - a[:, 0]) / (b[:, 1] - a[:, 1])).tolist())
                intersections.sort()
                if len(intersections) % 2:
                    raise ValueError("Unpaired polygon scanline intersections")
                for left, right in zip(intersections[::2], intersections[1::2]):
                    lo = np.searchsorted(LONS, left, side="left")
                    hi = np.searchsorted(LONS, right, side="right")
                    land[row, lo:hi] = True
    return land


def land_path(land, row, col, other_row, other_col):
    """Reject neighbors separated by ocean at this raster's spatial resolution."""
    delta_col = (int(other_col) - int(col) + WIDTH // 2) % WIDTH - WIDTH // 2
    delta_row = int(other_row) - int(row)
    steps = max(abs(delta_col), abs(delta_row)) * 2 + 1
    positions = np.linspace(0, 1, steps)
    rr = np.rint(row + positions * delta_row).astype(int)
    cc = np.rint(col + positions * delta_col).astype(int) % WIDTH
    return bool(np.all(land[rr, cc]))


def interpolate(land, original, raw):
    """Four original neighbors, spherical 2-degree cap, land path, surrounding support."""
    supported = original & land
    source_rows, source_cols = np.nonzero(supported)
    source_lat = np.radians(LATS[source_rows])
    source_lon = np.radians(LONS[source_cols])
    values = np.full((HEIGHT, WIDTH, 2), np.nan, dtype=np.float64)
    values[original] = raw
    filled = np.zeros((HEIGHT, WIDTH), dtype=bool)
    donor_distances = []
    max_row_delta = int(np.ceil(RADIUS / STEP))
    candidates_by_row = [np.flatnonzero(abs(source_rows - row) <= max_row_delta) for row in range(HEIGHT)]
    for row, col in zip(*np.nonzero(land & ~original)):
        candidates = candidates_by_row[row]
        if len(candidates) < 4:
            continue
        phi, lam = np.radians(LATS[row]), np.radians(LONS[col])
        dphi = source_lat[candidates] - phi
        dlam = (source_lon[candidates] - lam + np.pi) % (2 * np.pi) - np.pi
        haversine = np.sin(dphi / 2) ** 2 + np.cos(phi) * np.cos(source_lat[candidates]) * np.sin(dlam / 2) ** 2
        distance = np.degrees(2 * np.arcsin(np.sqrt(np.clip(haversine, 0, 1))))
        near = np.flatnonzero(distance <= RADIUS + 1e-10)
        if len(near) < 4:
            continue
        chosen = []
        for candidate in near[np.argsort(distance[near])]:
            idx = candidates[candidate]
            if land_path(land, row, col, source_rows[idx], source_cols[idx]):
                chosen.append(candidate)
                if len(chosen) == 4:
                    break
        if len(chosen) != 4:
            continue
        chosen = np.asarray(chosen)
        # A gap must have donors around it. Reject one-sided extrapolation into
        # unsupported interiors (for example deserts) even inside the radius.
        bearings = np.sort(np.arctan2(dphi[chosen], dlam[chosen] * np.cos(phi)))
        gaps = np.diff(np.r_[bearings, bearings[0] + 2 * np.pi])
        if np.max(gaps) > np.pi + 1e-10:
            continue
        indexes = candidates[chosen]
        weights = 1 / np.maximum(distance[chosen], 1e-12) ** 2
        weights /= weights.sum()
        donors = values[source_rows[indexes], source_cols[indexes]]
        values[row, col] = np.sum(donors * weights[:, None], axis=0)
        assert np.all(values[row, col] >= donors.min(axis=0) - 1e-10)
        assert np.all(values[row, col] <= donors.max(axis=0) + 1e-10)
        filled[row, col] = True
        donor_distances.extend(distance[chosen].tolist())
    return values, filled, max(donor_distances, default=0.0)


def encode(values, valid):
    quantized = np.full((HEIGHT, WIDTH), NODATA, dtype="<u2")
    rounded = np.rint(values[valid] / SCALE)
    if np.any(rounded < 0) or np.any(rounded >= NODATA):
        raise ValueError("Quantization range exceeded; adjust scale/offset explicitly")
    quantized[valid] = rounded.astype("<u2")
    max_error = float(np.max(abs(quantized[valid].astype(float) * SCALE - values[valid])))
    assert max_error <= SCALE / 2 + 1e-10
    return base64.b64encode(quantized.tobytes(order="C")).decode("ascii"), max_error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SITE.parent / "sources" / "datasets")
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    DATA.mkdir(parents=True, exist_ok=True)
    if not LAND_FILE.exists():
        LAND_FILE.write_bytes(urllib.request.urlopen(LAND_URL, timeout=60).read())
    land_bytes = LAND_FILE.read_bytes()
    if hashlib.sha256(land_bytes).hexdigest() != LAND_SHA256:
        raise ValueError("Natural Earth source differs from the reviewed pinned file")
    land = rasterize_land(json.loads(land_bytes))
    original = np.load(source / "data_stats" / "mask2d.npy", allow_pickle=False) > 0
    if original.shape != (HEIGHT, WIDTH) or np.count_nonzero(original) != 54152:
        raise ValueError("Unexpected original CarbonGlobe grid")
    targets = np.load(source / "data_global" / "glob_Y010.npy", mmap_mode="r", allow_pickle=False)
    if targets.shape != (54152, 41, 12, 7):
        raise ValueError("Unexpected target array shape")
    raw = np.asarray(targets[:, 40, 11, :2], dtype=np.float64)
    if not np.isfinite(raw).all():
        raise ValueError("Nonfinite original values")
    rows, cols = np.nonzero(original)
    with np.load(source / "data_stats" / "site_lat.npz", allow_pickle=False) as stored:
        np.testing.assert_array_equal(LATS[rows[(rows % 4 == 0) & (cols % 4 == 0)]], stored["train_lat"])
        np.testing.assert_array_equal(LATS[rows[(rows % 8 == 2) & (cols % 8 == 2)]], stored["test_lat"])
    values, filled, maximum_distance = interpolate(land, original, raw)
    np.testing.assert_array_equal(values[original], raw)
    assert not np.any(filled & ~land)
    assert not np.any(filled & original)
    valid = original | filled
    mask = np.zeros((HEIGHT, WIDTH), dtype="u1")
    mask[land] = 1
    mask[original] = 2
    mask[filled] = 3
    height, height_error = encode(values[:, :, 0], valid)
    agb, agb_error = encode(values[:, :, 1], valid)
    counts = {
        "rawCells": int(original.sum()), "interpolatedCells": int(filled.sum()),
        "unsupportedLandCells": int(np.count_nonzero(mask == 1)),
        "oceanCells": int(np.count_nonzero(mask == 0)),
        "naturalEarthLandCells": int(land.sum()),
        "rawOutsideLandMask": int(np.count_nonzero(original & ~land)),
    }
    result = {
        "meta": {
            "width": WIDTH, "height": HEIGHT,
            "grid": {"north": 90, "west": -180, "step": STEP, "cellCenters": True},
            "seedAge": 10, "year": 40, "monthIndex": 11,
            "encoding": "base64 little-endian uint16", "scale": SCALE, "offset": 0,
            "decode": "physical value = encoded uint16 * scale + offset; 65535 means no data",
            "nodata": NODATA, "order": "C order; north-to-south rows; west-to-east columns",
            "units": {"agb": "kg C m⁻²", "height": "m"},
            "maskEncoding": "base64 uint8",
            "maskLegend": {"0": "ocean", "1": "unsupported land", "2": "original ED cell", "3": "interpolated land"},
            "source": "Original CarbonGlobe ED simulations, glob_Y010.npy[:,40,11,:2]",
            "sourceRepository": "https://github.com/zhwang0/carbon-globe",
            "coordinates": "latitude=89.75-row*0.5; longitude=-179.75+column*0.5; source C-order mask; 4225 supplied latitudes verified",
            "longitudeConvention": "Standard west-to-east cell centers inferred from the global grid; no explicit longitude vector is bundled",
            "interpolation": {
                "method": "Inverse squared great-circle distance from four original source cells",
                "maximumDistanceDegrees": RADIUS,
                "observedMaximumDonorDistanceDegrees": maximum_distance,
                "restriction": "Target and all donors must lie on Natural Earth land; sampled direct paths may not cross ocean; donors must surround target (no bearing gap >180 degrees)",
                "purpose": "Visualization only; original cells retained; unsupported land remains nodata; no recursive filling or extrapolation across large gaps",
            },
            "coastlinePolicy": "Original ED cells are retained even when their centers fall outside Natural Earth land; these cells never seed interpolation",
            "land": {"name": "Natural Earth 1:50m land", "source": LAND_URL,
                "commit": LAND_COMMIT, "sha256": hashlib.sha256(land_bytes).hexdigest(),
                "officialPage": "https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/",
                "license": "Public domain", "licenseUrl": "https://www.naturalearthdata.com/about/terms-of-use/",
                "rasterization": "Even-odd polygon intersection at exact 0.5-degree cell centers, including polygon holes"},
            "counts": counts,
            "maximumQuantizationError": {"agb": agb_error, "height": height_error},
            "display": "Physical values are not color-clipped in this asset; renderers may apply their own color scales. Interpolated cells are distinct from ED reference outputs.",
        },
        "agb": agb, "height": height,
        "mask": base64.b64encode(mask.tobytes(order="C")).decode("ascii"),
    }
    output = DATA / "globe-surface.json"
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(counts, indent=2))
    print(f"Maximum interpolation donor distance: {maximum_distance:.6f} degrees")
    print(f"Surface export: {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
