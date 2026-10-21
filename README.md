# CarbonGlobe website

Project page for **CarbonGlobe: A Global-Scale, Multi-Decade Dataset and Benchmark for Carbon Forecasting in Forest Ecosystems** (NeurIPS 2025, Datasets & Benchmarks).

The page is laid out like a product launch. It opens with a news line (the follow-up world-model paper, accepted at ACM SIGSPATIAL 2026) and the film itself, a 70-second video with its own score (`assets/film/carbonglobe-film.mp4`, played in place, with sound, from its poster). Below it the same story runs as a scroll-driven film rendered live in WebGL from CarbonGlobe data: the sun rising over the Earth, a dive straight down into the Amazon to the forest canopy, a forest growing year by year, different forests under different forcings (a sapling in the wet Amazon, a mature stand that the 2015–16 drought kills back, a young stand that burns, a boreal sapling), each with its weather, a regional climate map and its rain and temperature year by year, fifteen starting ages scanned by the lidar of a passing space station (NASA's GEDI flies on the ISS), the whole planet turning once as its forests rise in relief from 1981 to 2021, an annotated deep emulator that reads a deck of gridded monthly climate maps (the kind of input ERA5 gives AI weather models) and the forest state and rolls next year's forest out, conditional rollouts, the Earth turning into its digital twin, the dataset in numbers, and an "Available now" end card over the Amazon. Below the film, each section makes one point in a short headline: why it matters (one sentence that lights up as it scrolls, three sourced figures on the forest carbon sink, and the programmes ED already informs), the missing benchmark for forests (the weather-AI analogy), the dataset pipeline and specifications, what makes it a machine-learning benchmark, a quick start with download and loading code, the interactive globe explorer, benchmarks with the runtime comparison, the IEEE BigData Cup 2026 challenge built on CarbonGlobe, the case for a digital twin of Earth's forests with a roadmap, the team, an FAQ, the citation with the abstract, and the numbered references that every claim on the page cites.

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
| `js/main.js` | Scroll timeline, the opening and word-by-word headlines, reveals, "Play in 3D" autoplay, the film player at the top, the statement, quick-start tabs, boot and lazy loading |
| `js/stage.js` | The WebGL film: globe, dive, forests, the four-forcing split view, streams and camera choreography |
| `js/cut.js` | The video's edit in the render mode (`index.html?render`): video time to film position, and its short beat-timed titles |
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
| `assets/tex/` | Earth imagery (4K for the page, 8K for the rendered film), clouds, night lights, the Amazon close up at 1 km, 65 m and 11 m, and the land mask |
| `assets/film/` | The video's edit (`cut.json`) and its MP4 render with sound, for talks and social posts |
| `assets/img/` | Paper figure, social card and no-WebGL poster |
| `assets/vendor/` | Three.js 0.186.1 (MIT), served locally |
| `scripts/` | Reproducible exporters, texture preparation, film renderer, the video's score (`soundtrack.py`) and site validator |

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
- **Film illustrations**: tree shapes, the cohort layout and the neural network are illustrations. Every tree is grown to an ED canopy-height series, and its crown thins and yellows when ED's leaf area index drops below its recent maximum; the HUD numbers are the ED values. Chapter one and the "warm and wet" view use the central Amazon site's age-1 run (3.25°S, 63.75°W); the drought view the drought site's 100-year-old stand, whose crown thins with its leaf area until the 2015–16 drought, when its leaves brown and fall and part of its crown dies back, before the surviving limbs slowly leaf out again (the leaf loss in dry years, the leaf fall and the extent of the dieback are illustrations); the cold view boreal Finland's age-1 run; and the fifteen-age forest the Amazon site's fifteen starting ages. The fire view is a sketch: CarbonGlobe's disturbance-rate input is constant (0.144 per year at every site), so no run contains a fire; it replays the Amazon site's 10-year-old stand to 2003, burns it, and restarts it at age 1. Each of the four views has its own weather so they read apart at a glance (sky, rain, snow, dust, embers, smoke and the state of the ground are illustrations): only the warm-and-wet view rains, more or less with the site's annual rain; the drought view is hot, rainless and dusty in every year and scorches in 2015–16; the fire view has fire-season haze and embers, then the blaze, smoke and scorched ground; the cold view snows. The rain bars and temperature stripes in each header are the sites' real data. The film returns to 1981 twice, each time at the bottom of a brief fade to dark, so no tree is seen shrinking. In the video the four views share no clock: each runs its own compressed years and slows down for its moment (the fire, the drought's leaf fall), so the page's year counter is left out there. The film's globe is satellite imagery: the Blue Marble with its clouds and Black Marble night lights, and for the dive into the Amazon a 1 km Blue Marble tile, then Sentinel-2 cloudless imagery around the site (65 m) and of the forest where the dive ends (11 m), at the head of a black-water lake, toned to the Blue Marble's colours. The forest layer on the globe is CarbonGlobe's canopy height. In the fifteen-age forest a small space station modelled on the ISS, which carries NASA's GEDI, flies over the plot (far lower and larger than the real one, some 400 km up) and its laser leaves footprints on the simulated canopy, the way GEDI measures canopy height from orbit; the footprints are not GEDI data (the paper's point is that ED is calibrated with satellite lidar and that forest structure is observable). After the what-if charts a scan line turns the photographic Earth into its digital twin: the CarbonGlobe canopy-height layer under a 5° graticule. In the planet chapter the forests stand in relief instead: each site of the age-1 runs is raised by its ED canopy height for the year shown, exaggerated so that a 35 m canopy stands 5% of Earth's radius high. The emulator diagram shows the benchmarked setup (136 monthly drivers plus the forest state in, next year's state out, rolled out for 40 years), not a specific architecture; the video names it after DeepED, the authors' emulator of ED (Wang et al., ACM SIGSPATIAL 2023) and the benchmark's best model on the carbon stocks, but the diagram stays a schematic; its deck of maps shows real 2015 inputs, and the highlighted cell is the column of drivers one site's sequence reads. The future-forcing chart shows the dataset's mean CO₂ for 1981–2020, then two illustrative CMIP6 branches to 2100. Only the SSP5-8.5 endpoint (≈1,135 ppm, Meinshausen et al., 2020) is a published value. No emulator predictions or future simulations are shown.
- **Benchmarks**: all values from Table 1 of the paper; emulator run times are read from Fig. 6.
- **Opening and end card**: the sunrise over the globe and the planet rising under the end card are lighting and camera moves; the globe still shows ED's canopy height. The challenge chart is a schematic of the CO₂ forcing in two futures, with no values.

