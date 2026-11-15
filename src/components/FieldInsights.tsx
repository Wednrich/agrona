import { t } from "../lib/i18n";
import type { FieldInsight } from "../features/field-insights";

export function FieldInsights({
  title,
  insights,
}: {
  title: string;
  insights: FieldInsight[];
}) {
  if (!insights.length) return null;
  return (
    <section className="card field-insights" aria-label={title}>
      <h2>{title}</h2>
      {insights.map((insight) => (
        <article key={insight.id} className="field-insight">
          <h3>{insight.observation}</h3>
          <p>{insight.meaning}</p>
          <p>
            <strong>{t("Что проверить")}</strong> {insight.action}
          </p>
          <p className="caption">
            {insight.source} · {insight.period}
          </p>
          <details>
            <summary>
              {t("Уверенность:") + " "}
              {t(insight.confidence).toLowerCase()}
            </summary>
            <p>{insight.limits}</p>
          </details>
        </article>
      ))}
    </section>
  );
}
