import { t, localize } from "../lib/i18n";
import { Link } from "react-router-dom";
import { useData } from "../lib/data";
export function FieldPicker({
  title,
  route,
}: {
  title: string;
  route: string;
}) {
  const { data, isLoading, error } = useData();
  return (
    <main className="page">
      <h1>{title}</h1>
      <p>{t("Выберите поле для продолжения.")}</p>
      {isLoading && <p>{t("Загрузка…")}</p>}
      {error && <p className="error">{localize(error.message)}</p>}
      <div className="metric-grid">
        {data?.fields.map((f) => (
          <Link className="card" key={f.id} to={`/${route}/${f.id}`}>
            <h3>{f.name} ↗</h3>
            <p>
              {Number(f.area_hectares).toFixed(1)}
              {" " + t("га")}
            </p>
          </Link>
        ))}
      </div>
      {data && !data.fields.length && (
        <Link className="button primary" to="/map">
          {t("Добавить первое поле")}
        </Link>
      )}
    </main>
  );
}
