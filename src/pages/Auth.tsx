import {
  CountryPicker,
  LocationPicker,
  type Country,
  type Location,
} from "../components/RegistrationLocations";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
export default function Auth() {
  const [mode, setMode] = useState<"login" | "register" | "reset" | "password">(
    window.location.hash.includes("type=recovery") ||
      new URLSearchParams(location.search).get("mode") === "recovery"
      ? "password"
      : "login",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [country, setCountry] = useState<Country | null>(null);
  const [place, setPlace] = useState<Location | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");
  const { enterDemo } = useAuth();
  const navigate = useNavigate();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    const fullName = String(f.get("full_name") ?? "").trim();
    setMessage("");
    if (mode === "register") {
      const next: Record<string, string> = {};
      if (!fullName) next.full_name = "Введите ваше имя.";
      if (!country) next.country = "Выберите страну.";
      if (!place) next.region = "Выберите регион или город из списка.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        next.email = "Введите корректный адрес.";
      if (password.length < 8)
        next.password = "Пароль должен содержать не менее 8 символов.";
      setErrors(next);
      if (Object.keys(next).length) return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: location.origin + "/map",
            data: {
              full_name: fullName,
              country: country!.name,
              country_code: country!.code,
              region: place!.name,
              latitude: place!.latitude,
              longitude: place!.longitude,
              location_id: place!.id,
              farm_name: String(f.get("farm_name") ?? "").trim(),
            },
          },
        });
        if (error) throw error;
        if (data.session) navigate("/map");
        else setVerifyEmail(email);
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/auth?mode=recovery",
        });
        if (error) throw error;
        setMessage("Ссылка для восстановления отправлена на почту.");
      } else if (mode === "password") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        navigate("/map");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate("/map");
      }
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Не удалось выполнить запрос",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <Link to="/" className="brand">
        ◈ FIELD SHIFT
      </Link>
      <section className="card auth-card">
        <span className="eyebrow">ВАШЕ ХОЗЯЙСТВО. НОВЫЕ ВОЗМОЖНОСТИ.</span>
        <h1>
          {verifyEmail
            ? "Подтвердите электронную почту"
            : mode === "register"
              ? "Создайте аккаунт"
              : mode === "reset"
                ? "Восстановление доступа"
                : mode === "password"
                  ? "Новый пароль"
                  : "С возвращением"}
        </h1>
        {verifyEmail ? (
          <p role="status">
            Проверьте почту {verifyEmail} и папку «Спам». Откройте ссылку из
            письма, чтобы завершить регистрацию.
          </p>
        ) : (
          <p>Начните принимать решения на основе данных.</p>
        )}
        {!supabase && (
          <p className="notice">
            Подключите Supabase в .env для регистрации и входа. Демо доступно
            без аккаунта.
          </p>
        )}
        {!verifyEmail && (
          <form onSubmit={submit} noValidate={mode === "register"}>
            {mode === "register" && (
              <>
                <label>
                  Ваше имя
                  <input
                    name="full_name"
                    maxLength={120}
                    autoComplete="name"
                    required
                    aria-invalid={!!errors.full_name}
                    aria-describedby={
                      errors.full_name ? "full-name-error" : undefined
                    }
                  />
                  {errors.full_name && (
                    <span id="full-name-error" className="error">
                      {errors.full_name}
                    </span>
                  )}
                </label>
                <CountryPicker
                  value={country}
                  onChange={(next) => {
                    if (next.code !== country?.code) setPlace(null);
                    setCountry(next);
                    setErrors((prev) => ({ ...prev, country: "", region: "" }));
                  }}
                  error={errors.country}
                />
                <LocationPicker
                  key={country?.code}
                  country={country}
                  value={place}
                  onChange={(value) => {
                    setPlace(value);
                    if (value) setErrors((prev) => ({ ...prev, region: "" }));
                  }}
                  error={errors.region}
                />
                <label>
                  Название хозяйства (необязательно)
                  <input name="farm_name" maxLength={120} />
                </label>
              </>
            )}
            {mode !== "password" && (
              <label>
                Электронная почта
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
                {errors.email && (
                  <span id="email-error" className="error">
                    {errors.email}
                  </span>
                )}
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Пароль
                <span className="registration-password">
                  <input
                    name="password"
                    type={mode === "register" && visible ? "text" : "password"}
                    aria-invalid={!!errors.password}
                    aria-describedby={
                      errors.password ? "password-error" : undefined
                    }
                    minLength={8}
                    required
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                  />
                  {mode === "register" && (
                    <button
                      type="button"
                      onClick={() => setVisible(!visible)}
                      aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  )}
                </span>
                {errors.password && (
                  <span id="password-error" className="error">
                    {errors.password}
                  </span>
                )}
              </label>
            )}
            <Button disabled={!supabase || busy}>
              {busy
                ? "Подождите…"
                : mode === "register"
                  ? "Зарегистрироваться"
                  : mode === "reset"
                    ? "Отправить ссылку"
                    : mode === "password"
                      ? "Сохранить пароль"
                      : "Войти"}
            </Button>
          </form>
        )}
        <p role="status">{message}</p>
        <div className="row wrap">
          <button
            disabled={busy}
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setVerifyEmail("");
              setErrors({});
              setMessage("");
              setVisible(false);
            }}
          >
            {mode === "register" ? "Уже есть аккаунт" : "Создать аккаунт"}
          </button>
          {!verifyEmail && (
            <button
              disabled={busy}
              onClick={() => {
                setMode("reset");
                setErrors({});
                setMessage("");
              }}
            >
              Забыли пароль?
            </button>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            enterDemo();
            navigate("/map");
          }}
        >
          Попробовать демо →
        </Button>
      </section>
    </main>
  );
}
