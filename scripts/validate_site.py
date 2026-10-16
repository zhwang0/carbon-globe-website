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

benchmarks = json.loads((ROOT / "assets/benchmarks.json").read_text())
assert len(benchmarks["models"]) == 8
assert len({model["id"] for model in benchmarks["models"]}) == 8
for model in benchmarks["models"]:
    assert set(model["values"]) == variables
    for errors in model["values"].values():
        assert set(errors) == {"rmse", "mae"}
        assert all(math.isfinite(v) and v >= 0 for v in errors.values())
        assert errors["rmse"] >= errors["mae"]

assert (ROOT / "assets/paper.pdf").read_bytes().startswith(b"%PDF-")
assert (ROOT / "assets/social.png").read_bytes().startswith(b"\x89PNG")
for font in (ROOT / "assets/fonts").glob("*.woff2"):
    assert font.read_bytes().startswith(b"wOF2"), f"Invalid WOFF2 font: {font.name}"
for forbidden in ("sources", ".tools", ".env", "node_modules"):
    assert not (ROOT / forbidden).exists(), f"Development/raw data must stay outside website: {forbidden}"
print(f"Validated {len(pages)} pages, {references} local references, {len(data['map']['points']):,} map points, all trajectories, and 112 benchmark values.")
print(f"Surface: {cell_count:,} cells; {counts[2]:,} originals, {counts[3]:,} interpolated, {counts[1]:,} neutral land, {counts[0]:,} ocean. Decoding, source cross-checks, nodata, and land-source checksum passed.")
