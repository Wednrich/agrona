import { t } from "./i18n";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  AdvisorAnswer,
  AdvisorErrorCode,
  AdvisorInput,
} from "../../supabase/functions/_shared/advisor-contract";

const messages: Record<AdvisorErrorCode, string> = {
  invalid: "Проверьте год и даты наблюдений.",
  question:
    "Задайте короткий вопрос о поле. Уберите ссылки, контакты и координаты.",
  sign_in: "Войдите в аккаунт снова, чтобы продолжить.",
  field: "Поле недоступно. Выберите своё сохранённое поле.",
  scenario: "Сценарий недоступен. Сохраните новый расчёт и повторите.",
  period:
    "Период или граница поля отличаются от сохранённого расчёта. Пересчитайте сценарий.",
  busy: "Недавний запрос ещё обрабатывается. Подождите немного и повторите.",
  limit:
    "Достигнут лимит. Доступно до трёх новых обращений в минуту и двенадцати за 24 часа.",
  disabled: "ИИ-агроном пока не подключён. Данные поля доступны в аналитике.",
  key: "ИИ-агроном сейчас недоступен. Сервису нужно проверить подключение.",
  billing: "ИИ-агроном приостановлен из-за настроек оплаты сервиса.",
  provider_limit: "Сервис ИИ перегружен. Попробуйте позже.",
  provider: "Не удалось получить ответ ИИ. Попробуйте позже.",
  response:
    "ИИ не вернул проверяемый ответ. Переформулируйте вопрос или откройте данные поля.",
  timeout: "Сервис ИИ не успел ответить. Попробуйте позже.",
  server: "Не удалось загрузить проверенные данные. Попробуйте позже.",
};

export async function requestAdvisor(
  input: AdvisorInput,
): Promise<AdvisorAnswer> {
  if (!supabase) throw new Error(t(messages.disabled));
  const { data, error } = await supabase.functions.invoke<{
    answer: AdvisorAnswer;
  }>("ai-advisor", { body: input });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response: Response = error.context;
      const payload = await response.json().catch(() => null);
      const code = payload?.error;
      if (typeof code === "string" && Object.hasOwn(messages, code)) {
        throw new Error(t(messages[code as AdvisorErrorCode]));
      }
      if (response.status === 401) throw new Error(t(messages.sign_in));
      if (response.status === 404) throw new Error(t(messages.disabled));
    }
    throw new Error(t(messages.server));
  }
  if (!data?.answer?.summary) throw new Error(t(messages.response));
  return data.answer;
}
