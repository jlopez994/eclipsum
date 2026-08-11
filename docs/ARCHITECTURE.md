# Architecture

> Faithful to the implementation on `main` (build identity = `android.versionCode`; `expo.version` mirrors it as `b<vc>`). Overview and release runbook in the [README](../README.md).

## Guiding principle

The **computation engine is pure TypeScript** runnable in Node: `lib/{eclipse,totality,spots,prefs,weather,eclipseCatalog}.ts` do not import `react-native` (AsyncStorage is allowed: its CJS entry loads in Node and native module access is deferred). `npm run selfcheck` (`scripts/selfcheck.ts`) runs them in Node with asserts covering the engine, catalog, RC, drill, prefs, totality and i18n — it is the gate for CI and for the Remote Config workflow.

All astronomical computation is 100% local ([astronomy-engine](https://github.com/cosinekitty/astronomy)). There is no backend; the only network calls are Open-Meteo (clouds), map tiles, Expo's geocoder and Firebase (RC/Analytics/Crashlytics, best-effort).

## App.tsx — root state

The only component with global state (~500 lines). No external store.

| State | Source | Purpose |
|---|---|---|
| `prefs` | `usePrefs()` | persisted preferences; `null` = loading (spinner) |
| `geo`, `locating` | `useGeo()` | one-shot GPS position |
| `permissions` | re-read on launch and on every `AppState → active` | location + notifications, without re-prompting |
| `remoteMsg`, `glassesUrl`, `sponsor`, `updateUrl` | `fetchRemoteExtras()` | Remote Config values |
| `catalogEpoch` | counter | invalidates the eclipse memo when RC changes the catalog |
| `tab` | `'mapa' \| 'alertas' \| 'ajustes'` | active tab |
| `demo` | bool | demo mode (1.5 s long-press on *About*, in Settings) |
| `drill` | `{eclipse, ids} \| null` | active drill + ids of its `[PRUEBA]` notifications |
| `now`, `fineClock` | clock | 30 s tick normally, 1 s during demo/drill/eclipse window |

Stateless derivations: `getActiveEclipse()` and `contextFor(prefs, civilDate)` recompute on every render (stable identity by design). `eclipse = useMemo(computeLocalEclipse(lat, lon, …), [lat, lon, id, catalogEpoch])`.

### Startup flow

1. Fonts (Space Grotesk) + prefs; until both load, spinner.
2. `usePrefs` applies `setLang()` and `setUserSelectedEclipseDay()` **before** exposing prefs (avoids a first render in the wrong language/eclipse).
3. On mount and on every return to foreground: `fetchRemoteExtras()` + permission re-read.
4. Spot seeding: if the active eclipse has no spot and GPS is available, the GPS point becomes the spot.
5. `useSpotData` resolves clouds, nearest totality and the GPS projection in parallel.

### Eclipse mode

If there is an active eclipse and `demo || window [C1 − 30 min, C4 + 5 min]`, `EclipseModeScreen` renders **instead of** the tabs (early return). Displayed eclipse priority: `drill ?? demo ?? real`. The fine clock (1 s) is armed with entry/exit timers for that window.

### Alerts (effect)

Reschedules all notifications when the spot, toggles, sound, language or permission change. **Skipped while a drill is active** (rescheduling does `cancelAll` and would kill the test notices). Texts are baked in the active language at scheduling time — that's why `prefs.language` is in the deps.

### Drill

- `startDrill`: requires a spot + ≥1 active alert. `buildDrillEclipse` (lib/drill.ts) builds a synthetic eclipse starting at *now + 2 min* with configurable durations; `scheduleFakeEclipseAlerts` adds real `[PRUEBA]` notifications without touching the real eclipse's.
- `jumpDrill(milestone)`: shifts the series so the tapped milestone lands in 20 s (only tappable from the rail in `EclipseModeScreen` during a drill).
- Exit: manual (`cancelAlertsByIds`) or automatic 60 s after the last event.

## lib/ — modules

| Module | Purpose | Key points |
|---|---|---|
| `eclipse.ts` | Local circumstances: C1–C4, maximum, obscuration, totality duration, sunset | In-RAM memo (`Map`, max 400 entries). `nextEvent`, `currentPhase` |
| `eclipseCatalog.ts` | Catalog and active eclipse | Merge: bundled (`ECLIPSES`, today only `2026-08-12-iberia`) + RC (`eclipse_catalog`) + engine-generated up to 12 upcoming. Dedupe by **civil day** (bundled entry wins). Active priority: user selection → `active_eclipse_id` (RC) → the nearest. User selection persists by civil day, not id. Labels regenerated per language when the entry has `kind` |
| `totality.ts` | Nearest totality | 8 bearings × probes `[25,50,100,200,400,700] km` + bisection to 2 km; duration measured 5 km inside the edge. RAM cache by `searchStart:lat,lon` |
| `prefs.ts` | Preferences + per-eclipse context + migrations | AsyncStorage `eclipsum:prefs`. `contextFor`/`withContext` provide spot, alerts and recents **per eclipse civil day**. `ALERT_EARLY_SECONDS = 15`, `RECENT_CAP = 3` |
| `weather.ts` | Open-Meteo clouds | Fixed model `ecmwf_ifs025` (matches Windy). AsyncStorage cache `eclipsum:clouds:v3:{day}:{lat},{lon}` (2 decimals) with pruning of old days/versions. 10 s timeout |
| `notifications.ts` | Local alerts | `opQueue` serializes every operation. Android channels `eclipse-alerts-v4-{eclipse\|default}` (deletes legacy v3). `scheduleEclipseAlerts` cancels everything and reschedules; `scheduleFakeEclipseAlerts` is additive and returns ids |
| `firebase.ts` | RC + Analytics + Crashlytics | Everything best-effort (the app works without Firebase). RC fetch: 0 in dev, 1 h in release. `track`/`trackError` |
| `i18n.ts` | Languages (today es/en, extensible) | `LANGS` + `LANG_META` (endonym, BCP-47 tag, decimal separator) + flat JSON dictionaries in `locales/<lang>.json` (months = `month.0–11` keys, `monthShort` helper). `I18nKey = keyof typeof es` — completeness enforced by the compiler and parity verified in selfcheck for every language. `t(key, vars)` with `{var}`; unknown key → returns the key. No dependencies; the language lives in `prefs.language` (`''` = auto: Spanish system → es, everything else → en, resolved in `usePrefs`). Format directly compatible with Crowdin/Weblate/Tolgee. How to add a language: [README](../README.md#adding-a-language) |
| `drill.ts` | Synthetic drill eclipse | Presets `DRILL_PARTIAL`, `DRILL_TOTALITY`; `clampDrill` validates ranges |
| `bandGeo.ts` | Bundled paths (**generated** by `scripts/genBand.ts`, do not edit by hand) | Today only the Iberia 2026 path (66 slices) |
| `spots.ts` | `Spot`/`SpotOption` types | No logic |
| `maps.ts`, `anim.ts`, `soundPreview.ts` | RN utilities (open Maps, LayoutAnimation, sound preview) | Import react-native — outside the engine |
| `leafletVendor.ts` | Vendored Leaflet 1.9.4 (JS+CSS as strings) | The real map does not depend on a CDN |

## components/ and hooks/

**Screens** (`components/screens/`):

- `MapScreen` — main: real map, chips (place/compass), GPS recenter button, draggable bottom sheet with countdown, stats, clouds chip → Windy, timeline, horizon, sponsor.
- `AlertsScreen` — C1–C4 milestones with switches, +15 s early warning, +1 h/+24 h reminders (C1 only), "after sunset" mark, test notification, scheduled counter.
- `SettingsScreen` — eye safety (IGN + affiliate), permissions, 5 selectable upcoming eclipses, sound, drill, language, support (Buy Me a Coffee via RC `donate_url`), *About*.
- `EclipseModeScreen` — event screen: clock, GLASSES ON/OFF banner, animated corona, giant countdown, milestone rail, `useKeepAwake()`.

**Map** (`components/map/`): `CompassChip` (needle at the sun's azimuth, relative to device heading when a sensor exists), `HorizonDiagram` (sun altitude to scale, "fists" reference ≈ 10°).

**Root**: `RealMap` (Leaflet WebView + Carto dark tiles; path, markers, taps resolved in RN; `forwardRef` handle `flyTo` for the GPS button; framing = path stretch within `BAND_LON_SPAN` degrees of longitude around the spot), `SpotSelector` (text or `lat, lon` search, sections with batched clouds), `TabBar`, `Countdown` (own 1 s tick, isolated from the tree), `theme.ts` (`C` palette + `F` fonts).

**Hooks**: `useGeo` (one-shot GPS: last known → fresh fix, race-safe geocoder), `usePrefs` (load/save + language + eclipse selection), `useSheet` (draggable sheet with `Animated` + `PanResponder`), `useSpotData` (clouds + totality + projected GPS).

## Persistence

| Key | Contents |
|---|---|
| `eclipsum:prefs` (AsyncStorage) | language, sound, drill config, and per eclipse civil day: spot, active alerts, recents |
| `eclipsum:clouds:v3:{day}:{lat},{lon}` | cached cloud cover (old entries pruned) |
| Remote Config native cache | last activated values persist offline |

## Remote data (Remote Config)

7 string parameters — full table and operations in the [README](../README.md#remote-config-remoteconfigtemplatejson). The client ships baked-in defaults (`lib/firebase.ts`), so the app is functional without ever having contacted Firebase.
