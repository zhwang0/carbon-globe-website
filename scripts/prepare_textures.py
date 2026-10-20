"""Prepare the globe textures: NASA Blue Marble imagery, clouds and night lights, and a Natural Earth land mask.

Downloads (cached outside the website) and writes:
  assets/tex/earth-day.webp      4096 x 2048 Blue Marble Next Generation, July 2004, topography + bathymetry
  assets/tex/earth-day-2k.webp   2048 x 1024 version for phones
  assets/tex/earth-day-8k.webp   8192 x 4096 version for the rendered film (from the 21600 x 10800 image)
  assets/tex/clouds.webp         2048 x 1024 Blue Marble cloud cover (grey)
  assets/tex/night-lights.webp   2048 x 1024 Black Marble 2016 night lights (grey)
  assets/tex/amazon.webp         2400 x 1600 Blue Marble at 1 km for 5°N-11°S, 76°W-52°W, the film's dive into the Amazon
  assets/tex/amazon-cell.webp    2048 x 2048 Sentinel-2 cloudless 2016 (EOX, CC BY 4.0) at ~65 m around the dive's grid cell
  assets/tex/amazon-ground.webp  2048 x 2048 the same at ~11 m where the dive ends
  assets/tex/land-mask.png       2048 x 1024 antialiased land mask from Natural Earth 1:50m land polygons

Usage: python scripts/prepare_textures.py [--cache ../.texture-cache]   (Pillow and NumPy required)
"""
import argparse, hashlib, json, os, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'tex')
BLUE_MARBLE = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg'
BLUE_MARBLE_2KM = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x21600x10800.jpg'
CLOUDS = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg'
LIGHTS = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg'
# 500 m Blue Marble tiles of 90° x 90° (21600 px): B1 is 0-90°N, 90°W-0; B2 is 0-90°S, 90°W-0
TILE = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x21600x21600.{}.jpg'
AMAZON = (-76, 5, -52, -11)   # west, north, east, south; keep in step with the detail box in js/stage.js
# Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0,
# https://s2maps.eu, in WGS84 tiles of 256 px (level z: 2^(z+1) x 2^z tiles over the globe). Boxes in step with js/stage.js.
S2 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless/default/WGS84/{z}/{row}/{col}.jpg'
CELL = (-64.35, -2.65, -63.15, -3.85)
GROUND = (-63.78, -3.19, -63.58, -3.39)   # forest at the head of a black-water lake, inside the 0.5° cell
LAND_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19'
LAND_URL = f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{LAND_COMMIT}/geojson/ne_50m_land.geojson'
LAND_SHA256 = 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b'


def fetch(url, path):
    if not os.path.exists(path):
        print('downloading', url)
        urllib.request.urlretrieve(url, path)
    return path


def s2_mosaic(box, z, size, cache):
    """Sentinel-2 cloudless imagery of box (west, north, east, south) from level-z tiles, resampled to size."""
    w, n, e, s = box
    deg = 180 / 2 ** z                 # degrees per tile
    c0, c1 = int((w + 180) // deg), int((e + 180) // deg)
    r0, r1 = int((90 - n) // deg), int((90 - s) // deg)
    os.makedirs(os.path.join(cache, f's2-{z}'), exist_ok=True)
    mosaic = Image.new('RGB', ((c1 - c0 + 1) * 256, (r1 - r0 + 1) * 256))
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            tile = fetch(S2.format(z=z, row=r, col=c), os.path.join(cache, f's2-{z}', f'{r}_{c}.jpg'))
            mosaic.paste(Image.open(tile).convert('RGB'), ((c - c0) * 256, (r - r0) * 256))
    ppd = 256 / deg
    crop = (round((w + 180 - c0 * deg) * ppd), round((90 - n - r0 * deg) * ppd), round((e + 180 - c0 * deg) * ppd), round((90 - s - r0 * deg) * ppd))
    return mosaic.crop(crop).resize(size, Image.LANCZOS)


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
    clouds = Image.open(fetch(CLOUDS, os.path.join(cache, 'clouds-2048.jpg'))).convert('L').resize((2048, 1024), Image.LANCZOS)
    clouds.save(os.path.join(OUT, 'clouds.webp'), quality=72, method=6)
    # keep the lights of towns and cities, not the faint moonlit land and ice under them (levels up to ~55)
    lights = Image.open(fetch(LIGHTS, os.path.join(cache, 'blackmarble-2016.jpg'))).convert('L').resize((2048, 1024), Image.LANCZOS)
    lights.point([round(255 * max(0, (v - 58) / 197) ** 1.2) for v in range(256)]).save(os.path.join(OUT, 'night-lights.webp'), quality=80, method=6)
    # the Amazon at 1 km, cut from the two 500 m tiles either side of the equator
    w, n, e, s = AMAZON
    ppd = 21600 / 90
    x0, x1 = round((w + 90) * ppd), round((e + 90) * ppd)
    north = Image.open(fetch(TILE.format('B1'), os.path.join(cache, 'bluemarble-B1.jpg'))).crop((x0, round((90 - n) * ppd), x1, 21600))
    south = Image.open(fetch(TILE.format('B2'), os.path.join(cache, 'bluemarble-B2.jpg'))).crop((x0, 0, x1, round(-s * ppd)))
    amazon = Image.new('RGB', (x1 - x0, north.height + south.height))
    amazon.paste(north, (0, 0))
    amazon.paste(south, (0, north.height))
    amazon.resize((2400, 1600), Image.LANCZOS).save(os.path.join(OUT, 'amazon.webp'), quality=80, method=6)
    # closer still, the grid cell and the ground where the dive ends, from Sentinel-2, toned to the Blue Marble's
    # colours over the cell so the layers blend without a seam
    cell = s2_mosaic(CELL, 11, (2048, 2048), cache)
    ground = s2_mosaic(GROUND, 13, (2048, 2048), cache)
    bw = amazon.size[0] / (e - w)
    under = amazon.crop((round((CELL[0] - w) * bw), round((n - CELL[1]) * bw), round((CELL[2] - w) * bw), round((n - CELL[3]) * bw)))
    mb, ms = ImageStat.Stat(under).mean, ImageStat.Stat(cell).mean
    gain = np.array([b / max(1e-3, m) for b, m in zip(mb, ms)])
    luma = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    neutral = luma(mb) / luma(ms)

    def tone(im):
        # the forest takes the Blue Marble's colour; brighter pixels (haze, sandbanks) only its brightness, so they
        # do not turn yellow
        a = np.asarray(im, np.float32)
        k = np.clip((a @ np.array([0.299, 0.587, 0.114], np.float32) - 55) / 65, 0, 1)[..., None]
        k = k * k * (3 - 2 * k)
        return Image.fromarray(np.clip(a * (gain * (1 - k) + neutral * k), 0, 255).astype(np.uint8))
    tone(cell).save(os.path.join(OUT, 'amazon-cell.webp'), quality=78, method=6)
    tone(ground).save(os.path.join(OUT, 'amazon-ground.webp'), quality=80, method=6)
    # the film's sharper globe
    Image.open(fetch(BLUE_MARBLE_2KM, os.path.join(cache, 'bluemarble-2004-07-2km.jpg'))).convert('RGB').resize((8192, 4096), Image.LANCZOS).save(
        os.path.join(OUT, 'earth-day-8k.webp'), quality=84, method=6)
    mask = land_mask(fetch(LAND_URL, os.path.join(cache, 'ne_50m_land.geojson')))
    mask.save(os.path.join(OUT, 'land-mask.png'), optimize=True)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
