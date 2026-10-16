# CarbonGlobe website

A dedicated research website for **CarbonGlobe: A Global-Scale, Multi-Decade Dataset and Benchmark for Carbon Forecasting in Forest Ecosystems** (NeurIPS 2025).

The original model implementations remain at [zhwang0/carbon-globe](https://github.com/zhwang0/carbon-globe). This repository contains only the website and compact presentation assets. IEEE Big Data Cup SSP126/SSP585 materials are outside its scope.

## Local preview

No package installation or build step is required; the renderer is included locally. From this directory:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Use an HTTP server rather than opening `index.html` directly, because the data explorer loads JSON with `fetch`.

## Contents

- `index.html`, `styles.css`, `app.js`, `globe.js`: responsive website, interactive globe, simulation explorer, benchmark comparison, and citation tools.
- `assets/data/carbon-globe.json`: compact export from the original ED simulation arrays. See [data provenance](DATA_NOTES.md).
- `assets/data/globe-surface.json`: full 0.5-degree globe grid with original values, bounded land-only display interpolation, and an explicit provenance mask.
- `assets/data/ne_50m_land.geojson`: pinned public-domain Natural Earth polygons used to classify land independently of carbon values; source and checksum are recorded in the surface metadata.
- `assets/textures/earth-terrain.webp`: local 4096 × 2048 Natural Earth I shaded-relief background. Its geographic colors supply context, not ED values.
- `assets/textures/earth-terrain.attribution.json`, `ATTRIBUTION.txt`: terrain source, version, geographic extent, preparation details, and checksums.
- `assets/vendor/`: locally hosted browser rendering code and its license; no package installation is needed to view the website.
- `assets/benchmarks.json`: all RMSE and MAE values from the published paper's main Table 1.
- `assets/paper.pdf`, `assets/citation.bib`: the verified published paper and official proceedings citation. The local source folder's template PDF was not used.
- `assets/fonts/`: locally hosted Manrope and DM Mono fonts with their SIL Open Font License files.
- `scripts/export_data.py`: regenerate the visualization export from locally available original datasets. NumPy is needed for regeneration, not for serving the website.
- `scripts/export_globe_surface.py`: regenerate the full globe surface and validate the bounded interpolation against original ED cells and independent land geometry.
- `scripts/prepare_terrain.py`: recreate the geographic texture from the official Natural Earth raster; requires Pillow only for regeneration.
- `scripts/validate_site.py`: check local page links and visualization asset integrity with Python's standard library.
- `.github/workflows/pages.yml`: deploy the static website to GitHub Pages.

## Hosting

The dedicated repository is `zhwang0/carbon-globe-website`, with public URL `https://zhwang0.github.io/carbon-globe-website/`.

GitHub Pages uses **GitHub Actions** as its publishing source. The included workflow publishes on pushes to `main` and can also be run manually. All runtime asset paths are relative, so project-subdirectory hosting works.

If the repository name or hosting destination changes, update the absolute Open Graph URL and image URL in `index.html` and the URLs in `sitemap.xml` and `robots.txt`.

Do not add the raw `sources/` directory or development `.tools/` directory to this repository. Only the contents of this `website/` directory belong here.

To regenerate the extracts in a standalone checkout, run `python scripts/export_data.py --source /path/to/original/datasets` and `python scripts/export_globe_surface.py --source /path/to/original/datasets` in an environment with NumPy installed. The surface exporter uses the included Natural Earth source; it downloads the pinned version only when the file is missing. Run `python scripts/validate_site.py` to check the static package before publishing.

To regenerate the terrain with Pillow installed, run `python scripts/prepare_terrain.py --cache-dir ../carbonglobe-terrain-cache`. The approximately 41 MB source download stays in that separate cache; only the compact texture and provenance files belong in the website. Validation uses Python's standard library and checks WebP dimensions, hashes, geographic metadata, scientific exports, and local links.

## Scientific interpretation

The explorer shows modeled responses to supplied environmental drivers, not direct observations or independent future climate predictions. Site trajectories are individual grid cells, not regional averages. Initial forest age is a simulation seed condition. Annual benchmark states use the December slice of the supplied targets.

The globe compares three display modes for AGB or canopy height at initial age 10, year 40. **Smooth surface** uses all 54,152 original ED sites plus 1,401 conservatively interpolated land gaps; 30,731 unsupported land cells retain no ED value and show geographic terrain imagery. Interpolation requires four surrounding original donors within 2 angular degrees and land-only connecting paths. It does not recursively fill large gaps. The surface quantizes values to 0.01 units, with maximum error 0.005, and identifies every cell as ocean, unsupported land, original, or interpolated. All original cells remain present, including 586 outside the independent coastline mask.

**3D columns** and **Original dots** use the same 13,546 original sampled cells, without adding interpolated values. Columns use an exaggerated linear display scale over a dark green source-data underlay, with terrain on unsupported and interpolated land beneath them. Original dots sit over geographic land imagery. Colors and column heights cap at 12 kg C m⁻² for AGB or 40 m for canopy height; these caps do not alter the downloaded physical values. Oceans are fixed blue in every mode. The explorer's raw trajectories remain unchanged.

The geographic background is Natural Earth I with Shaded Relief, 1:50 million, version 3.2.0, served locally as a north-up 4096 × 2048 WebP. Its ice, desert, and relief colors are geographic context, not ED estimates, categorical land-cover predictions, or current weather. The image does not fill missing scientific values. If it fails to load, the renderer uses a flat sand background with an explanatory note. Browsers without WebGL 2 receive original dots over a blue sphere without terrain.

The benchmark comparison uses the main paper's overall evaluation with input perturbations during training. It does not represent a live leaderboard. Cross-variable error magnitudes have different units; compare models within a selected variable.

## Attribution

Research materials and dataset excerpts remain subject to the authors' and original datasets' terms and citation requirements. Source links and extraction details are recorded in the data notes and benchmark metadata. Fonts are distributed under the included SIL Open Font Licenses.

Land geometry is made with [Natural Earth](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/), whose map data is public domain. The official website links its author-maintained GitHub repository. The pinned source and license links are included in [NATURAL_EARTH_ATTRIBUTION.txt](assets/data/NATURAL_EARTH_ATTRIBUTION.txt).

The separate terrain raster derives from the official [Natural Earth I shaded-relief archive](https://naturalearth.s3.amazonaws.com/50m_raster/NE1_50M_SR.zip), also public domain. RGB conversion, Lanczos downsampling, WebP compression, and any uniform display adjustment are recorded in the [raster attribution](assets/textures/ATTRIBUTION.txt) and [detailed metadata](assets/textures/earth-terrain.attribution.json) accompanying the local texture.
