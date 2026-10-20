"""Export the forcing data behind the film's "four forcings" and emulator chapters.

Writes to assets/data/:
  scenarios.json                  the drought site (the Amazon-basin cell whose ED run loses the largest
                                  share of aboveground biomass from 2015 to 2016), annual rain and
                                  temperature of the three sites the four views use, and the scales of
                                  the maps below
  forcing/maps_2015.png           twelve monthly global fields of six drivers in 2015 at 1 degree, one
                                  8-bit atlas: byte 0 = no data, value = lo + (hi - lo) * ((byte - 1) / 254) ** (1 / gamma)
  forcing/region_{key}.png        a small rendered climate map around each view's site

The hourly drivers are stored interleaved by hour: features 33..128 hold (hus, ta_h, rsds, sfcWind)
for hour 0, then for hour 1, and so on.
Usage: python scripts/export_scenarios.py --source /path/to/datasets
"""
import argparse, json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
OUT = os.path.join(ROOT, 'assets', 'data')
NAMES = ['height', 'agb', 'soil', 'lai', 'gpp', 'npp', 'rh']
ANNUAL_MEAN = {'lai', 'gpp', 'npp', 'rh'}
MAP_YEAR = 2015
# Global map tiles: 1 degree, 84N to 60S (CarbonGlobe's sites span 81.75N to 55.25S).
TILE_W, TILE_H, LAT0 = 360, 144, 84
MAP_VARS = [
    # key, label, unit, lo, hi, gamma, ramp (shared with the page)
    ('ta', 'Air temperature', 'K', 240, 310, 1, ['#26136b', '#2f6fc4', '#4fd3c4', '#f5c24b', '#f0553a']),
    ('pr', 'Precipitation', 'mm', 0, 400, 0.5, ['#10233a', '#13507a', '#1f8fb5', '#56d0e0', '#d9fbff']),
    ('hus', 'Specific humidity', 'kg kg⁻¹', 0, 0.022, 1, ['#1a1030', '#2c3d73', '#2e8a8c', '#6fd18f', '#e5ffb8']),
    ('rsds', 'Shortwave radiation', 'W m⁻²', 0, 330, 1, ['#120a1e', '#4a1559', '#b23a48', '#f2913a', '#fff1a8']),
    ('sfcWind', 'Wind speed', 'm s⁻¹', 1.5, 9.5, 1, ['#0c1a24', '#1c4d6b', '#4f8fb0', '#a6d3e6', '#f4fbff']),
    ('co2', 'CO₂', 'ppm', 392, 426, 1, ['#20123f', '#3b3a8c', '#2b7f9e', '#3cc29a', '#c8f27c']),
]
# Regional maps: (lat0, lat1, lon0, lon1); 300 x 200 px with longitudes scaled by cos(latitude).
AMAZON = (-22, 10, -82, -34)
BOREAL = (49, 73, -8, 66)
OCEAN, LAND = np.array([7, 19, 26]), np.array([22, 32, 30])


def hex2rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def colorize(t, ramp):
    stops = np.stack([hex2rgb(h) for h in ramp])
    t = np.clip(t, 0, 1) * (len(stops) - 1)
    i = np.minimum(np.floor(t).astype(int), len(stops) - 2)
    f = (t - i)[..., None]
    return stops[i] * (1 - f) + stops[i + 1] * f


def grid(rows, cols, v):
    g = np.full((360, 720), np.nan, np.float32)
    g[rows, cols] = v
    return g


def tile(g):
    """0.5-degree global grid -> 1-degree tile (mean of available cells), cropped to 84N..60S."""
    blocks = g.reshape(180, 2, 360, 2)
    count = (~np.isnan(blocks)).sum(axis=(1, 3))
    c = np.where(count > 0, np.nansum(blocks, axis=(1, 3)) / np.maximum(count, 1), np.nan)
    return c[90 - LAT0:90 - LAT0 + TILE_H]


def encode(t):
    out = np.zeros(t.shape, np.uint8)
    ok = ~np.isnan(t)
    out[ok] = 1 + np.round(np.clip(t[ok], 0, 1) * 254).astype(np.uint8)
    return out


def blur(a, sigma):
    if sigma <= 0:
        return a
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a = np.pad(a, r, mode='edge')
    a = np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 1, a)


def resample(a, size):
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize(size, Image.BICUBIC), np.float32)


