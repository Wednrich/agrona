"""NASA CMR discovery and authenticated, windowed HLS COG processing."""
import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import numpy as np
import rasterio
import requests
from rasterio.errors import RasterioIOError, WindowError
from rasterio.features import geometry_mask, geometry_window
from rasterio.warp import transform_geom

COLLECTIONS = {"HLSL30": "B05", "HLSS30": "B8A"}
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
DATA_HOST = "data.lpdaac.earthdatacloud.nasa.gov"
SCALE = 0.0001
LEASE_SECONDS = 12 * 60
HTTP = requests.Session()
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
ASSET_ATTEMPTS = 3
ASSET_AUTH_STATUS = {401, 403}


class HlsAssetError(RuntimeError):
    pass


class HlsAuthorizationError(HlsAssetError):
    def __init__(self, status):
        super().__init__(f"Доступ к файлам NASA HLS отклонён (HTTP {status}). "
                         "Проверьте срок действия токена Earthdata и разрешение LP DAAC.")


def retry_asset(attempt, deadline, retry_after=None):
    if attempt + 1 >= ASSET_ATTEMPTS:
        return False
    delay = 2**attempt
    if retry_after:
        try:
            seconds = (int(retry_after) if retry_after.isdecimal()
                       else parsedate_to_datetime(retry_after).timestamp() - time.time())
            delay = max(delay, seconds)
        except (ValueError, TypeError, OverflowError):
            pass
    # Do not retry earlier than the provider requested or beyond our wait budget.
    if delay > 30 or time.monotonic() + delay >= deadline:
        return False
    time.sleep(delay)
    return True


def resolve_asset(url, token, deadline):
    for attempt in range(ASSET_ATTEMPTS):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            with HTTP.get(
                url, headers={"Authorization": f"Bearer {token}", "Range": "bytes=0-15"},
                timeout=(min(8, remaining), min(20, remaining)), stream=True,
            ) as response:
                status = response.status_code
                if status in ASSET_AUTH_STATUS:
                    raise HlsAuthorizationError(status)
                if status in RETRYABLE_STATUS:
                    retry_after = response.headers.get("Retry-After")
                elif not response.ok:
                    raise HlsAssetError(f"Файл HLS недоступен (HTTP {status}).")
                elif urlparse(response.url).hostname == "urs.earthdata.nasa.gov":
                    raise HlsAuthorizationError(401)
                elif urlparse(response.url).scheme == "https":
                    return response.url
                else:
                    raise HlsAssetError("Некорректный адрес файла HLS.")
        except (requests.Timeout, requests.ConnectionError):
            retry_after = None
        except requests.RequestException:
            raise HlsAssetError("Не удалось открыть файл HLS.") from None
        if not retry_asset(attempt, deadline, retry_after):
            break
    raise HlsAssetError("Файл HLS недоступен после повторных попыток.")


def request(method, url, **kwargs):
    for attempt in range(3):
        try:
            response = HTTP.request(method, url, timeout=(8, 25), **kwargs)
        except (requests.Timeout, requests.ConnectionError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)
            continue
        if response.status_code not in RETRYABLE_STATUS or attempt == 2:
            response.raise_for_status()
            return response
        retry = response.headers.get("Retry-After", "")
        if retry.isdecimal() and int(retry) > 30:
            raise RuntimeError("Provider rate limit requires a later retry.")
        time.sleep(max(int(retry) if retry.isdecimal() else 0, 2**attempt))


def discover(boundary, year, product):
    ring = boundary["coordinates"][0]
    # CMR polygon queries expect counterclockwise exterior rings.
    signed_area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]))
    if signed_area < 0:
        ring = ring[::-1]
    params = {
        "short_name": product, "version": "2.0", "provider": "LPCLOUD",
        "temporal": f"{year}-01-01T00:00:00Z,{year}-12-31T23:59:59Z",
        "page_size": 200, "sort_key[]": ["start_date", "producer_granule_id"],
        "polygon": ",".join(str(v) for point in ring for v in point[:2]),
    }
    headers = {}
    seen = set()
    while True:
        response = request("POST", CMR, data=params, headers=headers)
        items = response.json()["items"]
        for item in items:
            concept = item["meta"]["concept-id"]
            if concept in seen:
                raise RuntimeError("CMR pagination repeated a granule.")
            seen.add(concept)
            yield item
        if len(items) < params["page_size"]:
            return
        cursor = response.headers.get("CMR-Search-After")
        if not cursor:
            raise RuntimeError("CMR returned an incomplete catalog page.")
        headers["CMR-Search-After"] = cursor


