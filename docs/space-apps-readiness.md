# AGRONA: PHASE 0 — аудит готовности

Дата: 2026-11-15, Asia/Almaty. Проект: Field Shift: Adapting Farms with NASA Data.
Проверен рабочий каталог AGRONA на базе commit `327e84a`, включая существующие
незакоммиченные SRTM, аналитические заключения и ребрендинг. Это не описание
только GitHub HEAD и не утверждение о составе опубликованного frontend.

## 1. Executive summary

AGRONA — работающий локальный каркас decision-support, но готовность полного
производственного демонстрационного сценария пока не подтверждена.
Карты, сохранение поля, история, сезонный POWER и детерминированный поиск
севооборотов уже реализованы. Переписывать архитектуру не требуется.

Наиболее важны не новые спутниковые источники, а завершение существующего пути:
реальное поле → актуальные наблюдения → объяснение → расчёт → сохранённый план.
Подтверждены следующие пробелы:

- Production применил миграции 001–005, но не 006; RPC `hls_field_preflight` отсутствует.
- `hls-vegetation` развёрнута, но совпадение её исходного кода с локальной версией
  не проверено. Локальная версия зависит от отсутствующего RPC.
- В очереди HLS 10 записей `running` с `started_at = -infinity` и одна `failed`.
  Первые десять — ожидающие запуска, а не доказательство выполняющегося анализа.
- Есть три кэша HLS с непустыми наблюдениями. Их пиксели в этом аудите не
  пересчитаны: это свидетельство предыдущей обработки, не полная валидация.
- `srtm-terrain` не развёрнута, `OPENTOPOGRAPHY_API_KEY` отсутствует.
  Нужные таблица и `terrain_metrics` уже существуют.
- Севооборот использует POWER только из кэша. Если пользователь не загрузил
  аналитику, новая стратегия может формироваться без климатических штрафов.
- Сохранённые сценарии не содержат полного воспроизводимого снимка входов:
  ревизии границы, версии модели/каталога, идентификатора климатического расчёта.
- GPM, SMAP, ECOSTRESS, DeepSeek и климатический what-if не реализованы.

Проверки: TypeScript, 55 Vitest-тестов, production build, 10 Python-тестов HLS
пройдены. Свежий прямой запрос NASA POWER вернул 365 дней за 2025 год и семь
параметров. Он не проверяет авторизованную Edge Function и сохранение в Supabase.
Production не изменён; реальные HLS/SRTM задания не запускались.

## 2. Доказательства и границы аудита

Статусы обозначают разные виды доказательств, а не взаимозаменяемые уровни:

| Статус | Что означает |
| --- | --- |
| NOT IMPLEMENTED | Исполняемый путь в репозитории не найден |
| IMPLEMENTED LOCALLY | Прослежен локальный путь данных и вызовов |
| TESTED WITH MOCKS | Проверены синтетические входы/заменённые зависимости |
| TESTED WITH REAL DATA | Проверен конкретный реальный источник/набор, с указанием границ проверки |
| DEPLOYED | Наличие функции/объекта подтверждено удалённо, не гарантирует работоспособность |
| VERIFIED END-TO-END | Воспроизведён весь пользовательский путь на целевой среде; в этом аудите не присвоен ни одной полной интеграции |

Изучены маршруты, компоненты, domain types, data access, климатический,
агрономический и insight-модули, четыре Edge Functions и общие адаптеры,
шесть миграций, SQL assertions, Python worker/Docker, тесты и документация.
Удалённо выполнены только чтение истории миграций, списка функций, имён
секретов, системного каталога и обезличенных счётчиков кэшей/очереди.
Не извлекались значения секретов, пользовательские имена, email или границы.

Ограничения: не проведён новый браузерный E2E; не проверены hosted Auth redirect
allow-list/SMTP, полный diff удалённых SQL-функций, deployed source bundles,
облачный аккаунт/биллинг, логи и содержимое всей истории Git. Предыдущие сообщения
пользователя о браузерных проверках этапов 1–2 учитываются как история, не как
новая проверка этого аудита. SQL-тесты не выполнялись в production и не
запускались локально: подготовленной disposable Supabase среды нет.

## 3. Requirements coverage matrix

