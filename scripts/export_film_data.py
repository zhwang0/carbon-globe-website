#!/usr/bin/env python3
"""Export original ED reference trajectories for the CarbonGlobe film.

Run from the project root:
  .tools/venv/bin/python website/scripts/export_film_data.py
Or supply --source /path/to/original/datasets. Requires NumPy; no network.
Large source arrays are opened as read-only memory maps. Only the selected
cells and variables are copied into memory. No SSP/competition data is used.
"""

import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = SITE_ROOT.parent / "sources" / "datasets"
OUTPUT = SITE_ROOT / "assets" / "data" / "film-growth.json"
COMMIT = "a99036367b76a2a7c738bc0e8530a5e57415c2dc"
PROFILE_AGES = (1, 10, 50)
ALL_AGES = (1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500)
PROFILE_ANCHORS = (
    ("congo", "Congo Basin", "Central Africa", -1, 23),
    ("eastern-us", "Eastern United States", "Appalachian Mountains", 38, -80),
    ("boreal", "Central Finland", "Northern Europe", 63, 26),
)
VARIABLES = (
    {"id": "height", "sourceIndex": 0, "unit": "m", "label": "Canopy height"},
    {"id": "agb", "sourceIndex": 1, "unit": "kg C m⁻²", "label": "Aboveground biomass"},
    {"id": "lai", "sourceIndex": 3, "unit": "m² m⁻²", "label": "Leaf area index"},
)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def array_hash(values):
    """Hash only the selected physical values, as C-order little-endian f32."""
    return hashlib.sha256(np.asarray(values, dtype="<f4").tobytes(order="C")).hexdigest()


def rounded(values, precision=6):
    return np.round(np.asarray(values, dtype=np.float64), precision).tolist()


def file_description(source, relative, values):
    return {
        "file": relative,
        "bytes": (source / relative).stat().st_size,
        "shape": list(values.shape),
        "dtype": str(values.dtype),
    }


