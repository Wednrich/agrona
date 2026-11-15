import { getLanguage, t } from "../lib/i18n";
import { useId, useRef, useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "./ui/button";
import { requestAdvisor } from "../lib/advisor";
import type {
  AdvisorAnswer,
  AdvisorInput,
  AdvisorLanguage,
} from "../../supabase/functions/_shared/advisor-contract";

type Scope = Pick<AdvisorInput, "fieldId" | "year" | "start" | "end">;
type Turn = { question: string; answer: AdvisorAnswer };

function Answer({ answer }: { answer: AdvisorAnswer }) {
  return (
    <div className="advisor-answer">
      <p className="caption">
        {answer.method === "deepseek"
          ? t("Объяснение с помощью DeepSeek")
          : t("Сводка по источникам AGRONA")}
      </p>
      <p>
        <strong>{answer.summary}</strong>
      </p>
      {answer.observations.length > 0 && (
        <section>
          <h4>{t("Что показывают данные")}</h4>
          <ul>
            {answer.observations.map((item) => (
              <li key={item.text}>
                {item.text}
                <small className="caption">
                  {item.date && `${item.date} · `}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.source} ↗
                    </a>
                  ) : (
                    item.source
                  )}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {[
        { title: t("Как это понимать"), lines: answer.interpretations },
        { title: t("Что можно проверить"), lines: answer.recommendations },
        { title: t("Ограничения данных"), lines: answer.limitations },
      ].map(
        ({ title, lines }) =>
          lines.length > 0 && (
            <section key={title}>
              <h4>{title}</h4>
              <ul>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}

function useAdvisorRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  async function run(
    input: AdvisorInput,
    onAnswer: (answer: AdvisorAnswer) => void,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      onAnswer(await requestAdvisor(input));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Не удалось получить объяснение."),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { run, pending, error };
}

export function ExplainAdvisor({
  scope,
  scenarioId,
}: {
  scope: Scope;
  scenarioId?: string;
}) {
  const [answer, setAnswer] = useState<AdvisorAnswer>();
  const { run, pending, error } = useAdvisorRequest();
  return (
    <div className="advisor-explain">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          void run(
            {
              ...scope,
              language: getLanguage(),
              mode: scenarioId ? "rotation" : "analysis",
              scenarioId,
            },
            setAnswer,
          )
        }
      >
        <MessageSquare size={16} aria-hidden="true" />
        {scenarioId
          ? t("Почему AGRONA рекомендует этот план?")
          : t("Объяснить мои данные")}
      </Button>
      {pending && (
        <p role="status">{t("Подбираем объяснение по данным поля…")}</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {answer && (
        <div aria-live="polite">
          <Answer answer={answer} />
        </div>
      )}
    </div>
  );
}

const examples: Record<AdvisorLanguage, string[]> = {
  ru: [
    "Как менялась растительность?",
    "Что влияет на потребность в воде?",
    "Каких данных не хватает?",
    "Почему AGRONA предложила такой севооборот?",
  ],
  kk: [
    "Өсімдік жамылғысы қалай өзгерді?",
    "Су қажеттілігіне не әсер етеді?",
    "Қандай дерек жетіспейді?",
    "AGRONA неліктен осы ауыспалы егісті ұсынды?",
  ],
  en: [
    "How did vegetation change?",
    "What affects water needs?",
    "What data are missing?",
    "Why did AGRONA suggest this rotation?",
  ],
};

export function AiAdvisorChat({
  scope,
  demo,
}: {
  scope: Scope;
  demo: boolean;
}) {
  const [answerLanguage, setAnswerLanguage] = useState<AdvisorLanguage>();
  const language = answerLanguage ?? getLanguage();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const { run, pending, error } = useAdvisorRequest();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 2 || demo) return;
    const focus = turns.at(-1)?.answer.focus;
    void run(
      { ...scope, mode: "chat", language, question: text, focus },
      (answer) => {
        setTurns((current) => [...current, { question: text, answer }]);
        setQuestion("");
      },
    );
  }
  return (
    <section className="card advisor-chat">
      <h2>{t("ИИ-агроном")}</h2>
      <p>
        {t(
          "Задайте вопрос о своём поле. AGRONA использует спутниковые и климатические данные, чтобы объяснить состояние поля и помочь оценить возможные решения.",
        )}
      </p>
      <p className="caption">
        {t("Период наблюдений") + " "}
        {scope.start} — {scope.end}
      </p>
      {demo ? (
        <p>
          {t("Войдите в аккаунт и выберите своё поле, чтобы задать вопрос.")}
        </p>
      ) : (
        <>
          <form className="advisor-form" onSubmit={submit}>
            <label className="advisor-language">
              {t("Язык ответа")}
              <select
                value={language}
                disabled={pending}
                onChange={(event) =>
                  setAnswerLanguage(event.target.value as AdvisorLanguage)
                }
              >
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
                <option value="en">English</option>
              </select>
            </label>
            <div
              className="advisor-examples"
              aria-label={t("Примеры вопросов")}
            >
              {examples[language].map((example) => (
                <Button
                  key={example}
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setQuestion(example);
                    inputRef.current?.focus();
                  }}
                >
                  {example}
                </Button>
              ))}
            </div>
            <label htmlFor={inputId}>{t("Вопрос о поле")}</label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={3}
              maxLength={500}
              value={question}
              disabled={pending}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button
              type="submit"
              disabled={pending || question.trim().length < 2}
            >
              <Send size={16} aria-hidden="true" />
              {" " + t("Отправить вопрос")}
            </Button>
          </form>
          {pending && (
            <p role="status">{t("Подбираем объяснение по данным поля…")}</p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div role="log" aria-label={t("История беседы")}>
            {turns.map((turn, i) => (
              <article key={i} className="advisor-turn">
                <h3>{turn.question}</h3>
                <Answer answer={turn.answer} />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