def band_urls(granule, product):
    expected = ("B04", COLLECTIONS[product], "Fmask")
    links = {}
    for link in granule["umm"].get("RelatedUrls", []):
        url = link.get("URL", "")
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != DATA_HOST:
            continue
        for band in expected:
            if parsed.path.endswith(f".{band}.tif"):
                links[band] = url
    if any(band not in links for band in expected):
        raise ValueError("Missing official LP DAAC reflectance or quality assets.")
    return [links[band] for band in expected]


def summarize(red, nir, quality, inside):
    water = inside & (quality != 255) & ((quality & 32) != 0)
    usable = (
        inside & (quality != 255) & ((quality & 0x3E) == 0)
        & ((quality & 0xC0) != 0xC0)
        & (red != -9999) & (nir != -9999)
        & (red >= 0) & (nir >= 0) & (red < 12000) & (nir < 12000)
    )
    red, nir = red.astype("float64") * SCALE, nir.astype("float64") * SCALE
    total = nir + red
    usable &= total > 0
    values = (nir[usable] - red[usable]) / total[usable]
    return {
        "mean": float(values.mean()) if values.size else None,
        "min": float(values.min()) if values.size else None,
        "max": float(values.max()) if values.size else None,
        "validPixels": int(values.size), "fieldPixels": int(inside.sum()),
        "waterPixels": int(water.sum()),
    }


def read_granule(granule, product, boundary, token, deadline=None):
    deadline = deadline if deadline is not None else time.monotonic() + LEASE_SECONDS
    urls = band_urls(granule, product)
    for attempt in range(ASSET_ATTEMPTS):
        if time.monotonic() >= deadline:
            raise HlsAssetError("Истекло время загрузки снимка HLS.")
        resolved_urls = [resolve_asset(url, token, deadline) for url in urls]
        try:
            return read_raster_window(granule, product, boundary, token, resolved_urls, deadline)
        except RasterioIOError as error:
            # Inspect GDAL's diagnostic without emitting it: it may contain a signed URL.
            message = str(error)
            match = re.search(r"(?:HTTP(?: response)?(?: status| code| error)?(?: code)?)[ :=]+([1-5][0-9]{2})\b", message, re.I)
            status = int(match[1]) if match else None
            if status in ASSET_AUTH_STATUS:
                raise HlsAuthorizationError(status) from None
            transient = status in RETRYABLE_STATUS or (
                status is None and re.search(r"timed? out|timeout|could(?: not|n't) connect|connection (?:reset|refused|closed)|temporary failure|recv failure|failed to connect", message, re.I)
            )
            if not transient or not retry_asset(attempt, deadline):
                raise HlsAssetError("Не удалось прочитать пиксели HLS.") from None


