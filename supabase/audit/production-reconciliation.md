# AGRONA production migration reconciliation

Target: Argon, `mcxzkbgnfqjbrlglfzki`. The live read-only audit found no remote history entries for migrations 001–004. No production migration or application data was changed during the audit.

| Migration | Production evidence | Action |
| --- | --- | --- |
| 202611140001 | All eight tables have matching base columns, defaults and nullability. Primary, foreign, unique and check constraints, named indexes, ownership policies, grants, enabled triggers, and the security-invoker GeoJSON view match the foundation. PostGIS is in `extensions`. All five seed crops matched by ID and contents. | Record as applied. |
| 202611140002 | All four profile location columns and their checks exist. The enabled confirmation trigger and current signup function match 002. This accounts for the intentional differences from 001. | Record as applied. |
| 202611140003 | All three analytics tables, their constraints and indexes, owner-only read policies, service-role permissions, and both job RPCs match 003, including the job ID renewal on reclaim. | Record as applied. |
| 202611140004 | Both Sentinel function names are absent. Read-only preflight verified UTM projection, boundary hashing and Web Mercator geometry for the existing saved field. | Apply normally. |

Run from the project directory using Supabase CLI v3. Check the production target in every command. Re-run the read-only queries if the schema or migration files changed after the audit.

```sh
npx supabase migration list --remote=mcxzkbgnfqjbrlglfzki
npx supabase db query --remote=mcxzkbgnfqjbrlglfzki --read-only --file supabase/audit/production-schema.sql
npx supabase db query --remote=mcxzkbgnfqjbrlglfzki --read-only --file supabase/audit/sentinel-preflight.sql
```

Record only the three verified versions. This writes migration history and executes none of their migration SQL.

```sh
npx supabase migration repair 202611140001 202611140002 202611140003 --status applied --remote=mcxzkbgnfqjbrlglfzki
npx supabase db push --dry-run --remote=mcxzkbgnfqjbrlglfzki
```

Stop if the preview lists anything other than `202611140004_sentinel_vegetation.sql`. If it lists only 004, run:

```sh
npx supabase db push --remote=mcxzkbgnfqjbrlglfzki
npx supabase migration list --remote=mcxzkbgnfqjbrlglfzki
```

Migration 004 creates the geometry reader and job completion function, sets their execute permissions, and records the version. Its migration body does not recreate application tables or run either function. Confirm that all four versions appear on both sides after the push. To enable the full provider, configure the two Copernicus secrets and deploy the Edge Function as described in the main README.