def region(g, box, mask_hi, t, ramp, soft=0, size=(300, 200)):
    """Render one regional map: data cells resampled onto the Natural Earth coastline."""
    la0, la1, lo0, lo1 = box
    W, H = size
    r0, r1, c0, c1 = int((90 - la1) * 2), int((90 - la0) * 2), int((lo0 + 180) * 2), int((lo1 + 180) * 2)
    ok = ~np.isnan(g[r0:r1, c0:c1])
    cov = blur(resample(ok, size), soft)
    v = blur(resample(np.where(ok, t[r0:r1, c0:c1], 0), size), soft) / np.maximum(cov, 1e-6)
    lon = lo0 + (np.arange(W) + 0.5) / W * (lo1 - lo0)
    lat = la1 - (np.arange(H) + 0.5) / H * (la1 - la0)
    LON, LAT = np.meshgrid(lon, lat)
    # Natural Earth land fraction (2048 x 1024, row 0 = 90N), bilinear
    mh, mw = mask_hi.shape
    my, mx = (90 - LAT) / 180 * mh - 0.5, (LON + 180) / 360 * mw - 0.5
    y0, x0 = np.floor(my).astype(int), np.floor(mx).astype(int)
    ay, ax = my - y0, mx - x0
    land = np.zeros((H, W), np.float32)
    for dy, dx, w in ((0, 0, (1 - ay) * (1 - ax)), (0, 1, (1 - ay) * ax), (1, 0, ay * (1 - ax)), (1, 1, ay * ax)):
        land += mask_hi[np.clip(y0 + dy, 0, mh - 1), np.clip(x0 + dx, 0, mw - 1)] * w
    data = (np.clip((cov - 0.35) / 0.4, 0, 1) * np.clip(land * 1.5, 0, 1))[..., None]
    img = OCEAN + (LAND - OCEAN) * land[..., None]
    img = img * (1 - data) + colorize(np.clip(v, 0, 1), ramp) * data
    # graticule every 10 degrees and a thin coastline
    step_x, step_y = (lo1 - lo0) / W, (la1 - la0) / H
    gx = np.abs(((LON + 5) % 10) - 5) < step_x * 0.5
    gy = np.abs(((LAT + 5) % 10) - 5) < step_y * 0.5
    img = np.where((gx | gy)[..., None], img * 0.82 + 255 * 0.07, img)
    gy_, gx_ = np.gradient(land)
    edge = np.abs(gy_) + np.abs(gx_)
    img = img + np.clip(edge * 1.6, 0, 1)[..., None] * (np.array([215, 235, 225]) - img) * 0.55
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.path.join(ROOT, '..', 'sources', 'datasets'))
    src = ap.parse_args().source
    os.makedirs(os.path.join(OUT, 'forcing'), exist_ok=True)
    mask = np.load(os.path.join(src, 'data_stats', 'mask2d.npy'))
    rows, cols = np.nonzero(mask)
    n = rows.size
    lat, lon = 89.75 - rows * 0.5, -179.75 + cols * 0.5

    # ---- the drought site: largest 2015 -> 2016 (year index 34 -> 35) loss of a mature age-1 stand
    Y = np.load(os.path.join(src, 'data_global', 'glob_Y001.npy'), mmap_mode='r')
    agb = np.asarray(Y[:, :, 11, 1], np.float32)
    box = (lat >= -10) & (lat <= 5) & (lon >= -75) & (lon <= -50) & (agb[:, 34] > 7)
    idx = np.nonzero(box)[0]
    i = int(idx[np.argmax(1 - agb[idx, 35] / agb[idx, 34])])
    def site_series(Y):
        y = np.asarray(Y[i], np.float32)                 # (41, 12, 7)
        return {name: [round(float(x), 3) for x in (y[:, :, k].mean(1) if name in ANNUAL_MEAN else y[:, 11, k])]
                for k, name in enumerate(NAMES)}
    series = site_series(Y)
    # the same cell's 100-year-old stand: the film's drought view, a mature forest that the drought thins and kills back
    series100 = site_series(np.load(os.path.join(src, 'data_global', 'glob_Y100.npy'), mmap_mode='r'))

    # ---- monthly temperature and rain at every site, 1981..2020
    X = np.load(os.path.join(src, 'data_global', 'glob_X_fea.npy'), mmap_mode='r')
    assert X.shape == (n, 40, 12, 136), X.shape
    mt = np.zeros((n, 40, 12), np.float32)
    mp = np.zeros((n, 40, 12), np.float32)
    for s in range(0, n, 2000):
        blk = np.array(X[s:s + 2000, :, :, :2])
        mt[s:s + 2000], mp[s:s + 2000] = blk[..., 0], blk[..., 1]
        print('forcing', s, flush=True)
    yp, yt = mp.sum(2), mt.mean(2) - 273.15            # (n, 40) annual rain (mm) and temperature (C)
    pr = yp[i]

    sites = {'amazon': 43602, 'drought': i, 'boreal': 10198}
    meta = json.load(open(os.path.join(OUT, 'meta.json')))
    assert meta['story']['amazon']['site'] == sites['amazon'] and meta['story']['boreal']['site'] == sites['boreal']
    climate = {k: {'precip_mm': [round(float(v)) for v in yp[s]], 'temp_c': [round(float(v), 2) for v in yt[s]]}
               for k, s in sites.items()}

    # ---- the emulator's input maps: 2015, twelve months, six drivers
    k = MAP_YEAR - 1981
    x = np.array(X[:, k])                                # (n, 12, 136)
    fields = {
        'ta': x[..., 0], 'pr': x[..., 1],
        'hus': x[..., 33:129:4].mean(-1), 'rsds': x[..., 35:129:4].mean(-1), 'sfcWind': x[..., 36:129:4].mean(-1),
        'co2': x[..., 8:32].mean(-1),
    }
    atlas = np.zeros((TILE_H * 2 * len(MAP_VARS), TILE_W * 6), np.uint8)
    for v, (key, _, _, lo, hi, gamma, _) in enumerate(MAP_VARS):
        f = fields[key]
        print(key, 'p1/p50/p99', np.percentile(f, [1, 50, 99]).round(4))
        for m in range(12):
            t = tile(grid(rows, cols, (f[:, m] - lo) / (hi - lo)))
            t = np.where(np.isnan(t), np.nan, np.clip(t, 0, 1) ** gamma)
            r, c = 2 * v + m // 6, m % 6
            atlas[r * TILE_H:(r + 1) * TILE_H, c * TILE_W:(c + 1) * TILE_W] = encode(t)
    p = os.path.join(OUT, 'forcing', f'maps_{MAP_YEAR}.png')
    Image.fromarray(atlas, 'L').save(p, optimize=True)
    print(p, atlas.shape, os.path.getsize(p) // 1024, 'KB')

    # ---- regional maps for the four views
    land_hi = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'tex', 'land-mask.png')).convert('L'), np.float32) / 255
    mean_p = yp.mean(1)
    with np.errstate(divide='ignore', invalid='ignore'):
        pct = np.where(mean_p > 50, 100 * yp[:, k] / mean_p, np.nan)
    dry_months = (mp.mean(1) < 100).sum(1).astype(np.float32)          # 1981-2020 monthly climatology
    frozen_months = (mt.mean(1) < 273.15).sum(1).astype(np.float32)
    regions = {
        # key: box, field, lo, hi, gamma, ramp, title, unit, blur (px)
        'wet': (AMAZON, grid(rows, cols, mean_p), 0, 4000, 1, MAP_VARS[1][6], 'Rain', 'mm/yr', 0),
        'drought': (AMAZON, grid(rows, cols, pct), 30, 170, 1,
                    ['#f2a33a', '#8a5a2a', '#1a2a2c', '#1f7f86', '#5fe0d0'], f'{MAP_YEAR} rain', 'of normal', 0),
        'fire': (AMAZON, grid(rows, cols, dry_months), 0, 7, 1,
                 ['#0f2a1c', '#38431c', '#9a5a1c', '#ef7d2c', '#ffd27a'], 'Dry season', 'months <100 mm', 1.6),
        'cold': (BOREAL, grid(rows, cols, frozen_months), 0, 8, 1,
                 ['#10202a', '#1d4e7a', '#4b8fd0', '#a9d4f5', '#f4fbff'], 'Frozen months', 'below 0 °C', 1.6),
    }
    out_regions = {}
    for key, (bx, g, lo, hi, gamma, ramp, title, unit, soft) in regions.items():
        t = np.clip((g - lo) / (hi - lo), 0, 1) ** gamma
        img = region(g, bx, land_hi, t, ramp, soft)
        p = os.path.join(OUT, 'forcing', f'region_{key}.png')
        img.save(p, optimize=True)
        out_regions[key] = {'file': f'assets/data/forcing/region_{key}.png', 'box': list(bx), 'lo': lo, 'hi': hi,
                            'gamma': gamma, 'ramp': ramp, 'title': title, 'unit': unit}
        print(p, os.path.getsize(p) // 1024, 'KB')

    out = {
        'drought': {
            'label': 'Central Amazon', 'site': i, 'lat': float(lat[i]), 'lon': float(lon[i]),
            'temp_c': round(float(yt[i].mean()), 1), 'precip_mm': round(float(pr.mean())),
            'rule': 'Amazon-basin cell with the largest 2015-16 age-1 AGB loss',
            'precip_pct': [round(float(p), 1) for p in 100 * pr / pr.mean()],
            'age1': series,
            'age100': series100,
        },
        'climate': climate,
        'maps': {
            'file': f'assets/data/forcing/maps_{MAP_YEAR}.png', 'year': MAP_YEAR, 'tile': [TILE_W, TILE_H],
            'lat': [LAT0, LAT0 - TILE_H], 'cols': 6, 'source': 'MERRA-2 (via CarbonGlobe inputs)',
            'vars': [{'key': key, 'label': label, 'unit': unit, 'lo': lo, 'hi': hi, 'gamma': gamma, 'ramp': ramp}
                     for key, label, unit, lo, hi, gamma, ramp in MAP_VARS],
        },
        'regions': out_regions,
    }
    with open(os.path.join(OUT, 'scenarios.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    d = out['drought']
    print(i, d['lat'], d['lon'], 'AGB 2015->2016', series['agb'][34], series['agb'][35],
          'LAI', series['lai'][34], series['lai'][35], 'rain 2015 %', d['precip_pct'][34])


if __name__ == '__main__':
    main()
