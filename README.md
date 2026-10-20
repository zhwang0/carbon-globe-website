# CarbonGlobe website

Project page for **CarbonGlobe: A Global-Scale, Multi-Decade Dataset and Benchmark for Carbon Forecasting in Forest Ecosystems** (NeurIPS 2025, Datasets & Benchmarks).

The page is laid out like a product launch. It opens with a scroll-driven film rendered live in WebGL from CarbonGlobe data: the sun rising over the Earth, a dive into one 0.5° Amazon cell, a forest growing year by year, the same start under four forcings (warm and wet, drought, fire, cold), each with its weather, a regional climate map and its rain and temperature year by year, fifteen starting ages, the whole planet across climate zones, an annotated deep emulator that reads a deck of gridded monthly climate maps (the kind of input ERA5 gives AI weather models) and the forest state and rolls next year's forest out, conditional rollouts, the dataset in numbers, and an "Available now" end card over the Amazon. Below the film are why it matters (a statement that lights up as it scrolls, sourced figures on the forest carbon sink, and the programmes ED already informs), the dataset pipeline and tech specs, a bento of what makes it a machine-learning benchmark, a quick start with download and loading code, the interactive globe explorer, benchmarks, the IEEE BigData Cup 2026 challenge built on CarbonGlobe, the case for coupling ecosystem emulators with weather and climate models with a roadmap, the film as a video, the team, an FAQ and the citation.

