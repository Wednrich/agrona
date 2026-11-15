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
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus,
  ScanLine,
  Layers,
  ArrowUpRight,
  X,
  MapPin,
  ListChecks,
  Sprout,
  BookOpen,
  Expand,
} from "lucide-react";
import { useData } from "../lib/data";
import { useUI } from "../lib/ui";
import type { Field } from "../lib/types";
import FieldForm from "../components/FieldForm";
import SoilEstimate from "../components/SoilEstimate";
import FieldWeather from "../components/FieldWeather";
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
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(() => params.get("field") ?? "");
  const fieldHeader = useRef<HTMLDivElement>(null);
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
  const creatingRef = useRef(false);
  const editTarget = useRef<{
    fieldId: string;
    featureId: string | number;
  } | null>(null);
  const selectedFarmId = data?.fields.find((f) => f.id === selected)?.farm_id;
  const farm =
    data?.farms.find((f) => f.id === (selectedFarmId ?? farmId)) ??
    data?.farms[0];
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
  useEffect(() => {
    if (field?.id && fieldHeader.current) {
      fieldHeader.current.focus({ preventScroll: true });
      fieldHeader.current.scrollIntoView?.({
        block: window.matchMedia("(max-width: 850px)").matches
          ? "start"
          : "nearest",
      });
    }
  }, [field?.id]);
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
        if (!creatingRef.current) return;
        const feature = d.getSnapshot().find((f) => f.id === id);
        if (feature?.geometry.type === "Polygon") {
          creatingRef.current = false;
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
    creatingRef.current = false;
    editTarget.current = null;
    draw.current?.clear();
    draw.current?.setMode("static");
    drawingRef.current = false;
    setDrawing(false);
    setEditing(false);
  }
  function startDrawing() {
    if (!draw.current) {
      setForm({});
      return;
    }
    clear();
    setSearch("");
    draw.current.setMode("polygon");
    creatingRef.current = true;
    drawingRef.current = true;
    setDrawing(true);
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
              clear();
              setSelected("");
            }}
          >
            {data?.farms.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <Button disabled={!farm || drawing || editing} onClick={startDrawing}>
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
      {(drawing || editing) && (
        <div className="map-drawing-bar">
          <span role="status">
            {editing
              ? "Выберите полигон и перемещайте вершины."
              : "Отметьте углы поля. Нажмите первую точку, чтобы замкнуть границу."}
          </span>
          <div className="row">
            {editing && (
              <Button
                disabled={saving}
                onClick={async () => {
                  const target = editTarget.current;
                  const geometry =
                    target &&
                    draw.current?.getSnapshotFeature(target.featureId)
                      ?.geometry;
                  if (!target || geometry?.type !== "Polygon") {
                    setMapError("Редактируемая граница отсутствует.");
                    return;
                  }
                  setSaving(true);
                  try {
                    const previousField = fields.find(
                      (item) => item.id === target.fieldId,
                    );
                    if (
                      previousField?.soil_type &&
                      !confirm(
                        "Подтверждаете, что ваши сведения о почве применимы к новой границе?",
                      )
                    )
                      return;
                    await save("fields", {
                      id: target.fieldId,
                      boundary: geometry,
                    });
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
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={clear}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}
      {mapError && (
        <div className="map-error" role="alert">
          {mapError}
          <button
            onClick={() => setMapError("")}
            aria-label="Закрыть сообщение"
          >
            ×
          </button>
        </div>
      )}
      <div className="map-layout">
        <div
          className={
            drawing || editing ? "map-canvas is-drawing" : "map-canvas"
          }
        >
          <div ref={container} className="map-container" />
          {!drawing && !editing && (
            <div className="map-tools">
              {fields.length > 0 && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по полям…"
                  aria-label="Поиск по полям"
                />
              )}
              {fields.length > 0 && search && (
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
                  disabled={!ready || !farm}
                  onClick={startDrawing}
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
          )}
          {fields.length > 0 && !drawing && !editing && (
            <div className="map-legend">
              <Layers size={14} />
              <span>Границы полей</span>
              <i /> Выбранное поле
            </div>
          )}
        </div>
        <aside className="field-panel">
          {field ? (
            <>
              <div
                className="field-card-header"
                ref={fieldHeader}
                tabIndex={-1}
              >
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
                <p className="field-card-meta">
                  {Number(field.area_hectares).toLocaleString("ru-RU", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  га
                  {farm?.region && ` · ${farm.region}`}
                </p>
              </div>
              {!selectedBounds && (
                <p role="status">Граница поля недоступна или повреждена.</p>
              )}
              <nav className="field-actions" aria-label="Действия с полем">
                <h3>Что хотите сделать?</h3>
                <Link
                  className="field-action field-action-primary"
                  to={`/rotation/${field.id}?mode=plan`}
                >
                  <ListChecks aria-hidden="true" />
                  <span>
                    <strong>Сравнить мой план</strong>
                    <small>Указать культуры на будущие годы</small>
                  </span>
                  <ArrowUpRight
                    className="field-action-arrow"
                    aria-hidden="true"
                  />
                </Link>
                <Link
                  className="field-action"
                  to={`/rotation/${field.id}?mode=explore`}
                >
                  <Sprout aria-hidden="true" />
                  <span>
                    <strong>Посмотреть варианты</strong>
                    <small>Изучить условия поля и возможные культуры</small>
                  </span>
                  <ArrowUpRight
                    className="field-action-arrow"
                    aria-hidden="true"
                  />
                </Link>
                <Link
                  className="field-action"
                  to={`/farms?history=${encodeURIComponent(field.id)}`}
                >
                  <BookOpen aria-hidden="true" />
                  <span>
                    <strong>
                      {history.length
                        ? "История посевов"
                        : "Записать прошлые посевы"}
                    </strong>
                    <small>
                      {history[0]
                        ? `Последняя запись · ${history[0].year}`
                        : "Добавить год и культуру, если они известны"}
                    </small>
                  </span>
                  <ArrowUpRight
                    className="field-action-arrow"
                    aria-hidden="true"
                  />
                </Link>
              </nav>
              <details className="flow-details field-data">
                <summary>Данные о поле</summary>
                <SoilEstimate boundary={field.boundary} />
                <FieldWeather field={field} />
                <p>
                  {field.irrigation_type
                    ? `Орошение · ${field.irrigation_type}`
                    : "Орошение не указано"}
                </p>
                <Link to={`/analytics/${field.id}?tab=sources`}>
                  Погода и спутниковые данные →
                </Link>
              </details>
              <Button variant="ghost" onClick={() => setForm({ field })}>
                Редактировать поле
              </Button>
              <Button
                variant="outline"
                disabled={!ready || !selectedBounds}
                onClick={() => {
                  clear();
                  const editor = draw.current;
                  if (!editor) return;
                  const [added] = editor.addFeatures([
                    {
                      type: "Feature",
                      geometry: field.boundary,
                      properties: { mode: "polygon" },
                    },
                  ]);
                  if (!added?.valid || added.id == null) {
                    setMapError(
                      "Не удалось подготовить границу к редактированию.",
                    );
                    return;
                  }
                  editTarget.current = {
                    fieldId: field.id,
                    featureId: added.id,
                  };
                  editor.setMode("select");
                  editor.selectFeature(added.id);
                  drawingRef.current = true;
                  setEditing(true);
                }}
              >
                Изменить границу на карте
              </Button>
            </>
          ) : !isLoading && !fields.length ? (
            <>
              <h2>{farm ? "Добавьте первое поле" : "Начните с хозяйства"}</h2>
              <p>
                {farm
                  ? "Найдите участок на карте и нажмите «Нарисовать поле»."
                  : "Создайте хозяйство, чтобы добавить поля."}
              </p>
              {!farm && (
                <Link className="button primary" to="/farms">
                  Создать хозяйство
                </Link>
              )}
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
          {farm && !drawing && !editing && (
            <Button variant="ghost" onClick={() => setForm({})}>
              Добавить по координатам или из файла
            </Button>
          )}
          {error && <p className="error">{error.message}</p>}
          {isLoading && <p role="status">Загрузка полей и их границ…</p>}
        </aside>
      </div>
      {form && farm && (
        <FieldForm
          farmId={farm.id}
          {...form}
          onSaved={setSelected}
          onClose={() => {
            setForm(null);
            clear();
          }}
        />
      )}
    </main>
  );
}
