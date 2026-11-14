import { FunctionsHttpError } from "@supabase/supabase-js";

export async function powerErrorMessage(error: unknown): Promise<string> {
  if (
    error instanceof FunctionsHttpError &&
    error.context instanceof Response
  ) {
    const response = error.context;
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (response.status === 404)
      return body?.error === "Поле недоступно"
        ? "Поле недоступно. Откройте аналитику из списка ваших полей."
        : "Функция nasa-power не найдена в подключённом проекте Supabase.";
    if (response.status === 401 || response.status === 403)
      return "Не удалось подтвердить доступ к аналитике. Войдите в аккаунт заново.";
    if (typeof body?.error === "string") return body.error;
  }
  return "Не удалось связаться с сервисом NASA POWER. Повторите запрос позже.";
}
