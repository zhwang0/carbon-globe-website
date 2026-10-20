"""Render the film to an MP4 with its score, plus a poster frame and a social card.

Steps the page's deterministic render mode (index.html?render) frame by frame in headless Chromium
along the beat-timed edit in assets/film/cut.json, so the video shows exactly what the website draws;
scripts/soundtrack.py scores the same beats and the score is muxed in.
Requires: playwright (with Chromium), Pillow, imageio-ffmpeg, numpy.
Usage: python scripts/render_film.py [--fps 30] [--width 1280 --height 720] [--stills-only] [--audio-only]
"""
import argparse, functools, http.server, io, json, os, shutil, subprocess, sys, tempfile, threading, time
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'film')
IMG = os.path.join(ROOT, 'assets', 'img')
VIDEO = os.path.join(OUT, 'carbonglobe-film.mp4')
CUT = json.load(open(os.path.join(OUT, 'cut.json')))
SPB = 60 / CUT['bpm']
# stills, in beats: the title once the sun is up, and the end card
POSTER_BEAT, SOCIAL_BEAT = 8, 122


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def write_score(wav):
    sys.path.insert(0, os.path.dirname(__file__))
    import soundtrack
    x, _ = soundtrack.score(CUT)
    soundtrack.write_wav(wav, x)


def mux(video_in, wav, video_out):
    """Put the score next to the picture: AAC audio, the video stream copied as is."""
    import imageio_ffmpeg
    out = video_out + '.part.mp4'
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-i', video_in, '-i', wav,
                    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
                    '-shortest', '-movflags', '+faststart', out], check=True)
    os.replace(out, video_out)
    print(video_out, os.path.getsize(video_out) // 1024, 'KB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=720)
    ap.add_argument('--stills-only', action='store_true')
    ap.add_argument('--audio-only', action='store_true', help='re-score the existing video without rendering it again')
    args = ap.parse_args()
    tmp = tempfile.mkdtemp()
    wav = os.path.join(tmp, 'score.wav')
    if not args.stills_only:
        write_score(wav)   # before the long render, so a scoring error costs seconds, not the render
    if args.audio_only:
        mux(VIDEO, wav, VIDEO)
        return
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    httpd = serve()
    url = f'http://127.0.0.1:{httpd.server_address[1]}/index.html?render'
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': args.width, 'height': args.height}, device_scale_factor=1)
        page.goto(url, wait_until='networkidle')
        page.wait_for_function('window.__cg !== undefined', timeout=240000)
        page.wait_for_timeout(1500)
        duration = page.evaluate('window.__cg.duration')

        def shot(t):
            page.evaluate(f'window.__cg.frame({t:.4f})')
            return Image.open(io.BytesIO(page.screenshot(type='png'))).convert('RGB')

        if not args.stills_only:
            import imageio_ffmpeg
            silent = os.path.join(tmp, 'silent.mp4')
            writer = imageio_ffmpeg.write_frames(silent, (args.width, args.height), fps=args.fps, codec='libx264',
                                                 output_params=['-crf', '24', '-preset', 'slow'],
                                                 pix_fmt_out='yuv420p', macro_block_size=8)
            writer.send(None)
            n = int(round(duration * args.fps))
            t0 = time.time()
            for i in range(n):
                writer.send(shot(i / args.fps).tobytes())
                if i % 60 == 0:
                    print(f'frame {i}/{n}  {time.time() - t0:.0f}s', flush=True)
            writer.close()
            mux(silent, wav, VIDEO)

        # stills: social card (the end card), video poster (the title once the sun is up), and a
        # text-free fallback image
        page.set_viewport_size({'width': 1600, 'height': 900})
        shot(SOCIAL_BEAT * SPB).resize((1200, 675), Image.LANCZOS).crop((0, 22, 1200, 652)).save(os.path.join(IMG, 'social.jpg'), quality=88)
        shot(POSTER_BEAT * SPB).resize((1280, 720), Image.LANCZOS).save(os.path.join(OUT, 'carbonglobe-film.jpg'), quality=86)
        page.add_style_tag(content='[data-u], .cell-label { visibility: hidden !important; } .titles { display: none !important; }')
        shot(POSTER_BEAT * SPB).save(os.path.join(IMG, 'poster.jpg'), quality=84)
        browser.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
