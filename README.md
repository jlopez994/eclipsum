# Eclipsum

App Android (Expo / React Native) para vivir eclipses solares: horarios exactos de los contactos en tu ubicación, mapa con la banda de totalidad, alertas locales y un modo eclipse a pantalla completa que te dice cuándo ponerte y quitarte las gafas.

Primer objetivo: el eclipse solar **total del 12 de agosto de 2026** (norte y centro de la península). Estado: **1.0.0 estable**, distribuida como APK directa (sin Play Store).

## Qué hace

- **Cálculo 100 % local** con [astronomy-engine](https://github.com/cosinekitty/astronomy): contactos C1–C4, máximo, obscuración, duración de totalidad y ocaso para cualquier coordenada. Sin backend.
- **Mapa** en dos vistas: diagrama esquemático y mapa real (Leaflet embebido + tiles Carto). Tocar un punto muestra sus circunstancias y permite fijarlo como puesto de observación.
- **Totalidad más cercana**: si el puesto queda fuera de la banda, distancia, rumbo y duración en destino (bisección sobre 8 rumbos, tope 700 km).
- **Alertas locales** (`expo-notifications`, sin red): aviso exacto por contacto, aviso previo opcional, recordatorios 24 h/1 h, y marca «tras el ocaso» en contactos sin sol. Sonido propio o del sistema.
- **Modo eclipse**: pantalla de evento automática en la ventana del eclipse (cuenta atrás, fase, banner GAFAS/SIN GAFAS, pantalla siempre encendida). Incluye **simulacro** configurable para ensayar con notificaciones reales.
- **Nubosidad** a la hora del máximo vía Open-Meteo (modelo ECMWF, el mismo que pinta Windy — el chip enlaza allí), con caché offline por día y coordenada.
- **Multi-eclipse**: el motor autocompleta siempre la lista de próximos eclipses globales; el catálogo (empaquetado + Remote Config) cura labels y bandas por encima, sin publicar release. Cada eclipse guarda su puesto y alertas.
- **Bilingüe es/en**: idioma automático por sistema (español → es, resto → en) o forzado en Ajustes. Los textos de las notificaciones se hornean en el idioma activo al programarlas.

## Offline vs red

| Función | Sin conexión |
|---|---|
| Horarios, fases, alertas, diagrama, simulacro | ✅ todo local |
| Banda en mapa real (datos) | ✅ empaquetada o RC ya activado |
| Tiles del mapa real | ❌ (fondo gris, banda y puntos se pintan igual) |
| Nubes | ✅ última descarga cacheada (marca `· Xh`) |
| Buscador de lugares / geocoder | ❌ (fallback a coordenadas) |
| Remote Config | ✅ últimos valores activados persisten |

## Estructura

```
App.tsx                  Estado raíz: eclipse activo, permisos, RC, drill, tabs
lib/
  eclipse.ts             Circunstancias locales (memoizado) — SIN imports de react-native
  eclipseCatalog.ts      Catálogo (empaquetado + RC + autogenerado), eclipse activo
  totality.ts            Totalidad más cercana, haversine, rumbos
  bandGeo.ts             Bandas empaquetadas (generado por scripts/genBand.ts)
  notifications.ts       Alertas locales (cola serializada, canales Android)
  weather.ts             Open-Meteo ECMWF + caché AsyncStorage
  prefs.ts               Preferencias persistidas, contexto por eclipse
  firebase.ts            Remote Config + Analytics + Crashlytics (best-effort)
  drill.ts               Eclipse sintético del simulacro
  i18n.ts                Diccionario es/en, t(), sin dependencias
  spots.ts               Tipos Spot/SpotOption
  maps.ts / anim.ts / soundPreview.ts / leafletVendor.ts
hooks/
  useGeo.ts              GPS one-shot + geocoder inverso
  usePrefs.ts            Carga/guarda prefs, resuelve idioma
  useSheet.ts            Hoja inferior arrastrable
  useSpotData.ts         Nubes + totalidad cercana + punto GPS del puesto
components/
  screens/               MapScreen, AlertsScreen, SettingsScreen, EclipseModeScreen
  map/                   Piezas visuales del mapa (CompassChip, HorizonDiagram, …)
  RealMap.tsx            WebView Leaflet (vendored en lib/leafletVendor.ts, sin CDN)
  SpotSelector.tsx       Modal de puesto: buscador, habituales, nubes por lote
  Countdown.tsx / TabBar.tsx / theme.ts
scripts/
  selfcheck.ts           Asserts del motor y catálogo en Node (puerta de CI)
  genEclipse.ts          Genera entradas de catálogo (--write fusiona en template RC)
  genBand.ts             Banda empaquetada por id → lib/bandGeo.ts
  syncBands.ts           Genera bandas que falten en el template RC
  dev.sh / mensaje.sh    Emulador con GPS simulado / banner RC rápido
```

Restricción: `lib/{eclipse,totality,spots,prefs,weather,eclipseCatalog}.ts` deben seguir libres de imports de `react-native` — `npm run selfcheck` los ejecuta en Node (AsyncStorage se permite: su entry CJS carga en Node y el módulo nativo es diferido).

Detalle de módulos y flujos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Desarrollo

```bash
npm install
npm run dev          # expo start (scripts/dev.sh)
npm run typecheck    # tsc --noEmit
npm run selfcheck    # asserts de motor/catálogo/prefs en Node
```

Requisitos para compilar: `google-services.json` del proyecto Firebase en la raíz (el del repo apunta al proyecto original; para un fork, usa el de tu propio proyecto Firebase) y Android Studio (se usa su JDK embebido; no hace falta JDK del sistema).

## Release

El despliegue vive en **GitHub Actions** (`.github/workflows/release-apk.yml`): al llegar a main un `expo.android.versionCode` nuevo, compila la APK (con `selfcheck` + `typecheck` como puerta), crea el **GitHub Release** `b<versionCode>` y publica `latest_version_code` en Remote Config para que la app avise de la actualización.

- **Desplegar = bumpear versionCode** en `app.json` y pushear a main (`chore(release): build N`). Pushear código sin bump no publica nada (el guard ve que la release ya existe).
- **Identidad de build = `android.versionCode`** (monótono, nunca baja). La versión (`expo.version`) es la línea: `1.0.0` estable, `*-beta` canal beta (sale como pre-release: no pisa el estable ni toca RC).
- **URL estable de descarga**: `https://github.com/jlopez994/eclipsum/releases/latest/download/eclipsum.apk` — el asset se llama siempre igual, la URL no cambia entre releases.
- **Actualizaciones sin tienda**: la app compara su versionCode con RC `latest_version_code` y muestra banner de descarga (`latest_apk_url`).
- Build local (sin publicar): `npm run apk` → `android/app/build/outputs/apk/release/app-release.apk`.
- Secretos del workflow: `GOOGLE_SERVICES_JSON` (contenido del fichero) y `FIREBASE_SERVICE_ACCOUNT` (compartida con sync-remote-config).

## Remote Config (`remoteconfig.template.json`)

| Parámetro | Uso |
|---|---|
| `eclipse_message` | Banner superior; vacío = oculto |
| `active_eclipse_id` | Fuerza eclipse activo; vacío = el más próximo |
| `eclipse_catalog` | JSON de eclipses extra (con banda opcional `band`) sin release |
| `glasses_url` | Afiliado gafas ISO 12312-2; vacío = botón oculto |
| `sponsor` | `{"name","url","tagline"?}` patrocinador del eclipse activo |
| `latest_version_code` / `latest_apk_url` | Aviso de actualización in-app |

Descripciones de parámetros: máx. 256 caracteres (límite de RC).

## Pipeline autónomo de catálogo

`.github/workflows/sync-remote-config.yml` (mensual + manual): `genEclipse --write` → `syncBands` → `selfcheck` como puerta → publica RC con la service account (`FIREBASE_SERVICE_ACCOUNT`, rol Firebase Remote Config Admin = `roles/cloudconfig.admin`) → auto-commitea el template. Los eclipses nuevos llegan a la app sin tocar código ni publicar APK.

## Añadir un idioma

Los idiomas viven en un único fichero, `lib/i18n.ts`, y las contribuciones son bienvenidas:

1. Añade el código a `LANGS` (p. ej. `'fr'`).
2. Rellena su entrada en `LANG_META`: endónimo (`name`), etiqueta BCP-47 (`tag`), separador decimal y meses abreviados. El compilador obliga a completarla.
3. Copia el diccionario `en`, tradúcelo y regístralo en `DICTS`.
4. `npm run selfcheck` verifica la paridad de claves con `es` — si falta alguna, falla con su nombre.

El selector de Ajustes se genera solo a partir de `LANGS`; no hay que tocar UI. Contexto útil para traducir: los textos en MAYÚSCULAS son labels de interfaz compactos; los `notif.*` son notificaciones que el usuario lee sin la app abierta; C1–C4/MÁX son los contactos del eclipse (jerga estándar).

## Seguridad ocular

La app avisa de los momentos exactos, pero la regla es una: **nunca mirar al sol sin gafas certificadas ISO 12312-2, salvo durante la totalidad**. Guía del IGN enlazada en Ajustes.
