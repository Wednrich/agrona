import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowUpRight, Tractor, Trash2, Pencil } from "lucide-react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { Button } from "../components/ui/button";
import FieldForm from "../components/FieldForm";
import type { Field, Season } from "../lib/types";
export default function Farms() {
  const { data, isLoading, error, save } = useData();
  const { user } = useAuth();
  const { farmId, setFarm } = useUI();
  const [search, setSearch] = useState("");
  const [fieldForm, setFieldForm] = useState<Field | "new" | null>(null);
  const [farmForm, setFarmForm] = useState(false);
  const [history, setHistory] = useState<Field | null>(null);
  const [seasonEdit, setSeasonEdit] = useState<Season | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const farm = data?.farms.find((f) => f.id === farmId) ?? data?.farms[0];
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage("Изменения сохранены");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (isLoading) return <div className="page">Загрузка хозяйств…</div>;
  if (error) return <div className="page error">{error.message}</div>;
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ВАШИ ЗЕМЛИ</span>
          <h1>Мои хозяйства</h1>
          <p>Каждое поле — часть большой картины.</p>
        </div>
        <Button onClick={() => setFarmForm(true)}>
          <Plus size={16} /> Создать хозяйство
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
            {f.name}
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
              <h2>{farm.name}</h2>
            </div>
            <div className="row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const name = prompt("Название хозяйства", farm.name);
                  if (name?.trim())
                    void perform(() =>
                      save("farms", { ...farm, name: name.trim() }),
                    );
                }}
              >
                <Pencil size={15} /> Переименовать
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Удалить «${farm.name}», все поля и историю?`))
                    void perform(() => save("farms", { id: farm.id }, true));
                }}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
          <div className="page-heading">
            <h2>Поля хозяйства</h2>
            <div className="row">
              <input
                aria-label="Поиск поля"
                placeholder="Найти поле…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button onClick={() => setFieldForm("new")}>
                <Plus size={16} /> Добавить поле
              </Button>
            </div>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Поле</th>
                  <th>Площадь</th>
                  <th>Почва</th>
                  <th>Орошение</th>
                  <th>Действия</th>
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
                          {f.name} <ArrowUpRight size={12} />
                        </Link>
                      </td>
                      <td>{Number(f.area_hectares).toFixed(1)} га</td>
                      <td>{f.soil_type || "Не указана"}</td>
                      <td>{f.irrigation_type || "Не указано"}</td>
                      <td>
                        <div className="row">
                          <button onClick={() => setHistory(f)}>История</button>
                          <button
                            aria-label={"Редактировать " + f.name}
                            onClick={() => setFieldForm(f)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            aria-label={"Удалить " + f.name}
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(`Удалить поле «${f.name}» и историю?`)
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
                <h2>Добавьте первое поле</h2>
                <p>Нарисуйте границу на карте или укажите координаты.</p>
                <Link className="button primary" to="/map">
                  Открыть карту →
                </Link>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="empty card">
          <Tractor />
          <h2>Начните с вашего хозяйства</h2>
          <p>Добавьте название и регион, затем создайте первое поле.</p>
          <Button onClick={() => setFarmForm(true)}>Создать хозяйство</Button>
        </div>
      )}
      {fieldForm && farm && (
        <FieldForm
          farmId={farm.id}
          field={fieldForm === "new" ? undefined : fieldForm}
          onClose={() => setFieldForm(null)}
        />
      )}
      {farmForm && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Создать хозяйство"
            className="card modal"
          >
            <h2>Новое хозяйство</h2>
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
                ["name", "Название"],
                ["country", "Страна"],
                ["region", "Регион"],
              ].map(([name, label]) => (
                <label key={name}>
                  {label}
                  <input name={name} required maxLength={120} />
                </label>
              ))}
              <p role="status">{message}</p>
              <div className="row">
                <Button disabled={busy}>Создать</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFarmForm(false)}
                >
                  Отмена
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
            aria-label="История поля"
          >
            <h2>{history.name} · история сезонов</h2>
            {data?.seasons
              .filter((s) => s.field_id === history.id)
              .sort((a, b) => b.year - a.year)
              .map((s) => (
                <div className="history-row" key={s.id}>
                  <strong>{s.year}</strong>
                  <button
                    aria-label={"Редактировать сезон " + s.year}
                    onClick={() => setSeasonEdit(s)}
                  >
                    <Pencil size={14} />
                  </button>
                  <span>
                    {data.crops.find((c) => c.id === s.crop_id)?.name}
                  </span>
                  <span>
                    {s.yield_tons_per_hectare ?? "—"} т/га ·{" "}
                    {s.irrigation_amount_mm ?? "—"} мм
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Удалить сезон?"))
                        void perform(() =>
                          save("field_seasons", { id: s.id }, true),
                        );
                    }}
                    aria-label="Удалить сезон"
                  >
                    <Trash2 size={14} />
                  </button>
                  <p>{s.notes}</p>
                </div>
              ))}
            <h3>{seasonEdit ? "Редактировать сезон" : "Записать сезон"}</h3>
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
                  Год
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
                  Культура
                  <select name="crop_id" defaultValue={seasonEdit?.crop_id}>
                    {data?.crops.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Урожайность, т/га
                  <input
                    type="number"
                    name="yield"
                    step="0.01"
                    min="0"
                    defaultValue={seasonEdit?.yield_tons_per_hectare ?? ""}
                  />
                </label>
                <label>
                  Орошение, мм
                  <input
                    type="number"
                    name="water"
                    step="0.1"
                    min="0"
                    defaultValue={seasonEdit?.irrigation_amount_mm ?? ""}
                  />
                </label>
                <label>
                  Посев
                  <input
                    type="date"
                    name="planting_date"
                    defaultValue={seasonEdit?.planting_date ?? ""}
                  />
                </label>
                <label>
                  Уборка
                  <input
                    type="date"
                    name="harvest_date"
                    defaultValue={seasonEdit?.harvest_date ?? ""}
                  />
                </label>
              </div>
              <label>
                Заметки
                <textarea name="notes" defaultValue={seasonEdit?.notes ?? ""} />
              </label>
              <p role="status">{message}</p>
              <div className="row">
                <Button disabled={busy}>Сохранить сезон</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHistory(null);
                    setSeasonEdit(null);
                  }}
                >
                  Закрыть
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
