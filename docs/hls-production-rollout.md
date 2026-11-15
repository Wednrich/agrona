# PHASE 1.1 — NASA HLS Production Reconciliation

Проверка: 2026-11-15. Production project: `mcxzkbgnfqjbrlglfzki`.
Во время работы по просьбе владельца получен GitHub main `8958e58` через
fast-forward. Обновление не изменило supabase/ и workers/hls/. Проверки
frontend ниже повторены на новом состоянии. PHASE 0 остаётся историческим
аудитом предыдущей версии, особенно в отношении изменившегося севооборота.

**Решение:** миграция 006 совместима с проверенными зависимостями production.
Её можно готовить к применению, но разрешения на применение/deploy ещё нет.
Не утверждается, что HLS работает end-to-end или автоматически.

## 1. Фактическое состояние

Проверка проведена CLI через `--read-only`; изменяющие RPC не вызывались.
Запрос для повторения: `supabase/audit/hls-production-readonly.sql`.
Вывод содержит схему/определения функций и агрегаты, без имён фермеров,
идентификаторов полей, координат, токенов и provider error text.

| Объект | Подтверждено |
| --- | --- |
| PostgreSQL / PostGIS | 17.11 / 3.3.7 |
| Migration history | 202611140001–005 applied; 006 отсутствует |
| `hls_field_preflight(uuid)` | Отсутствует, конфликтующего overload с этим именем не найдено |
| `hls_field(uuid)` | Есть, STABLE SECURITY INVOKER; execute authenticated/service_role, anon запрещён |
| `enqueue_hls(uuid,text,integer)` | Есть; execute только service_role из проверенных клиентских ролей |
| `take_hls_job()` | Есть; execute только service_role из проверенных клиентских ролей |
| `save_hls_job(uuid,jsonb,boolean,text)` | Есть; execute только service_role из проверенных клиентских ролей |
| HLS queue | 10 running с started_at=-infinity (queued), 1 failed, 0 stale active leases |
| Ревизии queue | 6 из 10 queued соответствуют нынешним границам; failed соответствует текущей |
| Площадь queue | У текущих геометрий связанных полей нет превышения 22 500 га; это НЕ проверка окна 250 000 пикселей |
| HLS cache | 3 записи, всего 74 observations; одна запись соответствует текущей границе |
| Dataset | queue/cache используют `hls-v2-ndvi-v1` |

Определения четырёх HLS RPC и validate_field, columns, constraints, indexes,
policies, relation flags/options и field triggers сравнены с результатом
применения локальных миграций в чистой тестовой БД: совпали. Это предметное
сравнение HLS-зависимостей, а не утверждение об идентичности всей базы.

`fields`: Polygon SRID 4326, area numeric, FK farm, GiST boundary,
validate_field trigger. `earth_observation_jobs`: field FK, provider/dataset,
geometry_reference, requested_period, status running/succeeded/failed,
timestamps/error, уникальность field/provider/dataset/revision/year.
`field_analytics`: та же область уникальности с analysis_period, JSON metrics,
source_metadata/calculated_at. Предусмотренные unique constraints подходят
ON CONFLICT существующих RPC. Миграция 006 эти таблицы не меняет.

RLS включена на farms/fields/jobs/analytics; field_geojson security_invoker=true.
Policies следуют field → farm → auth.uid(). Эффективные privileges проверены
отдельно через has_table_privilege, поскольку information_schema.role_table_grants
под ролью удалённого аудита не вернула список grants:

- authenticated: fields CRUD (ограничено RLS); jobs/analytics SELECT, без DML;
- anon: jobs/analytics без прав; fields имеет базовые CRUD grants, но RLS
  policy только для authenticated — grants сами по себе доступа к строкам не дают;
- service_role: CRUD всех трёх таблиц, привилегированный серверный доступ.

Более широкие anon table grants — существующее состояние, не добавляемое 006.
Менять его в этом rollout не требуется; не путать проверку grants с hosted
двухпользовательским E2E. Полноценный Auth/PostgREST smoke ещё нужен.

## 2. Что делает миграция 006

Файл `supabase/migrations/202611140006_hls_preflight.sql`:

