from datetime import date
from functools import partial

import numpy as np

from .earthdata import choose_asset, download, search_granules
from .public import NoCoverage, SourceError


def cell_index(axis, coordinate, spacing):
    if axis.ndim != 1 or len(axis) < 2 or not np.allclose(np.diff(axis), spacing, atol=0.00005):
        raise SourceError("Unexpected GES DISC grid spacing")
    if not axis[0] - spacing / 2 - 0.00005 <= coordinate <= axis[-1] + spacing / 2 + 0.00005:
        raise NoCoverage("Field centre lies outside the dataset grid")
    return int(np.argmin(np.abs(axis - coordinate)))


def read_cell(file, variable, point, axes, spacing, expected_units):
    dataset = file[variable]
    dimensions = tuple(tuple(dimension.keys()) for dimension in dataset.dims)
    if dimensions != tuple((axis,) for axis in axes) or dataset.shape[0] != 1:
        raise SourceError("Unexpected GES DISC grid dimensions")
    units = np.asarray(dataset.attrs["units"]).item()
    if isinstance(units, bytes):
        units = units.decode("ascii")
    if units != expected_units:
        raise SourceError("Unexpected GES DISC variable units")

    latitudes, longitudes = file["lat"][:].astype(float), file["lon"][:].astype(float)
    indices = {
        "time": 0, "lat": cell_index(latitudes, point.y, spacing),
        "lon": cell_index(longitudes, point.x, spacing),
    }
    raw_value = float(dataset[tuple(indices[axis] for axis in axes)])
    for attribute in ("_FillValue", "missing_value"):
        if raw_value in np.asarray(dataset.attrs.get(attribute, [])).ravel():
            raise NoCoverage("NASA marked the source cell as missing")
    scale = np.asarray(dataset.attrs.get("scale_factor", 1)).item()
    offset = np.asarray(dataset.attrs.get("add_offset", 0)).item()
    value = raw_value * scale + offset
    if not np.isfinite(value) or value < 0:
        raise NoCoverage("The source cell has no valid nonnegative value")
    cell = {"latitude": round(latitudes[indices["lat"]], 5), "longitude": round(longitudes[indices["lon"]], 5)}
    return value, cell


def sample(geometry, start, end, *, product, version, variable, suffix, axes, spacing, hours, soil=False):
    import h5py

    scenes = search_granules(product, version, geometry, start, end, limit=1)
    if not scenes:
        raise NoCoverage("No GES DISC file matched the location and dates")
    scene = scenes[0]
    timestamp = scene["time_start"]
    if not start <= date.fromisoformat(timestamp[:10]) <= end:
        raise NoCoverage("GES DISC sample starts outside the requested dates")
    url = choose_asset(scene, suffix)
    with download(url, 40 * 1024**2) as buffer, h5py.File(buffer, "r") as file:
        value, cell = read_cell(file, variable, geometry.centroid, axes, spacing, "kg m-2" if soil else "mm/day")
    return {
        "dataset": f"NASA {product}.{version}", "variable": variable,
        "resolutionDegrees": spacing, "timeStepHours": hours, "timeStandard": "UTC",
        "units": "kg/m²" if soil else "mm/day",
        **({"depthCm": [0, 10]} if soil else {}),
        "method": "Modelled soil water mass in the native grid cell at the field centre" if soil else
                  "Daily mean precipitation rate in the native grid cell at the field centre",
        "scope": "Single archive sample from the first matching file; no seasonal series",
        "data": [{"date": timestamp, "granule": scene["producer_granule_id"], "url": url,
                  "gridCell": cell, "value": value}],
    }


imerg_final = partial(sample, product="GPM_3IMERGDF", version="07", variable="precipitation",
                      suffix=".nc4", axes=("time", "lon", "lat"), spacing=0.1, hours=24)
gldas = partial(sample, product="GLDAS_NOAH025_3H", version="2.1", variable="SoilMoi0_10cm_inst",
                suffix=".nc4", axes=("time", "lat", "lon"), spacing=0.25, hours=3, soil=True)
nldas = partial(sample, product="NLDAS_NOAH0125_H", version="2.0", variable="SoilM_0_10cm",
                suffix=".nc", axes=("time", "lat", "lon"), spacing=0.125, hours=1, soil=True)
