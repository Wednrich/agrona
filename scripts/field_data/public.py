import json
import subprocess
from datetime import timedelta
from math import isfinite
from pathlib import Path
from time import sleep

import numpy as np
import requests
from rasterio.io import MemoryFile
from rasterio.warp import transform_geom
from shapely.geometry import box, mapping, shape

POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
SOILGRIDS = "https://maps.isric.org/mapserv"


class SourceError(Exception):
    pass


class NoCoverage(SourceError):
    pass


def get(url, **kwargs):
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=(10, 25), **kwargs)
        except (requests.Timeout, requests.ConnectionError):
            if attempt == 2:
                raise
            sleep(2**attempt)
            continue
        if response.status_code not in {429, 502, 503, 504} or attempt == 2:
            break
        delay = response.headers.get("Retry-After", "1")
        if not delay.isdecimal() or int(delay) > 10:
            break
        response.close()
        sleep(max(1, int(delay)))
    if not response.ok:
        raise SourceError(f"HTTP {response.status_code} · {response.url.split('?')[0]}")
    return response


def daily_power(geometry, start, end, parameters, time_standard):
    point = geometry.centroid
    params = {
        "parameters": ",".join(parameters), "community": "AG",
        "longitude": round(point.x, 6), "latitude": round(point.y, 6),
        "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }
    # NASA POWER's daily endpoint defaults to local solar time.
    if time_standard == "UTC":
        params["time-standard"] = time_standard
    response = get(POWER, params=params)
    payload = response.json()
    if not all(key in payload.get("properties", {}).get("parameter", {}) for key in parameters):
        raise SourceError("Response lacks a requested POWER parameter")
    columns = payload["properties"]["parameter"]
    fill = payload["header"]["fill_value"]
    rows = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        row = {"date": day.isoformat()}
        for key in parameters:
            value = columns[key].get(day.strftime("%Y%m%d"))
            valid = isinstance(value, (int, float)) and isfinite(value) and value not in (fill, -999)
            row[key] = value if valid and (key != "IMERG_PRECTOT" or value >= 0) else None
        rows.append(row)
    coverage = {key: sum(row[key] is not None for row in rows) for key in parameters}
    if not any(coverage.values()):
        raise NoCoverage("POWER returned no usable values")
    return {
        "method": "Field centroid sampled on the source grid", "timeStandard": time_standard,
        "resolution": {
            key: "0.1° × 0.1°" if key == "IMERG_PRECTOT" else
            "1° × 1°" if key == "ALLSKY_SFC_SW_DWN" else "0.5° × 0.625°"
            for key in parameters
        },
        "url": response.url, "upstream": payload["header"],
        "units": {key: payload["parameters"][key]["units"] for key in parameters},
        "coverageDays": coverage, "data": rows,
    }


def power(geometry, start, end):
    point = geometry.centroid
    try:
        reply = subprocess.run([
            "node", "--experimental-strip-types", str(Path(__file__).with_name("power.mjs")),
            f"{point.x:.8f}", f"{point.y:.8f}", str(start), str(end),
        ], capture_output=True, text=True, encoding="utf-8", timeout=150, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SourceError("Existing POWER loader unavailable; requires Node.js 22.6+") from None
    if reply.returncode:
        raise SourceError("Existing AGRONA POWER loader failed")
    data = json.loads(reply.stdout)
    if not any(data["coverageDays"].values()):
        raise NoCoverage("Existing POWER loader returned no usable values for the period")
    return data


def imerg_power(geometry, start, end):
    return daily_power(geometry, start, end, ("IMERG_PRECTOT",), "UTC")


def soil_layer(geometry, fraction, depth, statistic):
    west, south, east, north = geometry.bounds
    # WCS trims a rectangle. Pad it so that cells along the contour are retained.
    response = get(SOILGRIDS, params=[
        ("map", f"/map/{fraction}.map"), ("SERVICE", "WCS"), ("VERSION", "2.0.1"),
        ("REQUEST", "GetCoverage"), ("COVERAGEID", f"{fraction}_{depth}_{statistic}"),
        ("FORMAT", "GEOTIFF_INT16"),
        ("SUBSETTINGCRS", "http://www.opengis.net/def/crs/EPSG/0/4326"),
        ("SUBSET", f"Long({max(-180, west - .01):.8f},{min(180, east + .01):.8f})"),
        ("SUBSET", f"Lat({max(-90, south - .004):.8f},{min(90, north + .004):.8f})"),
    ])
    if not response.content.startswith((b"II", b"MM")):
        raise SourceError("SoilGrids WCS did not return a GeoTIFF")
    with MemoryFile(response.content) as file, file.open() as grid:
        if grid.crs is None or grid.transform.b != 0 or grid.transform.d != 0:
            raise SourceError("SoilGrids raster has unexpected georeferencing")
        return (grid.crs, grid.transform, grid.shape), grid.read(1, masked=True), response.url


def polygon_weights(geometry, grid):
    crs, affine, dimensions = grid
    footprint = shape(transform_geom("EPSG:4326", crs, mapping(geometry)))
    if not footprint.is_valid or footprint.area <= 0:
        raise SourceError("Polygon cannot be represented on the source grid")
    if dimensions[0] * dimensions[1] > 250_000:
        raise SourceError("Raster window exceeds the preparation limit")
    weights = np.zeros(dimensions, dtype=float)
    for row, col in np.ndindex(dimensions):
        left, top = affine * (col, row)
        right, bottom = affine * (col + 1, row + 1)
        weights[row, col] = footprint.intersection(box(left, bottom, right, top)).area
    return weights, footprint.area


def soilgrids(geometry, _start, _end):
    depths = ("0-5cm", "5-15cm", "15-30cm")
    fractions = ("sand", "silt", "clay")
    layers = []
    urls = []
    for depth in depths:
        rasters = [soil_layer(geometry, fraction, depth, "mean") for fraction in fractions]
        grid = rasters[0][0]
        if any(other_grid != grid for other_grid, _, _ in rasters):
            raise SourceError("SoilGrids fraction rasters do not align")
        weights, total = polygon_weights(geometry, grid)
        composition = np.stack([raster.astype(float).filled(np.nan) for _, raster, _ in rasters])
        # The provider constrains the three mean fractions to 1000 g/kg.
        # The tolerance covers rounding of the stored integer values.
        valid = (weights > 0) & np.all((composition >= 0) & (composition <= 1000), axis=0)
        valid &= np.abs(composition.sum(axis=0) - 1000) <= 5
        covered_area = weights[valid].sum()
        layers.append({
            "depthCm": [int(x) for x in depth.removesuffix("cm").split("-")],
            "areaCoverageFraction": round(float(covered_area / total), 5),
            "validPixels": int(valid.sum()), "intersectingPixels": int((weights > 0).sum()),
            "mean": {
                fraction: round(float(np.average(composition[i][valid], weights=weights[valid])), 2) if covered_area else None
                for i, fraction in enumerate(fractions)
            },
            "pixelRange": {
                fraction: [float(composition[i][valid].min()), float(composition[i][valid].max())] if covered_area else None
                for i, fraction in enumerate(fractions)
            },
        })
        urls.extend(url for _, _, url in rasters)
    if not any(layer["validPixels"] for layer in layers):
        raise NoCoverage("No valid texture composition intersects this contour")
    return {
        "dataset": "ISRIC SoilGrids 2.0", "resolutionMetres": 250, "units": "g/kg",
        "method": "Area-weighted overlap with valid cells on the native grid",
        "limitations": "Model estimate. Pixel range describes variability and does not represent prediction uncertainty.",
        "urls": urls, "data": layers,
    }


def nrcs_soil(geometry, general_map):
    # Build WKT from the validated numeric polygon, never from user SQL or free text.
    wkt = geometry.wkt
    url = "https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest"
    if general_map:
        units = f"""
          SELECT mukey FROM gsmmupolygon WHERE areasymbol = 'US' AND clipareasymbol = 'NE'
          AND mupolygongeo.STIntersects(geometry::STGeomFromText('{wkt}', 4326)) = 1
        """
    else:
        units = f"SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('{wkt}')"
    response = requests.post(url, timeout=(10, 45), json={
        "format": "JSON+COLUMNNAME",
        "query": f"""
        SELECT m.mukey, m.muname, c.compname, c.comppct_r,
               h.hzdept_r, h.hzdepb_r, h.sandtotal_r, h.silttotal_r, h.claytotal_r, h.awc_r
        FROM mapunit AS m
        JOIN component AS c ON c.mukey = m.mukey
        JOIN chorizon AS h ON h.cokey = c.cokey
        WHERE m.mukey IN ({units})
          AND h.hzdept_r < 30 AND c.comppct_r > 0
        ORDER BY m.mukey, c.comppct_r DESC, c.compname, h.hzdept_r
        """,
    })
    if not response.ok:
        raise SourceError(f"USDA Soil Data Access returned HTTP {response.status_code}")
    table = response.json().get("Table", [])
    if len(table) < 2:
        raise NoCoverage("No USDA soil map units for this contour")
    return {
        "dataset": "USDA NRCS STATSGO2" if general_map else "USDA NRCS SSURGO", "url": url,
        "method": "Intersecting map units and component horizons, no polygon-area averaging",
        "units": {"texture": "%", "depth": "cm", "awc": "cm/cm"},
        "data": [dict(zip(table[0], row)) for row in table[1:]],
    }


def ssurgo(geometry, _start, _end):
    return nrcs_soil(geometry, general_map=False)


def statsgo(geometry, _start, _end):
    return nrcs_soil(geometry, general_map=True)


def usgs_water(_geometry, start, end):
    # This station is an explicit sample for the Nebraska pilot, not an automatic
    # nearest-station or irrigation-availability calculation.
    url = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items"
    sample_end = min(end, start + timedelta(days=6))
    response = get(url, params={
        "monitoring_location_id": "USGS-06805500", "parameter_code": "00060",
        "statistic_id": "00003", "time": f"{start}/{sample_end}", "f": "json", "limit": 7,
    })
    rows = []
    for item in response.json().get("features", []):
        row = item["properties"]
        if row["unit_of_measure"] != "ft^3/s":
            raise SourceError("Unexpected USGS streamflow unit")
        rows.append({
            "date": row["time"], "value": float(row["value"]) if row["value"] is not None else None,
            "approval": row["approval_status"], "qualifier": row["qualifier"],
        })
    if not rows:
        raise NoCoverage("No daily streamflow returned for the selected station")
    return {
        "dataset": "USGS daily streamflow", "units": "ft³/s", "station": "USGS-06805500",
        "method": "Daily mean at a named station; regional context only", "url": response.url,
        "data": sorted(rows, key=lambda row: row["date"]),
    }