Официальный источник: [Field Shift 2026](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).
Поиск вернул официальный summary о NASA observations, локальной почве,
характеристиках культур, приоритетах и устойчивом севообороте. Прямое открытие
полной страницы вернуло HTTP 502. Поэтому строки O ниже отражают подтверждённую
основную формулировку, строки M — требования MASTER PROMPT пользователя.
Все источники NASA из расширенного задания не объявляются обязательными
условиями конкурса без проверки полного официального текста. Перед submission
нужно повторно сверить Details/Resources и правила подачи.

| Requirement | Existing implementation | Gap | Planned implementation | Verification method |
| --- | --- | --- | --- | --- |
| O1 NASA Earth observations | POWER, HLS, локальный SRTM | Не все пути подтверждены E2E | Завершить Phase 1 | Реальный участок, provenance, повторный запрос |
| O2 Локальная почва | `soil_type`, combobox, произвольный вариант | Нет анализов, глубины, текстуры отдельно от классификации | Типизированный профиль без подмены сведений | Тест происхождения и приоритета измерений |
| O3 Характеристики культур | 5 культур, семейство, дни, вода, азотфиксация, засухоустойчивость | Мало параметров и источников на уровне свойства | Регионально документированный каталог | Проверка агрономом и unit tests |
| O4 Приоритеты фермера | Веса почвы/воды/климата | Экономика не оценивается; дискретные веса | Чувствительность и явные trade-offs | Повторяемые сценарии со сменой весов |
| O5 Выбор устойчивого севооборота | Beam search, история, альтернативы, объяснения | Нет научной калибровки, ограниченные hard rules | Расширять по проверенным правилам | Эталонные кейсы, sensitivity, экспертная оценка |
| M1 Реальное поле и редактирование | INSERT/UPDATE, Terra Draw, таблица, GeoJSON | Новый hosted E2E не выполнен | Регрессия без архитектурной замены | ID/история/новая ревизия после edit |
| M2 Минимум три стратегии при возможности | Базовая + water + soil/climate, исключение дубликатов | Приближённый поиск, маленький каталог | Проверять содержательное отличие; не выдумывать варианты | Кейс 0/1/2/3 вариантов и равных весов |
| M3 Текущий план | Выбор сохранённой последовательности | Новый фермер не вводит произвольный будущий план; старые годы сдвигаются к новому planYear | Явный editor плана и даты начала | Восстановление исходных лет без сдвига |
| M4 История и предшественники | Все известные годы участвуют в штрафах | Только одна культура на поле/год; интервалы возврата мягкие | Источники правил и интервалы по культуре | Полная/пропущенная/неизвестная история |
| M5 Климат выбранного сезона | POWER daily, климатическая вкладка и rotation period | Вода/Риски годовые; сезон не пересекает 31 декабря | Единый явный period contract | Показатели вне сезона не меняют сезонный вывод |
| M6 Нормы и аномалии | Сравнение минимум трёх полных прошлых сохранённых лет | Это не стандартная климатическая норма; нет backfill | Фиксированный достаточный baseline | Контроль полноты, лет, геометрии, версий |
| M7 HLS automatic | Queue RPC, worker, checkpoint, retries | Не подтверждён scheduler; 006 отсутствует | Контролируемый периодический запуск | Create → queue → pixels → cache → reload |
| M8 SRTM | Raster API, slope, cache, UI, tests | Нет deployment/key/live raster | Разрешённое развёртывание и smoke test | Реальное окно, NoData, slope, cache/revision |
| M9 GPM/SMAP/ECOSTRESS | NOT IMPLEMENTED | Нет адаптеров/хранилища/QA этих продуктов | Отдельные Phase 2/3/4 | Продуктовые fixtures + реальные данные |
| M10 Data fusion | Source-specific metadata и scopes | Нет общего ObservationRecord и temporal support | Адаптеры общего контракта без усреднения источников | Unit/date/quality/scale/revision tests |
| M11 Заключения | Детерминированный `field-insights.ts`, terrain UI | Нет единого охвата всех вкладок; terrain conclusion встроен в JSX | Общая структура и period gating | Пропуски → предупреждение, не категоричный вывод |
| M12 What-if | Приоритеты/исключения/горизонт | Нет температурных, осадочных, водных сценариев | Отдельный SCENARIO слой | Нулевой сценарий равен baseline, входы immutable |
| M13 DeepSeek | NOT IMPLEMENTED | Нет server endpoint/валидации | Phase 8 с fallback | Чужое поле, timeout, invented-number rejection |
| M14 Безопасность | Auth, RLS, privileged writes после ownership | Нет нового двухпользовательского E2E, глобальных бюджетов | Проверить hosted policies, квоты, sanitization | 401/403, tenant isolation, redacted errors |
| M15 Сохранение плана | `rotation_scenarios`, UI reload | Не хватает provenance/revision | Версионированный snapshot, old-result label | Edit boundary/history → stale label |
| M16 Карта и raster layers | Bounds focus, Polygon, Copernicus preview | HLS/SRTM overlay отсутствует | Только реальные raster endpoints позднее | Legend/time/resolution, без фиктивных тайлов |
| M17 UX и локализация | Русский UI, статусы, частичный `i18n.ts` | Много literal strings, accessibility audit не выполнен | Постепенная локализация, keyboard/mobile QA | Browser viewport и screen-reader smoke |
| M18 Воспроизводимое демо | Snapshot POWER, demo поля, тесты | Нет нового полного production demo evidence | Runbook и запись источников | Все шаги на одном малом поле |

