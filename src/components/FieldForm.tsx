import { t, getLanguage } from "../lib/i18n";
import { useRef, useState } from "react";
import type { Field } from "../lib/types";
import { useData } from "../lib/data";
import SoilPicker from "./SoilPicker";
import SoilEstimate from "./SoilEstimate";
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
  onSaved,
}: {
  farmId: string;
  field?: Field;
  boundary?: Field["boundary"];
  onClose: () => void;
  onSaved?: (fieldId: string) => void;
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
  const [boundaryEditorOpened, setBoundaryEditorOpened] = useState(
    !initial.preview,
  );
  const [error, setError] = useState("");
  const [soil, setSoil] = useState(() => restoreSoil(field?.soil_type));
  const [soilError, setSoilError] = useState("");
  const fieldDetails = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [soilConfirmed, setSoilConfirmed] = useState(false);
  const needsSoilConfirmation =
    !!field?.soil_type &&
    JSON.stringify(geometry) !== JSON.stringify(field.boundary) &&
    !!soil.choice;
  const initialIrrigation = field?.irrigation_type || "";
  const boundaryEditor = (
    <FieldBoundaryEditor
      initial={initial.preview}
      initialError={initial.error}
      onChange={(value) => {
        setGeometry(value);
        setSoilConfirmed(false);
      }}
    />
  );
  return (
    <div className="modal-backdrop">
      <section
        className="card modal wide field-form"
        role="dialog"
        aria-modal="true"
        aria-label={t("Поле")}
      >
        <h2>{field ? t("Редактировать поле") : t("Новое поле")}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !geometry || (needsSoilConfirmation && !soilConfirmed))
              return;
            const initialSoil = restoreSoil(field?.soil_type);
            const soilChanged =
              !field ||
              soil.choice !== initialSoil.choice ||
              soil.custom.trim() !== initialSoil.custom.trim();
            const soilType = soilForSave(soil.choice, soil.custom);
            if (soilChanged && soilType === null) {
              if (fieldDetails.current) fieldDetails.current.open = true;
              setSoilError(customSoilError);
              return;
            }
            setError("");
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const name = String(f.get("name")).trim();
              const irrigation = String(f.get("irrigation_type") ?? "");
              const fieldId = await save("fields", {
                ...(field ? { id: field.id } : { farm_id: farmId }),
                ...(!field || name !== field.name.trim() ? { name } : {}),
                ...(soilChanged ? { soil_type: soilType } : {}),
                ...(!field || irrigation !== initialIrrigation
                  ? { irrigation_type: irrigation }
                  : {}),
                boundary: geometry,
              });
              if (fieldId) onSaved?.(fieldId);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Название поля")}
            <input
              autoFocus
              name="name"
              defaultValue={field?.name}
              required
              maxLength={120}
            />
          </label>
          {initial.preview ? (
            <details
              className="field-form-details"
              onToggle={(e) => {
                if (e.currentTarget.open) setBoundaryEditorOpened(true);
              }}
            >
              <summary>
                {t("Граница поля")}
                {geometry === initial.preview.geometry
                  ? " " +
                    t(
                      "· {0} га",
                      new Intl.NumberFormat(getLanguage(), {
                        maximumFractionDigits: 4,
                      }).format(initial.preview.hectares),
                    )
                  : ""}
              </summary>
              {boundaryEditorOpened && boundaryEditor}
            </details>
          ) : (
            boundaryEditor
          )}
          <SoilEstimate boundary={geometry} />
          {needsSoilConfirmation && (
            <label>
              <input
                type="checkbox"
                checked={soilConfirmed}
                onChange={(e) => setSoilConfirmed(e.target.checked)}
              />{" "}
              {t("Мои сведения о почве применимы к новой границе")}
            </label>
          )}
          <details className="field-form-details" ref={fieldDetails}>
            <summary>{t("Уточнить почву и полив")}</summary>
            <p>{t("Добавьте известные сведения своего хозяйства.")}</p>
            {soil.choice && (
              <button
                type="button"
                onClick={() => {
                  setSoil(restoreSoil(""));
                  setSoilError("");
                }}
              >
                {t("Отменить ручное уточнение почвы")}
              </button>
            )}
            <div className="form-grid">
              <SoilPicker
                choice={soil.choice}
                onChange={(choice) => {
                  setSoil((prev) => ({ ...prev, choice }));
                  setSoilError("");
                }}
              />
              <label>
                {t("Орошение")}
                <select name="irrigation_type" defaultValue={initialIrrigation}>
                  <option value="">{t("Не указано")}</option>
                  {initialIrrigation &&
                    !irrigationOptions.includes(initialIrrigation) && (
                      <option>{initialIrrigation}</option>
                    )}
                  {irrigationOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(option)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {soil.choice === "Другое" && (
              <label>
                {t("Укажите тип почвы")}
                <input
                  placeholder={t("Например, лугово-каштановая")}
                  value={soil.custom}
                  aria-invalid={!!soilError}
                  aria-describedby={soilError ? "custom-soil-error" : undefined}
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
          </details>
          <p className="error" role="alert">
            {error}
          </p>
          <div className="row">
            <Button
              disabled={
                busy || !geometry || (needsSoilConfirmation && !soilConfirmed)
              }
            >
              {busy ? t("Сохраняем…") : t("Сохранить поле")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("Отмена")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
