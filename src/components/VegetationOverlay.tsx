import { t } from "../lib/i18n";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";
import {
  Map,
  setWorkerUrl,
  NavigationControl,
  type ImageSourceSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function VegetationOverlay({
  image,
  coordinates,
}: {
  image: string;
  coordinates: ImageSourceSpecification["coordinates"];
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    setWorkerUrl(workerUrl);
    const map = new Map({
      container: target,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          ndvi: { type: "image", url: image, coordinates },
        },
        layers: [
          { id: "osm", type: "raster", source: "osm" },
          {
            id: "ndvi",
            type: "raster",
            source: "ndvi",
            paint: { "raster-resampling": "nearest" },
          },
        ],
      },
      bounds: [
        [coordinates[3][0], coordinates[3][1]],
        [coordinates[1][0], coordinates[1][1]],
      ],
      fitBoundsOptions: { padding: 36, maxZoom: 18 },
    });
    map.addControl(new NavigationControl());
    return () => map.remove();
  }, [image, coordinates]);
  return (
    <div
      ref={container}
      style={{ height: 320 }}
      role="region"
      aria-label={t("Карта NDVI")}
    />
  );
}
