"""Export compact browser data for the V2 CarbonGlobe website.

Reads the original CarbonGlobe arrays with read-only memory maps and writes:
  assets/data/grid/{var}_a{age}.png  41 annual global grids packed in one 8-bit atlas
  assets/data/climate.png            approximate Koppen main group per land cell
  assets/data/meta.json              scales, story trajectories, global series

Usage: python scripts/export_v2_data.py --source /path/to/datasets
"""
import argparse, json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'data')
NAMES = ['height', 'agb', 'soil', 'lai', 'gpp', 'npp', 'rh']
# Stocks use the December state; LAI and fluxes use the annual mean of 12 months.
ANNUAL_MEAN = {'lai', 'gpp', 'npp', 'rh'}
VMAX = {'height': 35, 'agb': 20, 'soil': 30, 'lai': 7, 'gpp': 4, 'npp': 2, 'rh': 2}
GAMMA = 0.5
ALL_AGES = [1, 10, 20, 30, 50, 70, 100, 150, 200, 250, 300, 350, 400, 450, 500]
GRID_AGES = [1, 50, 200]
COLS, ROWS = 7, 6  # 41 years -> 7 x 6 tiles


def annual(Y):
    """(N, 41, 12, 7) -> (N, 41, 7) using December stocks and annual-mean fluxes."""
    out = np.asarray(Y[:, :, 11, :], dtype=np.float32).copy()
    for k, n in enumerate(NAMES):
        if n in ANNUAL_MEAN:
            out[:, :, k] = np.asarray(Y[:, :, :, k], dtype=np.float32).mean(axis=2)
    return out