## 4. Архитектура и текущее состояние

### Frontend и поля

- `src/main.tsx`: QueryClient → BrowserRouter → AuthProvider → App.
- `src/App.tsx`: `/`, `/auth`; protected `/map`, `/farms`,
  `/analytics/:fieldId`, `/rotation/:fieldId`, `/settings`; lazy screens.
- `src/lib/auth.tsx`, `workspace-access.ts`: восстановление через Auth events,
  приоритет реальной сессии над demo. Demo хранится отдельно в sessionStorage;
  данные demo — localStorage. Logout очищает React Query. Guards сохранены.
- `src/lib/data.ts`: один запрос ресурсов farms/fields/seasons/crops/scenarios;
  кэш включает владельца; нет серверной пагинации. Рост числа полей увеличит
  время и память. Zustand хранит только выбор хозяйства.
- `field-write.ts`: существующее поле → UPDATE по ID + `.single()`, новое →
  INSERT. Boundary-only payload сохраняет метаданные/сезоны. `Map.tsx`
  отличает создание от edit при Terra Draw finish и выбирает нужный feature.
- `field-boundary.ts`: диапазоны координат, уникальность, замыкание,
  самопересечения, площадь; Polygon без дыр, не MultiPolygon. WKT writer
  использует внешнее кольцо, поэтому расширять поддержку дыр без writer нельзя.
- `FieldForm`, `CoordinateTable`, `FieldBoundaryEditor`, `FieldBoundaryMap`:
  координаты, порядок, preview, импорт одного GeoJSON, raw GeoJSON дополнительно.

Статус: IMPLEMENTED LOCALLY + TESTED WITH MOCKS. Реальные сценарии текущей
версии повторно не проверены браузером; ранее пользователь подтвердил этапы 1–2.

### Supabase и геометрия

`001`: PostGIS, profiles/farms/fields/crops/seasons/scenarios, старые climate и
analysis tables, validation triggers, RLS, security-invoker GeoJSON view.
`002`: профиль/местоположение и подтверждение email, идемпотентный onboarding.
`003`: earth_observations, field_analytics, queue и POWER RPC.
`004`: Sentinel RPC. `005`: HLS queue/lease/save. `006`: HLS preflight.
Все зависимые данные связаны с полем, ownership через хозяйство. Analytics
клиенту доступны на чтение; запись — server service role.

Ревизия — вычисляемый fingerprint, не одна общая колонка `geometry_revision`:
POWER — SHA-256 GeoJSON объекта; HLS — SHA-256 EWKB PostGIS; SRTM — SHA-256
coordinates. Внутри источников ключи согласованы, но эти строки нельзя напрямую
сравнивать между источниками. Нужен общий идентификатор границы или явное
отображение ревизий. Старые расчёты сохраняются при edit; удаление поля имеет
cascade — это отдельное осознанное пользовательское действие.

`src/lib/database.types.ts` отстаёт: нет earth tables/RPC, `Functions` пуст.
`supabase.ts` использует нетипизированный createClient. Успешный typecheck не
проверяет SQL-контракты и исходники Deno entrypoints, не импортируемые тестами.

### Агродвижок: фактическое поведение

`Rotation.tsx` вызывает `generateRotations` по кнопке. Готовых подменных карточек
для реального пользователя не найдено. Поле/история/каталог берутся из useData,
приоритеты и ограничения — из формы; POWER — `cacheOnly: true` с проверкой
геометрии и фильтрацией дат. Ключ React Query содержит owner/field/boundary/year.

