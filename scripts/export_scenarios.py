"""Export the drought site shown in the film's "four forcings" view.

Picks, among Amazon-basin cells with a mature age-1 stand, the cell whose ED run loses the largest
share of aboveground biomass from 2015 to 2016 (the 2015-16 El Nino drought), and writes its age-1
trajectory with the annual precipitation anomaly to assets/data/scenarios.json.

Usage: python scripts/export_scenarios.py --source /path/to/datasets
"""
import argparse, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'data', 'scenarios.json')
NAMES = ['height', 'agb', 'soil', 'lai', 'gpp', 'npp', 'rh']
ANNUAL_MEAN = {'lai', 'gpp', 'npp', 'rh'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.path.join(HERE, '..', '..', 'sources', 'datasets'))
    src = ap.parse_args().source
    mask = np.load(os.path.join(src, 'data_stats', 'mask2d.npy'))
    rows, cols = np.nonzero(mask)
    lat, lon = 89.75 - rows * 0.5, -179.75 + cols * 0.5
    Y = np.load(os.path.join(src, 'data_global', 'glob_Y001.npy'), mmap_mode='r')
    agb = np.asarray(Y[:, :, 11, 1], np.float32)

    # 2015 -> 2016 is year index 34 -> 35 (index 0 is 1981)
    box = (lat >= -10) & (lat <= 5) & (lon >= -75) & (lon <= -50) & (agb[:, 34] > 7)
    idx = np.nonzero(box)[0]
    loss = 1 - agb[idx, 35] / agb[idx, 34]
    i = int(idx[np.argmax(loss)])

    y = np.asarray(Y[i], np.float32)                     # (41, 12, 7)
    series = {}
    for k, name in enumerate(NAMES):
        v = y[:, :, k].mean(1) if name in ANNUAL_MEAN else y[:, 11, k]
        series[name] = [round(float(x), 3) for x in v]
    X = np.load(os.path.join(src, 'data_global', 'glob_X_fea.npy'), mmap_mode='r')
    x = np.asarray(X[i], np.float32)                     # (40, 12, 136): forcing for 1981..2020
    pr = x[..., 1].sum(1)
    t = x[..., 0].mean() - 273.15
    out = {
        'drought': {
            'label': 'Central Amazon', 'site': i, 'lat': float(lat[i]), 'lon': float(lon[i]),
            'temp_c': round(float(t), 1), 'precip_mm': round(float(pr.mean())),
            'rule': 'Amazon-basin cell with the largest 2015-16 age-1 AGB loss',
            'precip_pct': [round(float(p), 1) for p in 100 * pr / pr.mean()],
            'age1': series,
        },
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    d = out['drought']
    print(i, d['lat'], d['lon'], 'AGB 2015->2016', series['agb'][34], series['agb'][35],
          'LAI', series['lai'][34], series['lai'][35], 'rain 2015 %', d['precip_pct'][34])


if __name__ == '__main__':
    main()
