import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { bbox, feature, featureCollection } from "@turf/turf";
import { Link } from "react-router-dom";
import {
  Plus,
  ScanLine,
  Layers,
  ArrowUpRight,
  X,
  MapPin,
  Droplets,
  Wheat,
  Expand,
} from "lucide-react";
import { useData } from "../lib/data";
import { useUI } from "../lib/ui";
import type { Field } from "../lib/types";
import FieldForm from "../components/FieldForm";
import { Button } from "../components/ui/button";
maplibregl.setWorkerUrl(workerUrl);

function savedBoundary(field: Field) {
  const geometry = field.boundary;
  if (
    geometry?.type !== "Polygon" ||
    !Array.isArray(geometry.coordinates) ||
    !geometry.coordinates.length
  )
    return null;
  for (const ring of geometry.coordinates) {
    if (
      !Array.isArray(ring) ||
      ring.length < 4 ||
      ring.some(
        (point) =>
          !Array.isArray(point) ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) ||
          Math.abs(point[0]) > 180 ||
          Math.abs(point[1]) > 90,
      )
    )
      return null;
    if (ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1])
      return null;
  }
  const shape = feature(geometry, { id: field.id, name: field.name });
  const bounds = bbox(shape);
  return bounds[0] < bounds[2] && bounds[1] < bounds[3]
    ? { shape, bounds }
    : null;
}