1. Создаёт одну SQL-функцию `public.hls_field_preflight(p_field uuid)`:
   `TABLE(revision text, reason text, estimated_pixels bigint)`.
2. STABLE, SECURITY INVOKER, search_path public,extensions. Читает public.fields
   с RLS вызывающего пользователя; чужое/несуществующее поле → ноль строк.
3. Возвращает тот же SHA-256 EWKB, что существующие HLS RPC: старые cache keys
   совместимы, никакой массовой инвалидации или пересчёта не требуется.
4. Предварительно отсеивает area >225000000 м², неподдерживаемые широты/охват,
   затем оценивает bbox в соседних UTM с segmentize и запасом двух пикселей
   по измерениям. Лимит — 250 000 ячеек на сетке 30 м.
5. Отзывает execute у PUBLIC/anon, выдаёт authenticated. Это новые права новой
   функции; права существующих RPC и RLS не меняются.

Нет ALTER TABLE, INSERT, UPDATE, DELETE, DROP, изменения policies, запуска jobs
или удаления исторических observations. Function creation не сканирует и не
пересчитывает все поля. При вызове возможны затраты PostGIS на сложной границе.

Зависимости непосредственно: fields/PostGIS и ownership RLS из 001, PostgreSQL
sha256/encode. 002/004 не нужны для самой формулы, но остаются частью общей
истории. Для полного Edge workflow нужны jobs/analytics из 003 и enqueue из 005.
Новые provider credentials не нужны. Migration runner должен иметь CREATE
в public, доступ к extensions/fields и право назначить ACL новой функции.

**Повторное применение не идемпотентно:** CREATE FUNCTION второй раз возвращает
ошибку duplicate function. Проверено локально. Это ожидаемая защита от молчаливой
перезаписи неизвестной функции; менять на CREATE OR REPLACE без schema review
не нужно. Обычный migration runner пропускает уже записанную версию.
Если функция есть, но history нет, остановиться, сравнить определение/ACL и
подготовить отдельное решение reconciliation — не repair вслепую.

Оценка окна консервативна, не точное вычисление HLS raster window. Границы
тайлов, origin/grid и проекция конкретной сцены учитываются окончательно только
worker. Его ограничение 250 000 сохраняется. Новый preflight не запрещает
сохранять большие поля и использовать другие источники.

## 3. Проверка Edge и найденные ограничения

`supabase/functions/hls-vegetation/index.ts`:

- verify_jwt=true в config, дополнительно auth.getUser(); reader с JWT пользователя.
- UUID/year validation, завершённые годы с 2013. RPC preflight вызывается reader,
  service-role client создаётся только после проверки доступности поля.
- reason → unsupported=true, pending=false и понятная причина; enqueue не вызывается.
  Cache при той же ревизии остаётся видимым, в том числе для unsupported поля.
- Ошибка preflight/SQL → 502 общего сервиса, а не ложное «слишком большое поле».
  Provider errors приходят через job.warning от worker, а не preflight.
- running → pending, queued определяется по -infinity; свежий succeeded → cache;
  failed имеет 30-minute cooldown; succeeded — 180-day TTL.
- enqueue unique scope не допускает новых дубликатов при polling/concurrency.
  Но число повторных попыток на протяжении жизни failed job НЕ ограничено:
  новый UI-запрос после cooldown может re-enqueue. В рамках текущего release
  нет обещания глобально bounded retries/dead-letter. Для этого нужен отдельный этап.
- Без worker running/queued может ждать неограниченно; 006/deploy это не исправляет.

Локально подготовлено небольшое security исправление: catch логирует только
статическую строку вместо полного SDK error, который может содержать request
details. Контракт ответа не меняется. Старые error_message читаются как раньше;
текущий worker сохраняет санитизированные сообщения. Содержимое всех исторических
ошибок не выводилось и не сертифицировано на отсутствие sensitive data.

**Старые задания:** take_hls_job не вызывает preflight. Поэтому 006 защищает
новую постановку через обновлённую Edge, но не отменяет старые queued jobs.
Из четырёх queued старых ревизий worker не возьмёт ни одного при несовпадении
границы. Остальные шесть ещё требуют проверки estimated window перед будущим
запуском worker. Нельзя считать их безопасными только по площади.
Не вызывать take_hls_job для «проверки»: это выдача lease и изменение записи.

