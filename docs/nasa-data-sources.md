# NASA data inventory — PHASE 0

Дата проверки: 2026-11-15. Это инвентаризация и план, не декларация новых интеграций.
Текущие статусы и доказательства: [readiness](space-apps-readiness.md).

| Источник | Доступ / единицы / support | Качество и ограничения | Статус |
| --- | --- | --- | --- |
| POWER Daily API | HTTPS point, без provider credentials; °C, mm/day, %, m/s, радиация приводится к MJ/m²/day | Центр поля на грубой сетке, не измерение поля. NoData не заменяется нулём; metadata хранит upstream header. Time standard в запросе явно не закреплён — сверить перед сравнением с UTC продуктами | Реальный прямой запрос прошёл; Edge развёрнута, новый hosted E2E не выполнен |
| HLSL30/HLSS30 v2.0 | CMR discovery; Earthdata bearer; LP DAAC COG range reads; 30 м; B04 red, B05/B8A NIR, scale 0.0001 | Fmask, aerosol, fill; вода исключена и посчитана. Native UTM pixel centers. Partial tile отдельно, мозаики нет. Реальный filename и revision в provenance | Локальный worker + mocks, production caches существуют; unattended E2E не подтверждён |
| SRTMGL1.003 | OpenTopography Global DEM `SRTMGL1`, AAIGrid, server key; 1″; м EGM96, уклон в градусах | Съёмка 2000; ограниченное широтное покрытие; void filling, vegetation/buildings и сетка ограничивают интерпретацию; это не современная съёмка поля | Локально + mocks, key/deployment отсутствуют |
| Copernicus Sentinel-2 L2A | OAuth server credentials; Statistical + Process API, 10 м NDVI, SCL 20 м | Квоты, облака, resampling; не NASA-only источник. Сохранён как отдельный выбор, не удалять до HLS E2E | Edge есть, credentials отсутствуют |

## Официальные источники

- [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/).
- [POWER meteorology sources](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/).
- [HLS algorithms](https://hls.gsfc.nasa.gov/algorithms/) и
  [HLS v2 user guide](https://lpdaac.usgs.gov/documents/1698/HLS_User_Guide_V2.pdf).
- [SRTMGL1.003 DOI](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003),
  [OpenTopography developer requirements](https://opentopography.org/developers).
- [Copernicus Statistical API](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html).

NASA data citation и условия доступа сервиса — разные вещи. Для общего
OpenTopography ключа требуется разрешённая поставщиком модель использования.
Не выдавать бесплатный персональный ключ за разрешение обслуживать всех
пользователей. Стоимость/квоты перед релизом подтвердить у поставщика.

## Кандидаты следующих этапов

**GPM:** рассмотреть IMERG Final V07. NASA описывает 0.1° сетку и разные
accumulation periods в [GIS documentation](https://gpm.nasa.gov/resources/documents/imerg-gis-geotiff-documentation).
Также актуальная [POWER documentation](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/)
документирует `IMERG_PRECTOT`, суточные mm, UTC, и quality-related parameters.
Это потенциально минимальный server adapter без нового raster worker, но
требует отдельного live spike: доступность параметров, upstream version,
Final/Late граница, QA и географическое покрытие. Не считать текущий
`PRECTOTCORR` уже подключённым GPM. Не добавлять в Phase 0.
Для исходных half-hour rates mm/hour сумма = Σ(rate × 0.5 h), с проверкой
пропусков; готовые daily amounts нельзя повторно умножать на 24.

**SMAP:** кандидат [SPL3SMP_E Version 6](https://nsidc.org/data/spl3smp_e/versions/6),
daily 9 km EASE-grid. Шаг сетки не следует приравнивать к независимому
разрешению измерения. Перед реализацией сверить user guide, retrieval flags,
frozen/water masks, единицы объёмной влажности, глубину и Earthdata access.
Только региональный поверхностный контекст; не root-zone field sensor.

**ECOSTRESS:** кандидат ECO_L2T_LSTE для LST. NASA
[сообщила о Version 3](https://forum.earthdata.nasa.gov/viewtopic.php?sid=7011fe61ecdd6f613a1aca58e924160d&t=7884).
Документированный [NASA пример COG доступа](https://nasa.github.io/VITALS/python/emit_ecostress/01_Finding_Concurrent_Data.html)
показывает V002. Выбрать одну версию после проверки CMR и реальных файлов,
не смешивать V002/V003. Нужны acquisition time, QC, cloud, water, LST error,
день/ночь; temperature conversion строго по metadata. Каталог сцен не
подтверждает обработку пикселей. Масштаб около 70 м, нерегулярное расписание.

**Дополнительные:** SoilGrids полезен как модельный prior почвы с глубинами и
uncertainty; сначала полезнее лабораторные данные фермера. GRACE — региональный
водный контекст, не поле; GEDI — footprint/vegetation structure, не очевидный
приоритет для текущего rotation MVP; MODIS — длинный ряд, но coarse support.
Не добавлять ни один без отдельного обоснованного decision use-case и доступа.

Все три новые NASA интеграции: NOT IMPLEMENTED. Выбор продукта здесь —
направление исследования, а не обещание проверенной доступности endpoint.
