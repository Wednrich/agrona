# AGRONA

Russian-language agricultural decision support. React + TypeScript + Vite frontend; Supabase Auth/PostgreSQL/PostGIS backend. No privileged key is used in the browser.

## Текущий прогресс

- После сохранения контура и названия AGRONA сразу открывает карточку поля. Из неё можно записать прошлые посевы, сравнить свой план по годам или подобрать варианты без готового плана. Для истории достаточно года и культуры.
- Состав почвы загружается по контуру из SoilGrids. В карточке доступны глубины и покрытие, а фермер может добавить своё уточнение. Планировщик автоматически запрашивает историческую погоду NASA POWER и показывает полноту данных.
- Сравнение показывает замены по годам и до двух альтернатив к плану фермера. Выбранные культуры можно закрепить. Результат сохраняется и открывается повторно. На широком экране годы выровнены между карточками, на узком планы показаны последовательно.
- Для тестовых контуров в Казахстане и Небраске подготовлены реальные выборки. Среди них SoilGrids, NASA POWER и отдельные записи из IMERG Final, GLDAS и NLDAS. Источники, покрытие и ограничения описаны в [реестре данных](docs/data-preparation.md).

В локальном деморежиме проверен путь от создания поля до повторного открытия сравнения. Приложение запрашивает данные для открытого поля, в аналитике у каждого источника есть собственный результат и статус. Для опубликованной версии остаются развёртывание API поля и сквозная проверка под обычным аккаунтом. Сравнение носит справочный характер. Для рекомендации по посеву нужны проверенные местные сроки и сведения о сорте, а для расчёта полива нужны данные о почве и доступной воде.

## Architecture

- `src/components`: application shell and shadcn-style UI primitives.
- `src/pages`: lazy-loaded route screens.
- `src/features`: mapping, climate aggregation, deterministic rotation rules.
- `src/lib`: authentication, typed domain objects, data repository, localization and UI state.
- `supabase/migrations`: schema, RLS, server-side polygon validation, crop references.
- `supabase/functions/nasa-power`: authenticated server-side NASA adapter.
- `tests`: rule and data validation tests.

## Setup

Requires Node 22+, npm, a Supabase project and optional MapTiler account with a satellite plan appropriate for your usage.

```sh
npm install
cp .env.example .env
npm run dev
```

