"""Same-origin provider endpoint for the hosted AGRONA frontend."""
import json
import os
from http.server import BaseHTTPRequestHandler
from uuid import UUID

import requests
from shapely.errors import ShapelyError
from shapely.geometry import shape

from scripts.field_data.live import fetch_source, validate_request


class handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        body = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or len(auth) > 8192:
            return self.reply(401, {"status": "sign_in"})
        base = os.getenv("VITE_SUPABASE_URL", "").rstrip("/")
        key = os.getenv("VITE_SUPABASE_ANON_KEY", "")
        if not base or not key:
            return self.reply(503, {"status": "unconfigured"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 64000:
                return self.reply(413, {"status": "invalid_request"})
            payload = json.loads(self.rfile.read(length))
            source, geometry, start, end = validate_request(payload)
            field_id = str(UUID(payload["fieldId"])) if source != "soilgrids" else None
        except (TypeError, ValueError, KeyError, IndexError, AttributeError, ShapelyError):
            return self.reply(400, {"status": "invalid_request"})

        try:
            headers = {"Authorization": auth, "apikey": key}
            identity = requests.get(base + "/auth/v1/user", headers=headers, timeout=8)
            if identity.status_code in {401, 403}:
                return self.reply(401, {"status": "sign_in"})
            identity.raise_for_status()
            if field_id:
                field = requests.get(base + "/rest/v1/field_geojson", headers=headers, timeout=8,
                                     params={"id": "eq." + field_id, "select": "boundary", "limit": "1"})
                field.raise_for_status()
                rows = field.json()
                if not rows:
                    return self.reply(404, {"status": "field_not_found"})
                if not geometry.equals(shape(rows[0]["boundary"])):
                    return self.reply(409, {"status": "boundary_changed"})
        except (requests.RequestException, KeyError, TypeError, ValueError, ShapelyError):
            return self.reply(503, {"status": "field_unavailable"})

        data = fetch_source(source, geometry, start, end)
        return self.reply(200, data)
