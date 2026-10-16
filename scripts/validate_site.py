"""Validate deployable pages and scientific data assets using the standard library."""
from html.parser import HTMLParser
import json
import math
from pathlib import Path
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
for path, page in pages.items():
    for reference in page.references:
        link = urlsplit(reference)
        if link.scheme or link.netloc:
            continue
        target = (path.parent / unquote(link.path)).resolve() if link.path else path
        assert target.is_relative_to(ROOT), f"Local link escapes website: {reference}"
        assert target.is_file(), f"Missing local target in {path.name}: {reference}"
        if link.fragment and target in pages:
            assert unquote(link.fragment) in pages[target].ids, f"Missing anchor: {reference}"
        references += 1

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