Hard: разрешённая культура, исключения, длина сезона; горизонт 2–20 лет.
Soft: история повторений, семейства, бобовые, вода, холод/жара/сухие отрезки.
Beam width 24: ограниченный приближённый поиск вместо полного перебора.
Сравнение использует единые веса 1/2, поиск тематической альтернативы добавляет
3 к целевому весу. Исходный план берётся из выбранного сохранённого сценария;
иначе явно обозначенный baseline повторяет последнюю культуру либо берёт
лучший найденный вариант. Последовательности дедуплицируются.

Реально влияют: crop family, duration, water min, nitrogen fixation,
drought tolerance; доступная история; песчаная/супесчаная почва при сухом
отрезке; выбранные даты и сохранённые POWER Tmean/Tmin/Tmax/rain; веса.
Орошение меняет объяснение доступности, а не гарантирует воду. Площадь,
радиация, влажность воздуха, ветер, фактический объём полива, урожайность,
HLS и SRTM в score не входят. Экономический приоритет сообщает о нехватке
цен/затрат, но не имеет веса. Нельзя продавать это как оптимизацию прибыли.

Не реализованы отдельные расчёты органического вещества, покровных культур,
периодов открытой почвы, эрозионного риска по совместным данным, требований
к технике, рынку и кормовым культурам. Это пробелы расширенного агрономического
задания, а не скрытые возможности текущего score. Планируются в A8/A9 после
получения локальных данных и документированных правил.

`resultKey` в Rotation включает owner/field/geometry, но не ревизию истории,
почвы и источников. Автоматическое получение обновлённых farm data само по
себе не пересчитывает уже показанный результат. A6 должен закрыть и этот
клиентский случай, сохранив явную кнопку генерации.

Пять культур в production подтверждены read-only. Одинаковые альтернативы
при изменении весов возможны из-за малого допустимого набора и устойчивого
ранжирования; искусственные различия не нужны. Правила повторов — мягкие,
не универсальные фитосанитарные запреты. При менее трёх результатах текст
приписывает нехватку ограничениям, хотя beam search не является доказательством
отсутствия иных допустимых планов. Диагностическое `pool.length ** horizon`
считает пространство комбинаций по текущим hard rules, не объём исследованного
beam и не число агрономически подтверждённых стратегий.

### Заключения, периоды, научные ограничения

`field-insights.ts`: observation/meaning/action/source/period/limits/confidence,
без AI. Климатические пропуски учитываются; HLS требует ≥3 дат одного продукта,
≥14 дней между крайними датами, ≥10 field pixels, ≥80% valid pixels и полный
охват тайлом. Это явно продуктовые эвристики, не оценка статистической
достоверности. Одинаковое число пикселей ещё не гарантирует одинаковую маску.

SRTM заключение пока формируется в `TerrainAnalytics.tsx`, а не общем движке.
Вкладка Климат — выбранные даты, GDD5 и пояснения. Вода/Риски — годовой `metrics`.
HLS график/сводка — год, HLS заключение — `insightPeriod`. Различие периодов
нужно явно показывать или унифицировать. Порог заморозка тоже различается:
годовой показатель `<0`, rotation/insights `<=0`; нужны единое определение
или явное объяснение разных показателей.

Средний HLS NDVI взвешен по valid pixels разных снимков, не по длительности
интервалов. Это сводка доступных наблюдений, не полноценное среднегодовое
состояние. Сопоставление прошлых POWER лет требует ≥3 полных сохранённых лет
из последних десяти сохранённых; фиксированной климатической нормы нет.

## 5. NASA dataset inventory

