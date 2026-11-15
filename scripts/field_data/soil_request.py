"""Read a validated field polygon from stdin and return a SoilGrids estimate."""
import json
import sys
from datetime import datetime, timezone

from shapely.geometry import shape

try:
    from .geometry import validate_geometry
    from .public import NoCoverage, soilgrids
except ImportError:  # Loaded as a top-level module by the Vercel field_data service.
    from geometry import validate_geometry
    from public import NoCoverage, soilgrids


def estimate(boundary):
    """Return the /api/soil response body for a GeoJSON Polygon."""
    geometry = validate_geometry(shape(boundary))
    try:
        result = {"status": "ready", **soilgrids(geometry, None, None)}
    except NoCoverage:
        result = {"status": "no_coverage"}
    result["retrievedAt"] = datetime.now(timezone.utc).isoformat()
    return result


def main():
    print(json.dumps(estimate(json.load(sys.stdin)), allow_nan=False))


if __name__ == "__main__":
    main()
