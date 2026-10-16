# Visualization data provenance

`assets/data/carbon-globe.json` is a compact export of the original CarbonGlobe
Ecosystem Demography (ED) simulations supplied in `sources/datasets/`. It contains
reference simulation outputs, rather than observations or trained emulator
predictions. The exporter reads the source arrays with read-only memory maps.

## What the website shows

- **Globe:** aboveground biomass or canopy height at simulation year 40, with
  seed forest age 10. Smooth surface uses the full 54,152-site grid and the
  limited interpolation described below. Original dots and 3D columns use
  **13,546 original points**, retaining every second row and column of the
  0.5-degree grid without averaging neighboring cells.
- **Trajectories:** six illustrative land cells, four seed ages (1, 10, 50, 100),
  seven variables, and 41 records indexed by simulation year 0–40. Region names
  identify examples, not representative regional averages or in-situ stations.
- **Annual benchmark selection:** index 11, December, is selected from each
  12-month axis. Monthly values are neither summed nor averaged. Index 0 of the
  year axis provides the initial state; indices 1–40 follow it.
- **Original point and trajectory export:** raw stored physical values, with no standardization, mean scaling,
  smoothing, clipping, or fitted curves. Small negative simulation outputs are
  retained. Map values are rounded to three decimal places and trajectories to
  six decimal places for browser transfer.

The globe's color scales clip at 0–12 kg C m⁻² for biomass and 0–40 m for height.
Values above the upper limit share the highest color and column length. Column
lengths are an exaggerated linear display scale, not tree heights relative to Earth's radius.
Blue and green ocean choices affect appearance only. The original point JSON
retains values beyond the color scale and negative outputs subject to rounding.
The explorer's original trajectories are unchanged by the globe display modes.

The paper describes a historical 1981–2021 period. The interactive chart uses
simulation year indices to preserve the meaning of the 41 stored target records
and their 40 transitions.

## Smooth surface and independent land geometry

`assets/data/globe-surface.json` encodes a 720 × 360 equirectangular grid, in
north-to-south, west-to-east row order. It starts with every original ED cell for
age 10, year 40, December. Natural Earth 1:50m land polygons independently
classify land and ocean at exact 0.5-degree cell centers, including polygon holes.

| Provenance class | Cells | Meaning |
| --- | ---: | --- |
| 0 | 172,916 | Ocean; no carbon value |
| 1 | 30,731 | Unsupported land; neutral display and no carbon value |
| 2 | 54,152 | Original ED reference value |
| 3 | 1,401 | Land gap filled for visualization only |

Gap filling uses inverse squared great-circle distance from four original
neighbors, all within **2 angular degrees**. The target and donors must lie on
the independent land mask; sampled paths between them cannot cross ocean at the
grid resolution. Donor directions must surround the target, with no angular gap
greater than 180 degrees, to reject one-sided extrapolation into unsupported
interiors. Filled cells never become donors. Every filled value remains within
its donors' range. Unsupported land stays neutral; values are not projected
across large desert gaps or oceans.

The full source contains 586 original cells whose centers fall outside the
Natural Earth land mask. These reference values remain class 2, but cannot seed
interpolation. This accommodates differences between the simulation grid and
the independent coastline instead of discarding original data.

The two fields are base64-encoded little-endian unsigned 16-bit arrays. Decode
physical values as `encoded * 0.01 + 0`; `65535` marks no data. The separate
base64 unsigned 8-bit mask records the four provenance classes above. All
108,304 original AGB and height values survive decoding within **0.005 units**,
with no color-scale clipping in the asset. The current age-10/year-40 source
fields are nonnegative. Smooth rendering and the 1,401 filled cells serve visual
continuity, rather than creating new ED simulation results or improving the
dataset's scientific resolution.