def encode(v, vmax):
    t = np.clip(v / vmax, 0, 1) ** GAMMA
    return (1 + np.round(t * 254)).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.path.join(HERE, '..', '..', 'sources', 'datasets'))
    args = ap.parse_args()
    src = args.source
    os.makedirs(os.path.join(OUT, 'grid'), exist_ok=True)

    mask = np.load(os.path.join(src, 'data_stats', 'mask2d.npy'))
    rows, cols = np.nonzero(mask)  # C order == site order
    n = rows.size
    lat = 89.75 - rows * 0.5
    lon = -179.75 + cols * 0.5
    w = np.cos(np.deg2rad(lat))

    data = {}
    for age in ALL_AGES:
        Y = np.load(os.path.join(src, 'data_global', f'glob_Y{age:03d}.npy'), mmap_mode='r')
        assert Y.shape == (n, 41, 12, 7), Y.shape
        data[age] = annual(Y)
        print('read age', age, flush=True)

    # ---- atlases
    for age in GRID_AGES:
        A = data[age]
        for k, name in enumerate(NAMES):
            atlas = np.zeros((ROWS * 360, COLS * 720), np.uint8)
            for y in range(41):
                g = np.zeros((360, 720), np.uint8)
                g[rows, cols] = encode(A[:, y, k], VMAX[name])
                r, c = divmod(y, COLS)
                atlas[r * 360:(r + 1) * 360, c * 720:(c + 1) * 720] = g
            p = os.path.join(OUT, 'grid', f'{name}_a{age}.png')
            Image.fromarray(atlas, 'L').save(p, optimize=True)
            print(p, os.path.getsize(p) // 1024, 'KB', flush=True)

    # ---- climate drivers (chunked over sites)
    X = np.load(os.path.join(src, 'data_global', 'glob_X_fea.npy'), mmap_mode='r')
    assert X.shape == (n, 40, 12, 136), X.shape
    clim_t = np.zeros((n, 12), np.float32)
    clim_p = np.zeros((n, 12), np.float32)
    yr_t = np.zeros((n, 40), np.float32)
    yr_p = np.zeros((n, 40), np.float32)
    yr_c = np.zeros((n, 40), np.float32)
    step = 1500
    for i in range(0, n, step):
        blk = np.asarray(X[i:i + step])
        t, p, c = blk[..., 0], blk[..., 1], blk[..., 8:32].mean(-1)
        clim_t[i:i + step] = t.mean(1)
        clim_p[i:i + step] = p.mean(1)
        yr_t[i:i + step] = t.mean(2)
        yr_p[i:i + step] = p.sum(2)
        yr_c[i:i + step] = c.mean(2)
        print('forcing', i, flush=True)

    # Approximate Koppen-Geiger main groups (Peel et al., 2007) from 40-year climatology.
    tc = clim_t - 273.15
    mat, tmin, tmax = tc.mean(1), tc.min(1), tc.max(1)
    pann = clim_p.sum(1)
    north = lat >= 0
    summer = np.where(north[:, None], np.isin(np.arange(12), [3, 4, 5, 6, 7, 8])[None],
                      np.isin(np.arange(12), [9, 10, 11, 0, 1, 2])[None])
    psum = (clim_p * summer).sum(1)
    pth = 2 * mat + np.where(psum >= 0.7 * pann, 28, np.where(psum <= 0.3 * pann, 0, 14))
    zone = np.where(tmin >= 18, 1, np.where(tmin > 0, 3, 4))
    zone = np.where(pann < 10 * pth, 2, zone)
    zone = np.where(tmax < 10, 5, zone).astype(np.uint8)
    g = np.zeros((360, 720), np.uint8)
    g[rows, cols] = zone
    Image.fromarray(g, 'L').save(os.path.join(OUT, 'climate.png'), optimize=True)
    zone_names = ['Tropical', 'Arid', 'Temperate', 'Cold', 'Polar']
    zone_share = {zone_names[z - 1]: round(float((zone == z).mean()), 4) for z in range(1, 6)}
    print('zones', zone_share)

    def wmean(a):
        return (a * w[:, None]).sum(0) / w.sum()

    # ---- global means
    gmean = {str(age): {name: [round(float(x), 4) for x in wmean(data[age][:, :, k])]
                        for k, name in enumerate(NAMES)} for age in ALL_AGES}
    forcing = {
        'temp_c': [round(float(x) - 273.15, 3) for x in wmean(yr_t)],
        'precip_mm': [round(float(x), 1) for x in wmean(yr_p)],
        'co2_ppm': [round(float(x), 2) for x in wmean(yr_c)],
    }

    # ---- story sites
    def nearest(la, lo):
        d = (lat - la) ** 2 + ((lon - lo) * np.cos(np.deg2rad(la))) ** 2
        return int(np.argmin(d))

    def best_in_box(la0, la1, lo0, lo1, age=1):
        idx = np.nonzero((lat >= la0) & (lat <= la1) & (lon >= lo0) & (lon <= lo1))[0]
        h = data[age][idx, 40, 0]
        return int(idx[np.argsort(h)[int(len(h) * 0.9)]])  # 90th percentile height

    sites = {
        'amazon': ('Central Amazon', best_in_box(-6, -1, -66, -56)),
        'congo': ('Congo Basin', best_in_box(-3, 3, 16, 26)),
        'appalachia': ('Eastern United States', best_in_box(35, 42, -84, -76)),
        'boreal': ('Boreal Finland', best_in_box(61, 65, 24, 30)),
        'savanna': ('Miombo woodland, Zambia', best_in_box(-15, -11, 25, 31)),
        'siberia': ('Central Siberia', best_in_box(58, 62, 95, 105)),
    }
    story = {}
    for key, (label, i) in sites.items():
        story[key] = {
            'label': label, 'site': i, 'lat': float(lat[i]), 'lon': float(lon[i]),
            'zone': zone_names[zone[i] - 1] if zone[i] else None,
            'temp_c': round(float(mat[i]), 1), 'precip_mm': round(float(pann[i])),
            'ages': {str(a): {name: [round(float(x), 3) for x in data[a][i, :, k]]
                              for k, name in enumerate(NAMES)} for a in ALL_AGES},
            'co2_ppm': [round(float(x), 1) for x in yr_c[i]],
            'temp_series': [round(float(x) - 273.15, 2) for x in yr_t[i]],
        }
        print(key, label, i, lat[i], lon[i], story[key]['zone'],
              story[key]['ages']['1']['height'][::10])

    meta = {
        'grid': {'width': 720, 'height': 360, 'cols': COLS, 'rows': ROWS, 'years': 41,
                 'first_year': 1981, 'encoding': 'byte 0 = no data; value = vmax * ((byte-1)/254)^(1/gamma)',
                 'gamma': GAMMA, 'ages': GRID_AGES},
        'vars': {name: {'vmax': VMAX[name], 'annual_mean': name in ANNUAL_MEAN} for name in NAMES},
        'sites': n, 'ages': ALL_AGES,
        'zones': zone_names, 'zone_share': zone_share,
        'global_mean': gmean, 'forcing': forcing, 'story': story,
    }
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('meta.json', os.path.getsize(os.path.join(OUT, 'meta.json')) // 1024, 'KB')


if __name__ == '__main__':
    main()