def encode_field(values):
    values = np.asarray(values, dtype=np.float64)
    if not np.isfinite(values).all() or values.min() < 0 or values.max() >= 655.345:
        raise ValueError("Selected values do not fit the nonnegative uint16 encoding")
    quantized = np.rint(values / 0.01).astype("<u2")
    error = float(np.max(np.abs(quantized.astype(np.float64) * 0.01 - values)))
    if error > 0.0050001 or np.any(quantized == 65535):
        raise ValueError("Quantization validation failed")
    return base64.b64encode(quantized.tobytes(order="C")).decode("ascii"), error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    source = parser.parse_args().source.expanduser().resolve()
    mask = np.load(source / "data_stats/mask2d.npy", allow_pickle=False)
    if mask.shape != (360, 720):
        raise ValueError(f"Unexpected source mask shape: {mask.shape}")
    rows, cols = np.nonzero(mask > 0)
    if len(rows) != 54152:
        raise ValueError("Unexpected source site count")
    lat, lon = 89.75 - rows * 0.5, -179.75 + cols * 0.5
    sampled = np.flatnonzero((rows % 4 == 0) & (cols % 4 == 0))
    test = (rows % 8 == 2) & (cols % 8 == 2)
    with np.load(source / "data_stats/site_lat.npz", allow_pickle=False) as stored:
        np.testing.assert_array_equal(lat[sampled], stored["train_lat"])
        np.testing.assert_array_equal(lat[test], stored["test_lat"])
    if len(sampled) != 3373:
        raise ValueError("Unexpected film sample size")
    with np.load(source / "data_stats/age_triplet.npz", allow_pickle=False) as stored:
        np.testing.assert_array_equal(stored["age"], ALL_AGES)

    profiles = []
    for site_id, label, region, target_lat, target_lon in PROFILE_ANCHORS:
        distance = (lat - target_lat) ** 2 + (
            (lon - target_lon) * np.cos(np.radians(target_lat))
        ) ** 2
        index = int(np.argmin(distance))
        profiles.append({
            "id": site_id, "label": label, "region": region,
            "sourceIndex": index, "lat": float(lat[index]), "lon": float(lon[index]),
            "trajectories": {},
        })
    profile_indices = [site["sourceIndex"] for site in profiles]
    sources, selections, quantization_errors = [], [], {}
    global_data = {
        "sites": [[float(lat[i]), float(lon[i]), int(i)] for i in sampled],
    }
    ranges = {}
    for age in PROFILE_AGES:
        relative = f"data_global/glob_Y{age:03d}.npy"
        values = np.load(source / relative, mmap_mode="r", allow_pickle=False)
        if values.shape != (54152, 41, 12, 7) or values.dtype != np.dtype("float32"):
            raise ValueError(f"Unexpected output array: {relative}")
        sources.append(file_description(source, relative, values))
        selected_profiles = values[profile_indices, :, 11, :][:, :, [0, 1, 3]]
        if not np.isfinite(selected_profiles).all():
            raise ValueError("Nonfinite profile state")
        for site, selected in zip(profiles, selected_profiles):
            site["trajectories"][str(age)] = {
                variable["id"]: rounded(selected[:, i])
                for i, variable in enumerate(VARIABLES)
            }
        selections.append({
            "file": relative,
            "selection": "[profileSourceIndices, all 41 years, month 11, variables [0,1,3]]",
            "shape": list(selected_profiles.shape),
            "sha256": array_hash(selected_profiles),
        })
        if age == 1:
            selected_global = values[sampled, :, 11, :2]
            selections.append({
                "file": relative,
                "selection": "[sampleSourceIndices, all 41 years, month 11, variables [0,1]]",
                "shape": list(selected_global.shape),
                "sha256": array_hash(selected_global),
            })
            for i, field in enumerate(("height", "agb")):
                selected = selected_global[:, :, i]
                global_data[field], quantization_errors[field] = encode_field(selected)
                ranges[field] = {"min": float(selected.min()), "max": float(selected.max())}

    relative = "data_global/glob_X_fea.npy"
    inputs = np.load(source / relative, mmap_mode="r", allow_pickle=False)
    if inputs.shape != (54152, 40, 12, 136) or inputs.dtype != np.dtype("float32"):
        raise ValueError("Unexpected input array")
    sources.append(file_description(source, relative, inputs))
    # Table 2 gives ta_m, pr, six soil temperatures, then 24 hourly CO2
    # features. Upstream shapeCO2 preserves the 24-feature block; shapeCLM
    # preserves its climate channels. Raw value ranges corroborate the blocks.
    climate_indices = [0, 1, *range(8, 32)]
    selected_climate = inputs[profile_indices][:, :, :, climate_indices]
    if not np.isfinite(selected_climate).all():
        raise ValueError("Nonfinite forcing values")
    selections.append({
        "file": relative,
        "selection": "[profileSourceIndices, all 40 forcing years, all 12 months, features [0,1,8:32]]",
        "shape": list(selected_climate.shape),
        "sha256": array_hash(selected_climate),
    })
    for site, climate in zip(profiles, selected_climate.astype(np.float64)):
        temperature = climate[:, :, 0].mean(axis=1) - 273.15
        precipitation = climate[:, :, 1].sum(axis=1)
        co2 = climate[:, :, 2:].mean(axis=(1, 2))
        if not (-60 < temperature.min() <= temperature.max() < 60):
            raise ValueError("Unexpected temperature range")
        if precipitation.min() < 0 or not (200 < co2.min() <= co2.max() < 600):
            raise ValueError("Unexpected precipitation or CO2 range")
        site["climate"] = {
            "years": list(range(1, 41)),
            "temperatureC": rounded(temperature, 3),
            "precipitationMm": rounded(precipitation, 3),
            "co2Ppm": rounded(co2, 3),
        }

    result = {
        "meta": {
            "schemaVersion": 1,
            "source": "Original published CarbonGlobe Ecosystem Demography (ED) reference simulations",
            "sourceType": "Process-based simulation outputs, not observations or AI emulator predictions",
            "sourceRepository": "https://github.com/zhwang0/carbon-globe",
            "sourceCommit": COMMIT,
            "paper": "assets/paper.pdf",
            "paperEvidence": "Published paper pages 5–7 and Table 2 on page 24",
            "years": list(range(41)),
            "initialAges": list(ALL_AGES),
            "globalInitialAge": 1,
            "profileInitialAges": list(PROFILE_AGES),
            "sampleCount": len(sampled),
            "siteColumns": ["lat", "lon", "sourceIndex"],
            "variables": list(VARIABLES),
            "encoding": "base64 little-endian uint16",
            "scale": 0.01,
            "offset": 0,
            "nodata": 65535,
            "order": "site-major then year; index = siteIndex * 41 + simulationYear",
            "globalShape": [len(sampled), 41],
            "globalRawRanges": ranges,
            "maximumAbsoluteQuantizationError": quantization_errors,
            "quantization": "Physical value = encoded * 0.01; all selected values are finite and nonnegative, no clipping or nodata values were introduced",
            "sampling": "Every fourth row and column of original 0.5-degree mask; 3,373 original cells at 2-degree spacing where available, no spatial interpolation or averaging",
            "annualSelection": "December record (month index 11) of each target year 0–40; year 0 is the initial state and years 1–40 are successive reference states",
            "coordinates": "C-order nonzero mask cells; latitude = 89.75 - row * 0.5; longitude = -179.75 + column * 0.5",
            "coordinateValidation": "Latitude and compressed source order match every supplied training/test latitude; longitude follows inferred standard west-to-east cell centers, corroborated by geographic land overlap",
            "profileSelection": "Nearest original land cells to three illustrative anchors; these are single-cell examples, not regional means or in-situ stations",
            "profilePrecision": "Six decimals for states; three decimals for annual forcing summaries",
            "initialAgeMeaning": "Separate ED simulations initialized at different forest ages. These do not provide individual-tree ages, detailed ED cohort structure, tree positions, or measured tree geometry",
            "seasonality": "December LAI is a seasonal snapshot; small northern winter values must not be interpreted as year-round canopy density",
            "climate": {
                "source": "Raw physical values in glob_X_fea.npy, shared environmental forcing across initial-age simulations",
                "featureMapping": {"temperatureC": [0], "precipitationMm": [1], "co2Ppm": list(range(8, 32))},
                "mappingEvidence": "Paper Table 2 ordering/counts and upstream preprocessing shapeCLM/shapeCO2; raw numerical blocks agree with their physical units",
                "preprocessingCode": f"https://github.com/zhwang0/carbon-globe/blob/{COMMIT}/LSTM-LSTNet-DeepED/utils/preprocess.py",
                "temperatureC": "Arithmetic mean of 12 monthly mean air temperatures, converted from K by subtracting 273.15; months have equal weight",
                "precipitationMm": "Sum of 12 monthly precipitation totals, in mm",
                "co2Ppm": "Arithmetic mean over 12 months and 24 hourly-average CO2 features, in ppm; months and hours have equal weight",
                "yearAlignment": "Forcing array indices 0–39 are labeled transition years 1–40; there is no exported forcing year 0",
                "calendar": "Simulation indices only; the paper describes a historical 1981–2021 experiment. No independently verified calendar alignment is asserted for these forcing summaries",
                "interpretation": "Drivers provide context for the paired simulation, not causal attribution, isolated climate responses, observations, or future/counterfactual scenario results",
            },
            "verifiedDatasetNumbers": {
                "sites": 54152, "initialAges": 15, "siteAgeSequences": 812280,
                "rolloutYears": 40, "inputFeatures": 136, "targetVariables": 7,
                "benchmarkModels": 8,
            },
            "benchmarkModels": ["LSTM", "LSTNet", "DeepED", "Transformer", "Informer", "DLinear", "Crossformer", "TimeXer"],
            "scope": "Original published dataset only; no SSP126/585, competition scenarios, fitted emulator results, or generated future trajectories",
            "animation": "A conceptual forest illustration may interpolate between annual states for display. Its tree geometry, continuous motion, global point sizes, and neural-network graphics are illustrative; they are not additional scientific outputs",
            "sourceFiles": sources,
            "selectedValueHashes": selections,
            "selectedHashEncoding": "SHA-256 of selected raw float32 values in little-endian C order, before rounding or quantization; avoids reading entire multi-GB source files",
            "profileSourceIndices": profile_indices,
            "supportingFileHashes": {
                name: sha256_file(source / name)
                for name in ("data_stats/mask2d.npy", "data_stats/site_lat.npz", "data_stats/age_triplet.npz")
            },
        },
        "global": global_data,
        "profiles": profiles,
    }
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    if len(encoded.encode("utf-8")) > 3_000_000:
        raise ValueError("Film export exceeds the 3 MB budget")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(encoded, encoding="utf-8")
    print(f"Exported {len(sampled):,} original sites × 41 states × 2 fields")
    print(f"Profiles: {', '.join(site['id'] for site in profiles)}; initial ages {PROFILE_AGES}")
    print(f"Quantization maximum absolute error: {quantization_errors}")
    print(f"{OUTPUT.relative_to(SITE_ROOT)}: {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