| Источник / продукт | Реальный путь и масштаб | Реализация / доказательства | Влияние на рекомендации |
| --- | --- | --- | --- |
| NASA POWER, internal `daily-ag-v2` | Daily point API у центра поля; T2M/Tmin/Tmax, PRECTOTCORR, RH2M, WS2M, radiation; weather 0.5°×0.625°, solar 1° | IMPLEMENTED LOCALLY, TESTED WITH MOCKS, TESTED WITH REAL DATA (прямой запрос), DEPLOYED; 9 production caches/9 succeeded jobs | Температура/осадки/продолжительность/жара/заморозки/сухие отрезки при наличии кэша |
| HLSL30 / HLSS30 v2.0 | CMR → LP DAAC COG range reads → native UTM 30 м; red B04, NIR B05/B8A, scale 0.0001 | IMPLEMENTED LOCALLY, TESTED WITH MOCKS, Edge DEPLOYED; 3 непустых caches, без нового pixel/E2E подтверждения | NDVI dashboard/insights, не rotation score |
| NASA/JPL SRTMGL1.003 | OpenTopography Global DEM AAIGrid; 1″; февраль 2000; EGM96 | IMPLEMENTED LOCALLY + TESTED WITH MOCKS; не DEPLOYED | Terrain dashboard/заключение, не score |
| Sentinel-2 L2A, Copernicus | Statistical/Process APIs; NDVI 10 м, SCL quality native 20 м | IMPLEMENTED LOCALLY + TESTED WITH MOCKS; Edge DEPLOYED, CDSE secrets отсутствуют | Резервный selectable источник, не работающий fallback без ключей |
| GPM IMERG | План: Final V07, региональная сетка 0.1°, корректная суточная агрегация | NOT IMPLEMENTED | Пока нет |
| SMAP SPL3SMP_E V006, кандидат | Суточная EASE-grid 9 км; региональная поверхностная влага | NOT IMPLEMENTED; точную физическую поддержку/QA проверить по guide | Пока нет |
| ECOSTRESS ECO_L2T_LSTE, кандидат | Tiled LST 70 м, нерегулярные сцены и время суток | NOT IMPLEMENTED; V003 заявлена NASA, выбор версии/архива требует Phase 4 spike | Пока нет |
| SoilGrids / SRTM-derived hydrology / MODIS / GRACE / GEDI | Дополнительные возможные источники | NOT IMPLEMENTED | Подключать только под конкретное решение |

Список NASA источников и внешних ссылок: [nasa-data-sources.md](nasa-data-sources.md).
NASA POWER — gridded analysis/derived products, не метеостанция на поле.
PRECTOTCORR не следует переименовывать в IMERG: это другой параметр/источник.
Названия внутренних dataset keys не заменяют upstream product version.

## 6. Production snapshot и безопасность

Подтверждено 2026-11-15 для проекта `mcxzkbgnfqjbrlglfzki`:

| Объект | Результат |
| --- | --- |
| Миграции | 001–005 присутствуют в истории; 006 отсутствует |
| HLS preflight RPC | Отсутствует |
| `field_analytics.terrain_metrics` | Присутствует |
| Функции | nasa-power, sentinel-vegetation, hls-vegetation ACTIVE v1; SRTM отсутствует |
| Секреты OpenTopography / CDSE | Имена OPENTOPOGRAPHY_API_KEY, CDSE_CLIENT_ID, CDSE_CLIENT_SECRET отсутствуют; значения не запрашивались |
| HLS | 3 кэша с наблюдениями; 10 queued, 1 failed; новый worker не запускался |
| POWER | 9 кэшей, 9 succeeded jobs |
| Каталог | 5 культур |
| RLS | Включена на profiles, farms, fields, field_seasons, rotation_scenarios, earth_observation_jobs, field_analytics |

Наличие migration history не доказывает эквивалентность всех live functions,
grants, policies и triggers локальным SQL. Нужен schema diff перед deployment.
Включённая RLS не равна доказанной изоляции двух пользователей.

Положительно: getUser и чтение через пользовательскую RLS до service-role writes;
worker RPC ограничены service_role; `.env` игнорируются; из env-файлов Git
отслеживает `.env.example`. Поиск имён серверных ключей в `src` и `dist`
не нашёл совпадений. Значения секретов в этом аудите не выводились.
Это не сертификация отсутствия утечек во всей истории Git или внешних логах.

Риски: service role у worker имеет широкий доступ; нет общего лимита расхода
по пользователю; generic error logging в HLS/POWER Edge и data.ts требует
санитизации по allowlist; arbitrary server exception не должен уходить в UI.
Для OpenTopography секрет передаётся в query string только server-side,
ошибки санитизированы; нельзя включать URL tracing в прокси/логгере.
Бесплатный персональный OT key нельзя автоматически считать допустимым
общим ключом приложения: проверить условия поставщика.

## 7. Critical gaps: приоритеты и конкретные задачи