Populate `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the project URL and public anon/publishable key. Add `VITE_MAPTILER_KEY` to enable licensed satellite tiles; restrict this public key to your application origins. Without it the map uses an explicitly labeled fallback.

For local SoilGrids and NASA observations, install the full pipeline with `python -m pip install -r scripts/field_data/requirements.txt`. Vercel installs the smaller API dependency set. Direct SMAP, IMERG Final, GLDAS and NLDAS archive reads require the local pipeline. NASA POWER and HLS remain available through their usual paths. Local Vite and the Vercel configuration serve `/api/field-data` and the compatible `/api/soil` endpoint. On Vercel, use the repository root as the project root so the functions can import the shared loaders. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for `/api/field-data`. Set `EARTHDATA_TOKEN` in the function environment for archives that require it. In local development, the loader reads the token from `.env.earthdata`. The optional `VITE_SOIL_URL` setting uses the `/api/soil` request format. See [data preparation](docs/data-preparation.md).

Apply the SQL files in `supabase/migrations` in filename order through Supabase CLI (`supabase db push`) or SQL editor. Configure Auth Site URL and redirect allow-list for `/map` and `/auth` on your localhost and deployed origins. Enable email/password auth and configure SMTP for production confirmation/reset messages.

```sh
supabase functions deploy nasa-power
npm run db:types
npm run build
npm test
```

`db:types` requires a running local Supabase instance; for a hosted project use `supabase gen types typescript --project-id YOUR_PROJECT_ID`. Generated types should be regenerated after every schema change.

## Schema and isolation

Profiles reference auth users. Farms belong to profiles. Fields belong to farms. Seasons, climate observations, analyses and scenarios belong to fields. RLS follows this ownership chain for reads and writes. Crop reference data is public-read only. Deletions cascade through owned resources. Geometry is validated in a database trigger; geography area is recomputed server-side on every write. A security-invoker GeoJSON view preserves RLS. Signup creates the profile and initial farm in one transaction.

## Delivery sequence

1. Foundation: routing, visual system, auth and schema.
2. Maps: drawing, editing, ownership-scoped persistence and history.
3. Analytics: server-side NASA retrieval, cache, charts and transparent limitations.
4. Rotation: deterministic constrained strategies, comparison and saving.
5. Polish: landing, responsive UI, demo, tests and deployment documentation.

## Deployment

Vercel: Vite preset, `npm run build`, output `dist`. Netlify: same build/output with SPA rewrite in `public/_redirects`. Configure public Vite environment variables before building. Supabase is deployed separately. Never add the service-role key to Vite environment variables.

### ИИ-агроном

В аналитике нажмите «Объяснить мои данные» или откройте вкладку «ИИ-агроном». В севообороте объяснение доступно после сохранения варианта. Функция использует выбранный период наблюдений и проверяет принадлежность поля. DeepSeek выбирает факты и объяснения из подготовленного сервером контекста. Источники, цифры и обязательные оговорки формирует AGRONA. Чат хранит историю текущей беседы на странице.

1. Проверьте список миграций целевого проекта и примените `20261115060000_ai_advisor.sql` после зависимых миграций. В отдельной тестовой базе выполните `supabase/tests/ai_advisor.sql`. Проверьте Edge Function через `deno check supabase/functions/ai-advisor/index.ts`.
2. Разверните `ai-advisor` с проверкой JWT. На опубликованном сайте проверьте успешный ответ `/api/soil`. Если загрузчик SoilGrids размещён отдельно, укажите его доверенный URL в настройке Edge Function `AGRONA_SOIL_ENDPOINT`. Он должен принимать GeoJSON полигона с тем же форматом ответа, что и `/api/soil`.
3. Добавьте `DEEPSEEK_API_KEY` в [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/mcxzkbgnfqjbrlglfzki/functions/secrets). По умолчанию используется `deepseek-flash`. `DEEPSEEK_MODEL=deepseek-v4-pro` меняет модель на Pro.
4. Обновите frontend на Vercel, проверьте доступ владельца и отказ для чужого поля. После согласования расходов установите `DEEPSEEK_ENABLED=true` в Supabase Secrets и проверьте объяснение на принадлежащем тестовому аккаунту поле за 2025 год.

Открытие страницы не вызывает DeepSeek. Действуют серверные ограничения в три новых запроса в минуту и двенадцать за 24 часа на пользователя. Успешный ответ на тот же запрос переиспользуется до десяти минут. Учёт обращений и токенов хранится в таблице с доступом только серверной роли.

## Verification limits

A successful frontend build does not establish that a hosted Supabase migration or RLS policy has been exercised. Validate registration, email confirmation, recovery, two-user isolation, geometry rejection, cache reuse and the complete farmer workflow against your configured staging project before production.

## Sources

- NASA POWER daily API: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase profile trigger: https://supabase.com/docs/guides/auth/managing-user-data
- Satellite tiles: MapTiler, subject to your provider plan and attribution.

## Data provenance and model scope

`public/demo-power-2025.json` contains **365 real daily NASA POWER observations** for the original northern demo field in 2025. Its metadata preserves the upstream API version, sources, retrieval timestamp, location, units and request URL. For a new demo field or an edited boundary, the app queries NASA POWER using that field's coordinates. Production fields retrieve their own centroid observations through the Edge Function.

Indicative water ranges follow FAO Irrigation Water Management Training Manual 3, chapter 3, table 14: https://www.fao.org/4/s2022e/s2022e07.htm . Growing durations and drought categories are simplified MVP assumptions, not cultivar-specific calibration. The model considers family transitions, legumes, indicative water demand and historical dry periods. It does not estimate profit, yield, actual soil moisture or field-specific disease probability. The annual dry-period indicator can include months outside the growing season; validate local sowing/harvest windows before agronomic use.

Landing image: Bernd Dittrich, Unsplash, https://unsplash.com/photos/aerial-view-of-green-and-brown-agricultural-fields-81HghedjWk8 (Unsplash License). It illustrates farmland and is not an image of the demo location.

## Database checks

`supabase/tests/ownership.sql` is a transactional assertion script intended for a disposable local Supabase database. Run with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ownership.sql`. It rolls back fixtures. Do not confuse this script with a completed hosted RLS verification.

