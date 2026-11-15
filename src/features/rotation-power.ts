import { t } from "../lib/i18n";
import type { Observation } from "../lib/types";
import { matchesRotationGeometry } from "./rotation-climate";

type Invoke = (
  name: string,
  options: { body: { fieldId: string; year: number } },
) => PromiseLike<{ data: any; error: unknown }>;

// POWER jobs run in the existing server worker. Polling is bounded and cancels on navigation.
export async function loadRotationPower(
  invoke: Invoke,
  fieldId: string,
  year: number,
  fingerprint: string,
  signal: AbortSignal,
  pauseMs = 2000,
  attempts = 60,
): Promise<Observation[]> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fingerprint),
  );
  const revision = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  for (let i = 0; i < attempts; i++) {
    signal.throwIfAborted();
    const { data, error } = await invoke("nasa-power", {
      body: { fieldId, year },
    });
    signal.throwIfAborted();
    if (error)
      throw new Error(
        t(
          "Не удалось загрузить NASA POWER. Можно повторить запрос или продолжить без погодной оценки.",
        ),
      );
    if (!data?.pending) {
      if (data?.warning)
        throw new Error(
          t(
            "NASA POWER пока недоступен. Повторите позже или продолжите без погодной оценки.",
          ),
        );
      if (
        !matchesRotationGeometry(
          data?.metadata?.geometry,
          fingerprint,
          revision,
        )
      )
        throw new Error(
          t(
            "Погода не соответствует текущей границе поля. Повторите загрузку.",
          ),
        );
      return data.observations ?? [];
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, pauseMs);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  throw new Error(
    t(
      "Загрузка NASA POWER ещё не завершена. Повторите запрос позже или продолжите без погодной оценки.",
    ),
  );
}
