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
import { LanguageSelect } from "./LanguageSelect";
export default function Shell() {
  const { demo, user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="eyebrow">
          {t("ПЛАНИРУЙТЕ. ВЫРАЩИВАЙТЕ. АДАПТИРУЙТЕСЬ.")}
        </span>
        <nav>
          {[
            ["/map", t("Карта"), Map],
            ["/farms", t("Мои хозяйства"), Tractor],
            ["/analytics/overview", t("Аналитика"), ChartNoAxesCombined],
            ["/rotation/overview", t("Севооборот"), RefreshCw],
            ["/settings", t("Настройки"), Settings],
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
          <div className="satellite-badge">{t("✧ ДАННЫЕ О ЗЕМЛЕ")}</div>
          <p>
            {t("От наблюдений из космоса")}
            <br />
            {t("к решениям на вашем поле.")}
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
            <LogOut size={16} />
            {" " + t("Выйти")}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="row topbar-heading">
            <Brand className="topbar-brand" />
            <span>
              {t("Моё хозяйство")}{" "}
              <span className="muted">{" " + t("/ Рабочее пространство")}</span>
            </span>
          </div>
          <div className="row">
            <LanguageSelect />
            {demo && (
              <span className="demo-badge">{t("Демо · пример данных")}</span>
            )}
            <Link to="/settings" className="avatar" aria-label={t("Профиль")}>
              {demo ? t("Д") : (user?.email?.[0] ?? t("Ф")).toUpperCase()}
            </Link>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
