import json
from io import BytesIO
from datetime import timedelta
from urllib.parse import urlsplit
from zipfile import ZipFile

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.warp import transform
from rasterio.windows import Window

from .public import NoCoverage, SourceError, get

FAO = "https://api-cropcalendar.apps.fao.org/api/v1"
LANDFIRE = "https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVT_CONUS/ImageServer/identify"
PRISM = "https://services.nacse.org/prism/data/get/us/4km/ppt"
NLCD = "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms"
GAEZ = "https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/MAPSET/RES05-SIX"


def fao_calendar(country):
    response = get(f"{FAO}/countries/{country}/cropCalendar", params={"language": "en"})
    if response.status_code == 204:
        raise NoCoverage(f"FAO Crop Calendar has no records for {country}")
    payload = response.json()
    if not isinstance(payload, list) or not payload:
        raise NoCoverage(f"FAO Crop Calendar has no records for {country}")
    return {
        "dataset": "FAO Crop Calendar", "url": response.url,
        "method": "Public country records require checking the local agroecological zone",
        "data": payload,
    }


def gaez(geometry, _start, _end):
    point = geometry.centroid
    rows = []
    for crop, name in (("WHE", "wheat"), ("MZE", "grain maize")):
        for management, description in (("HRLM", "rainfed, high input"), ("HILM", "irrigated, high input")):
            response = get(f"{GAEZ}/GAEZ-V5.RES05-SIX.HP0120.AGERA5.HIST.{crop}.{management}.tif")
            with MemoryFile(response.content) as file, file.open() as raster:
                x, y = transform("EPSG:4326", raster.crs, [point.x], [point.y])
                value = next(raster.sample(zip(x, y), masked=True))[0]
                value = int(value) if not np.ma.is_masked(value) and np.isfinite(value) and value > 0 else None
                rows.append({
                    "crop": name, "cropCode": crop, "management": description, "managementCode": management,
                    "classCode": value, "url": response.url, "gridCrs": raster.crs.to_string(),
                    "pixelSize": [round(abs(n), 8) for n in raster.res],
                })
    if not any(row["classCode"] is not None for row in rows):
        raise NoCoverage("No GAEZ suitability class at the field centroid")
    return {
        "dataset": "FAO/IIASA GAEZ v5 RES05-SIX, AgERA5 historical", "units": "categorical class code",
        "method": "Centroid raster cell; modeled regional suitability under stated management",
        "period": {"startYear": 2001, "endYear": 2020}, "data": rows,
    }


def cocorahs(_geometry, start, end):
    url = "https://www.ncei.noaa.gov/access/services/data/v1"
    sample_end = min(end, start + timedelta(days=6))
    response = get(url, params={
        "dataset": "daily-summaries", "stations": "US1NESY0043", "startDate": str(start),
        "endDate": str(sample_end), "format": "json", "dataTypes": "PRCP",
        "includeStationName": "true", "includeStationLocation": "true",
        "includeAttributes": "true", "units": "metric",
    })
    if response.status_code == 204:
        raise NoCoverage("The selected CoCoRaHS station has no daily data in the requested period")
    payload = response.json()
    if not payload:
        raise NoCoverage("The selected CoCoRaHS station has no daily data in the requested period")
    rows = []
    for row in payload:
        raw = row.get("PRCP")
        flags = row.get("PRCP_ATTRIBUTES", "").split(",")
        quality_flag = flags[1] if len(flags) > 1 else None
        value = float(raw) if raw is not None and quality_flag == "" else None
        rows.append({
            "date": row["DATE"], "precipitationMm": value if value is None or value >= 0 else None,
            "attributes": row.get("PRCP_ATTRIBUTES"),
        })
    return {
        "dataset": "CoCoRaHS via NOAA GHCN Daily Summaries", "url": response.url, "units": "mm",
        "station": {"id": "NE-SY-43", "ghcn": "US1NESY0043", "name": payload[0]["NAME"],
                    "location": [float(payload[0]["LONGITUDE"]), float(payload[0]["LATITUDE"])]},
        "method": "Daily station precipitation; reporting day is not a synchronized gridded UTC day",
        "data": sorted(rows, key=lambda row: row["date"]),
    }


def nlcd(geometry, start, _end):
    point = geometry.centroid
    layer = "Land-Cover-Native_conus_year_data"
    year = min(start.year, 2025)
    response = get(NLCD, params={
        "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetFeatureInfo", "TIME": f"{year}-01-01",
        "LAYERS": layer, "QUERY_LAYERS": layer, "STYLES": "", "SRS": "EPSG:4326",
        "BBOX": f"{point.x-.001},{point.y-.001},{point.x+.001},{point.y+.001}",
        "WIDTH": 3, "HEIGHT": 3, "X": 1, "Y": 1, "FORMAT": "image/png", "INFO_FORMAT": "application/json",
    })
    features = response.json().get("features", [])
    code = features[0]["properties"].get("PALETTE_INDEX") if features else None
    if code not in {11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95}:
        raise NoCoverage("No valid Annual NLCD class at the field centroid")
    return {
        "dataset": "USGS Annual NLCD Land Cover CONUS", "url": response.url,
        "method": "Land-cover class at field centroid, context only", "resolutionMetres": 30,
        "units": "categorical code", "data": {"year": year, "code": code},
    }