S ≈ 0.5–1 инженерный день, M ≈ 2–4, L ≈ 5–10. Это предварительная оценка
работы, не срок получения доступа/разрешения или научной валидации.

| ID / приоритет | Проблема и влияние на фермера / challenge | Файлы и минимальное решение | Критерий готовности и тесты | Риски / зависимости / сложность |
| --- | --- | --- | --- | --- |
| A1 P0 | 006 отсутствует: локальная HLS функция несовместима с production, большие поля могут ждать | `supabase/migrations/202611140006_hls_preflight.sql`, `functions/hls-vegetation/index.ts`; read-only schema diff, local SQL tests, затем согласованный deploy пары | RPC owner/foreign, малый/большой/вытянутый Polygon, правильный UI, без нового job для unsupported | Production approval, PostGIS; S–M |
| A2 P0 | HLS очередь не обслуживается автоматически: farmer не получает EO evidence | `workers/hls/worker.py`, Dockerfile, новая scheduler конфигурация, HLS UI; `--once` + bounded scheduler | Новое тестовое поле → unattended pixels → partial/final → reload; crash/lease/retry test | Billing/IAM approval, Earthdata, quotas; M |
| A3 P0 | SRTM локальный, не реальный demo path | `functions/srtm-terrain`, `_shared/srtm*`, `TerrainAnalytics`, `docs/srtm-terrain.md`; ключ/право доступа, deploy, smoke | Реальный малый участок KZ, min≤mean≤max, slope≥0, coverage, cache и boundary change | Разрешение OT и production; S–M, без новой миграции |
| A4 P0 | Rotation без заранее загруженного POWER: важный NASA input отсутствует | `Rotation.tsx`, `nasa-power/index.ts`, `rotation-climate.ts`; явный статус отсутствия + действие загрузки/ожидания | Cold cache/failed/partial/changed geometry E2E; не включать старую границу | Квоты и async UX; M |
| A5 P0 | Нет нового полного acceptance evidence и двухпользовательского smoke | `tests`, `supabase/tests`, будущие E2E; staging/test accounts | Создать/edit → данные → вывод → план → reload, чужое поле недоступно | Test environment, разрешение записей; M |
| A6 P1 | Сохранённый результат теряет связь с ревизией/входами; фермер может считать старый score актуальным | `rotation.ts`, `Rotation.tsx`, `types.ts`; добавить snapshot в существующие JSON, stale label; без удаления старых планов | Изменить geometry/history/soil/period → старые scores помечены; восстановить исходную версию | Старые записи без snapshot должны честно оставаться unknown; M |
| A7 P1 | Разные периоды Water/Risks/NDVI/Climate создают несопоставимые выводы | `Analytics.tsx`, HlsVegetationAnalytics, insights/climate; один явный scope + годовые разделы подписать | Сезон с исключённой зимней датой, годовой режим, нулевой порог Tmin | Backward UI compatibility; M |
| A8 P1 | Каталог и hard rules слабы; одинаковое ранжирование не всегда чувствительно | `rotation.ts`, `types.ts`, `docs/rotation-model.md`; provenance свойств, локальные параметры, проверенные интервалы | Экспертные эталоны, веса, ties, beam-limit disclosure, performance | Агроном, источники; L |
| A9 P1 | Нет future plan editor и what-if; ограничено исследование компромиссов | `Rotation.tsx`, новый scenario module; immutable baseline и явные дельты | Нулевой сценарий, изменение ранга по расчёту, ограничения воды, restore | A6/A8, не прогноз; L |
| A10 P1 | Нет общего source/scale/unit/time contract | `types.ts`, shared adapters, insights; ObservationRecord adapters | Разные CRS/units/time/NoData/geometry не смешиваются | Не менять существующие hashes молча; M |
| A11 P1 | Нет GPM/SMAP/ECOSTRESS | Новые adapters/UI/tests, см. roadmap | Реальный продукт, flags, период, cache; не catalog-only | Auth/versions/API quotas, A10; каждый M–L |
| A12 P1 | Нет runtime contract и deployment checks | `database.types.ts`, `supabase.ts`, tsconfig, CI/runbook | Generated types + Deno checks + disposable SQL tests + live source version evidence | Различия CLI/production; M |
| A13 P1 | Нет global budgets, retries jobs зависят от открытия UI | queue migrations, HLS worker/Edge; failed retry policy/dead-letter, max attempts, cost cap | 429/401/403, cancelled revision, starvation, partial checkpoint; без бесконечных циклов | Подготовить новую migration только после проектирования; M |
| A14 P2 | Нет объясняющего AI | Новый DeepSeek Edge + UI, только проверенные structured facts | Ownership, rate limit, timeout, numbers validation, deterministic fallback | Server secret/budget approval; L |
| A15 P2 | Карты, словарь, мобильность, англ. версия, большие chunks | Shell/Analytics/map/i18n/styles; постепенные улучшения | Keyboard/mobile, legend/date, реальные rasters | Не подменять aggregate картинкой; M–L |
| A16 P1 | Документация конфликтует с кодом | README: «both SQL», «NDVI unavailable», старый db push; runbook | Один актуальный deployment checklist и pinned versions | Не применять foundation повторно; S |

