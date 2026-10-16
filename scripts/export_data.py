#!/usr/bin/env python3
"""Export compact website data from original CarbonGlobe ED simulations.

Run from the project root: .tools/venv/bin/python website/scripts/export_data.py
Requires NumPy. Source arrays are read-only memory maps; no network is used.
"""

from pathlib import Path
import argparse
import json

import numpy as np


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = SITE_ROOT.parent / "sources" / "datasets"
OUTPUT = SITE_ROOT / "assets" / "data" / "carbon-globe.json"
AGES = (1, 10, 50, 100)
VARIABLES = [
    {"id": "height", "label": "Canopy height", "unit": "m"},
    {"id": "agb", "label": "Aboveground biomass", "unit": "kg C m⁻²"},
    {"id": "soil", "label": "Soil carbon", "unit": "kg C m⁻²"},
    {"id": "lai", "label": "Leaf area index", "unit": "m² m⁻²"},
    {"id": "gpp", "label": "Gross primary production", "unit": "kg C m⁻²"},
    {"id": "npp", "label": "Net primary production", "unit": "kg C m⁻²"},
    {"id": "rh", "label": "Heterotrophic respiration", "unit": "kg C m⁻²"},
]
REGIONS = [
    ("amazon", "Amazon Basin", "South America", -3, -60),
    ("congo", "Congo Basin", "Africa", -1, 23),
    ("pacific-northwest", "Pacific Northwest", "North America", 45, -123),
    ("central-europe", "Central Europe", "Europe", 48, 12),
    ("southeast-asia", "Southeast Asia", "Asia", 16, 102),
    ("eastern-australia", "Eastern Australia", "Oceania", -33, 150),
]


def rounded(values, precision):
    """Round for browser transfer without exposing float32 serialization noise."""
    return np.round(np.asarray(values, dtype=np.float64), precision).tolist()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_SOURCE,
        help="Original dataset directory containing data_global/ and data_stats/",
    )
    source = parser.parse_args().source.expanduser().resolve()
    mask = np.load(source / "data_stats" / "mask2d.npy", allow_pickle=False)
    if mask.shape != (360, 720):
        raise ValueError(f"Unexpected mask shape: {mask.shape}")
    rows, cols = np.nonzero(mask > 0)
    if len(rows) != 54152:
        raise ValueError("Unexpected number of global land sites")
    lat = 89.75 - rows * 0.5
    lon = -179.75 + cols * 0.5

    # Upstream generateTrainTestGrid(mask, 4, 8) and local site_lat.npz
    # independently validate north-to-south orientation and compressed order.
    train = (rows % 4 == 0) & (cols % 4 == 0)
    test = (rows % 8 == 2) & (cols % 8 == 2)
    with np.load(source / "data_stats" / "site_lat.npz", allow_pickle=False) as stored:
        np.testing.assert_array_equal(lat[train], stored["train_lat"])
        np.testing.assert_array_equal(lat[test], stored["test_lat"])

    sites = []
    for site_id, label, region, target_lat, target_lon in REGIONS:
        distance = (lat - target_lat) ** 2 + (
            (lon - target_lon) * np.cos(np.radians(target_lat))
        ) ** 2
        index = int(np.argmin(distance))
        sites.append({
            "id": site_id,
            "label": label,
            "region": region,
            "sourceIndex": index,
            "lat": float(lat[index]),
            "lon": float(lon[index]),
            "trajectories": {},
        })

    # A 1-degree display sample of the original 0.5-degree cells: no averaging.
    sampled = np.flatnonzero((rows % 2 == 0) & (cols % 2 == 0))
    points = None
    for age in AGES:
        values = np.load(
            source / "data_global" / f"glob_Y{age:03d}.npy",
            mmap_mode="r", allow_pickle=False,
        )
        if values.shape != (54152, 41, 12, 7):
            raise ValueError(f"Unexpected target shape for age {age}: {values.shape}")
        for site in sites:
            annual = values[site["sourceIndex"], :, 11, :]
            if not np.isfinite(annual).all():
                raise ValueError(f"Nonfinite trajectory for {site['id']}, age {age}")
            site["trajectories"][str(age)] = {
                variable["id"]: rounded(annual[:, i], 6)
                for i, variable in enumerate(VARIABLES)
            }
        if age == 10:
            final = values[sampled, 40, 11, :2]
            if not np.isfinite(final).all():
                raise ValueError("Nonfinite map values")
            points = rounded(np.column_stack((
                lat[sampled], lon[sampled], final[:, 1], final[:, 0],
            )), 3)

    result = {
        "meta": {
            "source": "Original CarbonGlobe dataset: Ecosystem Demography (ED) simulations",
            "sourceType": "ED simulation reference outputs, not emulator predictions or observations",
            "sourceRepository": "https://github.com/zhwang0/carbon-globe",
            "sourceCommit": "a99036367b76a2a7c738bc0e8530a5e57415c2dc",
            "sourceFiles": [f"data_global/glob_Y{age:03d}.npy" for age in AGES],
            "seedAge": 10,
            "mapYear": 40,
            "years": list(range(41)),
            "ageOptions": list(AGES),
            "variables": VARIABLES,
            "annualSelection": "December record (month index 11) for simulation years 0–40, following the benchmark; no monthly summation or averaging",
            "fluxConvention": "Paper lists GPP, NPP, and Rh as annual targets in kg C m⁻²; this export preserves its December benchmark selection, not a new annual aggregation",
            "calendarConvention": "Simulation years are array indices 0–40; the paper describes the historical 1981–2021 period",
            "normalization": "Original stored physical values; no standardization or mean scaling",
            "gridResolutionDegrees": 0.5,
            "totalSites": len(rows),
            "sampledSites": len(sampled),
            "sampling": "Every second row and column of the original grid; original cell values, no spatial averaging",
            "coordinates": "C-order nonzero mask cells; latitude = 89.75 − row × 0.5; longitude = −179.75 + column × 0.5",
            "coordinateValidation": "All 3373 training and 852 test latitudes match site_lat.npz exactly; upstream preprocessing confirms C-order mask indexing. Longitude uses the standard west-to-east global cell-center convention; no explicit longitude vector is bundled",
            "trajectorySelection": "Nearest available land cell to six illustrative regional anchors; sites are examples, not regional averages",
            "precision": "Map values rounded to 3 decimal places; trajectories to 6 decimal places",
            "notes": "Small negative model outputs are retained; age is the seed forest age. See DATA_NOTES.md for provenance and interpretation",
        },
        "map": {"columns": ["lat", "lon", "agb", "height"], "points": points},
        "sites": sites,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    OUTPUT.write_text(encoded + "\n", encoding="utf-8")
    print(f"Exported {len(points):,} map points, {len(sites)} sites, {len(AGES)} ages, 7 variables")
    print(f"{OUTPUT.relative_to(SITE_ROOT)}: {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