Worker checkpoint/lease/hash проверки сохраняют partial observations и историю.
Failed job автоматически scheduler-ом не оживает: re-enqueue делает Edge.
Автоматический запуск и изменение worker не входят в PHASE 1.1.

## 4. Проверки, выполненные локально

- После GitHub pull: npm run typecheck — pass; npm test — 65/65, 12 файлов;
  npm run build — pass (существующее предупреждение chunks >500 kB).
- Миграции 001–006 применены в отдельной чистой БД template0 контейнера
  postgis/postgis:16-3.5, network none, без production secrets.
- Локальные PostgreSQL 16.9/PostGIS 3.5.2 отличаются от production 17.11/3.3.7.
  Тест не является точной копией hosted runtime; перед release желательно
  staging на совпадающих версиях. Подготовлены минимальные auth.users/auth.uid
  и роли для SQL-тестов, это не настоящий Supabase Auth server.
- hls_preflight.sql: малое/огромное/вытянутое поле и пересечение UTM — pass.
- ownership.sql и registration.sql — pass на синтетических fixtures.
- Новый hls_preflight_access.sql: owner доступ, чужое поле пусто, anon запрещён,
  revision совпадает с hls_field, privileged RPC недоступны authenticated — pass.
- Повторное применение 006: ожидаемый отказ duplicate function, без замены функции.
- Временный контейнер остановлен и удалён, production не затрагивался.

Первый запуск в стандартной БД образа выявил уже установленный PostGIS в public.
Использована новая БД template0 с extension в extensions; миграции проекта
не изменялись ради особенностей тестового образа.
Frontend tsc не является Deno runtime/SDK integration check. Hosted Edge smoke
не выполнен и не заменяется SQL-тестами. Изменение catch — только logging.

## 5. План безопасного развёртывания

### Gate A — backup и восстановление

До production изменений владелец подтверждает актуальную точку восстановления
и допустимое окно обслуживания. Проверить Backup/PITR availability в Dashboard,
timestamp, охват schema/data/roles и доступ оператора. Тариф и restore права
в этом аудите не проверялись. Не обещать доступный PITR без проверки.
Провести restore drill в отдельной разрешённой среде: восстановить backup,
проверить counts, FK, RPC/ACL/RLS и историю миграций. Зафиксировать длительность,
RPO/RTO и ответственного. Платное создание среды требует разрешения.