## Facts from outside the paper

The launch sections quote a few figures from other sources. Re-check them before reusing the copy. Every claim on the page carries a numbered citation to the References section at its foot (31 entries, all peer-reviewed except FAO's official statistics; each DOI was resolved when it was added).

- Forest area, about one-third of land (4.14 billion ha, 32%): FAO, *Global Forest Resources Assessment 2025* (press release, 21 October 2025); peer-reviewed support for "about 30%": Bonan, *Science* 320, 1444–1449 (2008).
- Forest carbon sink: Pan et al., "The enduring world forest carbon sink", *Nature* 631, 563–569 (2024), doi:10.1038/s41586-024-07602-x. The global forest sink was steady, 3.6 ± 0.4 Pg C per year in the 1990s and 2000s and 3.5 ± 0.4 in the 2010s, "equivalent to almost half of fossil-fuel emissions (7.8 ± 0.4 Pg C yr⁻¹ in 1990–2019)" (7.8 is the fossil-fuel figure, not the sink). From the 1990s to the 2010s the sink fell by 36 ± 6% in boreal and 31 ± 7% in intact tropical forests and rose in temperate (+30%) and tropical regrowth (+29%) forests, so the page says the sink is shrinking in boreal and intact tropical forests only.
- ED's uses (Global Carbon Budget since 2023, NASA Carbon Monitoring System, U.S. Greenhouse Gas Center, Maryland's forest carbon inventory), run times and dataset numbers: the CarbonGlobe paper.
- The challenge: IEEE Big Data Cup 2026, challenge 05, "CarbonGlobe — Global-Scale Land Ecosystem Forecasting", on Kaggle (`ieee-bigdata-cup-2026-ai-emulation-challenge`); IEEE BigData 2026 is in Phoenix, 14–17 December 2026. The Kaggle title says awards are available; no amounts are given on the page. Sites, ages and scenarios follow the challenge's public data description. The page does not use or publish any challenge test data.
- Licence and size: the Hugging Face dataset card (CC BY 4.0, 29.3 GB) and the code repository's `LICENSE.txt`.
- Follow-on work: Wang et al., "Earth System World Model for What-If Simulations: A Case Study for Terrestrial Ecosystems", arXiv:2609.08855 (2026), accepted at ACM SIGSPATIAL 2026 (Riverside, CA, 3–6 November 2026); it trains and evaluates on CarbonGlobe samples from six regions (the news line above the film). DeepED: Wang et al., ACM SIGSPATIAL 2023, doi:10.1145/3589132.3625577, tested over the northeastern U.S.
- Coverage: the 54,152 sites cover every continent but Antarctica, not every land cell (about 87% of the 0.5° land cells north of 60°S; most of the Greenland ice sheet and parts of the Sahara and Arabian deserts have no site), so the page says "all 54,152 land sites" rather than "every land cell".
- The 2015 drought: the drought view's cell (0.75°S, 63.25°W) gets 30% of its normal rain in 2015 in the MERRA-2 forcing; the 2015–16 Amazon drought is documented by Jiménez-Muñoz et al., *Scientific Reports* 6, 33130 (2016).

