# CarbonGlobe website

A dedicated research website for **CarbonGlobe: A Global-Scale, Multi-Decade Dataset and Benchmark for Carbon Forecasting in Forest Ecosystems** (NeurIPS 2025).

The original model implementations remain at [zhwang0/carbon-globe](https://github.com/zhwang0/carbon-globe). This repository contains only the website and compact presentation assets. IEEE Big Data Cup SSP126/SSP585 materials are outside its scope.

## Local preview

No frontend dependencies or build step are required. From this directory:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Use an HTTP server rather than opening `index.html` directly, because the data explorer loads JSON with `fetch`.

## Contents

- `index.html`, `styles.css`, `app.js`: responsive website, interactive canvas globe, simulation explorer, benchmark comparison, and citation tools.
- `assets/data/carbon-globe.json`: compact export from the original ED simulation arrays. See [data provenance](DATA_NOTES.md).
- `assets/benchmarks.json`: all RMSE and MAE values from the published paper's main Table 1.
- `assets/paper.pdf`, `assets/citation.bib`: the verified published paper and official proceedings citation. The local source folder's template PDF was not used.
- `assets/fonts/`: locally hosted Manrope and DM Mono fonts with their SIL Open Font License files.
- `scripts/export_data.py`: regenerate the visualization export from locally available original datasets. NumPy is needed for regeneration, not for serving the website.
- `scripts/validate_site.py`: check local page links and visualization asset integrity with Python's standard library.
- `.github/workflows/pages.yml`: deploy the static website to GitHub Pages.

## Hosting

The intended dedicated repository is `zhwang0/carbon-globe-website`, with public URL `https://zhwang0.github.io/carbon-globe-website/`.

Create the repository, push this directory, then choose **GitHub Actions** as the source in **Settings → Pages**. The included workflow publishes on pushes to `main` and can also be run manually. All runtime asset paths are relative, so project-subdirectory hosting works.

If the repository name or hosting destination changes, update the absolute Open Graph URL and image URL in `index.html` and the URLs in `sitemap.xml` and `robots.txt`.

Do not add the raw `sources/` directory or development `.tools/` directory to this repository. Only the contents of this `website/` directory belong here.

To regenerate the extract in a standalone checkout, run `python scripts/export_data.py --source /path/to/original/datasets` in an environment with NumPy installed. Run `python scripts/validate_site.py` to check the static package before publishing.

## Scientific interpretation

The explorer shows modeled responses to supplied environmental drivers, not direct observations or independent future climate predictions. Site trajectories are individual grid cells, not regional averages. Initial forest age is a simulation seed condition. Annual benchmark states use the December slice of the supplied targets.

The benchmark comparison uses the main paper's overall evaluation with input perturbations during training. It does not represent a live leaderboard. Cross-variable error magnitudes have different units; compare models within a selected variable.

## Attribution

Research materials and dataset excerpts remain subject to the authors' and original datasets' terms and citation requirements. Source links and extraction details are recorded in the data notes and benchmark metadata. Fonts are distributed under the included SIL Open Font Licenses.
