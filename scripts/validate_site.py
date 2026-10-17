"""Validate deployable pages and scientific data assets using the standard library."""
from html.parser import HTMLParser
from array import array
import base64
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import zlib
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path, self.ids, self.references = path, set(), []
        self.feed(path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate id: {self.path.name}#{attrs['id']}"
            self.ids.add(attrs["id"])
        for key in ("href", "src"):
            if key in attrs:
                self.references.append(attrs[key])


pages = {path.resolve(): Page(path) for path in ROOT.glob("*.html")}
references = 0


def check_reference(path, reference):
    link = urlsplit(reference)
    if link.scheme or link.netloc:
        return 0
    target = (path.parent / unquote(link.path)).resolve() if link.path else path
    assert target.is_relative_to(ROOT), f"Local link escapes website: {reference}"
    assert target.is_file(), f"Missing local target in {path.name}: {reference}"
    if link.fragment and target in pages:
        assert unquote(link.fragment) in pages[target].ids, f"Missing anchor: {reference}"
    return 1


for path, page in pages.items():
    for reference in page.references:
        references += check_reference(path, reference)

# Validate relative ES module imports, including locally vendored dependencies,
# and stylesheet assets without requiring a JavaScript runtime or package install.
for path in ROOT.rglob("*.js"):
    text = path.read_text(encoding="utf-8")
    module_links = re.findall(r"\bfrom\s*[\"'](\.{1,2}/[^\"']+)[\"']", text)
    module_links += re.findall(r"\bimport\s*(?:\(\s*)?[\"'](\.{1,2}/[^\"']+)[\"']", text)
    for reference in set(module_links):
        references += check_reference(path, reference)
for path in ROOT.rglob("*.css"):
    text = path.read_text(encoding="utf-8")
    for quoted, bare in re.findall(r"url\(\s*(?:[\"']([^\"']+)[\"']|([^\s)]+))\s*\)", text):
        references += check_reference(path, quoted or bare)

data = json.loads((ROOT / "assets/data/carbon-globe.json").read_text())
assert len(data["map"]["points"]) == data["meta"]["sampledSites"]
assert data["meta"]["totalSites"] == 54152
for lat, lon, agb, height in data["map"]["points"]:
    assert -90 <= lat <= 90 and -180 <= lon <= 180
    assert math.isfinite(agb) and math.isfinite(height)
variables = {v["id"] for v in data["meta"]["variables"]}
assert variables == {"height", "agb", "soil", "lai", "gpp", "npp", "rh"}
for site in data["sites"]:
    assert set(site["trajectories"]) == {str(age) for age in data["meta"]["ageOptions"]}
    for outputs in site["trajectories"].values():
        assert set(outputs) == variables
        for series in outputs.values():
            assert len(series) == 41 and all(math.isfinite(v) for v in series)

surface = json.loads((ROOT / "assets/data/globe-surface.json").read_text())
meta = surface["meta"]
assert (meta["width"], meta["height"]) == (720, 360)
assert meta["grid"] == {"north": 90, "west": -180, "step": 0.5, "cellCenters": True}
assert (meta["seedAge"], meta["year"], meta["monthIndex"]) == (10, 40, 11)
assert meta["encoding"] == "base64 little-endian uint16"
assert meta["maskEncoding"] == "base64 uint8"
assert (meta["scale"], meta["offset"], meta["nodata"]) == (0.01, 0, 65535)
cell_count = meta["width"] * meta["height"]
mask = base64.b64decode(surface["mask"], validate=True)
assert len(mask) == cell_count
counts = Counter(mask)
assert set(counts) == {0, 1, 2, 3}
for value, key in [(0, "oceanCells"), (1, "unsupportedLandCells"), (2, "rawCells"), (3, "interpolatedCells")]:
    assert counts[value] == meta["counts"][key], f"Surface count mismatch: {key}"
assert counts[2] == data["meta"]["totalSites"] == 54152
assert sum(counts.values()) == cell_count
assert meta["counts"]["naturalEarthLandCells"] == counts[1] + counts[2] + counts[3] - meta["counts"]["rawOutsideLandMask"]
assert 0 <= meta["counts"]["rawOutsideLandMask"] <= counts[2]
assert meta["interpolation"]["maximumDistanceDegrees"] == 2
assert 0 < meta["interpolation"]["observedMaximumDonorDistanceDegrees"] <= 2 + 1e-10
fields = {}
for variable in ("agb", "height"):
    decoded = base64.b64decode(surface[variable], validate=True)
    assert len(decoded) == cell_count * 2, f"Invalid {variable} surface byte length"
    values = array("H")
    values.frombytes(decoded)
    if sys.byteorder != "little":
        values.byteswap()
    assert len(values) == cell_count
    assert all((value == meta["nodata"]) == (provenance < 2) for value, provenance in zip(values, mask))
    assert 0 <= meta["maximumQuantizationError"][variable] <= 0.005 + 1e-10
    fields[variable] = values


def grid_index(lat, lon):
    row, col = round((89.75 - lat) / 0.5), round((lon + 179.75) / 0.5)
    assert 0 <= row < 360 and 0 <= col < 720
    assert abs(lat - (89.75 - row * 0.5)) < 1e-10
    assert abs(lon - (-179.75 + col * 0.5)) < 1e-10
    return row * 720 + col


# The existing point and trajectory assets provide independent rounded extracts
# for checking source locations and values without shipping raw NumPy arrays.
sampled_indexes = set()
for lat, lon, agb, height in data["map"]["points"]:
    index = grid_index(lat, lon)
    assert index not in sampled_indexes, "Duplicate map cell"
    sampled_indexes.add(index)
    assert mask[index] == 2, "An original point became interpolated or missing"
    for variable, expected in [("agb", agb), ("height", height)]:
        assert abs(fields[variable][index] * meta["scale"] - expected) <= 0.0055 + 1e-10
original_indexes = [i for i, provenance in enumerate(mask) if provenance == 2]
for site in data["sites"]:
    index = grid_index(site["lat"], site["lon"])
    assert original_indexes[site["sourceIndex"]] == index, "Compressed source site ordering changed"
    for variable in fields:
        expected = site["trajectories"]["10"][variable][40]
        assert abs(fields[variable][index] * meta["scale"] - expected) <= 0.0050005 + 1e-10
land_source = ROOT / "assets/data/ne_50m_land.geojson"
assert hashlib.sha256(land_source.read_bytes()).hexdigest() == meta["land"]["sha256"]
assert meta["land"]["license"] == "Public domain"
assert (ROOT / "assets/data/NATURAL_EARTH_ATTRIBUTION.txt").is_file()


def webp_dimensions(content):
    """Read dimensions from standard WebP chunks without an imaging library."""
    assert content[:4] == b"RIFF" and content[8:12] == b"WEBP", "Invalid WebP signature"
    assert int.from_bytes(content[4:8], "little") + 8 == len(content), "Invalid WebP container length"
    offset, dimensions = 12, []
    while offset < len(content):
        assert offset + 8 <= len(content), "Truncated WebP chunk header"
        kind = content[offset:offset + 4]
        size = int.from_bytes(content[offset + 4:offset + 8], "little")
        payload = content[offset + 8:offset + 8 + size]
        assert len(payload) == size, "Truncated WebP chunk"
        if kind == b"VP8 ":
            assert len(payload) >= 10 and payload[3:6] == b"\x9d\x01\x2a", "Invalid VP8 frame header"
            dimensions.append((int.from_bytes(payload[6:8], "little") & 0x3fff,
                               int.from_bytes(payload[8:10], "little") & 0x3fff))
        elif kind == b"VP8L":
            assert len(payload) >= 5 and payload[0] == 0x2f, "Invalid VP8L header"
            packed = int.from_bytes(payload[1:5], "little")
            dimensions.append(((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1))
        elif kind == b"VP8X":
            assert len(payload) >= 10, "Invalid VP8X header"
            dimensions.append((int.from_bytes(payload[4:7], "little") + 1,
                               int.from_bytes(payload[7:10], "little") + 1))
        assert kind != b"ANIM", "Terrain texture must be a static image"
        offset += 8 + size + (size % 2)
    assert offset == len(content) and dimensions, "Incomplete WebP image"
    assert len(set(dimensions)) == 1, "Conflicting WebP dimensions"
    return dimensions[0]


terrain_dir = ROOT / "assets/textures"
terrain_metadata = json.loads((terrain_dir / "earth-terrain.attribution.json").read_text())
terrain_output = terrain_metadata["output"]
assert terrain_output["filename"] == "earth-terrain.webp"
terrain_content = (terrain_dir / terrain_output["filename"]).read_bytes()
assert webp_dimensions(terrain_content) == (terrain_output["width"], terrain_output["height"]) == (4096, 2048)
assert len(terrain_content) == terrain_output["bytes"] < 1_000_000
assert hashlib.sha256(terrain_content).hexdigest() == terrain_output["sha256"]
assert terrain_metadata["title"] == "Natural Earth I with Shaded Relief"
assert terrain_metadata["version"] == "3.2.0" and terrain_metadata["scale"] == "1:50m"
assert terrain_metadata["license"] == "Public domain"
assert terrain_metadata["licenseUrl"] == "https://www.naturalearthdata.com/about/terms-of-use/"
assert terrain_metadata["downloadUrl"] == "https://naturalearth.s3.amazonaws.com/50m_raster/NE1_50M_SR.zip"
assert terrain_metadata["sourceArchive"]["sha256"] == "ae930744c0cf3d10e73c292726b74c81a40490a75829f8299dec9069e5d0e934"
assert (terrain_metadata["sourceRaster"]["width"], terrain_metadata["sourceRaster"]["height"]) == (10800, 5400)
world_file = terrain_metadata["sourceRaster"]["worldFileValues"]
assert len(world_file) == 6
assert all(abs(a - b) < 1e-10 for a, b in zip(world_file, [1/30, 0, 0, -1/30, -180 + 1/60, 90 - 1/60]))
assert terrain_metadata["georeferencing"]["datum"] == "WGS84"
assert terrain_metadata["georeferencing"]["bounds"] == {"west": -180, "east": 180, "north": 90, "south": -90}
assert isinstance(terrain_metadata["processing"]["colorAdjustment"], (str, dict))
assert terrain_metadata["processing"]["colorAdjustment"], "Terrain display adjustment must be documented"
assert (ROOT / terrain_metadata["processing"]["script"]).is_file()
assert (terrain_dir / "ATTRIBUTION.txt").is_file()
assert "terrain-background" in pages[(ROOT / "data-notes.html").resolve()].ids


def grayscale_png_dimensions(content):
    """Validate a PNG's grayscale IHDR using only the standard library."""
    assert len(content) >= 33 and content[:8] == b"\x89PNG\r\n\x1a\n", "Invalid PNG signature"
    assert int.from_bytes(content[8:12], "big") == 13 and content[12:16] == b"IHDR", "Invalid PNG IHDR"
    assert zlib.crc32(content[12:29]) & 0xffffffff == int.from_bytes(content[29:33], "big"), "Invalid PNG header checksum"
    assert content[24:29] == bytes([8, 0, 0, 0, 0]), "Display land mask must be 8-bit grayscale, non-interlaced PNG"
    return int.from_bytes(content[16:20], "big"), int.from_bytes(content[20:24], "big")


display_mask_meta = json.loads((terrain_dir / "earth-land-mask.attribution.json").read_text())
display_mask_output = display_mask_meta["output"]
assert display_mask_output["filename"] == "earth-land-mask.png"
display_mask_content = (terrain_dir / display_mask_output["filename"]).read_bytes()
assert grayscale_png_dimensions(display_mask_content) == (display_mask_output["width"], display_mask_output["height"]) == (4096, 2048)
assert len(display_mask_content) == display_mask_output["bytes"] < 500_000
assert hashlib.sha256(display_mask_content).hexdigest() == display_mask_output["sha256"]
assert display_mask_meta["license"] == "Public domain"
assert display_mask_meta["licenseUrl"] == terrain_metadata["licenseUrl"]
assert display_mask_meta["source"]["file"] == "assets/data/ne_50m_land.geojson"
assert display_mask_meta["source"]["sha256"] == meta["land"]["sha256"]
assert display_mask_meta["source"]["commit"] == meta["land"]["commit"]
assert display_mask_meta["source"]["url"] == meta["land"]["source"]
assert display_mask_meta["source"]["scale"] == "1:50m"
for key in ("projection", "datum", "bounds", "pixelSampling"):
    assert display_mask_meta["georeferencing"][key] == terrain_metadata["georeferencing"][key], f"Terrain/mask registration mismatch: {key}"
encoding = display_mask_meta["encoding"]
assert (encoding["format"], encoding["mode"], encoding["bitsPerPixel"]) == ("PNG", "L", 8)
assert (encoding["ocean"], encoding["land"]) == (0, 255)
assert display_mask_meta["processing"]["newGeometry"] is False
assert display_mask_meta["processing"]["supersample"] == 2
assert display_mask_meta["processing"]["rasterDimensions"] == [8192, 4096]
assert (ROOT / display_mask_meta["processing"]["script"]).is_file()
assert (terrain_dir / "LAND_MASK_ATTRIBUTION.txt").is_file()
assert sum(display_mask_output[key] for key in ("landPixels", "oceanPixels", "edgePixels")) == 4096 * 2048
assert all(display_mask_output[key] > 0 for key in ("landPixels", "oceanPixels", "edgePixels"))

benchmarks = json.loads((ROOT / "assets/benchmarks.json").read_text())
assert len(benchmarks["models"]) == 8
assert len({model["id"] for model in benchmarks["models"]}) == 8
for model in benchmarks["models"]:
    assert set(model["values"]) == variables
    for errors in model["values"].values():
        assert set(errors) == {"rmse", "mae"}
        assert all(math.isfinite(v) and v >= 0 for v in errors.values())
        assert errors["rmse"] >= errors["mae"]

# Film values were independently checked against the original read-only NumPy
# arrays when exported. CI checks their immutable payload fingerprints and uses
# the separately exported surface mask / Congo trajectories to verify alignment.
# Raw-selection hashes in the metadata describe pre-quantization float32 values;
# they cannot be recomputed from this lossy browser asset without the raw dataset.
film_path = ROOT / "assets/data/film-growth.json"
film = json.loads(film_path.read_text())
film_meta = film["meta"]
assert film_path.stat().st_size < 3_000_000
assert film_meta["schemaVersion"] == 1
assert film_meta["years"] == list(range(41)), "Film state years must include initial year 0"
assert film_meta["initialAges"] == [1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500]
assert film_meta["profileInitialAges"] == [1, 10, 50] and film_meta["globalInitialAge"] == 1
assert film_meta["encoding"] == "base64 little-endian uint16"
assert (film_meta["scale"], film_meta["offset"], film_meta["nodata"]) == (0.01, 0, 65535)
assert film_meta["order"] == "site-major then year; index = siteIndex * 41 + simulationYear"
assert film_meta["siteColumns"] == ["lat", "lon", "sourceIndex"]
assert film_meta["globalShape"] == [3373, 41] and film_meta["sampleCount"] == 3373
assert film_meta["sourceCommit"] == data["meta"]["sourceCommit"]
assert film_meta["verifiedDatasetNumbers"] == {
    "sites": 54152, "initialAges": 15, "siteAgeSequences": 812280,
    "rolloutYears": 40, "inputFeatures": 136, "targetVariables": 7, "benchmarkModels": 8,
}
assert len(film_meta["benchmarkModels"]) == len(benchmarks["models"]) == 8
expected_film_sites = []
for source_index, cell_index in enumerate(original_indexes):
    row, col = divmod(cell_index, 720)
    if row % 4 == 0 and col % 4 == 0:
        expected_film_sites.append([89.75 - row * 0.5, -179.75 + col * 0.5, source_index])
assert film["global"]["sites"] == expected_film_sites, "Film coordinates/source indices disagree with original surface cells"
assert len(expected_film_sites) == 3373
film_field_hashes = {
    "height": "a8c0ad30a5146a8ae6eb59194414580a5e6b58db247c6e6fe1908bf3a2229e94",
    "agb": "5e1bfc5edf5c398072f037c38c731e7b20e52189bf9e88bc96d805be047063a6",
}
for variable, maximum in (("height", 100), ("agb", 100)):
    payload = base64.b64decode(film["global"][variable], validate=True)
    assert len(payload) == 3373 * 41 * 2, f"Invalid film {variable} length"
    assert hashlib.sha256(payload).hexdigest() == film_field_hashes[variable], f"Film {variable} payload changed or years reordered"
    values = array("H")
    values.frombytes(payload)
    if sys.byteorder != "little":
        values.byteswap()
    assert all(v != film_meta["nodata"] and 0 <= v * 0.01 < maximum for v in values)
    raw_range = film_meta["globalRawRanges"][variable]
    assert abs(min(values) * 0.01 - raw_range["min"]) <= 0.0050001
    assert abs(max(values) * 0.01 - raw_range["max"]) <= 0.0050001
    assert 0 <= film_meta["maximumAbsoluteQuantizationError"][variable] <= 0.0050001

assert [s["id"] for s in film["profiles"]] == ["congo", "eastern-us", "boreal"]
assert film_meta["profileSourceIndices"] == [s["sourceIndex"] for s in film["profiles"]]
independent_sites = {site["id"]: site for site in data["sites"]}
film_overlap_values = 0
for site in film["profiles"]:
    source_index = site["sourceIndex"]
    assert isinstance(source_index, int) and 0 <= source_index < 54152
    assert original_indexes[source_index] == grid_index(site["lat"], site["lon"])
    assert set(site["trajectories"]) == {"1", "10", "50"}
    for age, outputs in site["trajectories"].items():
        assert set(outputs) == {"height", "agb", "lai"}
        for variable, series in outputs.items():
            assert len(series) == 41
            upper_bound = 30 if variable == "lai" else 100
            assert all(math.isfinite(v) and -0.01 <= v < upper_bound for v in series)
            if site["id"] in independent_sites:
                independent = independent_sites[site["id"]]
                assert (source_index, site["lat"], site["lon"]) == (independent["sourceIndex"], independent["lat"], independent["lon"])
                expected = independent["trajectories"][age][variable]
                assert all(abs(a - b) <= 1e-6 for a, b in zip(series, expected)), f"Film {site['id']} {age}/{variable} differs from independent trajectory"
                film_overlap_values += len(series)
    climate = site["climate"]
    assert set(climate) == {"years", "temperatureC", "precipitationMm", "co2Ppm"}
    assert climate["years"] == list(range(1, 41)), "Forcing years describe 40 transitions, not the initial state"
    for variable, lower, upper in (("temperatureC", -80, 60), ("precipitationMm", 0, 10000), ("co2Ppm", 200, 600)):
        assert len(climate[variable]) == 40
        assert all(math.isfinite(v) and lower <= v <= upper for v in climate[variable])
assert film_overlap_values == 369
profiles_payload = json.dumps(film["profiles"], sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
assert hashlib.sha256(profiles_payload).hexdigest() == "af53a0e8f9de5c115fdb4721b7540a61418b39bf289b3959600ca5b1c88fb823", "Film profiles/forcing summaries differ from source-verified export"
source_descriptions = {item["file"]: item for item in film_meta["sourceFiles"]}
assert set(source_descriptions) == {"data_global/glob_Y001.npy", "data_global/glob_Y010.npy", "data_global/glob_Y050.npy", "data_global/glob_X_fea.npy"}
for filename, item in source_descriptions.items():
    assert item["dtype"] == "float32"
    assert item["shape"] == ([54152, 40, 12, 136] if "glob_X" in filename else [54152, 41, 12, 7])
    assert item["bytes"] == math.prod(item["shape"]) * 4 + 128
assert len(film_meta["selectedValueHashes"]) == 5
for item in film_meta["selectedValueHashes"]:
    assert item["file"] in source_descriptions and re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
assert len(film_meta["supportingFileHashes"]) == 3
assert all(re.fullmatch(r"[0-9a-f]{64}", digest) for digest in film_meta["supportingFileHashes"].values())
film_provenance_path = ROOT / "assets/film/provenance.json"
if film_provenance_path.is_file():
    film_provenance = json.loads(film_provenance_path.read_text())
    if film_provenance.get("source") == "../data/film-growth.json":
        assert film_provenance["sourceSha256"] == hashlib.sha256(film_path.read_bytes()).hexdigest()
        if "profileSourceSha256" in film_provenance:
            assert film_provenance["profileSourceSha256"] == hashlib.sha256((ROOT / "assets/data/carbon-globe.json").read_bytes()).hexdigest()
print(f"Film: 3,373 original sites x 41 states x 2 fields; 3 profiles, 369 independent overlap values, coordinate ordering, physical bounds, and payload fingerprints verified.")

assert (ROOT / "assets/paper.pdf").read_bytes().startswith(b"%PDF-")
assert (ROOT / "assets/social.png").read_bytes().startswith(b"\x89PNG")
for font in (ROOT / "assets/fonts").glob("*.woff2"):
    assert font.read_bytes().startswith(b"wOF2"), f"Invalid WOFF2 font: {font.name}"
for forbidden in ("sources", ".tools", ".env", "node_modules"):
    assert not (ROOT / forbidden).exists(), f"Development/raw data must stay outside website: {forbidden}"
print(f"Validated {len(pages)} pages, {references} local references, {len(data['map']['points']):,} map points, all trajectories, and 112 benchmark values.")
print(f"Surface: {cell_count:,} cells; {counts[2]:,} originals, {counts[3]:,} interpolated, {counts[1]:,} unsupported land, {counts[0]:,} ocean. Decoding, source cross-checks, nodata, and land-source checksum passed.")
print(f"Terrain: 4096 x 2048 WebP, {len(terrain_content):,} bytes; source provenance, world-file coordinates, image headers, and checksum verified.")
print(f"Display coastline: 4096 x 2048 grayscale PNG, {len(display_mask_content):,} bytes; source polygon hash, image header, output checksum, and terrain registration verified.")
