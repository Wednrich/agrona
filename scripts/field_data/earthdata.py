from io import BytesIO
from math import cos, floor, radians
from os import environ
from pathlib import PurePosixPath
import re
from tempfile import TemporaryDirectory
from time import monotonic
from urllib.parse import urlsplit
from zipfile import ZipFile

import h5py
import fsspec
from aiohttp import ClientTimeout
import numpy as np
import rasterio
import requests
from rasterio.features import geometry_mask, geometry_window
from rasterio.io import MemoryFile
from rasterio.warp import transform, transform_geom
from shapely.geometry import mapping

from workers.hls.worker import HlsAssetError, read_granule as read_hls_granule

from .public import NoCoverage, SourceError, get, polygon_weights

CMR = "https://cmr.earthdata.nasa.gov/search"
NASA_ASSET_HOSTS = {
    "data.gesdisc.earthdata.nasa.gov",
    "data.lpdaac.earthdatacloud.nasa.gov",
    "data.nsidc.earthdatacloud.nasa.gov",
    "data.ornldaac.earthdata.nasa.gov",
}


def token():
    value = environ.get("EARTHDATA_TOKEN", "").strip()
    if not value:
        raise SourceError("EARTHDATA_TOKEN is required")
    return value


def search_granules(product, version, geometry, start=None, end=None, limit=3, umm=False, bbox=False):
    params = {"short_name": product, "version": version, "page_size": limit, "sort_key[]": "start_date"}
    if bbox:
        params["bounding_box"] = ",".join(f"{value:.8f}" for value in geometry.bounds)
    else:
        point = geometry.centroid
        params["point"] = f"{point.x:.8f},{point.y:.8f}"
    if start and end:
        params["temporal"] = f"{start.isoformat()}T00:00:00Z,{end.isoformat()}T23:59:59Z"
    fmt = "umm_json" if umm else "json"
    data = get(f"{CMR}/granules.{fmt}", params=params).json()
    return data["items"] if umm else data["feed"]["entry"]


def official_asset(url):
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.netloc in NASA_ASSET_HOSTS and not parsed.query


def granule_assets(granule):
    return {
        PurePosixPath(urlsplit(link["href"]).path).name: link["href"]
        for link in granule.get("links", [])
        if link.get("rel", "").endswith("/data#") and not link.get("inherited")
        and official_asset(link.get("href", ""))
    }


def choose_asset(granule, suffix):
    for filename, url in granule_assets(granule).items():
        if filename.lower().endswith(suffix.lower()):
            return url
    raise SourceError(f"Missing official NASA asset with suffix {suffix}")


def download(url, max_bytes, destination=None):
    if not official_asset(url):
        raise SourceError("Unrecognized NASA download endpoint")
    with requests.get(url, headers={"Authorization": f"Bearer {token()}"},
                      timeout=(10, 45), stream=True) as response:
        if not response.ok:
            detail = ""
            if response.status_code == 403 and "application/json" in response.headers.get("Content-Type", ""):
                try:
                    if response.json().get("error_description") == "EULA Acceptance Failure":
                        detail = " · Earthdata application terms require account-owner action"
                except ValueError:
                    pass
            raise SourceError(f"NASA archive HTTP {response.status_code}{detail} · {urlsplit(url).hostname}")
        if urlsplit(response.url).hostname == "urs.earthdata.nasa.gov":
            raise SourceError("NASA archive redirected to Earthdata Login")
        if int(response.headers.get("Content-Length", 0)) > max_bytes:
            raise SourceError("NASA file exceeds preparation limit")
        buffer = destination if destination is not None else BytesIO()
        for chunk in response.iter_content(1024 * 1024):
            buffer.write(chunk)
            if buffer.tell() > max_bytes:
                raise SourceError("NASA file exceeds preparation limit")
    buffer.seek(0)
    return buffer


def hls(geometry, start, end):
    results = []
    token_value = token()
    for product in ("HLSL30", "HLSS30"):
        scenes = search_granules(product, "2.0", geometry, start, end, limit=5, umm=True, bbox=True)
        deadline = monotonic() + 100
        for scene in scenes:
            try:
                value = read_hls_granule(scene, product, mapping(geometry), token_value, deadline=deadline)
            except HlsAssetError as error:
                raise SourceError(str(error)) from None
            if value:
                results.append(value)
            if value and value["validPixels"]:
                break
    if not any(row["validPixels"] for row in results):
        raise NoCoverage("No valid HLS NDVI pixels in the inspected scenes")
    return {
        "dataset": "NASA HLSL30/HLSS30 version 2.0", "resolutionMetres": 30,
        "units": "dimensionless NDVI", "method": "Existing HLS worker, field window and Fmask QA",
        "scope": "Up to five scenes inspected per product, stops after first usable scene",
        "data": results,
    }