Согласно [Supabase backups](https://supabase.com/docs/guides/platform/backups),
backup базы не включает сами Storage objects, а restore может требовать простоя
и терять изменения после выбранной точки. SQL schema dump не заменяет backup
данных. Backup creation/restore не выполнялись в этом этапе.

### Gate B — зависимости и артефакты

Зафиксировать release commit/изменение logging, SHA-256 файла 006 и Edge bundle.
Получить и сохранить текущий deployed HLS bundle/config в защищённое место для
восстановления. GitHub HEAD не считать доказанно тем же deployed bundle.
Проверить отсутствие других pending migrations и preflight conflicts.
Повторить read-only snapshot прямо перед deploy — приведённые counts не SLA.

CLI в аудите 3.1.0; проверить свою версию/help перед использованием --remote.

```sh
supabase migration list --remote=mcxzkbgnfqjbrlglfzki
supabase functions list --remote=mcxzkbgnfqjbrlglfzki
supabase db query --remote=mcxzkbgnfqjbrlglfzki --read-only \
  --file supabase/audit/hls-production-readonly.sql
```

### Gate C — команды ПОСЛЕ отдельного подтверждения

```sh
supabase db push --dry-run --remote=mcxzkbgnfqjbrlglfzki
# Продолжать только если ожидается исключительно 202611140006.
supabase db push --remote=mcxzkbgnfqjbrlglfzki
supabase migration list --remote=mcxzkbgnfqjbrlglfzki
supabase db query --remote=mcxzkbgnfqjbrlglfzki --read-only \
  "select to_regprocedure('public.hls_field_preflight(uuid)');"
# После проверки definition/ACL/security invoker:
supabase functions deploy hls-vegetation --remote=mcxzkbgnfqjbrlglfzki
supabase functions list --remote=mcxzkbgnfqjbrlglfzki
```

db push меняет schema/history; deploy меняет обслуживаемый Edge код.
Не запускать foundation отдельно и не использовать reset/repair/--include-all.
При неожиданном pending списке или ошибке остановиться; не повторять blindly.
Порядок обязателен: SQL → verification RPC → Edge, не наоборот.

### Gate D — smoke, старые задания и мониторинг

1. С JWT test user проверить preflight малого собственного поля: reason=null,
   positive estimate≤250000, revision идентична hls_field. Чужое/несуществующее
   поле — ноль строк, anon — отказ. Токены не помещать в команды/отчёт.
2. Ошибочные UUID/year/нет авторизации в Edge — 400/401; чужое поле — 404.
3. Oversized поле: unsupported + причина, до/после jobs counts неизменны.
   Использовать уже разрешённое тестовое поле; создание fixtures в production
   требует отдельного разрешения, SQL unit fixtures там запрещены.
4. Собственное поддерживаемое поле: ответ cached/pending по реальному состоянию,
   повторные запросы не плодят unique scopes. Вызов Edge может enqueue job:
   разрешение только на deploy не является разрешением на этот smoke write.
5. Сравнить состояние всех старых scopes/observations без выгрузки координат.
   Не изменять статус, revision, started_at или ID вручную. Не удалять старые cache.
6. Применить новый preflight в read-only проверке текущих полей старых queued jobs
   через разрешённого владельца/оператора. Не давать новый service_role grant
   только ради удобства аудита; SECURITY INVOKER должен сохраниться.
7. Мониторить 502/missing RPC, unsupported reasons, queued age, active lease >15 min,
   failed cooldown и cache presence. Не логировать URL, bearer headers, SDK objects.
8. Worker и scheduler оставить выключенными в рамках этой фазы. Pixel/NDVI
   verification, обработка имеющихся jobs и новые paid resources — отдельное разрешение.

## 6. Восстановление при ошибке

- Если SQL не прошёл: не deploy Edge. Проверить history/function/ACL фактически.
  PostgreSQL поддерживает transactional DDL, но автоматический rollback всего
  CLI rollout не обещается; ни SQL, ни Edge deployment не составляют одну транзакцию.
- Если 006 есть, а Edge smoke не прошёл: вернуть сохранённый предыдущий HLS
  bundle/config отдельным deploy. Новую read-only функцию можно оставить;
  удалять таблицы/данные или migration history для отката приложения не нужно.
- Если функция создана частично/ACL неверны: блокировать release; подготовить
  точечный проверенный repair по фактическому состоянию с отдельным approval.
- Не применять DROP FUNCTION CASCADE. SQL down migration здесь не предлагается:
  работающий новый код может зависеть от RPC, а ручное удаление рассогласует history.
- Full database restore — крайняя отдельно согласуемая операция с потерей новых
  записей/простоем; не обычный rollback этой additive миграции.

## 7. Критерии успеха и разрешения

Release-ready после: подтверждённого backup/restore drill; 006 в history;
правильных definition/ACL; authenticated ownership smoke; updated HLS Edge;
unsupported без enqueue; прежних cache/истории без потери; отсутствия duplicate
scopes и регрессий 401/403/502. Это готовность reconciliation, не automatic NDVI E2E.

Требуют подтверждения: backup export/restore на выбранную среду, применение 006,
deploy HLS, любой smoke с enqueue/созданием поля, запуск worker, обработка старых
jobs, scheduler и платные ресурсы. В текущем этапе ни одно не выполнено.

Локальные изменения этого этапа: данный отчёт, тест hls_preflight_access.sql,
санитизация catch в hls-vegetation/index.ts. Read-only audit SQL подготовлен
ранее в этом же диалоге и уже вошёл в полученное состояние репозитория.
Миграция 006 оставлена без изменений: проблемы её совместимости не выявлены.
