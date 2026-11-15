"""Serve one provider at a time so coverage gaps cannot block other results."""
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from shapely.errors import ShapelyError
from shapely.geometry import shape

from .__main__ import load_credential, prepare
from .geometry import validate_geometry

LIVE_SOURCES = frozenset({
    "soilgrids", "imerg-power", "imerg-final", "srtm", "hls", "sentinel2",
    "smap", "ecostress", "gldas", "nldas",
})
DATED_SOURCES = LIVE_SOURCES - {"soilgrids", "srtm"}


def validate_request(payload):
    if not isinstance(payload, dict) or payload.get("source") not in LIVE_SOURCES:
        raise ValueError("Unknown data source")
    source = payload["source"]
    boundary = payload.get("boundary")
    if not isinstance(boundary, dict) or boundary.get("type") != "Polygon":
        raise ValueError("Expected a polygon")
    geometry = validate_geometry(shape(boundary))
    start, end = None, None
    if source in DATED_SOURCES:
        start = date.fromisoformat(payload["start"])
        end = date.fromisoformat(payload["end"])
        if not 0 <= (end - start).days <= 365 or end > date.today():
            raise ValueError("Use a historical period of at most 366 days")
    return source, geometry, start, end


def fetch_source(source, geometry, start, end):
    if source == "nldas" and not (-125 <= geometry.centroid.x <= -67 and 25 <= geometry.centroid.y <= 53):
        record = {"status": "no_coverage", "reason": "NLDAS regional coverage does not include the field centre"}
    else:
        record = prepare(geometry, start, end, [source], None)[source]
    return {
        **record,
        "source": source,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        **({"requestedPeriod": {"start": start.isoformat(), "end": end.isoformat()}} if start else {}),
    }


def local_main():
    credentials = Path(".env.earthdata")
    if credentials.is_file():
        load_credential(credentials)
    try:
        params = validate_request(json.load(sys.stdin))
    except (TypeError, ValueError, KeyError, IndexError, AttributeError, ShapelyError):
        print(json.dumps({"status": "invalid_request"}))
        return
    print(json.dumps(fetch_source(*params), allow_nan=False))


if __name__ == "__main__":
    local_main()
