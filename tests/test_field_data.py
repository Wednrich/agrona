import json
import unittest
from datetime import date
from io import BytesIO
from unittest.mock import Mock, patch

import h5py
from rasterio.transform import from_origin
from shapely.geometry import Point, box

from api.soil import app as legacy_soil_api
from scripts.field_data.__main__ import prepare
from scripts.field_data.earthdata import official_asset, sinusoidal_index
from scripts.field_data.geometry import validate_geometry
from scripts.field_data.gesdisc import read_cell
from scripts.field_data.live import fetch_source, validate_request
from scripts.field_data.public import NoCoverage, daily_power, polygon_weights


class TestFieldSources(unittest.TestCase):
    def test_legacy_soil_route_accepts_the_original_polygon_body(self):
        polygon = box(76.697, 43.245, 76.705, 43.251).__geo_interface__
        payload = json.dumps(polygon).encode()
        start_response = Mock()
        with patch("scripts.field_data.soil_request.soilgrids", return_value={"data": []}) as source:
            body = legacy_soil_api({
                "PATH_INFO": "/api/soil", "REQUEST_METHOD": "POST",
                "CONTENT_LENGTH": str(len(payload)), "wsgi.input": BytesIO(payload),
            }, start_response)
        self.assertEqual(start_response.call_args.args[0], "200 OK")
        self.assertEqual(json.loads(b"".join(body))["status"], "ready")
        self.assertEqual(source.call_args.args[0].__geo_interface__, polygon)

    def test_live_source_uses_submitted_geometry_and_dates(self):
        polygon = box(76.697, 43.245, 76.705, 43.251)
        payload = {"source": "imerg-power", "boundary": polygon.__geo_interface__,
                   "start": "2025-05-03", "end": "2025-05-07"}
        with patch("scripts.field_data.live.prepare") as prepare_source:
            prepare_source.return_value = {"imerg-power": {"status": "ready", "data": [{"IMERG_PRECTOT": 0}]}}
            result = fetch_source(*validate_request(payload))
        source_geometry, start, end, names, pilot = prepare_source.call_args.args
        self.assertTrue(source_geometry.equals(polygon))
        self.assertEqual((start, end, names, pilot), (date(2025, 5, 3), date(2025, 5, 7), ["imerg-power"], None))
        self.assertEqual(result["data"], [{"IMERG_PRECTOT": 0}])
        with self.assertRaises(ValueError):
            validate_request({**payload, "source": "cocorahs"})

    def test_geometry_intersection_keeps_fractional_cells(self):
        polygon = box(0.75, 0.25, 1.25, 0.75)
        weights, area = polygon_weights(
            polygon, ("EPSG:4326", from_origin(0, 1, 1, 1), (1, 2)),
        )
        self.assertEqual(weights.tolist(), [[0.125, 0.125]])
        self.assertEqual(area, 0.25)

    def test_imerg_distinguishes_zero_from_missing_and_uses_utc(self):
        with patch("scripts.field_data.public.get") as get:
            get.return_value.json.return_value = {
                "properties": {"parameter": {"IMERG_PRECTOT": {
                    "20250501": 0, "20250502": -999, "20250504": 3.5,
                }}},
                "header": {"fill_value": -999}, "parameters": {"IMERG_PRECTOT": {"units": "mm/day"}},
            }
            result = daily_power(box(1, 1, 2, 2), date(2025, 5, 1), date(2025, 5, 4), ("IMERG_PRECTOT",), "UTC")
        self.assertEqual(get.call_args.kwargs["params"]["time-standard"], "UTC")
        self.assertEqual([row["IMERG_PRECTOT"] for row in result["data"]], [0, None, None, 3.5])
        self.assertEqual(result["coverageDays"], {"IMERG_PRECTOT": 2})

    def test_earthdata_bearer_is_only_for_known_https_asset_hosts(self):
        self.assertTrue(official_asset("https://data.nsidc.earthdatacloud.nasa.gov/a.h5"))
        self.assertFalse(official_asset("http://data.nsidc.earthdatacloud.nasa.gov/a.h5"))
        self.assertFalse(official_asset("https://data.nsidc.earthdatacloud.nasa.gov.example.com/a.h5"))

    def test_gesdisc_reads_the_annotated_grid_and_rejects_fill_values(self):
        with h5py.File(BytesIO(), "w") as file:
            for name, values in (("time", [0]), ("lon", [1., 1.1, 1.2]), ("lat", [2., 2.1])):
                file.create_dataset(name, data=values).make_scale(name)
            source = file.create_dataset("precipitation", data=[[[1., 2.], [3., 4.], [0., -9999.]]])
            source.attrs["units"] = b"mm/day"
            source.attrs["_FillValue"] = -9999.
            axes = "time", "lon", "lat"
            for dimension, axis in zip(source.dims, axes):
                dimension.attach_scale(file[axis])
            value, cell = read_cell(file, "precipitation", Point(1.19, 2.01), axes, .1, "mm/day")
            self.assertEqual(value, 0.)
            self.assertEqual(cell, {"latitude": 2., "longitude": 1.2})
            with self.assertRaisesRegex(NoCoverage, "marked.*missing"):
                read_cell(file, "precipitation", Point(1.19, 2.1), axes, .1, "mm/day")

    def test_regional_source_is_not_queried_for_kazakhstan(self):
        with patch.dict("scripts.field_data.__main__.SOURCES", {"ssurgo": self.fail}):
            results = prepare(box(76.69, 43.24, 76.71, 43.26), date(2025, 5, 1), date(2025, 5, 4), ["ssurgo"], "kz")
        self.assertEqual(results["ssurgo"]["status"], "outside_pilot")

    def test_nasa_sinusoidal_sample_uses_the_granule_tile(self):
        point = box(76.696, 43.245, 76.706, 43.252).centroid
        row, column = sinusoidal_index(point, "MOD13Q1.A2025113.h23v04.061.2025148090856", (4800, 4800))
        self.assertTrue(0 <= row < 4800 and 0 <= column < 4800)
        with self.assertRaisesRegex(Exception, "outside"):
            sinusoidal_index(point, "MOD13Q1.A2025113.h24v04.061.2025148090856", (4800, 4800))

    def test_large_geometry_is_rejected_before_provider_requests(self):
        with self.assertRaisesRegex(ValueError, "at most"):
            validate_geometry(box(0, 0, 10, 10))


if __name__ == "__main__":
    unittest.main()
