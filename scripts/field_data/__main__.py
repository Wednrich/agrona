import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from shapely.geometry import box, mapping, shape

from .earthdata import ecostress, hls, modis, smap, srtm, viirs
from .geometry import validate_geometry
from .gesdisc import gldas, imerg_final, nldas
from .public import NoCoverage, SourceError, imerg_power, power, soilgrids, ssurgo, statsgo, usgs_water
from .regional import cocorahs, fao_calendar, gaez, landfire, naip, nlcd, prism, sentinel2

# Only the optional local archive reader uses aiohttp.
try:
    from aiohttp import ClientError
except ModuleNotFoundError as error:
    if error.name != "aiohttp":
        raise
    NETWORK_ERRORS = (requests.RequestException,)
else:
    NETWORK_ERRORS = (requests.RequestException, ClientError)

LOCAL_ARCHIVE_PACKAGES = {"h5py", "fsspec", "aiohttp"}

# Public sampling contours, not claims about field ownership or actual crop history.
PILOTS = {
    "kz": box(76.696, 43.245, 76.706, 43.252),
    "us-ne": box(-96.505, 41.146, -96.495, 41.153),
}
SOURCES = {
    "power": power,
    "soilgrids": soilgrids,
    "hls": hls,
    "srtm": srtm,
    "smap": smap,
    "ecostress": ecostress,
    "imerg-power": imerg_power,
    "imerg-final": imerg_final,
    "gldas": gldas,
    "nldas": nldas,
    "modis": modis,
    "viirs": viirs,
    "ssurgo": ssurgo,
    "statsgo": statsgo,
    "usgs-water": usgs_water,
    "prism": prism,
    "landfire": landfire,
    "sentinel2": sentinel2,
    "nlcd": nlcd,
    "naip": naip,
    "gaez": gaez,
    "cocorahs": cocorahs,
    "fao-calendar": None,
}
US_ONLY = {"ssurgo", "statsgo", "usgs-water", "prism", "landfire", "nlcd", "cocorahs", "naip"}


def load_credential(path):
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() == "EARTHDATA_TOKEN":
            os.environ.setdefault("EARTHDATA_TOKEN", value.strip().strip("\"'"))
            return


def prepare(geometry, start, end, names, pilot):
    results = {}
    for name in names:
        if name in US_ONLY and pilot != "us-ne":
            results[name] = {"status": "outside_pilot", "reason": "Configured for the Nebraska pilot"}
            continue
        if name == "fao-calendar" and pilot is None:
            results[name] = {"status": "outside_pilot", "reason": "Requires a verified country or a configured pilot"}
            continue
        try:
            record = fao_calendar("US" if pilot == "us-ne" else "KZ") if name == "fao-calendar" else SOURCES[name](geometry, start, end)
            results[name] = {"status": "ready", **record}
        except NoCoverage as error:
            results[name] = {"status": "no_coverage", "reason": str(error)}
        except SourceError as error:
            results[name] = {"status": "blocked", "reason": str(error)}
        except ModuleNotFoundError as error:
            if error.name not in LOCAL_ARCHIVE_PACKAGES:
                raise
            results[name] = {"status": "blocked", "reason": "Requires the local NASA archive pipeline"}
        except NETWORK_ERRORS as error:
            # Exception strings may expose redirected URLs, so keep the network error class only.
            results[name] = {"status": "blocked", "reason": type(error).__name__}
        except (KeyError, ValueError, OSError, RuntimeError, StopIteration) as error:
            results[name] = {"status": "blocked", "reason": f"Unsupported or malformed response: {type(error).__name__}"}
        print(f"{name}: {results[name]['status']} {results[name].get('reason', '')}", file=sys.stderr, flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    field = parser.add_mutually_exclusive_group(required=True)
    field.add_argument("--pilot", choices=PILOTS)
    field.add_argument("--boundary", type=Path, help="Path to a GeoJSON Polygon or Feature")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2025, 5, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2025, 9, 30))
    parser.add_argument("--sources", nargs="+", choices=SOURCES, default=list(SOURCES))
    parser.add_argument("--env-file", type=Path, help="Read only EARTHDATA_TOKEN from this file")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 0 <= (args.end - args.start).days <= 365:
        parser.error("Select a period from one day to one year")
    if args.env_file:
        load_credential(args.env_file)
    if args.pilot:
        geometry = PILOTS[args.pilot]
    else:
        payload = json.loads(args.boundary.read_text(encoding="utf-8-sig"))
        geometry = shape(payload["geometry"] if payload["type"] == "Feature" else payload)
    geometry = validate_geometry(geometry)
    results = prepare(geometry, args.start, args.end, args.sources, args.pilot)
    package = {
        "schemaVersion": 1, "pilot": args.pilot, "boundary": mapping(geometry),
        "period": {"start": args.start.isoformat(), "end": args.end.isoformat()},
        "retrievedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sources": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(package, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8")
    return 1 if any(row["status"] == "blocked" for row in results.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