## Regenerate

With NumPy and Pillow installed, from this directory:

```sh
python scripts/export_v2_data.py --source /path/to/CarbonGlobe/datasets     # grids, climate zones, meta.json
python scripts/export_v2_layers.py --source /path/to/CarbonGlobe/datasets   # dataset-section map layers
python scripts/export_scenarios.py --source /path/to/CarbonGlobe/datasets   # drought site, site climates and forcing maps for chapters 2 and 5
python scripts/prepare_textures.py                                          # Blue Marble, its clouds, Black Marble night lights, Natural Earth land mask
python scripts/render_film.py                                               # 70 s, 1920 x 1080 MP4 with its score, poster and social card (Playwright + imageio-ffmpeg)
python scripts/render_film.py --scale 3 --master ../_work/carbonglobe-film-4k.mp4   # a 3840 x 2160 master for YouTube, and the website video from it
python scripts/render_film.py --audio-only                                  # re-score the video without rendering it again
python scripts/validate_site.py                                             # link, module and data checks
```

The exporters read the multi-gigabyte arrays with memory maps and take about two minutes. `prepare_textures.py` caches its downloads outside the website directory.

## The video

The MP4 is an edit of the page's film rather than a straight scroll through it, cut like a launch film: `assets/film/cut.json` places every shot on a 100 BPM beat grid (`u` maps beats to film positions), replaces the page's captions and readouts with short titles that land on the beat, and lists the cues the score hits. It also adds what only the video needs: the authors under the opening title, a question over the dive, a corner tag naming ED, the process-based model behind the simulated chapters, DeepED's name on the emulator, and the page's address on the end card. The page's dive comes to rest over the region, where the page names the site; the video dives in one motion (`filmU` in `stage.js`). `scripts/soundtrack.py` synthesises that score with NumPy from the same file (pads, bass, plucked arpeggios and soft drums following its chords; hits, risers, whooshes and counter runs on its cues), so there is nothing to license. To change a title or its timing, edit `cut.json` and run `render_film.py`; to change only the music, edit `soundtrack.py` or the `music` and `cues` entries and run `render_film.py --audio-only`. A licensed track at 100 BPM that starts on beat 0 would follow the same cuts; the big moments fall on beats 4, 20, 52, 84, 100 and 108.

The page is laid out at 1280 x 720 CSS pixels and captured at `--scale` device pixels per CSS pixel, so the titles (live text), the charts (SVG) and the 3D scenes (drawn at the full device resolution) stay sharp at any size: `--scale 1.5` gives the website's 1920 x 1080 video, `--scale 3` a 3840 x 2160 master. With `--master PATH` the render writes the master (H.264 High profile at CRF 14, closed GOP of half the frame rate, two B-frames, AAC 384 kb/s at 48 kHz, as YouTube recommends) and makes the website video from it. A 4K render takes about 70 minutes on one CPU core; `--seconds N --out PATH --no-stills` renders just the start for checking.

## Hosting

GitHub Pages publishes the site with GitHub Actions on every push to `main` (`.github/workflows/pages.yml`). The workflow runs `scripts/validate_site.py` first. All asset paths are relative, so the site works from a project sub-path. If the repository name changes, update the Open Graph URLs in `index.html`, `sitemap.xml` and `robots.txt`.

## Credits

- Earth imagery: NASA Earth Observatory, Blue Marble Next Generation (Reto Stöckli), July 2004, topography and bathymetry, and its cloud cover; night lights from NASA's Black Marble 2016. Public domain.
- The Amazon close up: Sentinel-2 cloudless 2016 (https://s2maps.eu) by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0. The film credits it on its end card; credit it again wherever the film is posted, for example in a YouTube description.
- Land mask: Natural Earth 1:50m land polygons, public domain, pinned to commit `ca96624a56bd078437bca8184e78163e5039ad19` (SHA-256 checked).
- Three.js (MIT). Fonts: Inter, Instrument Serif and JetBrains Mono via Google Fonts (SIL Open Font License).
- Simulations: Ecosystem Demography (ED) model, University of Maryland.
