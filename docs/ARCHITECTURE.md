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
| `remoteMsg`, `glassesUrl`, `sponsor`, `updateUrl`, `suggestedSpots` | `fetchRemoteExtras()` | Remote Config values |
| `catalogEpoch` | counter | invalidates the eclipse memo when RC changes the catalog |
| `tab` | `'mapa' \| 'eclipses' \| 'alertas' \| 'ajustes'` | active tab |
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

- `startDrill`: requires a spot + ≥1 active alert. `buildDrillEclipse` (lib/drill.ts) builds a synthetic eclipse starting at *now + 1 min* with fixed minimum legs (30 s partial, 45 s totality — the whole run is ~2 min); `scheduleFakeEclipseAlerts` adds real `[PRUEBA]` notifications without touching the real eclipse's. No settings: a drill is a smoke test, not a scale rehearsal.
- `jumpDrill(milestone)`: shifts the series so the tapped milestone lands in 20 s (only reachable from the C1–C4 chips that `EclipseModeScreen` shows during a drill).
- Exit: manual (`cancelAlertsByIds`) or automatic 60 s after the last event.

## lib/ — modules

| Module | Purpose | Key points |
|---|---|---|
| `eclipse.ts` | Local circumstances: C1–C4, maximum, obscuration, totality duration, sunset | In-RAM memo (`Map`, max 400 entries). `nextEvent`, `currentPhase`. `sunCoverage(eclipse, now)` = live obscuration from piecewise-linear centre separation + equal-disc overlap area (~2 % off the real value, and valid for the synthetic drill too) |
| `eclipseBar.ts` | Geometry of the eclipse-mode timeline | True-to-scale legs, totality sliver clamped to `SLIVER_MIN = 7`…`SLIVER_MAX = 24` px, and `xAt(t)` mapping instant → pixel leg by leg. Pure — asserted in selfcheck |
| `eclipseCatalog.ts` | Catalog and active eclipse | Merge: bundled (`ECLIPSES`, today only `2026-08-12-iberia`) + RC (`eclipse_catalog`) + engine-generated: up to 20 upcoming (`upcomingEclipses`) and 60 past (`pastEclipses`, computed only on demand). Any real civil day 1900–2199 resolves via a single global engine search (`resolveByEngine`). Dedupe by **civil day** (bundled entry wins). Active priority: user selection → `active_eclipse_id` (RC) → the nearest. User selection persists by civil day, not id; `selectedEclipsePast` marks a deliberate archive query so it survives restarts without breaking the normal rollover. Labels regenerated per language when the entry has `kind` |
| `totality.ts` | Nearest totality | 8 bearings × probes `[25,50,100,200,400,700] km` + bisection to 2 km; duration measured 5 km inside the edge. RAM cache by `searchStart:lat,lon` |
| `prefs.ts` | Preferences + per-eclipse context + migrations | AsyncStorage `eclipsum:prefs`. `contextFor`/`withContext` provide spot, alerts and recents **per eclipse civil day**. `ALERT_EARLY_SECONDS = 15`, `RECENT_CAP = 3` |
| `weather.ts` | Open-Meteo clouds | Forecast API with fixed model `ecmwf_ifs025` (matches Windy); **past days route to the ERA5 archive API** (real cloud cover for archive mode; ~2–5 day lag degrades the very recent past to "no data"). AsyncStorage cache `eclipsum:clouds:v3:{day}:{lat},{lon}` (2 decimals) with pruning of old days/versions. 10 s timeout |
| `notifications.ts` | Local alerts | `opQueue` serializes every operation. Android channels `eclipse-alerts-v4-{eclipse\|default}` (deletes legacy v3). `scheduleEclipseAlerts` cancels everything and reschedules; `scheduleFakeEclipseAlerts` is additive and returns ids |
| `firebase.ts` | RC + Analytics + Crashlytics | Everything best-effort (the app works without Firebase). RC fetch: 0 in dev, 1 h in release. `track`/`trackError` |
| `i18n.ts` | Languages (today es/en, extensible) | `LANGS` + `LANG_META` (endonym, BCP-47 tag, decimal separator) + flat JSON dictionaries in `locales/<lang>.json` (months = `month.0–11` keys, `monthShort` helper). `I18nKey = keyof typeof es` — completeness enforced by the compiler and parity verified in selfcheck for every language. `t(key, vars)` with `{var}`; unknown key → returns the key. No dependencies; the language lives in `prefs.language` (`''` = auto: Spanish system → es, everything else → en, resolved in `usePrefs`). Format directly compatible with Crowdin/Weblate/Tolgee. How to add a language: [README](../README.md#adding-a-language) |
| `drill.ts` | Synthetic drill eclipse | Fixed legs `DRILL_PARTIAL_SEC = 30`, `DRILL_TOTALITY_SEC = 45` — minimums that keep the 15 s early alerts in order (asserted in selfcheck) |
| `bandGeo.ts` | Bundled path pack (**generated** by `scripts/genBandPack.ts`, do not edit by hand) | Every total/annular path in the browsable window (~50 paths, ~240 KB) — offline and zero-maintenance; history never changes. Shared walker in `scripts/bandWalk.ts` (fine 0.25° seeding for thin hybrid/annular paths) |
| `spotEclipses.ts` | Eclipses visible from one spot | Iterates `SearchLocalSolarEclipse`/`NextLocalSolarEclipse` ±25/8 years, drops below-horizon series, canonicalizes each hit to the **global** peak's civil day (the local maximum can fall ±1 day). Promise cache per rounded coordinate; ~0.5 s per sweep, yielding between engine steps |
| `spots.ts` | `Spot`/`SpotOption` types | No logic |
| `maps.ts`, `anim.ts`, `soundPreview.ts` | RN utilities (open Maps, LayoutAnimation, sound preview) | Import react-native — outside the engine |
| `leafletVendor.ts` | Vendored Leaflet 1.9.4 (JS+CSS as strings) | The real map does not depend on a CDN |

## components/ and hooks/

**Screens** (`components/screens/`):

- `MapScreen` — main: real map, chips (place/compass), GPS recenter button, draggable bottom sheet with countdown, stats, clouds chip → Windy, timeline, horizon, sponsor.
- `AlertsScreen` — C1–C4 milestones with switches, +15 s early warning, +1 h/+24 h reminders (C1 only), "after sunset" mark, test notification, scheduled counter.
- `EclipsesScreen` — eclipse browser: paginated upcoming (~8 years) and past (~25 years) lists, radio selection ('' = automatic). Picking a past one = archive mode (alerts off, archive clouds, map says "finished").
- `SettingsScreen` — eye safety (IGN + affiliate), permissions, sound, drill, language, support (Buy Me a Coffee via RC `donate_url`), *About*.
- `EclipseModeScreen` — event screen: full-bleed corona, safety status, giant countdown (two huge digits in the last 60 s before C2 and 15 s before C3), live sun coverage, true-to-scale timeline, NEXT card, `useKeepAwake()`. Six states: before C1 · partial · imminent · totality · after C3 · finished. During a drill it adds the C1–C4 jump chips.

**Eclipse mode** (`components/mode/`): `CoronaHero` (the corona bleeds off the top edge; the JPEG is cut with an SVG radial mask because RN has no `mix-blend-mode`; sky, opacity and motion change per state), `EclipseTimeline` (the bar from `lib/eclipseBar`, veil over what has not happened yet, "you are here" marker).

**Map** (`components/map/`): `CompassChip` (needle at the sun's azimuth, relative to device heading when a sensor exists), `HorizonDiagram` (sun altitude to scale, "fists" reference ≈ 10°).

**Root**: `RealMap` (Leaflet WebView + Carto dark tiles; path, markers, taps resolved in RN; `forwardRef` handle `flyTo` for the GPS button; framing = path stretch within `BAND_LON_SPAN` degrees of longitude around the spot), `SpotSelector` (text or `lat, lon` search, sections with batched clouds — including the curated `suggested_spots` from RC, filtered to those inside the active eclipse's band and hidden when none qualify), `SpotEclipses` ("eclipses from here" modal, opened from the map sheet; jumping keeps the current spot), `TabBar`, `Countdown` (own 1 s tick, isolated from the tree), `theme.ts` (`C` palette + `F` fonts).

**Hooks**: `useGeo` (one-shot GPS: last known → fresh fix, race-safe geocoder), `usePrefs` (load/save + language + eclipse selection), `useSheet` (draggable sheet with `Animated` + `PanResponder`), `useSpotData` (clouds + totality + projected GPS).

## Persistence

| Key | Contents |
|---|---|
| `eclipsum:prefs` (AsyncStorage) | language, sound, and per eclipse civil day: spot, active alerts, recents |
| `eclipsum:clouds:v3:{day}:{lat},{lon}` | cached cloud cover (old entries pruned) |
| Remote Config native cache | last activated values persist offline |

## Remote data (Remote Config)

9 string parameters — full table and operations in the [README](../README.md#remote-config-remoteconfigtemplatejson). The client ships baked-in defaults (`lib/firebase.ts`), so the app is functional without ever having contacted Firebase.