export default function MapPage() {
  const { user, demo } = useAuth();
  const { data: profile } = useQuery({
    queryKey: ["profile-map-center", user?.id],
    enabled: !!user && !demo && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("profiles")
        .select("latitude,longitude")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data, isLoading, error, save } = useData();
  const { farmId, setFarm } = useUI();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{
    field?: Field;
    boundary?: Field["boundary"];
  } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mapError, setMapError] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const drawingRef = useRef(false);
  const farm = data?.farms.find((f) => f.id === farmId) ?? data?.farms[0];
  const fields = useMemo(
    () => data?.fields.filter((f) => f.farm_id === farm?.id) ?? [],
    [data?.fields, farm?.id],
  );
  const boundaries = useMemo(
    () =>
      fields.flatMap((f) => {
        const boundary = savedBoundary(f);
        return boundary ? [boundary] : [];
      }),
    [fields],
  );
  const lastFocused = useRef<{ map: maplibregl.Map; id: string } | null>(null);
  const selectField = useCallback((id: string) => {
    if (!drawingRef.current) setSelected(id);
  }, []);
  const field = fields.find((f) => f.id === selected);
  const key = import.meta.env.VITE_MAPTILER_KEY;
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
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
        center: [69.37, 51.19],
        zoom: 12,
        locale: {
          "NavigationControl.ZoomIn": "Приблизить",
          "NavigationControl.ZoomOut": "Отдалить",
          "NavigationControl.ResetBearing": "Север сверху",
          "AttributionControl.ToggleAttribution": "Источники карты",
        },
        attributionControl: { compact: true },
      });
    } catch {
      setMapError(
        "Браузер не поддерживает WebGL. Используйте список полей и ввод координат.",
      );
      return;
    }
    map.current = m;
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(container.current);
    m.addControl(new maplibregl.NavigationControl(), "bottom-left");
    m.on("error", () =>
      setMapError(
        "Подложка недоступна. Проверьте соединение и настройки поставщика карт.",
      ),
    );
    m.on("load", () => {
      m.addSource("fields", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "field-fill",
        type: "fill",
        source: "fields",
        paint: { "fill-color": "#b9ef65", "fill-opacity": 0.22 },
      });
      m.addLayer({
        id: "field-line",
        type: "line",
        source: "fields",
        paint: { "line-color": "#b9ef65", "line-width": 2 },
      });
      const d = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
        modes: [
          new TerraDrawPolygonMode(),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: {
                    draggable: true,
                    midpoints: true,
                    deletable: true,
                  },
                },
              },
            },
          }),
        ],
      });
      d.start();
      draw.current = d;
      d.on("finish", (id) => {
        const feature = d.getSnapshot().find((f) => f.id === id);
        if (feature?.geometry.type === "Polygon") {
          setForm({ boundary: feature.geometry });
          setDrawing(false);
          drawingRef.current = false;
          d.setMode("static");
        }
      });
      m.on("click", "field-fill", (e) => {
        if (e.features?.[0]) selectField(String(e.features[0].properties.id));
      });
      setReady(true);
    });
    return () => {
      observer.disconnect();
      draw.current?.stop();
      m.remove();
      map.current = null;
      draw.current = null;
      setReady(false);
    };
  }, [key, selectField]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("fields") as maplibregl.GeoJSONSource;
    if (!source) return;
    source.setData(featureCollection(boundaries.map(({ shape }) => shape)));
    const markers = boundaries.map(({ shape, bounds }) => {
      const el = document.createElement("button");
      el.className = "field-label";
      el.textContent = shape.properties.name;
      el.onclick = (event) => {
        event.stopPropagation();
        selectField(shape.properties.id);
      };
      return new maplibregl.Marker({ element: el })
        .setLngLat([(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
        .addTo(map.current!);
    });
    return () => markers.forEach((m) => m.remove());
  }, [boundaries, ready, selectField]);

  const selectedBounds = boundaries.find(
    ({ shape }) => shape.properties.id === field?.id,
  )?.bounds;
  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    const active: maplibregl.ExpressionSpecification = [
      "==",
      ["get", "id"],
      selected,
    ];
    current.setPaintProperty("field-fill", "fill-color", [
      "case",
      active,
      "#39ff77",
      "#b9ef65",
    ]);
    current.setPaintProperty("field-fill", "fill-opacity", [
      "case",
      active,
      0.35,
      0.18,
    ]);
    current.setPaintProperty("field-line", "line-color", [
      "case",
      active,
      "#39ff77",
      "#b9ef65",
    ]);
    current.setPaintProperty("field-line", "line-width", [
      "case",
      active,
      4,
      2,
    ]);
    if (!field) lastFocused.current = null;
    if (
      !selectedBounds ||
      !field ||
      (lastFocused.current?.map === current &&
        lastFocused.current.id === field.id)
    )
      return;
    const [west, south, east, north] = selectedBounds;
    const padding = Math.min(
      80,
      Math.floor(
        Math.min(
          current.getContainer().clientWidth,
          current.getContainer().clientHeight,
        ) / 4,
      ),
    );
    current.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding, duration: 1200, maxZoom: 17 },
    );
    lastFocused.current = { map: current, id: field.id };
  }, [ready, selected, selectedBounds, field]);

  function fit() {
    if (!map.current) return;
    if (boundaries.length) {
      const b = bbox(featureCollection(boundaries.map(({ shape }) => shape)));
      map.current.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 70, maxZoom: 15 },
      );
    } else {
      const centers: Record<string, [number, number]> = {
        Казахстан: [68, 48],
        Россия: [45, 54],
        Узбекистан: [64, 41],
        США: [-98, 39],
      };
      map.current.flyTo({
        center:
          profile?.latitude != null && profile?.longitude != null
            ? [profile.longitude, profile.latitude]
            : (centers[farm?.country ?? ""] ?? [69, 48]),
        zoom: profile?.latitude != null ? 9 : 5,
      });
    }
  }
  useEffect(() => {
    if (ready && !field) fit();
  }, [farm?.id, ready, fields.length, profile?.latitude, profile?.longitude]);
  const history =
    data?.seasons
      .filter((s) => s.field_id === field?.id)
      .sort((a, b) => b.year - a.year) ?? [];
  function clear() {
    draw.current?.clear();
    draw.current?.setMode("static");
    drawingRef.current = false;
    setDrawing(false);
    setEditing(false);
  }
  return (
    <main className="map-page">
      <div className="map-heading">
        <div>
          <span className="eyebrow">ОБЗОР ХОЗЯЙСТВА</span>
          <h1>Взгляните на поле шире.</h1>
        </div>
        <div className="row">
          <select
            aria-label="Хозяйство"
            value={farm?.id ?? ""}
            onChange={(e) => {
              setFarm(e.target.value);
              setSelected("");
            }}
          >
            {data?.farms.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <Button disabled={!farm} onClick={() => setForm({})}>
            <Plus size={16} /> Добавить поле
          </Button>
        </div>
      </div>
      <div className="map-summary">
        <span>
          <MapPin size={15} />
          {farm?.region || "Выберите хозяйство"}
        </span>
        <span>
          <strong>{fields.length}</strong> поля
        </span>
        <span>
          <strong>
            {fields.reduce((s, f) => s + Number(f.area_hectares), 0).toFixed(1)}
          </strong>{" "}
          га под управлением
        </span>
        <span className="source-status">
          ●{" "}
          {key
            ? "Спутниковая подложка"
            : "Базовая карта · спутник не подключён"}
        </span>
      </div>
      <div className="map-layout">
        <div className="map-canvas">
          <div ref={container} className="map-container" />
          <div className="map-tools">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по полям…"
              aria-label="Поиск по полям"
            />
            {search && (
              <div className="search-results">
                {fields
                  .filter((f) =>
                    f.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        selectField(f.id);
                        setSearch("");
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
              </div>
            )}
            <div className="row">
              <Button
                variant="outline"
                disabled={!ready || !farm || editing}
                onClick={() => {
                  clear();
                  draw.current?.setMode("polygon");
                  setDrawing(true);
                  drawingRef.current = true;
                }}
              >
                <ScanLine size={16} /> Нарисовать поле
              </Button>
              <Button
                variant="outline"
                onClick={fit}
                aria-label="Показать все поля"
              >
                <Expand size={16} />
              </Button>
            </div>
          </div>
          {(drawing || editing) && (
            <div className="map-instruction">
              {editing
                ? "Выберите полигон и перемещайте вершины."
                : "Щёлкайте по карте. Нажмите первую точку, чтобы замкнуть границу."}
              {editing && (
                <Button
                  disabled={saving}
                  onClick={async () => {
                    const geometry = draw.current
                      ?.getSnapshot()
                      .find((f) => f.geometry.type === "Polygon")?.geometry;
                    if (!field || geometry?.type !== "Polygon") return;
                    setSaving(true);
                    try {
                      await save("fields", { ...field, boundary: geometry });
                      clear();
                    } catch (e) {
                      setMapError(String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Сохранить границу
                </Button>
              )}
              <button onClick={clear}>Отмена</button>
            </div>
          )}
          {mapError && (
            <div className="map-error" role="alert">
              {mapError}
              <button onClick={() => setMapError("")}>×</button>
            </div>
          )}
          <div className="map-legend">
            <Layers size={14} />
            <span>Границы полей</span>
            <i /> Выбранное поле
          </div>
          {!fields.length && !isLoading && (
            <div className="map-empty card">
              <h2>Здесь начнётся ваша история</h2>
              <p>
                {farm
                  ? "Нарисуйте границу вашего первого поля."
                  : "Создайте хозяйство, чтобы добавить поля."}
              </p>
              {!farm && (
                <Link className="button primary" to="/farms">
                  Создать хозяйство →
                </Link>
              )}
            </div>
          )}
        </div>
        <aside className="field-panel">
          {fields.length > 0 && (
            <nav className="map-field-list" aria-label="Поля хозяйства">
              {fields.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className="field-list-item"
                  aria-pressed={f.id === selected}
                  onClick={() => selectField(f.id)}
                >
                  <span>
                    {f.name}
                    <small>{Number(f.area_hectares).toFixed(1)} га</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </nav>
          )}
          {field ? (
            <>
              <div className="row between">
                <span className="eyebrow">ВЫБРАННОЕ ПОЛЕ</span>
                <button
                  aria-label="Закрыть поле"
                  onClick={() => setSelected("")}
                >
                  <X size={17} />
                </button>
              </div>
              <h2>{field.name}</h2>
              {!selectedBounds && (
                <p role="status">Граница поля недоступна или повреждена.</p>
              )}
              <p className="field-region">{farm?.region}</p>
              <div className="area-number">
                {Number(field.area_hectares).toFixed(1)} <span>га</span>
              </div>
              <div className="field-stat">
                <Wheat />
                <div>
                  <small>Последняя культура · {history[0]?.year ?? "—"}</small>
                  <strong>
                    {data?.crops.find((c) => c.id === history[0]?.crop_id)
                      ?.name ?? "Нет истории"}
                  </strong>
                </div>
              </div>
              <div className="field-stat">
                <RefreshIcon />
                <div>
                  <small>Предыдущая культура</small>
                  <strong>
                    {data?.crops.find((c) => c.id === history[1]?.crop_id)
                      ?.name ?? "Нет истории"}
                  </strong>
                </div>
              </div>
              <div className="field-stat">
                <Droplets />
                <div>
                  <small>Орошение</small>
                  <strong>{field.irrigation_type || "Не указано"}</strong>
                </div>
              </div>
              <div className="field-stat">
                <Wheat />
                <div>
                  <small>Последняя урожайность</small>
                  <strong>
                    {history[0]?.yield_tons_per_hectare ?? "—"} т/га
                  </strong>
                </div>
              </div>
              <div className="analysis-hint">
                <span>✧ КЛИМАТИЧЕСКАЯ АНАЛИТИКА</span>
                <p>Загрузите наблюдения NASA для оценки условий и рисков.</p>
              </div>
              <Link className="button primary" to={"/analytics/" + field.id}>
                Анализировать <ArrowUpRight size={16} />
              </Link>
              <Link className="button outline" to={"/rotation/" + field.id}>
                Планировать севооборот →
              </Link>
              <Button variant="ghost" onClick={() => setForm({ field })}>
                Редактировать поле
              </Button>
              <Button
                variant="outline"
                disabled={!ready || !selectedBounds}
                onClick={() => {
                  clear();
                  draw.current?.addFeatures([
                    {
                      type: "Feature",
                      id: field.id,
                      geometry: field.boundary,
                      properties: { mode: "polygon" },
                    },
                  ]);
                  draw.current?.setMode("select");
                  drawingRef.current = true;
                  setEditing(true);
                }}
              >
                Изменить границу на карте
              </Button>
              <Link className="detail-link" to="/farms">
                Подробнее и история →
              </Link>
            </>
          ) : (
            <>
              <span className="eyebrow">ПОЛЯ ХОЗЯЙСТВА</span>
              <h2>Всё начинается с поля</h2>
              <p>
                Выберите участок на карте или в списке, чтобы увидеть его
                историю.
              </p>
            </>
          )}
          {error && <p className="error">{error.message}</p>}
          {isLoading && <p role="status">Загрузка полей и их границ…</p>}
        </aside>
      </div>
      {form && farm && (
        <FieldForm
          farmId={farm.id}
          {...form}
          onClose={() => {
            setForm(null);
            clear();
          }}
        />
      )}
    </main>
  );
}
function RefreshIcon() {
  return <span className="small-icon">↻</span>;
}