P0 здесь блокирует заявленное полное демонстрационное прохождение. Если SRTM
официально исключить из демонстрации и показать unavailable, A3 можно временно
понизить; отсутствие каждого дополнительного NASA источника само по себе не
считается доказанным нарушением официального brief.

## 8. HLS эксплуатация: минимальная автоматизация

Worker действительно читает пиксели, а не только CMR metadata. Маски исключают
cloud/adjacency/shadow/snow/water/high aerosol/fill; water считается отдельно.
Ограничение окна 250 000 пикселей, время process 12 минут, остановка после
8 ошибок, checkpoint каждые 8 успешных наблюдений, до 3 попыток asset HTTP.
`take_hls_job` использует SKIP LOCKED и 15-minute stale lease, новый job ID
защищает от записи старым lease; `save_hls_job` проверяет текущую границу.
Partial-tile наблюдения хранятся отдельно, сшивки в полное поле нет.

`--once` берёт максимум одно задание и завершает процесс. Без флага worker
постоянно опрашивает БД. Ни Cloud Run, ни scheduler/IaC в репозитории не найдены.
Фактическое наличие внешнего scheduler вне репозитория не проверено.
Failed jobs сами `take_hls_job` не подбираются: re-enqueue инициирует Edge
после cooldown при новом запросе UI. Cloud Scheduler сам это не исправит.
`process()` поглощает ряд ошибок с сохранением failed; zero process exit
не доказывает успешного задания. Нужны мониторинг queue status и явная retry policy.

Предпочтение: Cloud Run Job с `python worker.py --once`, одна task,
Cloud Scheduler, отдельный service account, Secret Manager. Начальный интервал
15 минут — проектное предложение, не готовое SLA; 96 запусков/сутки дают максимум
96 обработок одного job до учёта повторов, а не 96 завершённых годовых анализов.
Настроить внешний deadline, не превышающий безопасный lease budget, и учесть
последовательные HTTP операции: локальный deadline — не жёсткое убийство процесса.
IAM scheduler — только запуск job, runtime — доступ только к нужным secrets.
Earthdata и Supabase service role никогда не входят в image, Git или браузер.

Альтернативы: cron на уже доверенном сервере дешевле внедрением при наличии
сервера; локальный Docker годится для проверяемого demo, но зависит от ноутбука;
scheduled CI — возможен, но задержки, runner secrets и стоимость требуют оценки.
Растровую обработку не переносить в браузер/короткую Edge Function.
Периодический запуск без постоянного сервера архитектурно возможен.
Не обещать нулевую стоимость: job compute, Scheduler, registry, Secret Manager,
logs и egress оцениваются по региону и времени реального малого задания.
Cloud account, billing и IAM не инспектировались; ресурсов не создано.

## 9. Implementation roadmap и первая задача

Сохраняется последовательность MASTER PROMPT. Каждый этап требует отдельного
подтверждения; готовность этапа включает соответствующие реальные проверки.

1. **Phase 1:** A1 → A3 → A2/A4 → A5; A6/A7 при подтверждении как критичных
   дефектов данных. Малые независимые изменения; сначала локальная проверка,
   затем отдельное разрешение на production и расходы.
2. **Phase 2 GPM:** закрепить Final product/units/time; один доступный сезон,
   comparison POWER с маркировкой масштаба. Общий metadata contract спроектировать
   заранее; полноценный fusion оставить Phase 5.