def srtm(geometry, _start, _end):
    datasets = search_granules("SRTMGL1", "003", geometry, limit=16, bbox=True)
    if not datasets:
        raise NoCoverage("SRTM tiles do not cover the contour")
    totals, area, sources = [], 0.0, []
    for granule in datasets:
        url = choose_asset(granule, ".hgt.zip")
        with ZipFile(download(url, 35 * 1024**2)) as archive:
            member, = [item for item in archive.infolist() if item.filename.lower().endswith(".hgt")]
            if member.file_size != 3601**2 * 2:
                raise SourceError("Unexpected SRTMGL1 tile dimensions")
            with MemoryFile(archive.read(member), filename=PurePosixPath(member.filename).name) as file, file.open() as grid:
                geom = mapping(geometry)
                try:
                    window = geometry_window(grid, [geom])
                except rasterio.errors.WindowError:
                    continue
                weights, area = polygon_weights(geometry, (grid.crs, grid.window_transform(window), (int(window.height), int(window.width))))
                surface = grid.read(1, window=window, masked=True).astype(float).filled(np.nan)
                keep = (weights > 0) & np.isfinite(surface)
                totals.extend(zip(surface[keep], weights[keep]))
                sources.append(url)
    if not totals:
        raise NoCoverage("SRTM tiles contain no valid elevations for this contour")
    values, weights = zip(*totals)
    return {
        "dataset": "NASA SRTMGL1.003", "resolutionArcSeconds": 1, "units": "m EGM96",
        "method": "NASA HGT, field overlap weighted in the source geographic grid; elevation only",
        "urls": sources, "data": {
            "min": float(min(values)), "max": float(max(values)), "mean": round(float(np.average(values, weights=weights)), 2),
            "areaCoverageFraction": round(min(1., float(sum(weights) / area)), 5), "validPixels": len(values),
        },
    }


def smap(geometry, start, end):
    point = geometry.centroid
    x, y = transform("EPSG:4326", "EPSG:6933", [point.x], [point.y])
    # NSIDC global EASE-Grid 2.0, nominal 9 km.
    index = (floor((7314540.83 - y[0]) / 9008.05), floor((x[0] + 17367530.44) / 9008.05))
    if not (0 <= index[0] < 1624 and 0 <= index[1] < 3856):
        raise NoCoverage("Centroid is outside the SMAP global 9 km grid")
    scenes = search_granules("SPL3SMP_E", "006", geometry, start, end, limit=8)
    rows = []
    for scene in scenes:
        url = choose_asset(scene, ".h5")
        with fsspec.open(
            url, "rb", headers={"Authorization": f"Bearer {token()}"},
            client_kwargs={"timeout": ClientTimeout(total=25, sock_connect=8, sock_read=15)},
            block_size=256 * 1024, cache_type="blockcache", cache_options={"maxblocks": 12},
        ) as remote, h5py.File(remote, "r") as file:
            group = file["Soil_Moisture_Retrieval_Data_AM"]
            if group["soil_moisture"].shape != (1624, 3856):
                raise SourceError("Unexpected SMAP 9 km grid dimensions")
            qa = int(group["retrieval_qual_flag"][index])
            flag = int(group["surface_flag"][index])
            value = float(group["soil_moisture"][index])
            usable = qa & 0b11 == 0 and 0 <= value <= 1
            rows.append({
                "date": scene["time_start"][:10], "granule": scene["producer_granule_id"], "url": url,
                "value": value if usable else None, "qa": qa, "surfaceFlag": flag,
                "gridRow": index[0], "gridColumn": index[1],
            })
        if sum(row["value"] is not None for row in rows) >= 3:
            break
    usable = any(row["value"] is not None for row in rows)
    return {
        "status": "ready" if usable else "no_coverage",
        **({} if usable else {"reason": "No recommended-quality SMAP morning data in up to eight inspected days"}),
        "dataset": "NASA SMAP SPL3SMP_E.006", "resolutionMetres": 9000, "units": "m³/m³",
        "method": "Regional surface moisture, morning pass, QA bits 0–1 clear",
        "scope": "At most eight days inspected, stops after three usable values",
        "data": rows,
    }


def ecostress(geometry, start, end):
    scenes = search_granules("ECO_L2T_LSTE", "002", geometry, start, end, limit=7, bbox=True)
    results = []
    for scene in scenes:
        urls = {band: choose_asset(scene, f"_{band}.tif") for band in ("LST", "QC", "cloud", "water")}
        arrays = {}
        grid_key = None
        for band, url in urls.items():
            with MemoryFile(download(url, 35 * 1024**2).getvalue()) as file, file.open() as grid:
                field = transform_geom("EPSG:4326", grid.crs, mapping(geometry))
                try:
                    window = geometry_window(grid, [field])
                except rasterio.errors.WindowError:
                    break
                key = (grid.crs, grid.window_transform(window), (int(window.height), int(window.width)))
                if grid_key is not None and grid_key != key:
                    raise SourceError("ECOSTRESS temperature and flag grids do not align")
                grid_key = key
                # Zero is the meaningful "clear / land / QA 00" flag.
                array = grid.read(1, window=window)
                arrays[band] = array * grid.scales[0] + grid.offsets[0] if band == "LST" else array
        if len(arrays) < len(urls):
            continue
        temperature = arrays["LST"]
        inside = geometry_mask([field], out_shape=temperature.shape, transform=grid_key[1], invert=True)
        qc = arrays["QC"].astype("uint16")
        valid = inside & (arrays["cloud"] == 0) & (arrays["water"] == 0) & ((qc & 3) == 0)
        valid &= (temperature >= 150) & (temperature <= 400)
        if valid.any():
            results.append({
                "date": scene["time_start"], "granule": scene["producer_granule_id"],
                "validPixels": int(valid.sum()), "fieldPixels": int(inside.sum()),
                "mean": round(float(temperature[valid].mean() - 273.15), 2), "urls": urls,
            })
            break
    if not results:
        raise NoCoverage("No clear land-surface temperature in the inspected ECOSTRESS scenes")
    return {
        "dataset": "NASA ECOSTRESS ECO_L2T_LSTE.002", "resolutionMetres": 70, "units": "°C",
        "method": "Instantaneous land-surface temperature, clear land pixels with mandatory QC bits 00",
        "scope": "Up to seven scenes inspected, stops at first usable scene", "data": results,
    }