Land geometry is [Natural Earth 1:50m land](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/),
distributed in the [public domain](https://www.naturalearthdata.com/about/terms-of-use/).
The official Natural Earth site links the author-maintained
[`nvkelso/natural-earth-vector` repository](https://github.com/nvkelso/natural-earth-vector).
The unchanged `ne_50m_land.geojson` is pinned to commit
`ca96624a56bd078437bca8184e78163e5039ad19` and checked against SHA-256
`e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b`.
See [the included attribution](assets/data/NATURAL_EARTH_ATTRIBUTION.txt).

## Coordinates and indexing

`data_stats/mask2d.npy` has shape `(360, 720)`. Values 1, 2, and 3 denote included
sites; zero denotes excluded cells. The 54,152 nonzero cells are traversed in
NumPy C order, matching axis 0 of `glob_Y*.npy`. Upstream
[`convertCMP2Raw`, `generateTrainTestGrid`, and `extractTrainTest2dTo1d`](https://github.com/zhwang0/carbon-globe/blob/a99036367b76a2a7c738bc0e8530a5e57415c2dc/LSTM-LSTNet-DeepED/utils/preprocess.py)
establish the mask indexing and grid split conventions.

The coordinate reconstruction uses cell centers:

```text
latitude  =  89.75 - row    × 0.5
longitude = -179.75 + column × 0.5
```

The exporter checks every derived latitude against the bundled
`data_stats/site_lat.npz`: all **3,373 training** latitudes and **852 test**
latitudes match exactly after reconstructing the upstream stride-4 training and
offset-2 stride-8 test grids. This independently validates latitude orientation,
cell-center offset, and compressed row ordering. Longitude adopts the standard
west-to-east global cell-center convention; the supplied files and upstream
preprocessing do not contain an explicit longitude vector. That longitude
convention is an inference, not a separately supplied coordinate measurement.

Selected cells are nearest to regional anchor coordinates using an approximate
local angular distance, with longitude distance weighted by cosine of latitude:

| Example | Source site index | Latitude | Longitude |
| --- | ---: | ---: | ---: |
| Amazon Basin | 43437 | -2.75 | -60.25 |
| Congo Basin | 42864 | -0.75 | 22.75 |
| Pacific Northwest | 22655 | 45.25 | -123.25 |
| Central Europe | 20560 | 48.25 | 11.75 |
| Southeast Asia | 37530 | 16.25 | 101.75 |
| Eastern Australia | 52871 | -32.75 | 149.75 |

## Variables and temporal interpretation

The output variable order follows the paper's variable table in
`sources/NeurIPS_2025_Carbon/neurips_2025.tex`, lines 1384–1390.

| Array index | JSON key | Variable | Paper unit |
| ---: | --- | --- | --- |
| 0 | `height` | Vegetation canopy height | m |
| 1 | `agb` | Aboveground biomass | kg C m⁻² |
| 2 | `soil` | Soil carbon (`sc` in the paper) | kg C m⁻² |
| 3 | `lai` | Leaf area index | Dimensionless; displayed as m² m⁻² |
| 4 | `gpp` | Gross primary production | kg C m⁻² |
| 5 | `npp` | Net primary production | kg C m⁻² |
| 6 | `rh` | Heterotrophic respiration | kg C m⁻² |

The paper describes GPP, NPP, and Rh as annual target variables. The export
preserves its benchmark convention by selecting December; it does not calculate
an annual total from monthly records. The upstream
[`eval_glob` implementation](https://github.com/zhwang0/carbon-globe/blob/a99036367b76a2a7c738bc0e8530a5e57415c2dc/LSTM-LSTNet-DeepED/utils/func.py#L1081)
explicitly selects December from the second stored year onward for evaluation.
The upstream
[`DLinear` loader](https://github.com/zhwang0/carbon-globe/blob/a99036367b76a2a7c738bc0e8530a5e57415c2dc/DLinear/data_provider/data_loader.py#L70)
also selects the final month for all 41 years before forming initial-state and
target pairs. This website includes the initial December state as chart year 0.

## Reproduce

From the project root, with NumPy available:

```bash
.tools/venv/bin/python website/scripts/export_data.py
```

In a standalone checkout of the website repository, install NumPy in your Python
environment and point the exporter at your original CarbonGlobe dataset:

```bash
python scripts/export_data.py --source /path/to/CarbonGlobe/datasets
python scripts/export_globe_surface.py --source /path/to/CarbonGlobe/datasets
```

The output is always written to `assets/data/carbon-globe.json` relative to the
website directory containing the script, regardless of the working directory.

The script reads `glob_Y001.npy`, `glob_Y010.npy`, `glob_Y050.npy`, and
`glob_Y100.npy`, each with shape `(54152, 41, 12, 7)`, plus `mask2d.npy` and
`site_lat.npz`. It validates array shapes, coordinate agreement, and finite
selected values before writing the JSON. It needs no network connection and
does not alter source data.

The surface exporter reads only the age-10 target array and coordinate metadata.
It also uses the included, checksum-verified Natural Earth source, downloading
the pinned file only if it is absent. It checks latitude reconstruction, all
original values, land-only interpolation, donor ranges, and quantization error.
Its separate surface JSON is approximately 1.73 MB.

Upstream code was inspected at commit
`a99036367b76a2a7c738bc0e8530a5e57415c2dc`. The resulting JSON is approximately
430 kB, rather than requiring visitors to download the multi-gigabyte source
arrays. Source files remain the authoritative numerical data; the JSON is a
rounded, selected visualization extract.