3. **Phase 3 SMAP:** региональный surface moisture + QA; без root-zone claims.
4. **Phase 4 ECOSTRESS:** один проверенный LST product, QC, день/ночь, acquisition time.
5. **Phase 5:** source adapters в ObservationRecord, provenance, сравнимость.
6. **Phase 6:** регионально документированный crop catalog/rotation rules,
   reference cases, sensitivity; не «прогноз урожая».
7. **Phase 7:** сценарии Δtemperature/precipitation/water/constraints.
8. **Phase 8:** защищённое объяснение DeepSeek с fallback; не критическая зависимость demo.
9. **Phase 9:** UX, glossary, layers only for real rasters, accessibility.
10. **Phase 10:** hosted E2E, научные cross-checks, репетиция/фиксация версии demo.

**Первая рекомендуемая инженерная задача:** синхронизировать HLS preflight
с deployment: проверить live schema и локально протестировать 006, подготовить
точный diff и rollback приложения, затем с разрешения применить только 006
и развернуть согласованную HLS функцию. Не начинать с очередного NASA API.
Одновременно можно подготовить SRTM release без применения: его schema готова,
но нужен разрешённый ключ. Старый foundation SQL не выполнять повторно.

## 10. Exact verification checklist

- [x] `npm run typecheck`: pass.
- [x] `npm test`: 9 файлов, 55 tests passed.
- [x] `npm run build`: pass; предупреждение о chunks >500 kB, не ошибка.
- [x] `git diff --check`: pass; новые документы дополнительно проверены на whitespace.
- [x] Python syntax: AST parse worker.py/test_worker.py, pass.
- [x] HLS Python: 10 tests passed в существующем Docker image, исходники
  примонтированы read-only, `--network none`, без env-file/credentials.
  Системный Python 3.9 первоначально не имел requests; контейнер решил зависимость.
- [x] `node --experimental-strip-types scripts/check-power-live.mjs`:
  реальный публичный NASA запрос, 365 дней, 7 параметров, derived metrics.
- [x] Read-only production: migrations/functions/secret-name presence/RLS flags,
  aggregate queue/cache/catalog counts. Это не live pixel verification.
- [ ] Disposable Supabase: применить все миграции на чистой тестовой среде,
  выполнить ownership.sql, registration.sql, hls_preflight.sql с ON_ERROR_STOP.
- [ ] Deno check/serve всех Edge entrypoints отдельно от frontend tsc.
- [ ] Два test users: чужое поле/кэш/план/RPC inaccessible; email confirmation,
  refresh, logout/login, demo/session separation.
- [ ] Малое сохранённое поле KZ: draw/coordinates/import, UPDATE ID, история
  неизменна; invalid polygon не сохраняется; большая граница сохраняется,
  но не ставит unsupported HLS/SRTM расчёт.
- [ ] После отдельного deployment approval: HLS real granule B04 + B05/B8A
  + Fmask, независимо пересчитать masked NDVI; partial tile/cloud/0 valid cases.
- [ ] SRTM: реальный AAIGrid и metadata, min/mean/max, уклоны на метрической
  сетке, NoData coverage; repeat из кэша без provider call; boundary edit →
  новый scope, старый результат остаётся в истории.
- [ ] POWER: Edge запрос за выбранный год → cache/observations → reload,
  новый field boundary не возвращает старый source scope.
- [ ] Rotation: cold cache/partial/full history, все веса, 0/1/2/3 вариантов,
  сохранённый baseline, actual displayed sequences, stale plan после edit.
- [ ] Одинаковый выбранный period на метриках/выводах; раздельные source scales,
  отсутствие ложных soil/yield/profit claims.
- [ ] Автоматизация: очередь обрабатывается без ручного Docker, failed recovery,
  lease takeover, bounded costs и alert token expiry.
- [ ] Browser mobile/keyboard/real map/navigation и полный demo reload.
- [ ] Scientific validation: сравнить расчёты с независимым инструментом и
  agronomic reference cases. Unit tests недостаточно.

Команды и границы развёртывания: [deployment-runbook.md](deployment-runbook.md).

## 11. Изменения PHASE 0

Только новые документы: этот отчёт, nasa-data-sources.md, data-fusion.md,
scientific-limitations.md, deployment-runbook.md, demo-script.md.
Существующий `docs/rotation-model.md` изучен и сохранён без изменений.
Ранее изменённые исходники/документы/изображения оставлены как были.
Никаких миграций, deployment, job processing, новых API интеграций или
production writes в Phase 0 не выполнено. Phase 1 ожидает подтверждения.
