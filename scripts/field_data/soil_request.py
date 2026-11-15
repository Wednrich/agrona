"""Read a validated field polygon from stdin and return a SoilGrids estimate."""
import json
import sys
from datetime import datetime, timezone

from shapely.geometry import shape

from .__main__ import validate_geometry
from .public import NoCoverage, soilgrids


def main():
    geometry = validate_geometry(shape(json.load(sys.stdin)))
    try:
        result = {"status": "ready", **soilgrids(geometry, None, None)}
    except NoCoverage:
        result = {"status": "no_coverage"}
    result["retrievedAt"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
