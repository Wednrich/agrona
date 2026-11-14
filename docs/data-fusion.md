# Data fusion — проект контракта, PHASE 0

Реализация общего слоя отсутствует. Сейчас используются source-specific
`earth_observations`, `field_analytics`, source_metadata и отдельные UI types.
Не требуется немедленно менять SQL или переписывать работающие adapters.

Предлагаемый ObservationRecord:

| Группа | Поля |
| --- | --- |
| Источник | source, product, product_version, provenance, processing_version |
| Величина | variable, value, unit, classification: OBSERVED/DERIVED/HEURISTIC/SCENARIO/UNAVAILABLE |
| Время | observation_start, observation_end, time_standard, temporal_resolution, retrieval_time |
| Место | field_id, geometry_revision, source_geometry_reference, spatial_resolution, spatial_support, CRS |
| Качество | coverage_fraction, valid_observation_count, quality_flags, uncertainty, data_status |
| Обработка | processing_method, weighting_method, missing_count, source_observation_ids |

`spatial_support`: FIELD_LEVEL, REGIONAL_CONTEXT, POINT_ESTIMATE,
PARTIAL_FIELD_COVERAGE. Для POWER сохранять и координату запроса, и support
грубой сетки; точечный запрос не создаёт точечного измерения.

Правила будущей реализации:

1. Прежде агрегации проверить field/revision, единицы, временную поддержку,
   origin/quality и версию продукта. Разные способы hash не сравнивать как
   один идентификатор: POWER хэширует GeoJSON, HLS EWKB, SRTM coordinates.
2. Instantaneous satellite acquisition не превращать в daily average.
   Снимок 2000 SRTM — статический контекст, не наблюдение выбранного 2025 сезона.
3. Не переводить региональный SMAP/IMERG в детальную field map ресэмплингом.
4. Суммы только для соответствующих интервалов/единиц; rate × duration.
   Пропуски не нули; fraction valid и временная полнота — разные показатели.
5. Area-weighting при пересечении coarse ячеек; pixel-centre SRTM/HLS методы
   обозначать отдельно. Не называть арифметическое среднее area-exact.
6. Источники с разными оценками осадков показывать рядом с причинами различий,
   не усреднять их автоматически. Не интерполировать без маркировки.
7. Все сценарные дельты хранить отдельно от исходных observations.

Тестовые контракты Phase 5: несовпадающие периоды, LST timestamp/day/night,
UTC/LST, mm/hour против mm/day, 9 km context против 30 m pixels, missing
source, NoData, partial polygon, старая геометрия и смена processing version.

Первый шаг без миграции — типизированные адаптеры над существующим JSON.
Для persist общего слоя понадобится сравнение live schema и отдельное
предложение миграции, совместимое со старыми кэшами.
