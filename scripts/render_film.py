"""Render the film to an MP4 with its score, plus a poster frame and a social card.

Steps the page's deterministic render mode (index.html?render) frame by frame in headless Chromium
along the beat-timed edit in assets/film/cut.json, so the video shows exactly what the website draws;
scripts/soundtrack.py scores the same beats and the score is muxed in. The page is laid out at
1280 x 720 CSS pixels and captured at --scale device pixels per CSS pixel, so text and 3D stay sharp
at any size: 1.5 gives the website's 1920 x 1080 video, 3 a 3840 x 2160 master.
Requires: playwright (with Chromium), Pillow, imageio-ffmpeg, numpy.
Usage: python scripts/render_film.py [--scale 1.5] [--fps 30] [--seconds N] [--stills-only] [--audio-only]
       python scripts/render_film.py --scale 3 --master ../_work/carbonglobe-film-4k.mp4
           renders a high-quality master (CRF 14, AAC 384 kb/s, for YouTube) and makes the website's
           1920 x 1080 video from it
"""
import argparse, functools, http.server, io, json, os, shutil, subprocess, sys, tempfile, threading, time
import imageio_ffmpeg
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'film')
IMG = os.path.join(ROOT, 'assets', 'img')
VIDEO = os.path.join(OUT, 'carbonglobe-film.mp4')
CUT = json.load(open(os.path.join(OUT, 'cut.json')))
SPB = 60 / CUT['bpm']
# stills, in beats: the title once the sun is up, and the dataset in numbers
POSTER_BEAT, SOCIAL_BEAT = 8, 103.75


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


FF = imageio_ffmpeg.get_ffmpeg_exe()
WEB = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p']
# YouTube's recommended upload settings: High profile, closed GOP of half the frame rate, two B-frames
MASTER = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '15', '-bf', '2']


def mux(video_in, wav, video_out, audio='160k'):
    """Put the score next to the picture: AAC audio, the video stream copied as is."""
    out = video_out + '.part.mp4'
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', video_in, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
                    '-c:a', 'aac', '-b:a', audio, '-ar', '48000', '-shortest', '-movflags', '+faststart', out], check=True)
    os.replace(out, video_out)
    print(video_out, os.path.getsize(video_out) // 1024, 'KB')


def web_from_master(master, video_out):
    """The website's 1920 x 1080 video, made from the master."""
    out = video_out + '.part.mp4'
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', master, '-vf', 'scale=1920:1080:flags=lanczos', *WEB,
                    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], check=True)
    os.replace(out, video_out)
    print(video_out, os.path.getsize(video_out) // 1024, 'KB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--scale', type=float, default=1.5, help='device pixels per CSS pixel of the 1280 x 720 page')
    ap.add_argument('--master', help='also write a high-quality master here, and make the website video from it')
    ap.add_argument('--seconds', type=float, help='render only the first seconds (for checking)')
    ap.add_argument('--out', default=VIDEO, help='where to write the website video')
    ap.add_argument('--no-stills', action='store_true')
    ap.add_argument('--stills-only', action='store_true')
    ap.add_argument('--audio-only', action='store_true', help='re-score the existing video without rendering it again')
    args = ap.parse_args()
    W, H = 1280, 720
    tmp = tempfile.mkdtemp()
    wav = os.path.join(tmp, 'score.wav')
    if not args.stills_only:
        write_score(wav)   # before the long render, so a scoring error costs seconds, not the render
    if args.audio_only:
        mux(args.out, wav, args.out)
        return
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    httpd = serve()
    url = f'http://127.0.0.1:{httpd.server_address[1]}/index.html?render'
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=args.scale)
        page.goto(url, wait_until='networkidle')
        page.wait_for_function('window.__cg !== undefined', timeout=240000)
        page.wait_for_timeout(1500)
        duration = page.evaluate('window.__cg.duration')

        def shot(t):
            page.evaluate(f'window.__cg.frame({t:.4f})')
            return Image.open(io.BytesIO(page.screenshot(type='png'))).convert('RGB')

        if not args.stills_only:
            silent = os.path.join(tmp, 'silent.mp4')
            size = (round(W * args.scale), round(H * args.scale))
            writer = imageio_ffmpeg.write_frames(silent, size, fps=args.fps, codec='libx264',
                                                 output_params=(MASTER if args.master else WEB)[2:],
                                                 pix_fmt_out='yuv420p', macro_block_size=8)
            writer.send(None)
            n = int(round(min(duration, args.seconds or duration) * args.fps))
            t0 = time.time()
            for i in range(n):
                writer.send(shot(i / args.fps).tobytes())
                if i % 60 == 0:
                    print(f'frame {i}/{n}  {time.time() - t0:.0f}s', flush=True)
            writer.close()
            if args.master:
                os.makedirs(os.path.dirname(os.path.abspath(args.master)), exist_ok=True)
                mux(silent, wav, args.master, audio='384k')
                web_from_master(args.master, args.out)
            else:
                mux(silent, wav, args.out)
        if args.no_stills:
            browser.close()
            httpd.shutdown()
            return

        # stills: social card (the dataset in numbers), video poster (the title once the sun is up), and a
        # text-free fallback image
        page.set_viewport_size({'width': 1600, 'height': 900})
        shot(SOCIAL_BEAT * SPB).resize((1200, 675), Image.LANCZOS).crop((0, 22, 1200, 652)).save(os.path.join(IMG, 'social.jpg'), quality=88)
        shot(POSTER_BEAT * SPB).resize((1920, 1080), Image.LANCZOS).save(os.path.join(OUT, 'carbonglobe-film.jpg'), quality=86)
        page.add_style_tag(content='[data-u], .cell-label { visibility: hidden !important; } .titles { display: none !important; }')
        shot(POSTER_BEAT * SPB).resize((1600, 900), Image.LANCZOS).save(os.path.join(IMG, 'poster.jpg'), quality=84)
        browser.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
