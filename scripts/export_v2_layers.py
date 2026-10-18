"""Render colored map layers (inputs and outputs) for the dataset section.

Writes transparent 720x360 PNGs to assets/data/layers/.
Usage: python scripts/export_v2_layers.py --source /path/to/datasets
"""
import argparse, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'data', 'layers')

RAMPS = {
    'temp': ['#1b1446', '#4a1d7a', '#a8326e', '#ec6a3b', '#fbd05a'],
    'precip': ['#10233a', '#13507a', '#1f8fb5', '#56d0e0', '#d9fbff'],
    'co2': ['#20123f', '#3b3a8c', '#2b7f9e', '#3cc29a', '#c8f27c'],
    'soild': ['#2a1a10', '#5b3a1e', '#9a6a33', '#d1a45c', '#f6e1a6'],
    'height': ['#06231c', '#0c5a3e', '#1f9e5c', '#86dc5b', '#efffb0'],
    'agb': ['#0b2120', '#16514a', '#2b9b72', '#9bdc6a', '#f6ffc6'],
    'soilc': ['#24150a', '#5e3412', '#a5601d', '#e3a44a', '#ffe7a8'],
    'gpp': ['#081d2b', '#0d4b5c', '#139a8a', '#6fdc9a', '#e6ffc4'],
}


def hex2rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def colorize(t, ramp):
    stops = np.array([hex2rgb(h) for h in RAMPS[ramp]], np.float32)
    t = np.clip(t, 0, 1) * (len(stops) - 1)
    i = np.minimum(np.floor(t).astype(int), len(stops) - 2)
    f = (t - i)[..., None]
    return stops[i] * (1 - f) + stops[i + 1] * f


def save(name, rows, cols, t, ramp):
    img = np.zeros((360, 720, 4), np.uint8)
    img[rows, cols, :3] = colorize(t, ramp).astype(np.uint8)
    img[rows, cols, 3] = 255
    p = os.path.join(OUT, name + '.png')
    Image.fromarray(img, 'RGBA').save(p, optimize=True)
    print(p, os.path.getsize(p) // 1024, 'KB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.path.join(HERE, '..', '..', 'sources', 'datasets'))
    src = ap.parse_args().source
    os.makedirs(OUT, exist_ok=True)
    mask = np.load(os.path.join(src, 'data_stats', 'mask2d.npy'))
    rows, cols = np.nonzero(mask)
    n = rows.size

    X = np.load(os.path.join(src, 'data_global', 'glob_X_fea.npy'), mmap_mode='r')
    mat = np.zeros(n, np.float32); pann = np.zeros(n, np.float32)
    co2 = np.zeros(n, np.float32); sd = np.zeros(n, np.float32)  # saturated soil water content
    for i in range(0, n, 1500):
        blk = np.asarray(X[i:i + 1500])
        mat[i:i + 1500] = blk[..., 0].mean((1, 2)) - 273.15
        pann[i:i + 1500] = blk[..., 1].sum(2).mean(1)
        co2[i:i + 1500] = blk[:, -1, :, 8:32].mean((1, 2))
        sd[i:i + 1500] = blk[:, 0, 0, 130]
    print('mat', np.percentile(mat, [1, 50, 99]), 'pann', np.percentile(pann, [1, 50, 99]),
          'co2', np.percentile(co2, [1, 50, 99]), 'sd', np.percentile(sd, [1, 50, 99]))
    save('in_temp', rows, cols, (mat + 25) / 55, 'temp')
    save('in_precip', rows, cols, np.sqrt(np.clip(pann, 0, None) / 3500), 'precip')
    lo, hi = np.percentile(co2, [2, 98])
    save('in_co2', rows, cols, (co2 - lo) / (hi - lo), 'co2')
    lo, hi = np.percentile(sd, [2, 98])
    save('in_soil', rows, cols, (sd - lo) / (hi - lo), 'soild')

    Y = np.load(os.path.join(src, 'data_global', 'glob_Y200.npy'), mmap_mode='r')
    A = np.asarray(Y[:, 40, :, :])  # (n, 12, 7)
    save('out_height', rows, cols, np.sqrt(A[:, 11, 0] / 35), 'height')
    save('out_agb', rows, cols, np.sqrt(A[:, 11, 1] / 20), 'agb')
    save('out_soil', rows, cols, np.sqrt(A[:, 11, 2] / 30), 'soilc')
    save('out_gpp', rows, cols, np.sqrt(np.clip(A[:, :, 4].mean(1), 0, None) / 4), 'gpp')


if __name__ == '__main__':
    main()