def read_raster_window(granule, product, boundary, token, resolved_urls, deadline):
    remaining = max(1, int(deadline - time.monotonic()))
    # GDAL performs HTTP range reads for the polygon window. Auth is process-local.
    with rasterio.Env(
        GDAL_HTTP_AUTH="BEARER", GDAL_HTTP_BEARER=token,
        GDAL_HTTP_CONNECTTIMEOUT=str(min(8, remaining)),
        GDAL_HTTP_TIMEOUT=str(min(20, remaining)),
        GDAL_HTTP_MAX_RETRY="0",
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    ), rasterio.open(resolved_urls[0]) as red, rasterio.open(resolved_urls[1]) as nir, rasterio.open(resolved_urls[2]) as qa:
        if any((band.crs, band.transform, band.shape) != (red.crs, red.transform, red.shape)
               for band in (nir, qa)):
            raise ValueError("HLS band grids do not align.")
        geometry = transform_geom("EPSG:4326", red.crs, boundary)
        try:
            window = geometry_window(red, [geometry])
        except WindowError:
            return None
        if window.width * window.height > 250_000:
            raise ValueError("Field exceeds the supported HLS processing window.")
        inside = geometry_mask([geometry], out_shape=(int(window.height), int(window.width)),
                               transform=red.window_transform(window), invert=True)
        if not inside.any():
            return None
        stats = summarize(red.read(1, window=window), nir.read(1, window=window),
                          qa.read(1, window=window), inside)
        # A numerator from a partial tile is useful, but its coverage must be explicit.
        bounds = red.bounds
        full_field = all(bounds.left <= x <= bounds.right and bounds.bottom <= y <= bounds.top
                         for ring in geometry["coordinates"] for x, y, *_ in ring)
    timestamp = granule["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
    return {
        **stats, "date": timestamp[:10], "acquiredAt": timestamp, "dataset": product,
        "granuleId": granule["umm"]["GranuleUR"], "conceptId": granule["meta"]["concept-id"],
        "revisionId": granule["meta"].get("revision-id"), "tileContainsField": full_field,
    }


def rpc(name, params):
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = os.environ["SUPABASE_URL"].rstrip("/")
    return request("POST", f"{url}/rest/v1/rpc/{name}", json=params,
                   headers={"apikey": key, "Authorization": f"Bearer {key}"}).json()


def process(job, token):
    cached = job.get("cached", [])
    observations = {row["conceptId"]: row for row in cached if not row.get("empty")}
    empty = {row["conceptId"]: row for row in cached if row.get("empty")}
    deadline = time.monotonic() + LEASE_SECONDS
    errors = False
    completed = 0

    def save(state="checkpoint", warning=None):
        return rpc("checkpoint_hls_job", {
            "p_job": job["job_id"],
            "p_observations": sorted(observations.values(),
                key=lambda row: (row["acquiredAt"], row["conceptId"])),
            "p_empty": list(empty.values()),
            "p_state": state,
            "p_warning": warning,
            "p_progress": completed > 0,
        })

    unavailable = "Часть снимков NASA HLS временно недоступна."
    for product in COLLECTIONS:
        if product == "HLSS30" and job["analysis_year"] < 2015:
            continue
        granules = iter(discover(job["boundary"], job["analysis_year"], product))
        while time.monotonic() < deadline:
            try:
                granule = next(granules)
                concept = granule["meta"]["concept-id"]
                revision = granule["meta"]["revision-id"]
            except StopIteration:
                break
            except (requests.RequestException, RuntimeError, KeyError, ValueError):
                save("partial", "Не удалось завершить поиск снимков в каталоге NASA HLS.")
                return

            previous = empty.get(concept, observations.get(concept))
            if previous is not None and previous.get("revisionId") == revision:
                continue
            if time.monotonic() >= deadline:
                save("partial")
                return
            try:
                row = read_granule(granule, product, job["boundary"], token, deadline)
            except HlsAuthorizationError as error:
                save("failed", str(error))
                return
            except (HlsAssetError, requests.RequestException, ValueError):
                errors = True
                continue
            if row is None:
                # An empty new revision is a processed catalog entry. Preserve
                # the earlier historical observation if one already exists.
                empty[concept] = {"conceptId": concept, "revisionId": revision, "empty": True}
            else:
                observations[concept] = row
                empty.pop(concept, None)
            completed += 1
            if completed % 8 == 0 and not save():
                return
        else:
            save("partial", unavailable if errors else None)
            return
    if errors:
        save("partial", unavailable)
    else:
        save("succeeded")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Process at most one queued job.")
    parser.add_argument("--field", help="Only claim queued work for this saved field and year.")
    parser.add_argument("--smoke-field", help="Read one actual saved field and try HLS pixels without writing.")
    parser.add_argument("--year", type=int, default=datetime.now(timezone.utc).year-1)
    args = parser.parse_args()
    # Rasterio's GDAL callback can log raw diagnostics containing signed URLs.
    logging.getLogger("rasterio._env").disabled = True
    token = os.environ["EARTHDATA_TOKEN"]
    if args.smoke_field:
        field = rpc("hls_field", {"p_field": args.smoke_field})
        for product in COLLECTIONS:
            for granule in discover(field[0]["boundary"], args.year, product):
                try:
                    row = read_granule(granule, product, field[0]["boundary"], token)
                except HlsAuthorizationError as error:
                    raise SystemExit(str(error)) from None
                except HlsAssetError:
                    continue
                if row and row["validPixels"]:
                    print(json.dumps(row))
                    return
        raise SystemExit("No usable pixels found.")
    while True:
        try:
            jobs = (rpc("take_hls_job_for", {"p_field": args.field, "p_year": args.year})
                    if args.field else rpc("take_hls_job", {}))
            if jobs:
                process(jobs[0], token)
        except (requests.RequestException, RuntimeError) as error:
            print(f"HLS worker database request failed ({type(error).__name__})", file=sys.stderr)
            if args.once:
                return 1
            time.sleep(30)
            continue
        if args.once:
            return
        if not jobs:
            time.sleep(10)


if __name__ == "__main__":
    sys.exit(main())