The checked-in `src/lib/database.types.ts` is schema-aligned source typing, not a claim of introspection against a live database. Regenerate types with the Supabase CLI after migration. The app currently loads farm resources together; add server pagination and viewport-based queries for large deployments.

## Verification performed

- Production build and strict TypeScript compilation passed at each implementation checkpoint.
- Unit tests cover polygon validity, NASA units/missing values, dry-period discontinuities, deterministic rotations, exclusions and insufficient alternatives.
- Live NASA request validated against the adapter; a complete year was retrieved and cached for demo use.
- Browser: demo entry, polygon drawing and saving, coordinate creation, rotation comparison, and reload persistence. The current field workflow was checked at narrow and wide widths with past-season entry, both planning paths, and reopening a saved comparison.
- npm audit after dependency updates: zero reported vulnerabilities.

## Still requires connected deployment validation

Supabase registration/confirmation/recovery, hosted migration execution, RLS isolation, production field/scenario persistence and Edge Function cache behavior need a configured Supabase project. Satellite imagery needs a licensed MapTiler key. The hosted NDVI paths for HLS and Sentinel-2 still need an authenticated end-to-end check. See [runtime data integration status](docs/data-preparation.md#реестр-исходного-списка). Multi-year statistical trend fitting and cultivar-specific agronomic validation are outside this MVP; the dashboard supports selecting historical years.

Registration location search requires `VITE_MAPTILER_KEY`. Add the exact origin and `/map` path of your running frontend to the Supabase Auth redirect allow-list (for example, `http://127.0.0.1:5174/map` when Vite picks port 5174). Run `supabase/tests/registration.sql` on a disposable database after applying the migrations.

## Earth observation Phase A

Apply the Earth observation migration, then deploy the updated `nasa-power` Edge Function. The function uses the built-in Supabase service role only for job claims and writes. It checks field ownership through the caller's session first.

For a hosted smoke test, sign in as a test farmer with a saved field. Open Analytics and wait for the selected year to load automatically. Confirm that the job reaches `succeeded`, that daily parameter rows appear in `earth_observations`, and that `field_analytics` contains the matching year and boundary revision. Reload and check that the cached data appears without a new job. Select another year and check that its observations and coverage replace the previous year. Repeat as a separate account to confirm that the first farmer's field data is inaccessible.

Run the live provider test with `node --experimental-strip-types scripts/check-power-live.mjs`. It retrieves and validates all seven parameters at the public demo coordinates. The dashboard bundles a snapshot of those real observations. The automated hosted path requires the migration and function deployment.

POWER processes the selected complete calendar year, with seven-day cache freshness for the latest complete year and 180 days for earlier years. Incomplete provider coverage stays visible as missing data. Annual comparisons and anomalies use complete parameter series only. The historical baseline uses at least three of the ten most recent saved prior years and does not represent a standard climatological normal.

## Sentinel-2 vegetation

The Vegetation tab uses the [Copernicus Sentinel Hub Statistical API](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html). Create an OAuth client in the [Sentinel Hub dashboard](https://shapps.dataspace.copernicus.eu/dashboard/) and configure the credentials as Supabase Edge Function secrets. See [authentication](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html), [quotas](https://documentation.dataspace.copernicus.eu/Quotas.html), and [Copernicus terms](https://dataspace.copernicus.eu/terms-and-conditions). General-user Sentinel Hub access is metered by requests and processing units. Annual requests and optional previews both consume quota.

From the project directory, with the Supabase CLI authenticated and linked to the target project:

```sh
npx supabase db push
npx supabase secrets set --env-file /absolute/path/to/private-cdse.env
npx supabase functions deploy sentinel-vegetation
```

The private env file must contain `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET`. Keep it outside the frontend and repository. The deployment needs migrations 003 and 004 applied. If you applied earlier SQL through the Dashboard, apply pending migration 004 through the Dashboard as well, or reconcile migration history before running `db push`.

After deployment, sign in, save a Kazakhstan field, and open Vegetation. Confirm the analysis job succeeds, the year’s observation rows appear in the tab, and the `field_analytics.vegetation_metrics` cache is saved. Reopen the tab to verify cache reuse, select a date to verify the masked PNG preview, then edit the boundary and confirm a new revision is used. New saves queue the latest complete UTC year. Earlier complete years back to 2017 are available subject to local Sentinel-2 Level-2A coverage. The analysis uses a 10 m UTM grid, with the native 20 m SCL mask resampled using nearest neighbour and a per-request limit on field extent. The 256 × 256 preview uses Web Mercator and can differ visually from the analysis grid.

## NASA HLS vegetation

NASA HLS v2.0 is the default on the Vegetation tab. Copernicus remains selectable during verification. The HLS workflow uses NASA CMR for spatial/temporal discovery and LP DAAC Earthdata Cloud HTTPS range reads for the actual COG data. AppEEARS supports area extraction with its own authenticated task workflow. Direct COG reads keep each source granule, native pixel grid, and explicit Fmask handling under AGRONA's control.

HLSL30 uses B04 and B05 and starts in 2013. HLSS30 uses B04 and B8A and starts in 2015. Observations depend on the location and NASA archive coverage. Reflectance scale is 0.0001 with zero offset. Statistics use 30 m pixel centers inside the saved polygon. Negative or saturated reflectance, fill, zero denominator, cloud, adjacency, shadow, snow, high aerosol, and water are excluded. Water counts are retained. A granule that only covers part of the polygon is labeled separately and excluded from the field-wide summary. Each point is a granule, so multiple observations can share a day. The Copernicus option retains its existing preview. An HLS raster overlay is pending.

1. Verify the Supabase migration history using the production reconciliation runbook if necessary. Preview the push. Apply migration `202611140005_hls_vegetation.sql` and any earlier migration that the audit confirmed is pending.
2. Create an Earthdata Login account at <https://urs.earthdata.nasa.gov/>. Authorize the LP DAAC Earthdata Cloud application by signing in to an LP DAAC download, then generate a user token under **Generate Token**. Earthdata user tokens expire after 60 days. Rotate the worker secret before expiry.
3. Deploy the Edge Function against the target project:

   ```sh
   npx supabase db push --dry-run --remote=mcxzkbgnfqjbrlglfzki
   npx supabase db push --remote=mcxzkbgnfqjbrlglfzki
   npx supabase functions deploy hls-vegetation --project-ref mcxzkbgnfqjbrlglfzki
   ```

4. Run the worker where it can hold a Supabase lease. The Edge Function only queues and reads jobs; the worker that opens the rasters owns `EARTHDATA_TOKEN`, and its service role key can write the queue and cache, so both must stay private. Three hosts are supported.

   **GitHub Actions (free, periodic).** `.github/workflows/hls-worker.yml` claims at most one job per run, checkpoints it, and exits, so the next run resumes from the stored `conceptId`/`revisionId` pairs instead of re-reading finished granules. Create the repository secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `EARTHDATA_TOKEN` under **Settings → Secrets and variables → Actions**. Run **Actions → HLS worker → Run workflow** with a `field_id` and `year` first, then create the repository variable `HLS_AUTOMATION_ENABLED=true` to arm the `*/30` schedule. An idle queue skips the image build, and every run reports queue and analytics counts in its job summary. Actions is a periodic processor, not an always-on service: runs are queued, capped at 25 minutes, and hold no lease between runners.

   **Local Docker (smoke test or one-off).** The worker reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `EARTHDATA_TOKEN` directly or from the `*_FILE` variables, so a secrets directory works too.

   ```sh
   docker build -t agrona-hls workers/hls
   docker run --rm --env-file /absolute/path/to/private-hls.env agrona-hls \
     python worker.py --smoke-field YOUR_FIELD_UUID --year 2025
   docker run -d --name agrona-hls --restart unless-stopped \
     --env-file /absolute/path/to/private-hls.env agrona-hls
   ```

   **Persistent container host.** `workers/hls/compose.yaml` runs the same image with `restart: unless-stopped`, a read-only root filesystem, a non-root user, dropped capabilities and file-based secrets.

The smoke test reads actual pixels for one saved field without writing. Then open Vegetation for that field and year and verify that the job completes, the results persist on reload, saving a new field queues analysis, and editing the boundary selects a new cache revision. Run with the Copernicus credentials omitted to verify HLS independence. The worker uses one active job per process, window-size limits, incremental checkpoints and backoff for transient HTTP errors. NASA requests can be throttled or denied. Inspect the worker logs and `earth_observation_jobs` if the tab remains queued or shows partial results.
