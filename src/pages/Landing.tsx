import { workspaceAccess } from "../lib/workspace-access";
import { Link, useNavigate } from "react-router-dom";
import {
  Sprout,
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
        <Link to="/" className="brand">
          <Sprout /> FIELD SHIFT
        </Link>
        <div>
          <a href="#approach">Возможности</a>
          <a href="#data">Данные NASA</a>
          <Link to={destination}>
            {user ? "Открыть приложение" : "Войти"} ↗
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-tag">
            <span /> ДАННЫЕ ИЗ КОСМОСА. РЕШЕНИЯ НА ЗЕМЛЕ.
          </div>
          <h1>
            Спутниковая аналитика
            <br />
            для{" "}
            <em>
              умного
              <br />
              севооборота.
            </em>
          </h1>
          <p>
            Планируйте культуры, оценивайте климатические риски и принимайте
            решения на основе данных NASA.
          </p>
          <div className="row">
            <Link className="button primary" to={destination}>
              {user ? "Открыть приложение" : "Начать работу"}{" "}
              <ArrowUpRight size={17} />
            </Link>
            <Button variant="ghost" onClick={demo} disabled={loading}>
              {user ? "К карте" : "Попробовать демо"} <ArrowRight size={16} />
            </Button>
          </div>
          <div className="hero-foot">
            <Satellite size={18} />
            <span>NASA POWER</span>
            <i />
            <span>От истории погоды — к будущему поля</span>
          </div>
        </div>
        <div className="hero-visual">
          <img
            src="https://images.unsplash.com/photo-1779943539046-a0e1a07373ac?auto=format&fit=crop&w=1400&q=85"
            alt="Зелёные сельскохозяйственные поля на холмах"
          />
          <div className="image-shade" />
          <div className="visual-top">
            <span>FIELD SHIFT / EARTH OBSERVATION</span>
            <span>↗</span>
          </div>
          <div className="visual-caption">
            <span>УВИДЕТЬ БОЛЬШЕ. ВЫРАСТИТЬ ЛУЧШЕ.</span>
            <h2>
              У каждого поля
              <br />
              есть своя история.
            </h2>
            <p>Давайте спланируем следующую главу.</p>
          </div>
          <div className="visual-coordinate">
            51.197° N &nbsp; 69.369° E{" "}
            <span>ДЕМО-ЛОКАЦИЯ · ФОТО ИЛЛЮСТРАТИВНОЕ</span>
          </div>
        </div>
      </section>
      <section className="mission" id="approach">
        <div>
          <span className="eyebrow">ОДНО ПОЛЕ. ПОЛНАЯ КАРТИНА.</span>
          <h2>
            От границ участка
            <br />
            до стратегии на годы.
          </h2>
        </div>
        <p>
          Объедините историю своего хозяйства с наблюдениями за Землёй.
          Понимайте условия, сравнивайте варианты и сохраняйте решения в одном
          рабочем пространстве.
        </p>
      </section>
      <section className="feature-strip">
        {[
          [
            Map,
            "01",
            "Ваши поля на карте",
            "Нарисуйте границы, сохраните площадь и историю культур. Все участки — в одном месте.",
          ],
          [
            ChartNoAxesCombined,
            "02",
            "Климат без догадок",
            "Изучайте температуру, осадки и сухие периоды. Всегда знайте источник и границы применимости данных.",
          ],
          [
            RefreshCw,
            "03",
            "Осознанный севооборот",
            "Сравнивайте последовательности культур по понятным правилам с учётом ваших ограничений.",
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
          <span className="eyebrow">НАУЧНЫЕ ДАННЫЕ. ПОНЯТНЫЙ КОНТЕКСТ.</span>
          <h2>
            Космос ближе,
            <br />
            чем кажется.
          </h2>
          <p>
            NASA POWER предоставляет многолетние наблюдения за климатом. Field
            Shift помогает исследовать их для выбранного участка — с
            источниками, периодами и объяснениями.
          </p>
          <p className="caption">
            Климатическая сетка не заменяет измерения почвы на поле. Проект для
            NASA Space Apps; не является продуктом NASA.
          </p>
          <a
            href="https://power.larc.nasa.gov/"
            target="_blank"
            rel="noreferrer"
          >
            Об источнике данных ↗
          </a>
        </div>
      </section>
      <section className="landing-cta">
        <span className="eyebrow">СЛЕДУЮЩИЙ ШАГ — ВАШ</span>
        <h2>Начните с одного поля.</h2>
        <p>Исследуйте демохозяйство без регистрации.</p>
        <Button onClick={demo} disabled={loading}>
          {user ? "К карте" : "Открыть демо"} <ArrowUpRight size={18} />
        </Button>
      </section>
      <footer>
        <Link className="brand" to="/">
          <Sprout /> FIELD SHIFT
        </Link>
        <span>Adapting Farms with NASA Data</span>
        <a
          href="https://unsplash.com/photos/aerial-view-of-green-and-brown-agricultural-fields-81HghedjWk8"
          target="_blank"
          rel="noreferrer"
        >
          Фото: Unsplash
        </a>
      </footer>
    </main>
  );
}
