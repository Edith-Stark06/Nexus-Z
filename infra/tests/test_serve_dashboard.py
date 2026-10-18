import http.client
import threading
from http.server import ThreadingHTTPServer

import pytest

from infra.serve_dashboard import make_handler


@pytest.fixture
def server(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside the dist folder", encoding="utf-8")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(dist))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd.server_address[1]
    httpd.shutdown()


def fetch(port, path, method="GET"):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path)
    r = c.getresponse()
    body = r.read()
    return r.status, dict(r.getheaders()), body


def test_the_home_page_and_assets_are_served(server):
    status, _, body = fetch(server, "/")
    assert status == 200 and b"app" in body
    status, headers, body = fetch(server, "/assets/app.js")
    assert status == 200 and body == b"console.log(1)"


def test_a_client_side_route_gets_the_app_so_a_refresh_works(server):
    for path in ("/ring/RNG-1A2B3C", "/alerts", "/warning/ACC-000123", "/account/ACC-1?x=1"):
        status, _, body = fetch(server, path)
        assert status == 200 and body == b"<html>app</html>", path


def test_a_missing_file_is_a_404_not_the_app(server):
    assert fetch(server, "/assets/missing.js")[0] == 404
    assert fetch(server, "/favicon.ico")[0] == 404


def test_nothing_outside_the_dist_folder_is_served(server):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt"):
        status, _, body = fetch(server, path)
        assert b"outside the dist folder" not in body, path


def test_there_are_no_directory_listings(server):
    status, _, body = fetch(server, "/assets/")
    assert b"app.js" not in body


def test_only_get_and_head_are_accepted(server):
    for method in ("POST", "PUT", "DELETE", "PATCH", "OPTIONS"):
        assert fetch(server, "/", method)[0] == 405, method
    assert fetch(server, "/", "HEAD")[0] == 200


def test_security_headers_are_sent_and_the_policy_names_only_the_api_on_loopback(server):
    _, headers, _ = fetch(server, "/")
    assert headers["X-Content-Type-Options"] == "nosniff" and headers["Referrer-Policy"] == "no-referrer"
    csp = headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp and "http://127.0.0.1:8000" in csp and "*" not in csp


def test_bundled_fonts_are_allowed_but_only_from_self_or_data(server):
    _, headers, _ = fetch(server, "/")
    assert "font-src 'self' data:" in headers["Content-Security-Policy"]
