# Deployment runbook — подготовка PHASE 0

Не является разрешением на применение. Production: `mcxzkbgnfqjbrlglfzki`.
Состояние 2026-11-15: 001–005 applied, 006 pending; SRTM function/key отсутствуют.
Readiness и риски: [основной отчёт](space-apps-readiness.md).

## Проверки без production writes

В аудите использовался Supabase CLI 3.1.0 с `--remote=<ref>`.
Перед выполнением на другой машине сверить `supabase --version` и `--help`:
старые CLI могут использовать `--project-ref`/`--linked`.

```sh
npm run typecheck
npm test
npm run build
git diff --check
supabase migration list --remote=mcxzkbgnfqjbrlglfzki
supabase functions list --remote=mcxzkbgnfqjbrlglfzki
supabase db query --remote=mcxzkbgnfqjbrlglfzki --read-only \
  "select to_regprocedure('public.hls_field_preflight(uuid)');"
```

До deployment сравнить определения affected RPC/policies/grants с локальными
SQL, а не только migration history. Не repair history и не запускать повторно
foundation. Не запускать SQL fixtures в production даже с rollback.
Создать disposable Supabase и выполнить `supabase/tests/*.sql` отдельно.
Проверить Deno entrypoints: frontend tsc их полностью не проверяет.

## Предложение действий, требующих отдельного разрешения

1. Согласовать deployment revision (включая текущие untracked SRTM файлы),
   резервную копию/восстановление, тестовый аккаунт и допустимое тестовое поле.
2. Dry-run миграций. Если pending не только 006 — остановиться, сравнить diff.
3. Применить проверенную 006 и обновить HLS Edge согласованной версией.
4. Владелец добавляет разрешённый OpenTopography key непосредственно в
   [Supabase Secrets](https://supabase.com/dashboard/project/mcxzkbgnfqjbrlglfzki/functions/secrets).
   Имя `OPENTOPOGRAPHY_API_KEY`. Значение не присылать в чат, не вставлять
   в shell command/history, Git или VITE env. Альтернатива — приватный env-file
   вне репозитория и `supabase secrets set --env-file ...`.
5. Развернуть SRTM и frontend. SRTM не требует новой SQL миграции.
6. Выполнить разрешённые реальные запросы; они создают cache/job записи и
   расходуют квоту. Boundary edit только на обозначенном тестовом поле:
   текущее приложение также пытается поставить HLS после сохранения.
7. Только после согласования cloud account/budget/IAM — HLS scheduler.

Подготовленные команды (не выполнялись):

```sh
supabase db push --dry-run --remote=mcxzkbgnfqjbrlglfzki
# Только после проверки списка и разрешения:
supabase db push --remote=mcxzkbgnfqjbrlglfzki
supabase functions deploy hls-vegetation --remote=mcxzkbgnfqjbrlglfzki
supabase functions deploy srtm-terrain --remote=mcxzkbgnfqjbrlglfzki
```

Не отключать JWT/RLS ради успешного smoke test. При проблеме откатить
приложение/функцию на известную версию; не удалять новые таблицы/историю.
Добавленная read-only preflight RPC сама не требует удаления при rollback app.

## Worker и инфраструктура

Существующий `--once` подходит для scheduled job. Нужны runtime secrets
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EARTHDATA_TOKEN. Не подключать приватный
workers/hls/.env в CI и не выводить environment. Secret Manager access — только
runtime account; scheduler — только invoker. Контейнер non-root уже есть.
Закрепить образ/зависимости; доступность Earthdata и expiry проверить отдельно.

[Cloud Run Jobs scheduler documentation](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
подтверждает возможность такого запуска без постоянного сервера.
[Pricing](https://cloud.google.com/run/pricing) зависит от региона, compute и
использования. Бюджет считать после малого benchmark; free tier не гарантирует
бесплатность Scheduler, secrets, registry, logs и transfer. Ресурсы не созданы.

Отдельно нужны retry failed jobs и operational status: текущий worker подбирает
queued/stale-running, но failed re-enqueue зависит от Edge-запроса. Следить за
возрастом очереди, partial status, error class, expiry; не за exit code одним.

## Evidence для релиза

Зафиксировать git revision, deployed function versions, product version,
processing version, geometry fingerprint, выбранные даты, количество valid
наблюдений, timestamps, cache hit и независимый расчет sample.
В публичные отчёты не включать user IDs, координаты приватных полей, URL с
подписями, ключи, raw headers или сырые provider exceptions.
