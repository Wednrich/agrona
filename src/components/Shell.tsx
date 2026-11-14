import { Brand } from "./Brand";
import { NavLink, Outlet, Link, useNavigate } from "react-router-dom";
import {
  Map,
  Tractor,
  ChartNoAxesCombined,
  RefreshCw,
  Settings,
  LogOut,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
export default function Shell() {
  const { demo, user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="eyebrow">ПЛАНИРУЙТЕ. ВЫРАЩИВАЙТЕ. АДАПТИРУЙТЕСЬ.</span>
        <nav>
          {[
            ["/map", t("map"), Map],
            ["/farms", t("farms"), Tractor],
            ["/analytics/overview", t("analytics"), ChartNoAxesCombined],
            ["/rotation/overview", t("rotation"), RefreshCw],
            ["/settings", t("settings"), Settings],
          ].map(([url, label, Icon]) => {
            const I = Icon as typeof Map;
            return (
              <NavLink key={String(url)} to={String(url)}>
                <I size={19} />
                {String(label)}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="satellite-badge">✧ ДАННЫЕ О ЗЕМЛЕ</div>
          <p>
            От наблюдений из космоса
            <br />к решениям на вашем поле.
          </p>
          <button
            onClick={async () => {
              try {
                await logout();
                nav("/");
              } catch (e) {
                alert(String(e));
              }
            }}
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="row topbar-heading">
            <Brand className="topbar-brand" />
            <span>
              Моё хозяйство{" "}
              <span className="muted"> / Рабочее пространство</span>
            </span>
          </div>
          <div className="row">
            {demo && <span className="demo-badge">Демо · пример данных</span>}
            <Link to="/settings" className="avatar" aria-label="Профиль">
              {demo ? "Д" : (user?.email?.[0] ?? "Ф").toUpperCase()}
            </Link>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
