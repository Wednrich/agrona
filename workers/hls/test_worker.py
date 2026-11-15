import os
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from email.utils import format_datetime
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import requests
from rasterio.errors import RasterioIOError
import worker

import numpy as np
from rasterio.features import geometry_mask
from rasterio.transform import from_origin

from worker import summarize


class SecretLoadingTest(unittest.TestCase):
    names = worker.REQUIRED_SECRETS

    def test_missing_secret_is_named(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(SystemExit, "Missing SUPABASE_URL"):
                worker.load_secrets()

    def test_secret_files_are_read_and_trimmed(self):
        values = {
            "SUPABASE_URL": "https://project.supabase.co\n",
            "SUPABASE_SERVICE_ROLE_KEY": "private-key\n",
            "EARTHDATA_TOKEN": "private-token\n",
        }
        with tempfile.TemporaryDirectory() as directory:
            environment = {}
            for name, value in values.items():
                path = Path(directory) / name.lower()
                path.write_text(value)
                environment[name + "_FILE"] = str(path)
            with patch.dict(os.environ, environment, clear=True):
                worker.load_secrets()
                self.assertEqual(os.environ["SUPABASE_URL"], "https://project.supabase.co")
                self.assertEqual(os.environ["EARTHDATA_TOKEN"], "private-token")

    def test_unreadable_secret_file_is_reported(self):
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "private-key",
            "EARTHDATA_TOKEN_FILE": "/nonexistent/token",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(SystemExit, "Cannot read EARTHDATA_TOKEN_FILE"):
                worker.load_secrets()

    def test_plain_http_supabase_url_is_rejected(self):
        environment = {
            "SUPABASE_URL": "http://example.test",
            "SUPABASE_SERVICE_ROLE_KEY": "private-key",
            "EARTHDATA_TOKEN": "private-token",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(SystemExit, "https") as caught:
                worker.load_secrets()
        self.assertNotIn("private-", str(caught.exception))



class HlsPixelTest(unittest.TestCase):
    def test_polygon_and_fmask_define_the_denominator(self):
        polygon = {"type": "Polygon", "coordinates": [[
            [0, 3], [2, 3], [2, 0], [0, 0], [0, 3],
        ]]}
        inside = geometry_mask([polygon], out_shape=(3, 3),
                               transform=from_origin(0, 3, 1, 1), invert=True)
        # One usable pixel, then water, adjacent cloud, cloud shadow, snow and fill.
        quality = np.array([[0, 32, 0], [4, 8, 0], [16, 255, 0]], dtype="uint8")
        red = np.full((3, 3), 1000, dtype="int16")
        nir = np.full((3, 3), 3000, dtype="int16")
        stats = summarize(red, nir, quality, inside)
        self.assertEqual(stats["fieldPixels"], 6)
        self.assertEqual(stats["validPixels"], 1)
        self.assertEqual(stats["waterPixels"], 1)
        self.assertAlmostEqual(stats["mean"], 0.5)

    def test_all_invalid_pixels_have_null_ndvi(self):
        red = np.array([[-9999, 0, 1000]], dtype="int16")
        nir = np.array([[3000, 0, 3000]], dtype="int16")
        quality = np.array([[0, 0, 192]], dtype="uint8")
        stats = summarize(red, nir, quality, np.ones(red.shape, dtype=bool))
        self.assertEqual(stats["validPixels"], 0)
        self.assertIsNone(stats["mean"])


class HlsDownloadTest(unittest.TestCase):
    url = "https://data.lpdaac.earthdatacloud.nasa.gov/test.Fmask.tif"
    signed_url = "https://example.test/test.Fmask.tif?signature=private-value"

    def response(self, status, retry_after=None):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = status
        response.ok = status < 400
        response.url = self.signed_url
        response.headers = {"Retry-After": retry_after} if retry_after else {}
        return response

    @patch("worker.time.sleep")
    @patch("worker.HTTP.get")
    def test_retries_502_and_timeouts_then_succeeds(self, get, sleep):
        get.side_effect = [self.response(502), requests.Timeout(), self.response(206)]
        self.assertEqual(worker.resolve_asset(self.url, "private-token", float("inf")), self.signed_url)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])

    @patch("worker.time.sleep")
    @patch("worker.HTTP.get")
    def test_retries_temporary_connection_failure(self, get, sleep):
        get.side_effect = [requests.ConnectionError(), self.response(206)]
        self.assertEqual(worker.resolve_asset(self.url, "private-token", float("inf")), self.signed_url)
        sleep.assert_called_once_with(1)

    @patch("worker.time.time", return_value=100)
    @patch("worker.time.sleep")
    @patch("worker.HTTP.get")
    def test_429_honors_retry_after_seconds_and_http_date(self, get, sleep, _now):
        http_date = format_datetime(datetime.fromtimestamp(109, timezone.utc), usegmt=True)
        get.side_effect = [self.response(429, "7"), self.response(429, http_date), self.response(206)]
        worker.resolve_asset(self.url, "private-token", float("inf"))
        self.assertEqual(sleep.call_args_list, [call(7), call(9)])

    @patch("worker.time.sleep")
    @patch("worker.HTTP.get")
    def test_long_retry_after_skips_without_waiting(self, get, sleep):
        get.return_value = self.response(429, "300")
        with self.assertRaises(worker.HlsAssetError):
            worker.resolve_asset(self.url, "private-token", float("inf"))
        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()

    @patch("worker.time.sleep")
    @patch("worker.HTTP.get")
    def test_authorization_failure_is_not_retried(self, get, sleep):
        for status in (401, 403):
            with self.subTest(status=status):
                get.reset_mock()
                get.return_value = self.response(status)
                with self.assertRaisesRegex(worker.HlsAuthorizationError, str(status)) as caught:
                    worker.resolve_asset(self.url, "private-token", float("inf"))
                self.assertNotIn("private-", str(caught.exception))
                get.assert_called_once()
                sleep.assert_not_called()

    @patch("worker.time.sleep")
    @patch("worker.read_raster_window")
    @patch("worker.resolve_asset")
    @patch("worker.band_urls")
    def test_range_read_retries_502_but_stops_on_403(self, urls, resolve, read, sleep):
        urls.return_value = [self.url]
        resolve.return_value = self.signed_url
        read.side_effect = [
            RasterioIOError(f"HTTP response code: 502 - {self.signed_url}"),
            RasterioIOError(f"HTTP response code: 403 - {self.signed_url}"),
        ]
        with self.assertRaisesRegex(worker.HlsAuthorizationError, "403") as caught:
            worker.read_granule({}, "HLSL30", {}, "private-token")
        self.assertNotIn("private-value", str(caught.exception))
        self.assertEqual(read.call_count, 2)
        sleep.assert_called_once_with(1)

    @patch("worker.rpc", return_value=True)
    @patch("worker.discover")
    @patch("worker.read_raster_window")
    @patch("worker.band_urls")
    @patch("worker.time.sleep")
    @patch("worker.HTTP.get")
    def test_exhausted_asset_retries_preserve_cache_and_process_next_granule(
        self, get, sleep, urls, read, discover, rpc,
    ):
        urls.return_value = [self.url]
        discover.return_value = [{"meta": {"concept-id": name, "revision-id": 1}} for name in ("bad", "good")]
        get.side_effect = [self.response(502) for _ in range(3)] + [self.response(206)]
        good = {"conceptId": "good", "acquiredAt": "2014-06-02"}
        cached = {"conceptId": "cached", "acquiredAt": "2014-06-01"}
        read.return_value = good
        worker.process({"job_id": "test", "analysis_year": 2014, "boundary": {}, "cached": [cached]}, "private-token")
        self.assertEqual(get.call_count, 4)
        read.assert_called_once()
        self.assertEqual(rpc.call_args.args[1]["p_observations"], [cached, good])
        self.assertEqual(rpc.call_args.args[1]["p_state"], "partial")
        self.assertIn("Часть снимков", rpc.call_args.args[1]["p_warning"])
        self.assertEqual(rpc.call_args.args[1]["p_failures"], [{
            "conceptId": "bad", "revisionId": 1, "dataset": "HLSL30",
            "reason": "asset_unavailable",
        }])
        self.assertEqual(rpc.call_args.args[0], "checkpoint_hls_job_v2")
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])

    @patch("worker.rpc", return_value=True)
    @patch("worker.discover")
    @patch("worker.read_granule")
    def test_auth_stops_job_and_saves_partial_observations(self, read, discover, rpc):
        discover.return_value = [{"meta": {"concept-id": name, "revision-id": 1}} for name in ("first", "denied", "next")]
        first = {"conceptId": "first", "acquiredAt": "2014-06-01"}
        read.side_effect = [first, worker.HlsAuthorizationError(401)]
        with redirect_stderr(StringIO()) as logs:
            worker.process({"job_id": "test", "analysis_year": 2014, "boundary": {}}, "private-token")
        self.assertEqual(read.call_count, 2)
        self.assertEqual(rpc.call_args.args[1]["p_observations"], [first])
        self.assertIn("HTTP 401", rpc.call_args.args[1]["p_warning"])
        self.assertNotIn("private-token", logs.getvalue())

    @patch("worker.STOP_REQUESTED", True)
    @patch("worker.rpc", return_value=True)
    @patch("worker.discover")
    @patch("worker.read_granule")
    def test_shutdown_releases_lease_without_losing_saved_rows(self, read, discover, rpc):
        cached = {"conceptId": "saved", "revisionId": 1, "acquiredAt": "2014-06-01"}
        worker.process({"job_id": "lease", "analysis_year": 2014,
                        "boundary": {}, "cached": [cached]}, "private-token")
        read.assert_not_called()
        checkpoint = rpc.call_args.args[1]
        self.assertEqual(checkpoint["p_state"], "partial")
        self.assertEqual(checkpoint["p_observations"], [cached])
        self.assertEqual(checkpoint["p_failures"], [])


    @patch("worker.rpc", return_value=True)
    @patch("worker.discover")
    @patch("worker.read_granule")
    @patch("worker.time.monotonic")
    def test_timeout_resumes_only_new_revisions_and_unprocessed_granules(
        self, clock, read, discover, rpc,
    ):
        now = 0
        clock.side_effect = lambda: now
        entries = [
            {"meta": {"concept-id": name, "revision-id": revision}}
            for name, revision in (("old", 1), ("empty", 1), ("revised", 2))
        ]
        discover.return_value = entries
        old = {"conceptId": "old", "revisionId": 1, "acquiredAt": "2014-06-01"}
        revised = {"conceptId": "revised", "revisionId": 1, "acquiredAt": "2014-06-02"}
        job = {"job_id": "first", "analysis_year": 2014, "boundary": {}, "cached": [old, revised]}

        def expire(*args):
            nonlocal now
            now += worker.LEASE_SECONDS
            return None

        read.side_effect = expire
        worker.process(job, "token")
        checkpoint = rpc.call_args.args[1]
        self.assertEqual(checkpoint["p_state"], "partial")
        self.assertEqual(checkpoint["p_observations"], [old, revised])
        self.assertEqual(checkpoint["p_empty"][0]["conceptId"], "empty")

        read.reset_mock(side_effect=True)
        read.return_value = {**revised, "revisionId": 2}
        job.update(job_id="second", cached=checkpoint["p_observations"] + checkpoint["p_empty"])
        worker.process(job, "token")
        read.assert_called_once()
        self.assertEqual(read.call_args.args[0], entries[2])
        self.assertEqual(rpc.call_args.args[1]["p_state"], "succeeded")
        self.assertEqual(rpc.call_args.args[1]["p_observations"], [old, read.return_value])


if __name__ == "__main__":
    unittest.main()
