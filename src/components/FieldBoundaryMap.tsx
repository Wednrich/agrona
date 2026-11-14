import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { bbox } from "@turf/bbox";
import type { Polygon } from "geojson";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

export default function FieldBoundaryMap({
  geometry,
  drawing,
  onDraw,
}: {
  geometry?: Polygon;
  drawing: boolean;
  onDraw: (polygon: Polygon) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map>();
  const [error, setError] = useState("");
  const onDrawRef = useRef(onDraw);
  onDrawRef.current = onDraw;

  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    const key = import.meta.env.VITE_MAPTILER_KEY;
    try {
      maplibregl.setWorkerUrl(workerUrl);
      instance = new maplibregl.Map({
        container: container.current,
        center: [69.37, 51.19],
        zoom: 5,
        style: key
          ? `https://api.maptiler.com/maps/satellite/style.json?key=${encodeURIComponent(key)}`
          : {
              version: 8,
              sources: {
                osm: {
                  type: "raster",
                  tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                  tileSize: 256,
                  attribution: "© OpenStreetMap contributors",
                },
              },
              layers: [{ id: "osm", type: "raster", source: "osm" }],
            },
        attributionControl: { compact: true },
      });
    } catch {
      setError(
        "Карта недоступна в этом браузере. Можно ввести координаты или импортировать GeoJSON.",
      );
      return;
    }
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
    );
    instance.on("error", () =>
      setError("Не удалось загрузить часть карты. Проверьте подключение."),
    );
    instance.on("load", () => {
      instance.addSource("boundary-preview", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      instance.addLayer({
        id: "boundary-preview-fill",
        type: "fill",
        source: "boundary-preview",
        paint: { "fill-color": "#47c882", "fill-opacity": 0.28 },
      });
      instance.addLayer({
        id: "boundary-preview-line",
        type: "line",
        source: "boundary-preview",
        paint: { "line-color": "#47c882", "line-width": 3 },
      });
      setMap(instance);
    });
    return () => instance.remove();
  }, []);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource<maplibregl.GeoJSONSource>("boundary-preview");
    source?.setData(
      geometry
        ? { type: "Feature", geometry, properties: {} }
        : { type: "FeatureCollection", features: [] },
    );
    if (geometry) {
      const [west, south, east, north] = bbox(geometry);
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: 24,
          maxZoom: 17,
          duration: 0,
        },
      );
    }
  }, [map, geometry]);

  useLayoutEffect(() => {
    if (!map || !drawing) return;
    const editor = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [new TerraDrawPolygonMode()],
    });
    editor.on("finish", (id) => {
      const geometry = editor.getSnapshotFeature(id)?.geometry;
      if (geometry?.type !== "Polygon") return;
      onDrawRef.current(geometry);
      editor.clear();
    });
    editor.start();
    editor.setMode("polygon");
    return () => editor.stop();
  }, [map, drawing]);

  return (
    <>
      <div
        ref={container}
        className="field-boundary-map"
        aria-label={
          drawing
            ? "Карта для рисования границы"
            : "Предпросмотр границы на карте"
        }
      />
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
    </>
  );
}
