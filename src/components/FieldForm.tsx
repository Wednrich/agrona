import { useState } from "react";
import type { Field } from "../lib/types";
import { useData } from "../lib/data";
import SoilPicker from "./SoilPicker";
import { restoreSoil, soilForSave, customSoilError } from "../lib/soil";
import { Button } from "./ui/button";
export default function FieldForm({
  farmId,
  field,
  boundary,
  onClose,
}: {
  farmId: string;
  field?: Field;
  boundary?: Field["boundary"];
  onClose: () => void;
}) {
  const { save } = useData();
  const [error, setError] = useState("");
  const [soil, setSoil] = useState(() => restoreSoil(field?.soil_type));
  const [soilError, setSoilError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="card modal"
        role="dialog"
        aria-modal="true"
        aria-label="Поле"
      >
        <h2>{field ? "Редактировать поле" : "Новое поле"}</h2>
        <p>Задайте границу на карте или введите координаты: долгота, широта.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const soilType = soilForSave(soil.choice, soil.custom);
            if (soilType === null) {
              setSoilError(customSoilError);
              return;
            }
            setError("");
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const geometry = JSON.parse(String(f.get("boundary")));
              await save("fields", {
                ...(field ? { id: field.id } : {}),
                farm_id: farmId,
                name: String(f.get("name")).trim(),
                soil_type: soilType,
                irrigation_type: f.get("irrigation_type"),
                boundary: geometry,
              });
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Название
            <input
              autoFocus
              name="name"
              defaultValue={field?.name}
              required
              maxLength={120}
            />
          </label>
          <div className="form-grid">
            <SoilPicker
              choice={soil.choice}
              onChange={(choice) => {
                setSoil((prev) => ({ ...prev, choice }));
                setSoilError("");
              }}
            />
            <label>
              Орошение
              <select
                name="irrigation_type"
                defaultValue={field?.irrigation_type ?? "Без орошения"}
              >
                <option>Без орошения</option>
                <option>Дождевание</option>
                <option>Капельное</option>
                <option>Другое</option>
              </select>
            </label>
          </div>
          {soil.choice === "Другое" && (
            <label>
              Укажите тип почвы
              <input
                required
                placeholder="Например, лугово-каштановая"
                value={soil.custom}
                aria-invalid={!!soilError}
                aria-describedby={soilError ? "custom-soil-error" : undefined}
                onInvalid={() => setSoilError(customSoilError)}
                onChange={(e) => {
                  setSoil({ ...soil, custom: e.target.value });
                  setSoilError("");
                }}
              />
              {soilError && (
                <span id="custom-soil-error" role="alert" className="error">
                  {soilError}
                </span>
              )}
            </label>
          )}
          <label>
            Граница GeoJSON
            <textarea
              name="boundary"
              required
              defaultValue={JSON.stringify(
                field?.boundary ??
                  boundary ?? { type: "Polygon", coordinates: [] },
              )}
            />
          </label>
          <p className="error" role="alert">
            {error}
          </p>
          <div className="row">
            <Button disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить поле"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
