"""Serve the built dashboard (dashboard/dist) from the LinuxONE VM.

    python infra/serve_dashboard.py <dist folder> [--port 3000] [--host 127.0.0.1]

A small static server with three differences from `python -m http.server`:
  * a path with no file behind it and no file extension (a client-side route such as /ring/RNG-1A2B3C) answers with index.html,
    so a page refresh or a pasted link works;
  * GET and HEAD only, no directory listings, and nothing outside the dist folder is ever served;
  * security headers: no sniffing, no referrer, and a content security policy that lets the page load only its own files and talk
    only to itself and the API on the VM's loopback (the browser reaches it through the SSH tunnel).
It serves files and nothing else; it holds no data and no credentials.
"""
import argparse
import http.server
import os
from pathlib import Path

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
       "connect-src 'self' http://localhost:8000 http://127.0.0.1:8000; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


def make_handler(root: Path):
    root = root.resolve()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def send_head(self):
            target = Path(self.translate_path(self.path))
            if target.is_dir():
                target = target / "index.html"
            inside = root == target.resolve() or root in target.resolve().parents
            if not inside:
                self.send_error(404, "Not found")
                return None
            if not target.is_file():
                if "." in Path(self.path.split("?")[0]).name:   # a missing asset is a real 404, not a page
                    self.send_error(404, "Not found")
                    return None
                self.path = "/index.html"   # a client-side route
            return super().send_head()

        def list_directory(self, path):
            self.send_error(404, "Not found")
            return None

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def _refuse(self):
            self.send_error(405, "Method not allowed")

        do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _refuse

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("dist", type=Path)
    ap.add_argument("--port", type=int, default=3000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    if not (args.dist / "index.html").is_file():
        raise SystemExit(f"{args.dist} has no index.html; build the dashboard first (cd dashboard && npm ci && npm run build)")
    server = http.server.ThreadingHTTPServer((args.host, args.port), make_handler(args.dist))
    print(f"dashboard on http://{args.host}:{args.port} serving {args.dist}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