def sinusoidal_index(point, granule_id, dimensions):
    tile = re.search(r"\.h(\d\d)v(\d\d)\.", granule_id)
    if not tile or dimensions[0] != dimensions[1] or dimensions[0] not in (2400, 4800):
        raise SourceError("Unrecognized NASA sinusoidal tile dimensions")
    size = 1111950.519667
    radius = 6371007.181
    cell_size = size / dimensions[0]
    x = radius * radians(point.x) * cos(radians(point.y))
    y = radius * radians(point.y)
    col = floor((x - (-20015109.354 + int(tile[1]) * size)) / cell_size)
    row = floor((10007554.677 - int(tile[2]) * size - y) / cell_size)
    if not (0 <= row < dimensions[0] and 0 <= col < dimensions[1]):
        raise NoCoverage("Centroid falls outside the NASA sinusoidal granule")
    return row, col


def modis(geometry, start, end):
    from pathlib import Path
    from pyhdf.SD import SD, SDC

    scenes = search_granules("MOD13Q1", "061", geometry, start, end, limit=3)
    rows = []
    for scene in scenes:
        url = choose_asset(scene, ".hdf")
        granule_id = scene["producer_granule_id"]
        with TemporaryDirectory() as directory:
            file = Path(directory) / "modis.hdf"
            with file.open("w+b") as target:
                download(url, 300 * 1024**2, destination=target)
            hdf = SD(str(file), SDC.READ)
            try:
                ndvi = hdf.select("250m 16 days NDVI")
                quality = hdf.select("250m 16 days pixel reliability")
                try:
                    index = sinusoidal_index(geometry.centroid, granule_id, ndvi.info()[2])
                    raw, qa = int(ndvi[index]), int(quality[index])
                finally:
                    ndvi.endaccess()
                    quality.endaccess()
            finally:
                hdf.end()
        rows.append({
            "date": scene["time_start"][:10], "granule": granule_id, "url": url, "qa": qa,
            "ndvi": round(raw * .0001, 4) if qa == 0 and -2000 <= raw <= 10000 else None,
        })
        if rows[-1]["ndvi"] is not None:
            break
    if not any(row["ndvi"] is not None for row in rows):
        raise NoCoverage("No MODIS best-quality composite NDVI in the inspected clips")
    return {
        "dataset": "NASA MODIS MOD13Q1.061", "resolutionMetres": 250, "units": "dimensionless NDVI",
        "method": "Centroid pixel from original composite; good pixel-reliability class",
        "data": rows,
    }


def viirs(geometry, start, end):
    scenes = search_granules("VNP13A1", "002", geometry, start, end, limit=3)
    rows = []
    for scene in scenes:
        url = choose_asset(scene, ".h5")
        granule_id = scene["producer_granule_id"]
        with h5py.File(download(url, 140 * 1024**2), "r") as file:
            group = file["HDFEOS/GRIDS/VIIRS_Grid_16Day_VI_500m/Data Fields"]
            ndvi = group["500 m 16 days NDVI"]
            quality = group[next(name for name in group if "pixel reliability" in name.lower())]
            index = sinusoidal_index(geometry.centroid, granule_id, ndvi.shape)
            raw, qa = int(ndvi[index]), int(quality[index])
            scale = float(np.asarray(ndvi.attrs["scale_factor"]).flatten()[0])
            low, high = ndvi.attrs["valid_range"]
            fill = np.asarray(ndvi.attrs["_FillValue"]).flatten()
        rows.append({
            "date": scene["time_start"][:10], "granule": granule_id, "url": url, "qa": qa,
            "ndvi": round(raw * scale, 4) if qa == 0 and low <= raw <= high and raw not in fill else None,
        })
        if rows[-1]["ndvi"] is not None:
            break
    if not any(row["ndvi"] is not None for row in rows):
        raise NoCoverage("No VIIRS best-quality composite NDVI in the inspected clips")
    return {
        "dataset": "NASA VIIRS VNP13A1.002", "resolutionMetres": 500, "units": "dimensionless NDVI",
        "method": "Centroid pixel from original composite; best pixel-reliability class",
        "data": rows,
    }
