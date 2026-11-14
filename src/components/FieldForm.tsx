import { useState } from "react";
import type { Field } from "../lib/types";
import { useData } from "../lib/data";
import SoilPicker from "./SoilPicker";
import FieldBoundaryEditor from "./FieldBoundaryEditor";
import { previewBoundary } from "../lib/field-boundary";
import { restoreSoil, soilForSave, customSoilError } from "../lib/soil";
import { Button } from "./ui/button";

const irrigationOptions = ["Без орошения", "Дождевание", "Капельное", "Другое"];

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
  const [initial] = useState(() => {
    const polygon = field?.boundary ?? boundary;
    if (!polygon) return {};
    try {
      return { preview: previewBoundary(polygon) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [geometry, setGeometry] = useState(initial.preview?.geometry);
  const [error, setError] = useState("");
  const [soil, setSoil] = useState(() => restoreSoil(field?.soil_type));
  const [soilError, setSoilError] = useState("");
  const [busy, setBusy] = useState(false);
  const initialIrrigation = field?.irrigation_type || irrigationOptions[0];
  return (
    <div className="modal-backdrop">
      <section
        className="card modal wide field-form"
        role="dialog"
        aria-modal="true"
        aria-label="Поле"
      >
        <h2>{field ? "Редактировать поле" : "Новое поле"}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !geometry) return;
            const initialSoil = restoreSoil(field?.soil_type);
            const soilChanged =
              !field ||
              soil.choice !== initialSoil.choice ||
              soil.custom.trim() !== initialSoil.custom.trim();
            const soilType = soilForSave(soil.choice, soil.custom);
            if (soilChanged && soilType === null) {
              setSoilError(customSoilError);
              return;
            }
            setError("");
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const name = String(f.get("name")).trim();
              const irrigation = f.get("irrigation_type");
              await save("fields", {
                ...(field ? { id: field.id } : { farm_id: farmId }),
                ...(!field || name !== field.name.trim() ? { name } : {}),
                ...(soilChanged ? { soil_type: soilType } : {}),
                ...(!field || irrigation !== initialIrrigation
                  ? { irrigation_type: irrigation }
                  : {}),
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
              <select name="irrigation_type" defaultValue={initialIrrigation}>
                {!irrigationOptions.includes(initialIrrigation) && (
                  <option>{initialIrrigation}</option>
                )}
                {irrigationOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
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
          <FieldBoundaryEditor
            initial={initial.preview}
            initialError={initial.error}
            onChange={setGeometry}
          />
          <p className="error" role="alert">
            {error}
          </p>
          <div className="row">
            <Button disabled={busy || !geometry}>
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
