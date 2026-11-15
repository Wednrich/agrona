"""Field contour validation shared by the CLI and the /api/soil service."""


def validate_geometry(geometry):
    if geometry.geom_type != "Polygon" or geometry.is_empty or not geometry.is_valid:
        raise ValueError("Expected a valid, non-empty GeoJSON Polygon")
    west, south, east, north = geometry.bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Contour coordinates must be WGS84 longitude and latitude")
    if east - west > .25 or north - south > .25:
        raise ValueError("Use a field contour spanning at most 0.25° per axis")
    return geometry
