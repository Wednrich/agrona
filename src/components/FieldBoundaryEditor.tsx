import { lazy, Suspense, useId, useRef, useState } from "react";
import type { Polygon } from "geojson";
import {
  type BoundaryPreview,
  coordinatesFromPolygon,
  polygonFromCoordinates,
  previewBoundary,
  readFieldGeoJSON,
} from "../lib/field-boundary";
import CoordinateTable from "./CoordinateTable";
import { Button } from "./ui/button";

const FieldBoundaryMap = lazy(() => import("./FieldBoundaryMap"));
type Mode = "coordinates" | "draw" | "file" | "raw";
const modes = [
  ["draw", "Нарисовать на карте"],
  ["coordinates", "Ввести координаты"],
  ["file", "Импортировать GeoJSON"],
] as const;
const areaFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });

export default function FieldBoundaryEditor({
  initial,
  initialError,
  onChange,
}: {
  initial?: BoundaryPreview;
  initialError?: string;
  onChange: (geometry: Polygon | undefined) => void;
}) {
  const [mode, setMode] = useState<Mode>("coordinates");
  const [rows, setRows] = useState(() =>
    coordinatesFromPolygon(initial?.geometry),
  );
  const [preview, setPreview] = useState(initial);
  const [lastValid, setLastValid] = useState(initial);
  const [error, setError] = useState(initialError ?? "");
  const [raw, setRaw] = useState("");
  const [drawing, setDrawing] = useState(false);
  const importRequest = useRef(0);
  const descriptionId = useId();

  function update(calculate: () => ReturnType<typeof previewBoundary>) {
    try {
      const next = calculate();
      setPreview(next);
      setLastValid(next);
      onChange(next.geometry);
      setError("");
    } catch (cause) {
      setPreview(undefined);
      onChange(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    importRequest.current++;
    setMode(next);
    setDrawing(false);
    setError("");
    setPreview(lastValid);
    onChange(lastValid?.geometry);
    if (next === "coordinates")
      setRows(coordinatesFromPolygon(lastValid?.geometry));
    if (next === "raw")
      setRaw(lastValid ? JSON.stringify(lastValid.geometry, null, 2) : "");
  }

  return (
    <fieldset
      className="field-boundary-editor"
      aria-describedby={descriptionId}
    >
      <legend>Граница поля</legend>
      <div className="row wrap">
        {modes.map(([key, label]) => (
          <Button
            type="button"
            key={key}
            variant={mode === key ? "default" : "outline"}
            aria-pressed={mode === key}
            onClick={() => switchMode(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {mode === "coordinates" && (
        <CoordinateTable
          rows={rows}
          onChange={(next) => {
            setRows(next);
            update(() => polygonFromCoordinates(next));
          }}
        />
      )}
      {mode === "draw" && (
        <>
          <p>
            Нажимайте на карту, чтобы поставить точки. Нажмите первую точку,
            чтобы замкнуть контур.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDrawing(!drawing);
              onChange(drawing ? preview?.geometry : undefined);
            }}
          >
            {drawing ? "Отменить рисование" : "Начать рисование"}
          </Button>
        </>
      )}
      {mode === "file" && (
        <label>
          Файл GeoJSON с границей одного поля
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const request = ++importRequest.current;
              setError("");
              setPreview(undefined);
              onChange(undefined);
              try {
                const contents = await file.text();
                if (request === importRequest.current)
                  update(() => readFieldGeoJSON(contents));
              } catch {
                if (request === importRequest.current)
                  setError("Не удалось открыть выбранный файл.");
              }
            }}
          />
        </label>
      )}
      <details open={mode === "raw" || undefined}>
        <summary>Дополнительно</summary>
        {mode === "raw" ? (
          <label>
            Исходный GeoJSON
            <textarea
              rows={6}
              value={raw}
              onChange={(event) => {
                const text = event.target.value;
                setRaw(text);
                update(() => readFieldGeoJSON(text));
              }}
            />
          </label>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => switchMode("raw")}
          >
            Ввести исходный GeoJSON
          </Button>
        )}
      </details>
      <p
        id={descriptionId}
        className={error ? "error" : undefined}
        aria-live="polite"
      >
        {error ||
          (preview
            ? `Предварительная площадь: ${areaFormat.format(preview.hectares)} га`
            : "Задайте границу, чтобы увидеть полигон и площадь.")}
      </p>
      {(lastValid || mode === "draw") && (
        <Suspense fallback={<p role="status">Загружаем карту…</p>}>
          <FieldBoundaryMap
            geometry={preview?.geometry}
            drawing={drawing}
            onDraw={(polygon) => {
              setDrawing(false);
              update(() => previewBoundary(polygon));
            }}
          />
        </Suspense>
      )}
    </fieldset>
  );
}
