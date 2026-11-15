import { t, localize } from "../lib/i18n";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, ArrowUpRight, Tractor, Trash2, Pencil } from "lucide-react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { Button } from "../components/ui/button";
import FieldForm from "../components/FieldForm";
import SoilEstimate from "../components/SoilEstimate";
import type { Field, Season } from "../lib/types";
export default function Farms() {
  const { data, isLoading, error, save } = useData();
  const { user, demo } = useAuth();
  const { farmId, setFarm } = useUI();
  const [search, setSearch] = useState("");
  const [fieldForm, setFieldForm] = useState<Field | "new" | null>(null);
  const [farmForm, setFarmForm] = useState(false);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const history = data?.fields.find(
    (field) => field.id === params.get("history"),
  );
  const [editingSeason, setSeasonEdit] = useState<Season | null>(null);
  const seasonEdit =
    editingSeason?.field_id === history?.id ? editingSeason : null;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const farm =
    data?.farms.find((f) => f.id === (history?.farm_id ?? farmId)) ??
    data?.farms[0];
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(t("Изменения сохранены"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (isLoading) return <div className="page">{t("Загрузка хозяйств…")}</div>;
  if (error) return <div className="page error">{localize(error.message)}</div>;
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("ВАШИ ЗЕМЛИ")}</span>
          <h1>{t("Мои хозяйства")}</h1>
          <p>{t("Каждое поле — часть большой картины.")}</p>
        </div>
        <Button onClick={() => setFarmForm(true)}>
          <Plus size={16} />
          {" " + t("Создать хозяйство")}
        </Button>
      </div>
      <p role="status">{message}</p>
      <div className="farm-tabs">
        {data?.farms.map((f) => (
          <button
            className={farm?.id === f.id ? "active" : ""}
            key={f.id}
            onClick={() => setFarm(f.id)}
          >
            <Tractor size={17} />
            {demo ? t(f.name) : f.name}
          </button>
        ))}
      </div>
      {farm ? (
        <>
          <div className="card farm-summary">
            <div>
              <span className="eyebrow">
                {farm.country} / {farm.region}
              </span>
              <h2>{demo ? t(farm.name) : farm.name}</h2>
            </div>
            <div className="row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const name = prompt(t("Название хозяйства"), farm.name);
                  if (name?.trim())
                    void perform(() =>
                      save("farms", { ...farm, name: name.trim() }),
                    );
                }}
              >
                <Pencil size={15} />
                {" " + t("Переименовать")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(t("Удалить «{0}», все поля и историю?", farm.name))
                  )
                    void perform(() => save("farms", { id: farm.id }, true));
                }}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
          <div className="page-heading">
            <h2>{t("Поля хозяйства")}</h2>
            <div className="row">
              <input
                aria-label={t("Поиск поля")}
                placeholder={t("Найти поле…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button onClick={() => setFieldForm("new")}>
                <Plus size={16} />
                {" " + t("Добавить поле")}
              </Button>
            </div>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Поле")}</th>
                  <th>{t("Площадь")}</th>
                  <th>{t("Почва")}</th>
                  <th>{t("Орошение")}</th>
                  <th>{t("Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.fields
                  .filter(
                    (f) =>
                      f.farm_id === farm.id &&
                      f.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Link to={"/analytics/" + f.id}>
                          {demo ? t(f.name) : f.name} <ArrowUpRight size={12} />
                        </Link>
                      </td>
                      <td>
                        {Number(f.area_hectares).toFixed(1)}
                        {" " + t("га")}
                      </td>
                      <td>
                        {f.soil_type && (
                          <p>
                            {t("Уточнение фермера ·") + " "}
                            {localize(f.soil_type)}
                          </p>
                        )}
                        <SoilEstimate boundary={f.boundary} />
                      </td>
                      <td>{localize(f.irrigation_type) || t("Не указано")}</td>
                      <td>
                        <div className="row">
                          <Link
                            to={`/farms?history=${encodeURIComponent(f.id)}`}
                          >
                            {t("История посевов")}
                          </Link>
                          <button
                            aria-label={t("Редактировать") + " " + f.name}
                            onClick={() => setFieldForm(f)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            aria-label={t("Удалить") + " " + f.name}
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  t("Удалить поле «{0}» и историю?", f.name),
                                )
                              )
                                void perform(() =>
                                  save("fields", { id: f.id }, true),
                                );
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data?.fields.some((f) => f.farm_id === farm.id) && (
              <div className="empty">
                <Tractor />
                <h2>{t("Добавьте первое поле")}</h2>
                <p>{t("Нарисуйте границу на карте или укажите координаты.")}</p>
                <Link className="button primary" to="/map">
                  {t("Открыть карту →")}
                </Link>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="empty card">
          <Tractor />
          <h2>{t("Начните с вашего хозяйства")}</h2>
          <p>{t("Добавьте название и регион, затем создайте первое поле.")}</p>
          <Button onClick={() => setFarmForm(true)}>
            {t("Создать хозяйство")}
          </Button>
        </div>
      )}
      {fieldForm && farm && (
        <FieldForm
          farmId={farm.id}
          field={fieldForm === "new" ? undefined : fieldForm}
          onSaved={
            fieldForm === "new"
              ? (id) => navigate(`/map?field=${encodeURIComponent(id)}`)
              : undefined
          }
          onClose={() => setFieldForm(null)}
        />
      )}
      {farmForm && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("Создать хозяйство")}
            className="card modal"
          >
            <h2>{t("Новое хозяйство")}</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await perform(async () => {
                  await save("farms", {
                    user_id: user?.id ?? "demo",
                    name: String(f.get("name")).trim(),
                    country: f.get("country"),
                    region: f.get("region"),
                  });
                  setFarmForm(false);
                });
              }}
            >
              {[
                ["name", t("Название")],
                ["country", t("Страна")],
                ["region", t("Регион")],
              ].map(([name, label]) => (
                <label key={name}>
                  {label}
                  <input name={name} required maxLength={120} />
                </label>
              ))}
              <p role="status">{message}</p>
              <div className="row">
                <Button disabled={busy}>{t("Создать")}</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFarmForm(false)}
                >
                  {t("Отмена")}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
      {history && (
        <div className="modal-backdrop">
          <section
            className="card modal wide"
            role="dialog"
            aria-modal="true"
            aria-label={t("История поля")}
          >
            <h2>
              {demo ? t(history.name) : history.name}
              {" " + t("· история сезонов")}
            </h2>
            {data?.seasons
              .filter((s) => s.field_id === history.id)
              .sort((a, b) => b.year - a.year)
              .map((s) => (
                <div className="history-row" key={s.id}>
                  <strong>{s.year}</strong>
                  <button
                    aria-label={t("Редактировать сезон") + " " + s.year}
                    onClick={() => setSeasonEdit(s)}
                  >
                    <Pencil size={14} />
                  </button>
                  <span>
                    {t(data.crops.find((c) => c.id === s.crop_id)?.name ?? "")}
                  </span>
                  <span>
                    {s.yield_tons_per_hectare ?? "—"}
                    {" " + t("т/га ·")} {s.irrigation_amount_mm ?? "—"}
                    {" " + t("мм")}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm(t("Удалить сезон?")))
                        void perform(() =>
                          save("field_seasons", { id: s.id }, true),
                        );
                    }}
                    aria-label={t("Удалить сезон")}
                  >
                    <Trash2 size={14} />
                  </button>
                  <p>{s.notes}</p>
                </div>
              ))}
            <h3>
              {seasonEdit ? t("Редактировать сезон") : t("Записать сезон")}
            </h3>
            <p>
              {t(
                "Укажите год и культуру, которую выращивали. Даты, урожайность, полив и заметки можно добавить позже.",
              )}
            </p>
            <form
              key={seasonEdit?.id ?? "new"}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                await perform(async () => {
                  await save("field_seasons", {
                    ...(seasonEdit ? { id: seasonEdit.id } : {}),
                    field_id: history.id,
                    year: Number(f.get("year")),
                    crop_id: f.get("crop_id"),
                    planting_date: f.get("planting_date") || null,
                    harvest_date: f.get("harvest_date") || null,
                    yield_tons_per_hectare:
                      f.get("yield") === "" ? null : Number(f.get("yield")),
                    irrigation_amount_mm:
                      f.get("water") === "" ? null : Number(f.get("water")),
                    notes: f.get("notes"),
                  });
                  setSeasonEdit(null);
                  form.reset();
                });
              }}
            >
              <div className="form-grid">
                <label>
                  {t("Год")}
                  <input
                    type="number"
                    name="year"
                    defaultValue={seasonEdit?.year ?? new Date().getFullYear()}
                    min={1900}
                    max={2200}
                    required
                  />
                </label>
                <label>
                  {t("Культура")}
                  <select
                    name="crop_id"
                    defaultValue={seasonEdit?.crop_id ?? ""}
                    required
                  >
                    <option value="" disabled>
                      {t("Выберите культуру")}
                    </option>
                    {data?.crops.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t(c.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Урожайность, т/га")}
                  <input
                    type="number"
                    name="yield"
                    step="0.01"
                    min="0"
                    defaultValue={seasonEdit?.yield_tons_per_hectare ?? ""}
                  />
                </label>
                <label>
                  {t("Орошение, мм")}
                  <input
                    type="number"
                    name="water"
                    step="0.1"
                    min="0"
                    defaultValue={seasonEdit?.irrigation_amount_mm ?? ""}
                  />
                </label>
                <label>
                  {t("Посев")}
                  <input
                    type="date"
                    name="planting_date"
                    defaultValue={seasonEdit?.planting_date ?? ""}
                  />
                </label>
                <label>
                  {t("Уборка")}
                  <input
                    type="date"
                    name="harvest_date"
                    defaultValue={seasonEdit?.harvest_date ?? ""}
                  />
                </label>
              </div>
              <label>
                {t("Заметки")}
                <textarea name="notes" defaultValue={seasonEdit?.notes ?? ""} />
              </label>
              <p role="status">{message}</p>
              <div className="row">
                <Button disabled={busy}>{t("Сохранить сезон")}</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSeasonEdit(null);
                    setParams({}, { replace: true });
                  }}
                >
                  {t("Закрыть")}
                </Button>
                <Link to={`/rotation/${encodeURIComponent(history.id)}`}>
                  {t("Перейти к планированию →")}
                </Link>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