Public URL: `https://zhwang0.github.io/carbon-globe-website/`. The dataset and model code live at [zhwang0/carbon-globe](https://github.com/zhwang0/carbon-globe) and on [Kaggle](https://www.kaggle.com/datasets/zhihaow/carbonglobe).

## Preview locally

No build step or package installation is needed:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. Use a server rather than opening `index.html` directly, because the page fetches its data files.

## Layout

| Path | Contents |
| --- | --- |
| `index.html`, `css/main.css` | Page structure and styles |
| `js/main.js` | Scroll timeline, the opening and word-by-word headlines, reveals, "Play the film" autoplay, the statement, quick-start tabs, the film lightbox, boot and lazy loading |
| `js/stage.js` | The WebGL film: globe, dive, forests, the four-forcing split view, streams and camera choreography |
| `js/network.js` | The annotated emulator: a deck of monthly climate maps and the forest state in, encoder, sequence model, heads and the autoregressive loop |
| `js/globe.js` | Shared globe shader (with the opening's eclipse ring and night side), data-atlas decoding, the sun flare and geographic helpers |
| `js/post.js` | The film's post-processing: a multisampled frame and a soft bloom (desktop only; add `?nobloom` to compare) |
| `js/hero-grow.js` | Tree growth: space colonisation driven by an ED canopy-height series, with self-shading, crown lift, pipe-model wood, broadleaf and conifer forms, and fire |
| `js/hero-tree.js`, `js/hero-worker.js` | Lit point-cloud rendering of the trees and their flames; growth runs in a module worker |
| `js/forest.js` | Ground, sky, drifting motes and the weather (rain, snow, dust, ash) of the forest scenes |
| `js/random.js` | Seeded random numbers shared by the procedural scenes |
| `js/forecast.js` | "What if?" rollout panel |
| `js/explorer.js` | Interactive globe explorer with site trajectories |
| `js/bench.js` | Benchmark heat map, bar chart and runtime comparison (Table 1 and Fig. 6 of the paper) |
| `assets/data/` | Browser exports of the CarbonGlobe simulations (see below) |
| `assets/tex/` | Earth imagery and land mask |
| `assets/film/` | MP4 render of the film, for talks and social posts |
| `assets/img/` | Paper figure, social card and no-WebGL poster |
| `assets/vendor/` | Three.js 0.186.1 (MIT), served locally |
| `scripts/` | Reproducible exporters, texture preparation, film renderer and site validator |

## What the visualizations show

All carbon values come from the CarbonGlobe ED reference simulations in the original dataset (`glob_Y{age}.npy`, `glob_X_fea.npy`, `mask2d.npy`). Nothing is fabricated or modelled for the page.

- **Global grids** (`assets/data/grid/{var}_a{age}.png`): all 41 annual states (1981–2021) of the 7 targets for starting ages 1, 50 and 200 at every one of the 54,152 sites, packed as 7 × 6 tiles of the 720 × 360 grid. Stocks (height, AGB, soil C) use the December state. LAI, GPP, NPP and Rh use the mean of the 12 monthly values. Values are stored as 8-bit on a square-root scale (`value = vmax · ((byte − 1)/254)²`, byte 0 = no data) and are for display only. Download the dataset for full precision.
- **Story trajectories** (`assets/data/meta.json`): exact annual series for six sites (central Amazon, Congo Basin, Zambian miombo, eastern United States, boreal Finland, central Siberia) at all 15 starting ages. Each site is the 90th-percentile canopy height cell (starting age 1, year 40) inside a regional box.
- **Drought site** (`assets/data/scenarios.json`): the age-1 series of the Amazon-basin cell whose ED run loses the largest share of aboveground biomass from 2015 to 2016 (0.75°S, 63.25°W: 2015 rain 30% of its 40-year mean, LAI 5.1 → 0.5, AGB −21%), with its annual precipitation anomaly.
- **Climate of the four views** (`scenarios.json`, `climate`): annual rain and mean air temperature, 1981–2020, at the central Amazon, drought and boreal Finland sites, drawn as each view's rain bars and temperature-anomaly stripes.
- **Regional climate maps** (`assets/data/forcing/region_*.png`), from the inputs at 0.5° on Natural Earth coastlines: mean annual rain 1981–2020 and 2015 rain as a share of that mean around the Amazon sites; dry-season length (months whose 1981–2020 mean rain is under 100 mm) for the fire view; frozen months (mean air temperature below 0 °C) around the boreal site.
- **Emulator input maps** (`assets/data/forcing/maps_2015.png`): the twelve monthly 2015 fields of six of the 136 drivers (air temperature, precipitation, specific humidity, shortwave radiation, wind speed and CO₂), averaged from the 0.5° sites to 1° and stored 8-bit on the per-variable scales listed in `scenarios.json` (`maps`). The meteorology is MERRA-2 as integrated in CarbonGlobe; hourly drivers are shown as the mean of their 24 hourly values. In `glob_X_fea.npy` those hourly values are interleaved by hour: features 33–128 hold (hus, ta_h, rsds, sfcWind) for hour 0, then for hour 1, and so on.
- **Climate zones** (`assets/data/climate.png`): approximate Köppen–Geiger main groups (Peel et al., 2007 thresholds) computed from the dataset's own 40-year monthly temperature and precipitation. These approximate the zones the paper uses; they are not the official Beck et al. (2018) map.
- **Dataset layers** (`assets/data/layers/`): mean air temperature, annual precipitation, 2020 CO₂ and saturated soil water content from the inputs; year-40 height, AGB, soil C and GPP at starting age 200 from the outputs.
- **Film illustrations**: tree shapes, the cohort layout and the neural network are illustrations. Every tree is grown to an ED canopy-height series, and its crown thins and yellows when ED's leaf area index drops below its recent maximum; the HUD numbers are the ED values. Chapter one and the "warm and wet" view use the central Amazon site (3.25°S, 63.75°W), the drought view the drought site above, the cold view boreal Finland, and the fifteen-age forest the Amazon site's fifteen starting ages. The fire view is a sketch: CarbonGlobe's disturbance-rate input is constant (0.144 per year at every site), so no run contains a fire; it replays the Amazon age-1 run, burnt in 2003 and restarted at age 1. The weather of the four views (sky, rain, snow, dust, smoke and the state of the ground) illustrates each site's annual rain and temperature: rain thins in dry years, the drought view turns hot and dusty in 2015–16 and recovers, the boreal view snows. The emulator diagram shows the benchmarked setup (136 monthly drivers plus the forest state in, next year's state out, rolled out for 40 years), not a specific architecture; its deck of maps shows real 2015 inputs, and the highlighted cell is the column of drivers one site's sequence reads. The future-forcing chart shows the dataset's mean CO₂ for 1981–2020, then two illustrative CMIP6 branches to 2100. Only the SSP5-8.5 endpoint (≈1,135 ppm, Meinshausen et al., 2020) is a published value. No emulator predictions or future simulations are shown.
- **Benchmarks**: all values from Table 1 of the paper; emulator run times are read from Fig. 6.
- **Opening and end card**: the sunrise over the globe and the planet rising under the end card are lighting and camera moves; the globe still shows ED's canopy height. The challenge chart is a schematic of the CO₂ forcing in two futures, with no values.

## Facts from outside the paper

The launch sections quote a few figures from other sources. Re-check them before reusing the copy.

- Forest area, about one-third of land (4.14 billion ha): FAO, *Global Forest Resources Assessment 2025* (press release, October 2025).
- Forest carbon sink: Pan et al., "The enduring world forest carbon sink", *Nature* 631, 563–569 (2024), doi:10.1038/s41586-024-07602-x. Gross sink 7.8 ± 0.4 Pg C per year in 1990–2019, "equivalent to almost half of fossil-fuel emissions"; over those three decades the sink fell by 36 ± 6% in boreal and 31 ± 7% in intact tropical forests.
- ED's uses (Global Carbon Budget since 2023, NASA Carbon Monitoring System, U.S. Greenhouse Gas Center, Maryland's forest carbon inventory), run times and dataset numbers: the CarbonGlobe paper.
- The challenge: IEEE Big Data Cup 2026, challenge 05, "CarbonGlobe — Global-Scale Land Ecosystem Forecasting", on Kaggle (`ieee-bigdata-cup-2026-ai-emulation-challenge`); IEEE BigData 2026 is in Phoenix, 14–17 December 2026. The Kaggle title says awards are available; no amounts are given on the page. Sites, ages and scenarios follow the challenge's public data description. The page does not use or publish any challenge test data.
- Licence and size: the Hugging Face dataset card (CC BY 4.0, 29.3 GB) and the code repository's `LICENSE.txt`.
- Follow-on work: Wang et al., "Earth System World Model for What-If Simulations: A Case Study for Terrestrial Ecosystems", arXiv:2609.08855 (2026), which evaluates on CarbonGlobe. DeepED: Wang et al., ACM SIGSPATIAL 2023.

## Regenerate

With NumPy and Pillow installed, from this directory:

```sh
python scripts/export_v2_data.py --source /path/to/CarbonGlobe/datasets     # grids, climate zones, meta.json
python scripts/export_v2_layers.py --source /path/to/CarbonGlobe/datasets   # dataset-section map layers
python scripts/export_scenarios.py --source /path/to/CarbonGlobe/datasets   # drought site, site climates and forcing maps for chapters 2 and 5
python scripts/prepare_textures.py                                          # Blue Marble + Natural Earth land mask
python scripts/render_film.py                                               # 72 s MP4, poster and social card (Playwright + imageio-ffmpeg)
python scripts/validate_site.py                                             # link, module and data checks
```

The exporters read the multi-gigabyte arrays with memory maps and take about two minutes. `prepare_textures.py` caches its downloads outside the website directory.

## Hosting

GitHub Pages publishes the site with GitHub Actions on every push to `main` (`.github/workflows/pages.yml`). The workflow runs `scripts/validate_site.py` first. All asset paths are relative, so the site works from a project sub-path. If the repository name changes, update the Open Graph URLs in `index.html`, `sitemap.xml` and `robots.txt`.

## Credits

- Earth imagery: NASA Earth Observatory, Blue Marble Next Generation (Reto Stöckli), July 2004, topography and bathymetry. Public domain.
- Land mask: Natural Earth 1:50m land polygons, public domain, pinned to commit `ca96624a56bd078437bca8184e78163e5039ad19` (SHA-256 checked).
- Three.js (MIT). Fonts: Inter, Instrument Serif and JetBrains Mono via Google Fonts (SIL Open Font License).
- Simulations: Ecosystem Demography (ED) model, University of Maryland.