def landfire(geometry, _start, _end):
    point = geometry.centroid
    response = get(LANDFIRE, params={
        "geometry": json.dumps({"x": point.x, "y": point.y, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPoint", "returnGeometry": "false",
        "returnCatalogItems": "false", "f": "json",
    })
    payload = response.json()
    code = payload.get("value")
    if not str(code).isdecimal():
        raise NoCoverage("LANDFIRE returned no raster class at the centroid")
    return {
        "dataset": "LANDFIRE LF 2024 Existing Vegetation Type (CONUS)",
        "url": response.url, "method": "Class code at field centroid, context only",
        "units": "categorical code", "resolutionMetres": 30, "data": {"code": int(code)},
    }


def prism(geometry, start, _end):
    point = geometry.centroid
    response = get(f"{PRISM}/{start:%Y%m%d}")
    with ZipFile(BytesIO(response.content)) as archive:
        entry, = [item for item in archive.infolist() if item.filename.endswith(".tif")]
        if entry.file_size > 30 * 1024**2:
            raise SourceError("PRISM raster exceeds the allowed size")
        with MemoryFile(archive.read(entry)) as file, file.open() as raster:
            x, y = transform("EPSG:4326", raster.crs, [point.x], [point.y])
            value = next(raster.sample(zip(x, y), masked=True))[0]
            pixel_size = tuple(round(abs(n), 8) for n in raster.res)
            crs = raster.crs.to_string()
            if np.ma.is_masked(value) or not np.isfinite(value) or value < 0:
                raise NoCoverage("PRISM returned no precipitation at the centroid")
    return {
        "dataset": "Oregon State University PRISM daily precipitation", "url": response.url,
        "method": "Single test day at the field centroid (4 km product)",
        "resolution": {"pixelSize": pixel_size, "gridCrs": crs},
        "units": "mm/day", "data": [{"date": str(start), "value": float(value)}],
    }


def sentinel2(geometry, start, end):
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.warp import transform_geom
    from shapely.geometry import mapping

    response = get("https://earth-search.aws.element84.com/v1/search", params={
        "collections": "sentinel-2-c1-l2a",
        "bbox": ",".join(map(str, geometry.bounds)),
        "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
        "limit": 5,
    })
    for scene in response.json().get("features", []):
        asset = scene["assets"]["scl"]["href"]
        if not asset.startswith("https://"):
            raise SourceError("Sentinel-2 SCL is not available over HTTPS")
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="20"), rasterio.open(asset) as grid:
            polygon = transform_geom("EPSG:4326", grid.crs, mapping(geometry))
            try:
                window = geometry_window(grid, [polygon])
            except rasterio.errors.WindowError:
                continue
            classes = grid.read(1, window=window)
            if classes.size > 250_000:
                raise SourceError("Sentinel-2 window exceeds the preparation limit")
            inside = geometry_mask([polygon], classes.shape, grid.window_transform(window), invert=True)
            counts = np.bincount(classes[inside].astype(int), minlength=12)
            if counts[4] + counts[5] == 0:
                continue
            return {
                "dataset": "Copernicus Sentinel-2 L2A Collection 1", "urls": [response.url, asset],
                "method": "Scene Classification Layer at polygon cell centres; class 4 vegetation and 5 bare soil",
                "resolutionMetres": 20, "units": "pixels by SCL class",
                "data": {
                    "scene": scene["id"], "date": scene["properties"]["datetime"],
                    "sclCounts": {str(code): int(count) for code, count in enumerate(counts) if count},
                },
            }
    raise NoCoverage("No vegetation or bare soil pixels in the inspected Sentinel-2 scenes")


def naip(geometry, start, end):
    provider = "https://planetarycomputer.microsoft.com"
    data = get(f"{provider}/api/stac/v1/search", params={
        "collections": "naip", "bbox": ",".join(map(str, geometry.bounds)),
        "datetime": f"{start.year-4}-01-01T00:00:00Z/{end}T23:59:59Z",
        "limit": 4,
    }).json()
    point = geometry.centroid
    for scene in data.get("features", []):
        asset = scene["assets"]["image"]["href"]
        host = urlsplit(asset)
        if host.scheme != "https" or not host.netloc.endswith(".blob.core.windows.net") or host.query:
            continue
        signed = get(f"{provider}/api/sas/v1/sign", params={"href": asset}).json()["href"]
        if urlsplit(signed).netloc != host.netloc:
            raise SourceError("NAIP signed URL has unexpected host")
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="20"), rasterio.open(signed) as raster:
            x, y = transform("EPSG:4326", raster.crs, [point.x], [point.y])
            row, col = raster.index(x[0], y[0])
            if not (0 <= row < raster.height and 0 <= col < raster.width):
                continue
            window = Window(max(0, col - 8), max(0, row - 8), 16, 16)
            patch = raster.read([1, 2, 3], window=window, masked=True)
            if patch.shape != (3, 16, 16) or patch.count() != patch.size:
                continue
            return {
                "dataset": "USDA NAIP, Planetary Computer collection", "url": asset,
                "method": "16 × 16 orthophoto pixels near centroid, imagery and context",
                "resolutionMetres": scene["properties"].get("gsd"),
                "units": "stored RGB digital numbers", "data": {
                    "scene": scene["id"], "date": scene["properties"]["datetime"],
                    "meanRgb": [round(float(band.mean()), 2) for band in patch],
                },
            }
    raise NoCoverage("No suitable RGB NAIP window at the contour centroid")
