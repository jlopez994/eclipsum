# Arquitectura

> Fiel a la implementación en `main` (1.0.0, versionCode 23). Visión general y runbook de releases en el [README](../README.md).

## Principio rector

El **motor de cálculo es TypeScript puro** ejecutable en Node: `lib/{eclipse,totality,spots,prefs,weather,eclipseCatalog}.ts` no importan `react-native` (AsyncStorage sí está permitido: su entry CJS carga en Node y el acceso al módulo nativo es diferido). `npm run selfcheck` (`scripts/selfcheck.ts`) los ejecuta en Node con asserts de motor, catálogo, RC, drill, prefs, totalidad e i18n — es la puerta de CI y del workflow de Remote Config.

Todo el cálculo astronómico es 100 % local ([astronomy-engine](https://github.com/cosinekitty/astronomy)). No hay backend propio; la única red es Open-Meteo (nubes), tiles de mapa, geocoder de Expo y Firebase (RC/Analytics/Crashlytics, best-effort).

## App.tsx — estado raíz

Único componente con estado global (~500 líneas). No hay store externo.

| Estado | Origen | Uso |
|---|---|---|
| `prefs` | `usePrefs()` | preferencias persistidas; `null` = cargando (spinner) |
| `geo`, `locating` | `useGeo()` | posición GPS one-shot |
| `permissions` | releído en arranque y en cada `AppState → active` | ubicación + notificaciones, sin volver a pedir |
| `remoteMsg`, `glassesUrl`, `sponsor`, `updateUrl` | `fetchRemoteExtras()` | valores de Remote Config |
| `catalogEpoch` | contador | invalida el memo del eclipse cuando RC cambia el catálogo |
| `tab` | `'mapa' \| 'alertas' \| 'ajustes'` | pestaña activa |
| `demo` | bool | modo demo (long-press 1,5 s en *Acerca de*, en Ajustes) |
| `drill` | `{eclipse, ids} \| null` | simulacro activo + ids de sus notificaciones `[PRUEBA]` |
| `now`, `fineClock` | reloj | tick 30 s normal, 1 s si demo/drill/ventana de eclipse |

Derivados sin estado: `getActiveEclipse()` y `contextFor(prefs, civilDate)` se recalculan en cada render (identidad estable por diseño). `eclipse = useMemo(computeLocalEclipse(lat, lon, …), [lat, lon, id, catalogEpoch])`.

### Flujo de arranque

1. Fuentes (Space Grotesk) + prefs; hasta que ambas cargan, spinner.
2. `usePrefs` aplica `setLang()` y `setUserSelectedEclipseDay()` **antes** de exponer prefs (evita un primer render en idioma/eclipse incorrecto).
3. Al montar y en cada vuelta a primer plano: `fetchRemoteExtras()` + relectura de permisos.
4. Siembra de puesto: si el eclipse activo no tiene puesto y hay GPS, se fija el punto GPS como puesto.
5. `useSpotData` resuelve en paralelo nubes, totalidad más cercana y proyección del GPS en el diagrama.

### Modo eclipse

Si hay eclipse activo y `demo || ventana [C1 − 30 min, C4 + 5 min]`, se renderiza `EclipseModeScreen` **en lugar de** tabs (return temprano). Prioridad de eclipse mostrado: `drill ?? demo ?? real`. El reloj fino (1 s) se arma con timers de entrada/salida de esa ventana.

### Alertas (efecto)

Reprograma todas las notificaciones al cambiar puesto, toggles, sonido, idioma o permiso. **Se salta si hay drill activo** (la reprogramación hace `cancelAll` y mataría los avisos de prueba). Los textos se hornean en el idioma activo al programar — por eso `prefs.language` está en las deps.

### Simulacro (drill)

- `startDrill`: exige puesto + ≥1 alerta activa. `buildDrillEclipse` (lib/drill.ts) construye un eclipse sintético que empieza en *ahora + 2 min* con duraciones configurables; `scheduleFakeEclipseAlerts` añade notificaciones reales `[PRUEBA]` sin tocar las del eclipse real.
- `jumpDrill(hito)`: desplaza la serie para que el hito tocado caiga en 20 s (solo tocable desde el raíl de `EclipseModeScreen` en drill).
- Salida: manual (`cancelAlertsByIds`) o automática 60 s después del último evento.

## lib/ — módulos

| Módulo | Propósito | Claves |
|---|---|---|
| `eclipse.ts` | Circunstancias locales: C1–C4, máximo, obscuración, duración de totalidad, ocaso | Memo en RAM (`Map`, máx. 400 entradas). `nextEvent`, `currentPhase` |
| `eclipseCatalog.ts` | Catálogo y eclipse activo | Fusión: empaquetado (`ECLIPSES`, hoy solo `2026-08-12-iberia`) + RC (`eclipse_catalog`) + autogenerado por el motor hasta 12 próximos. Dedupe por **día civil** (gana la entrada empaquetada). Prioridad de activo: selección de usuario → `active_eclipse_id` (RC) → el más próximo. La selección de usuario se persiste por día civil, no por id. Labels regenerados por idioma cuando la entrada tiene `kind` |
| `totality.ts` | Totalidad más cercana | 8 rumbos × sondas `[25,50,100,200,400,700] km` + bisección a 2 km; duración medida 5 km dentro del borde. Caché RAM por `searchStart:lat,lon` |
| `prefs.ts` | Preferencias + contexto por eclipse + migraciones | AsyncStorage `eclipsum:prefs`. `contextFor`/`withContext` dan puesto, alertas y recientes **por día civil de eclipse**. `ALERT_EARLY_SECONDS = 15`, `RECENT_CAP = 3` |
| `weather.ts` | Nubes Open-Meteo | Modelo fijo `ecmwf_ifs025` (coincide con Windy). Caché AsyncStorage `eclipsum:clouds:v3:{día}:{lat},{lon}` (2 decimales) con poda de días/versiones viejas. Timeout 10 s |
| `notifications.ts` | Alertas locales | Cola `opQueue` que serializa toda operación. Canales Android `eclipse-alerts-v4-{eclipse\|default}` (borra los v3 legacy). `scheduleEclipseAlerts` cancela todo y reprograma; `scheduleFakeEclipseAlerts` es aditiva y devuelve ids |
| `firebase.ts` | RC + Analytics + Crashlytics | Todo best-effort (la app funciona sin Firebase). Fetch RC: 0 en dev, 1 h en release. `track`/`trackError` |
| `i18n.ts` | Idiomas (hoy es/en, extensible) | `LANGS` + `LANG_META` (endónimo, tag BCP-47, separador decimal) + diccionarios JSON planos en `locales/<lang>.json` (meses = claves `month.0–11`, helper `monthShort`). `I18nKey = keyof typeof es` — completitud forzada por compilador y paridad verificada en selfcheck para cada idioma. `t(key, vars)` con `{var}`; clave desconocida → devuelve la clave. Sin dependencias; el idioma vive en `prefs.language` (`''` = auto: sistema español → es, resto → en, resuelto en `usePrefs`). Formato compatible con Crowdin/Weblate/Tolgee. Cómo añadir un idioma: [README](../README.md#añadir-un-idioma) |
| `drill.ts` | Eclipse sintético del simulacro | Presets `DRILL_PARTIAL`, `DRILL_TOTALITY`; `clampDrill` valida rangos |
| `bandGeo.ts` | Bandas empaquetadas (**generado** por `scripts/genBand.ts`, no editar a mano) | Hoy solo la banda de Iberia 2026 (66 cortes) |
| `spots.ts` | Tipos `Spot`/`SpotOption` | Sin lógica |
| `maps.ts`, `anim.ts`, `soundPreview.ts` | Utilidades RN (abrir Maps, LayoutAnimation, preview de sonido) | Importan react-native — fuera del motor |
| `leafletVendor.ts` | Leaflet 1.9.4 embebido (JS+CSS como strings) | El mapa real no depende de CDN |

## components/ y hooks/

**Pantallas** (`components/screens/`):

- `MapScreen` — principal: diagrama SVG o mapa real, chips (lugar/vista/brújula), hoja inferior arrastrable con cuenta atrás, stats, chip de nubes → Windy, cronología, horizonte, patrocinador.
- `AlertsScreen` — hitos C1–C4 con switch, aviso previo +15 s, recordatorios +1 h/+24 h (solo C1), marca «tras el ocaso», notificación de prueba, contador de programadas.
- `SettingsScreen` — permisos, sonido, idioma, seguridad ocular (IGN + afiliado), simulacro, próximos 5 eclipses seleccionables, *Acerca de*.
- `EclipseModeScreen` — pantalla de evento: reloj, banner GAFAS/SIN GAFAS, corona animada, cuenta atrás gigante, raíl de hitos, `useKeepAwake()`.

**Mapa** (`components/map/`): `CompassChip` (aguja al azimut del sol, relativa al rumbo del móvil si hay sensor), `Dots` (puesto + GPS), `HorizonDiagram` (altura del sol a escala, referencia «puños» ≈ 10°), `TotalPill` (distancia/rumbo a totalidad), `UmbraSweep` (barrido de la umbra).

**Raíz**: `RealMap` (WebView Leaflet + tiles Carto dark; banda, marcadores, tap resuelto en RN), `SpotSelector` (buscador texto o `lat, lon`, secciones con nubes por lote), `TabBar`, `Countdown` (tick propio de 1 s, aislado del árbol), `theme.ts` (paleta `C` + fuentes `F`).

**Hooks**: `useGeo` (GPS one-shot: última conocida → fix fresco, geocoder anti-carrera), `usePrefs` (carga/guarda + idioma + selección de eclipse), `useSheet` (hoja arrastrable con `Animated` + `PanResponder`), `useSpotData` (nubes + totalidad + GPS proyectado).

## Persistencia

| Clave | Contenido |
|---|---|
| `eclipsum:prefs` (AsyncStorage) | idioma, sonido, drill config, y por día civil de eclipse: puesto, alertas activas, recientes |
| `eclipsum:clouds:v3:{día}:{lat},{lon}` | nubosidad cacheada (se poda lo viejo) |
| Caché nativa de Remote Config | últimos valores activados persisten offline |

## Datos remotos (Remote Config)

7 parámetros string — tabla completa y operativa en el [README](../README.md#remote-config-remoteconfigtemplatejson). El cliente lleva defaults horneados (`lib/firebase.ts`), así que la app es funcional sin haber contactado nunca con Firebase.
