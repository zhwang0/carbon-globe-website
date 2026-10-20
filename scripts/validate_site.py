"""Static checks for the CarbonGlobe website (standard library only).

Verifies that every local file referenced by index.html, the CSS and the JS modules exists,
and that the exported data has the expected shapes. Exit code 1 on any failure.
Usage: python scripts/validate_site.py
"""
import json, os, re, struct, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
errors = []


def local(ref):
    return not re.match(r'^(https?:|mailto:|data:|#|//)', ref)


def exists(path, where):
    if not os.path.exists(os.path.join(ROOT, path)):
        errors.append(f'{where}: missing {path}')


def png_size(path):
    with open(os.path.join(ROOT, path), 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'{path} is not a PNG')
    return struct.unpack('>II', head[16:24])


html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
    if local(ref):
        exists(ref.split('#')[0].split('?')[0], 'index.html')
ids = set(re.findall(r'id="([^"]+)"', html))
for ref in re.findall(r'href="#([^"]+)"', html):
    if ref and ref not in ids:
        errors.append(f'index.html: anchor #{ref} has no target')

css = open(os.path.join(ROOT, 'css', 'main.css'), encoding='utf-8').read()
for ref in re.findall(r'url\("?([^")]+)"?\)', css):
    if local(ref):
        exists(os.path.normpath(os.path.join('css', ref)), 'main.css')

js_dir = os.path.join(ROOT, 'js')
for name in sorted(os.listdir(js_dir)):
    src = open(os.path.join(js_dir, name), encoding='utf-8').read()
    for ref in re.findall(r"""(?:from\s+|import\(|new URL\()\s*['"]([^'"]+)['"]""", src):
        exists(os.path.normpath(os.path.join('js', ref)), name)
    for ref in re.findall(r"""['"`](assets/[^'"`$]+)['"`]""", src):
        exists(ref, name)
    for sel in re.findall(r"""\$\('#([\w-]+)'\)""", src):
        if sel not in ids:
            errors.append(f'{name}: #{sel} not found in index.html')

meta = json.load(open(os.path.join(ROOT, 'assets', 'data', 'meta.json')))
g = meta['grid']
assert meta['sites'] == 54152, 'unexpected site count'
for var in meta['vars']:
    for age in g['ages']:
        path = f'assets/data/grid/{var}_a{age}.png'
        exists(path, 'meta.json')
        if os.path.exists(os.path.join(ROOT, path)):
            size = png_size(path)
            if size != (g['width'] * g['cols'], g['height'] * g['rows']):
                errors.append(f'{path}: unexpected size {size}')
for key in ['amazon', 'congo', 'savanna', 'appalachia', 'boreal', 'siberia']:
    s = meta['story'][key]
    for age in meta['ages']:
        for var in meta['vars']:
            if len(s['ages'][str(age)][var]) != g['years']:
                errors.append(f'story {key}/{age}/{var}: expected {g["years"]} values')
scen = json.load(open(os.path.join(ROOT, 'assets', 'data', 'scenarios.json')))
for var in ('height', 'agb', 'lai'):
    if len(scen['drought']['age1'][var]) != g['years']:
        errors.append(f'scenarios.json drought/{var}: expected {g["years"]} values')
for key in ('amazon', 'drought', 'boreal'):
    for var in ('precip_mm', 'temp_c'):
        if len(scen['climate'][key][var]) != g['years'] - 1:
            errors.append(f'scenarios.json climate/{key}/{var}: expected {g["years"] - 1} values')
M = scen['maps']
exists(M['file'], 'scenarios.json')
if os.path.exists(os.path.join(ROOT, M['file'])) and png_size(M['file']) != (M['tile'][0] * M['cols'], M['tile'][1] * 2 * len(M['vars'])):
    errors.append(f'{M["file"]}: unexpected size')
for key in ('wet', 'drought', 'fire', 'cold'):
    exists(scen['regions'][key]['file'], 'scenarios.json')
if png_size('assets/data/climate.png') != (720, 360):
    errors.append('climate.png: unexpected size')


def mp4_seconds(path):
    # duration from the movie header ('moov' > 'mvhd'), enough to keep the page's copy in step
    with open(os.path.join(ROOT, path), 'rb') as f:
        data = f.read()

    def boxes(lo, hi):
        while lo + 8 <= hi:
            size, kind = struct.unpack('>I4s', data[lo:lo + 8])
            head = 8
            if size == 1:
                size, head = struct.unpack('>Q', data[lo + 8:lo + 16])[0], 16
            elif size == 0:
                size = hi - lo
            yield kind, lo + head, lo + size
            lo += size

    for kind, a, b in boxes(0, len(data)):
        if kind == b'moov':
            for k, c, _ in boxes(a, b):
                if k == b'mvhd':
                    if data[c] == 1:
                        scale, dur = struct.unpack('>IQ', data[c + 20:c + 32])
                    else:
                        scale, dur = struct.unpack('>II', data[c + 12:c + 20])
                    return dur / scale
    raise ValueError(f'{path}: no movie header')


secs = re.search(r'id="film-secs">(\d+)<', html)
film = 'assets/film/carbonglobe-film.mp4'
if secs and os.path.exists(os.path.join(ROOT, film)):
    try:
        if abs(mp4_seconds(film) - int(secs.group(1))) > 0.6:
            errors.append(f'index.html: the film is {mp4_seconds(film):.1f} s, the page says {secs.group(1)} s')
    except ValueError as e:
        errors.append(str(e))

if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'OK: links, modules and data checked ({len(meta["vars"]) * len(g["ages"])} global grids).')
