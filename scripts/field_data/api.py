"""WSGI entrypoint for the Vercel `field_data` service.

Serves the same contract as the Vite dev middleware in scripts/soil-server.mjs:
POST /api/soil with a GeoJSON Polygon body returns a SoilGrids estimate.
"""
import json
import os
import sys

# The service root is this directory, so sibling modules are imported top-level.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from soil_request import estimate  # noqa: E402

MAX_BODY = 64000
ROUTES = {"/api/soil", "/api/soil/"}


def _reply(start_response, status, body=b"", content_type=None):
    headers = [("Content-Length", str(len(body)))]
    if content_type:
        headers.append(("Content-Type", content_type))
    start_response(status, headers)
    return [body]


def app(environ, start_response):
    if environ.get("PATH_INFO", "/") not in ROUTES:
        return _reply(start_response, "404 Not Found")
    if environ.get("REQUEST_METHOD") != "POST":
        return _reply(start_response, "405 Method Not Allowed")
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if not 0 < length <= MAX_BODY:
        return _reply(start_response, "400 Bad Request")
    try:
        boundary = json.loads(environ["wsgi.input"].read(length))
        if boundary.get("type") != "Polygon":
            raise ValueError
    except (ValueError, AttributeError):
        return _reply(start_response, "400 Bad Request")
    try:
        result = estimate(boundary)
    except ValueError:
        return _reply(start_response, "400 Bad Request")
    except Exception:  # Upstream SoilGrids failures map to 503 like the dev server.
        return _reply(start_response, "503 Service Unavailable")
    body = json.dumps(result, allow_nan=False).encode("utf-8")
    return _reply(start_response, "200 OK", body, "application/json")
