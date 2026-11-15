import { t } from "../lib/i18n";
import { Brand } from "../components/Brand";
import { LanguageSelect } from "../components/LanguageSelect";
import { workspaceAccess } from "../lib/workspace-access";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Satellite,
  Map,
  ChartNoAxesCombined,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
export default function Landing() {
  const { enterDemo, user, loading } = useAuth();
  const { destination } = workspaceAccess(user?.id, loading, false);
  const navigate = useNavigate();
  const demo = () => {
    if (loading) return;
    if (!user) enterDemo();
    navigate("/map");
  };
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Brand />
        <div>
          <LanguageSelect />
          <a href="#approach">{t("Возможности")}</a>
          <a href="#data">{t("Данные NASA")}</a>
          <Link to={destination}>
            {user ? t("Открыть приложение") : t("Войти")} ↗
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-tag">
            <span />
            {" " + t("ДАННЫЕ ИЗ КОСМОСА. РЕШЕНИЯ НА ЗЕМЛЕ.")}
          </div>
          <h1>
            {t("Спутниковая аналитика")}
            <br />
            {t("для")}{" "}
            <em>
              {t("умного")}
              <br />
              {t("севооборота.")}
            </em>
          </h1>
          <p>
            {t(
              "Планируйте культуры, оценивайте климатические риски и принимайте решения на основе данных NASA.",
            )}
          </p>
          <div className="row">
            <Link className="button primary" to={destination}>
              {user ? t("Открыть приложение") : t("Начать работу")}{" "}
              <ArrowUpRight size={17} />
            </Link>
            <Button variant="ghost" onClick={demo} disabled={loading}>
              {user ? t("К карте") : t("Попробовать демо")}{" "}
              <ArrowRight size={16} />
            </Button>
          </div>
          <div className="hero-foot">
            <Satellite size={18} />
            <span>NASA POWER</span>
            <i />
            <span>{t("От истории погоды — к будущему поля")}</span>
          </div>
        </div>
        <div className="hero-visual">
          <img
            src="https://images.unsplash.com/photo-1779943539046-a0e1a07373ac?auto=format&fit=crop&w=1400&q=85"
            alt={t("Зелёные сельскохозяйственные поля на холмах")}
          />
          <div className="image-shade" />
          <div className="visual-top">
            <span>AGRONA / EARTH OBSERVATION</span>
            <span>↗</span>
          </div>
          <div className="visual-caption">
            <span>{t("УВИДЕТЬ БОЛЬШЕ. ВЫРАСТИТЬ ЛУЧШЕ.")}</span>
            <h2>
              {t("У каждого поля")}
              <br />
              {t("есть своя история.")}
            </h2>
            <p>{t("Давайте спланируем следующую главу.")}</p>
          </div>
          <div className="visual-coordinate">
            51.197° N &nbsp; 69.369° E{" "}
            <span>{t("ДЕМО-ЛОКАЦИЯ · ФОТО ИЛЛЮСТРАТИВНОЕ")}</span>
          </div>
        </div>
      </section>
      <section className="mission" id="approach">
        <div>
          <span className="eyebrow">{t("ОДНО ПОЛЕ. ПОЛНАЯ КАРТИНА.")}</span>
          <h2>
            {t("От границ участка")}
            <br />
            {t("до стратегии на годы.")}
          </h2>
        </div>
        <p>
          {t(
            "Объедините историю своего хозяйства с наблюдениями за Землёй. Понимайте условия, сравнивайте варианты и сохраняйте решения в одном рабочем пространстве.",
          )}
        </p>
      </section>
      <section className="feature-strip">
        {[
          [
            Map,
            "01",
            t("Ваши поля на карте"),
            t(
              "Нарисуйте границы, сохраните площадь и историю культур. Все участки — в одном месте.",
            ),
          ],
          [
            ChartNoAxesCombined,
            "02",
            t("Климат без догадок"),
            t(
              "Изучайте температуру, осадки и сухие периоды. Всегда знайте источник и границы применимости данных.",
            ),
          ],
          [
            RefreshCw,
            "03",
            t("Осознанный севооборот"),
            t(
              "Сравнивайте последовательности культур по понятным правилам с учётом ваших ограничений.",
            ),
          ],
        ].map(([Icon, num, title, desc]) => {
          const I = Icon as typeof Map;
          return (
            <article key={String(num)}>
              <div>
                <I size={25} />
                <span>{String(num)}</span>
              </div>
              <h3>{String(title)}</h3>
              <p>{String(desc)}</p>
            </article>
          );
        })}
      </section>
      <section className="nasa-section" id="data">
        <div className="orbit-mark">
          <Satellite size={64} />
          <span>
            NASA
            <br />
            POWER
          </span>
        </div>
        <div>
          <span className="eyebrow">
            {t("НАУЧНЫЕ ДАННЫЕ. ПОНЯТНЫЙ КОНТЕКСТ.")}
          </span>
          <h2>
            {t("Космос ближе,")}
            <br />
            {t("чем кажется.")}
          </h2>
          <p>
            {t(
              "NASA POWER предоставляет многолетние наблюдения за климатом. AGRONA помогает исследовать их для выбранного участка — с источниками, периодами и объяснениями.",
            )}
          </p>
          <p className="caption">
            {t(
              "Климатическая сетка не заменяет измерения почвы на поле. Проект для NASA Space Apps; не является продуктом NASA.",
            )}
          </p>
          <a
            href="https://power.larc.nasa.gov/"
            target="_blank"
            rel="noreferrer"
          >
            {t("Об источнике данных ↗")}
          </a>
        </div>
      </section>
      <section className="landing-cta">
        <span className="eyebrow">{t("СЛЕДУЮЩИЙ ШАГ — ВАШ")}</span>
        <h2>{t("Начните с одного поля.")}</h2>
        <p>{t("Исследуйте демохозяйство без регистрации.")}</p>
        <Button onClick={demo} disabled={loading}>
          {user ? t("К карте") : t("Открыть демо")} <ArrowUpRight size={18} />
        </Button>
      </section>
      <footer>
        <Brand />
        <span>Adapting Farms with NASA Data</span>
        <a
          href="https://unsplash.com/photos/aerial-view-of-green-and-brown-agricultural-fields-81HghedjWk8"
          target="_blank"
          rel="noreferrer"
        >
          {t("Фото: Unsplash")}
        </a>
      </footer>
    </main>
  );
}
