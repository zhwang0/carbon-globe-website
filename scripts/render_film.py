"""Render the scroll film to an MP4, a poster frame and a social card.

Steps the page's deterministic render mode (index.html?render) frame by frame in headless
Chromium, so the video shows exactly what the website draws.
Requires: playwright (with Chromium), Pillow, imageio-ffmpeg.
Usage: python scripts/render_film.py [--fps 30] [--width 1280 --height 720] [--stills-only]
"""
import argparse, functools, http.server, io, os, threading, time
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'film')
IMG = os.path.join(ROOT, 'assets', 'img')

# (seconds, film position u). Linear in between; holds give captions time to be read.
KEYS = [
    (0, 0), (3.0, 0.05), (8.0, 1.95), (8.6, 2.15), (15.0, 3.45), (16.2, 3.95), (22.0, 4.95),
    (23.5, 5.3), (25.0, 5.85), (27.5, 6.05), (30.0, 6.55), (31.0, 6.75), (36.0, 7.85), (37.0, 8.15),
    (40.5, 8.6), (43.5, 8.95), (46.5, 9.2), (48.0, 9.6), (53.0, 10.0),
]


def u_at(t):
    for (t0, u0), (t1, u1) in zip(KEYS, KEYS[1:]):
        if t <= t1:
            return u0 + (u1 - u0) * (t - t0) / (t1 - t0)
    return KEYS[-1][1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=720)
    ap.add_argument('--stills-only', action='store_true')
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    httpd = serve()
    url = f'http://127.0.0.1:{httpd.server_address[1]}/index.html?render'
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': args.width, 'height': args.height}, device_scale_factor=1)
        page.goto(url, wait_until='networkidle')
        page.wait_for_function('window.__cg !== undefined', timeout=180000)
        page.wait_for_timeout(1500)

        def shot(t):
            page.evaluate(f'window.__cg.frame({u_at(t):.5f}, {t:.4f})')
            return Image.open(io.BytesIO(page.screenshot(type='png'))).convert('RGB')

        if not args.stills_only:
            import imageio_ffmpeg
            path = os.path.join(OUT, 'carbonglobe-film.mp4')
            writer = imageio_ffmpeg.write_frames(path, (args.width, args.height), fps=args.fps, codec='libx264',
                                                 output_params=['-crf', '22', '-preset', 'slow', '-movflags', '+faststart'],
                                                 pix_fmt_out='yuv420p', macro_block_size=8)
            writer.send(None)
            n = int(KEYS[-1][0] * args.fps)
            t0 = time.time()
            for i in range(n + 1):
                writer.send(shot(i / args.fps).tobytes())
                if i % 60 == 0:
                    print(f'frame {i}/{n}  {time.time() - t0:.0f}s', flush=True)
            writer.close()
            print(path, os.path.getsize(path) // 1024, 'KB')

        # stills: social card (hero with title), video poster, and a text-free fallback image
        page.set_viewport_size({'width': 1600, 'height': 900})
        hero = shot(1.2)
        hero.resize((1200, 675), Image.LANCZOS).crop((0, 22, 1200, 652)).save(os.path.join(IMG, 'social.jpg'), quality=88)
        hero.resize((1280, 720), Image.LANCZOS).save(os.path.join(OUT, 'carbonglobe-film.jpg'), quality=86)
        page.add_style_tag(content='[data-u], .cell-label { visibility: hidden !important; }')
        shot(1.25).save(os.path.join(IMG, 'poster.jpg'), quality=84)
        browser.close()
    httpd.shutdown()


if __name__ == '__main__':
    main()
