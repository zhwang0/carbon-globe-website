"""Render original 3D frames and encode a silent H.264 research concept film.

Requires Pillow, playwright (Chromium installed), and imageio-ffmpeg.
Run from any directory: python scripts/render_film.py [--stills-only]
Uses the existing exported ED reference trajectory; never alters source data.
"""
import argparse
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import hashlib
from pathlib import Path
import threading

import imageio_ffmpeg
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/film"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stills-only", action="store_true")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=ROOT))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"http://127.0.0.1:{server.server_port}/scripts/render_film.html")
            page.wait_for_function("window.filmReady", timeout=60000)

            def frame(t):
                encoded = page.evaluate("t => { window.renderFrame(t); return document.querySelector('canvas').toDataURL('image/png').split(',')[1]; }", t)
                return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")

            for name, time in [("forest", 5.3), ("network", 10.2), ("rollout", 19.7), ("poster", 5.3)]:
                frame(time).save(OUTPUT / f"{name}.jpg", quality=94, subsampling=0)
            meta = page.evaluate("window.filmMetadata")
            print("Rendered chapter stills", meta, flush=True)
            if not args.stills_only:
                fps = 24
                writer = imageio_ffmpeg.write_frames(str(OUTPUT / "carbon-globe-emulation.mp4"), (1280, 720), fps=fps, codec="libx264", pix_fmt_out="yuv420p", quality=None, output_params=["-crf", "23", "-movflags", "+faststart", "-preset", "slow"], macro_block_size=16)
                writer.send(None)
                try:
                    for i in range(meta["duration"] * fps):
                        writer.send(frame(i / fps).tobytes())
                        if i % fps == 0:
                            print(f"Encoded {i // fps}/{meta['duration']} seconds", flush=True)
                finally:
                    writer.close()
                count, duration = imageio_ffmpeg.count_frames_and_secs(str(OUTPUT / "carbon-globe-emulation.mp4"))
                assert count == fps * meta["duration"], (count, duration)
                meta.update(fps=fps, frames=count, encodedDuration=duration, silent=True)
            assert not errors, errors
            meta.update(geometry="Original procedural illustration; not individual-tree measurements", network="Conceptual architecture; no trained-model predictions", interpolation="Linear between annual December states for motion only", source="../data/carbon-globe.json", sourceSha256=hashlib.sha256((ROOT / 'assets/data/carbon-globe.json').read_bytes()).hexdigest(), variables={"height":"m", "agb":"kg C m^-2"})
            (OUTPUT / "provenance.json").write_text(json.dumps(meta, indent=2) + "\n")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
