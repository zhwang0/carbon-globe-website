"""Prepare the globe textures: NASA Blue Marble imagery and a Natural Earth land mask.

Downloads (cached outside the website) and writes:
  assets/tex/earth-day.webp      4096 x 2048 Blue Marble Next Generation, July 2004, topography + bathymetry
  assets/tex/earth-day-2k.webp   2048 x 1024 version for phones
  assets/tex/land-mask.png       2048 x 1024 antialiased land mask from Natural Earth 1:50m land polygons

Usage: python scripts/prepare_textures.py [--cache ../.texture-cache]   (Pillow required)
"""
import argparse, hashlib, json, os, urllib.request
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'tex')
BLUE_MARBLE = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg'
LAND_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19'
LAND_URL = f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{LAND_COMMIT}/geojson/ne_50m_land.geojson'
LAND_SHA256 = 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b'


def fetch(url, path):
    if not os.path.exists(path):
        print('downloading', url)
        urllib.request.urlretrieve(url, path)
    return path


def land_mask(geojson_path, width=2048, supersample=4):
    raw = open(geojson_path, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != LAND_SHA256:
        raise ValueError('Natural Earth source differs from the pinned file.')
    W, H = width * supersample, width // 2 * supersample
    high = Image.new('L', (W, H), 0)
    for feature in json.loads(raw)['features']:
        g = feature['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for rings in polys:
            pts = [[((lon + 180) / 360 * W - 0.5, (90 - lat) / 180 * H - 0.5) for lon, lat, *_ in ring] for ring in rings]
            xs, ys = [x for x, _ in pts[0]], [y for _, y in pts[0]]
            l, t = max(0, int(min(xs))), max(0, int(min(ys)))
            r, b = min(W, int(max(xs)) + 2), min(H, int(max(ys)) + 2)
            if r <= l or b <= t:
                continue
            # Draw each polygon (with its holes) locally, then union it into the mask.
            layer = Image.new('L', (r - l, b - t), 0)
            d = ImageDraw.Draw(layer)
            d.polygon([(x - l, y - t) for x, y in pts[0]], fill=255)
            for hole in pts[1:]:
                d.polygon([(x - l, y - t) for x, y in hole], fill=0)
            high.paste(255, (l, t, r, b), layer)
    # Pad in longitude so filtering wraps across the antimeridian.
    pad = 8 * supersample
    wrap = Image.new('L', (W + 2 * pad, H))
    wrap.paste(high, (pad, 0))
    wrap.paste(high.crop((W - pad, 0, W, H)), (0, 0))
    wrap.paste(high.crop((0, 0, pad, H)), (W + pad, 0))
    return wrap.resize((width + 16, width // 2), Image.LANCZOS).crop((8, 0, width + 8, width // 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(HERE, '..', '..', '.texture-cache'))
    cache = ap.parse_args().cache
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = None
    day = Image.open(fetch(BLUE_MARBLE, os.path.join(cache, 'bluemarble-2004-07.jpg'))).convert('RGB')
    big = day.resize((4096, 2048), Image.LANCZOS)
    big.save(os.path.join(OUT, 'earth-day.webp'), quality=84, method=6)
    big.resize((2048, 1024), Image.LANCZOS).save(os.path.join(OUT, 'earth-day-2k.webp'), quality=84, method=6)
    mask = land_mask(fetch(LAND_URL, os.path.join(cache, 'ne_50m_land.geojson')))
    mask.save(os.path.join(OUT, 'land-mask.png'), optimize=True)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
