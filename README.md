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
- **Multi-eclipse**: catálogo ampliable por Remote Config sin publicar release; cada eclipse guarda su puesto y alertas. Agotado el catálogo, la app autogenera el siguiente eclipse global con el motor.

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
components/
  screens/               MapScreen, AlertsScreen, SettingsScreen, EclipseModeScreen
  map/                   Piezas visuales del mapa (CompassChip, HorizonDiagram, …)
  RealMap.tsx            WebView Leaflet (vendored en lib/leafletVendor.ts, sin CDN)
scripts/
  selfcheck.ts           Asserts del motor y catálogo en Node (puerta de CI)
  genEclipse.ts          Genera entradas de catálogo (--write fusiona en template RC)
  genBand.ts             Banda empaquetada por id → lib/bandGeo.ts
  syncBands.ts           Genera bandas que falten en el template RC
  publish-apk.sh         Sube APK a DAS/CDN + GitHub Release
```

Restricción: `lib/{eclipse,totality,spots,prefs,weather,eclipseCatalog}.ts` deben seguir libres de imports de react-native — `npm run selfcheck` los ejecuta en Node.

## Desarrollo

```bash
npm install
npm run dev          # expo start (scripts/dev.sh)
npm run typecheck    # tsc --noEmit
npm run selfcheck    # asserts de motor/catálogo/prefs en Node
```

Requisitos para compilar: `google-services.json` del proyecto Firebase en la raíz (no versionado) y Android Studio (se usa su JDK embebido; no hace falta JDK del sistema).

## Release

```bash
npm run apk          # prebuild + gradle release + publish-apk.sh
```

- **Identidad de build = `android.versionCode`** (monótono, nunca baja). La versión (`expo.version`) es la línea: `1.0.0` estable, `*-beta` canal beta. Release nueva = subir solo versionCode + `latest_version_code` en el template RC.
- `publish-apk.sh` copia la APK al DAS (`/Volumes/DAS/s3/eclipsum`, servido por `https://cdn.jlh.app/eclipsum/`): histórico `eclipsum-<versión>-b<vc>-<fecha>.apk` + `eclipsum.apk` (estable) o `eclipsum-beta.apk` (si la versión contiene beta/rc). También crea el **GitHub Release** `b<versionCode>` con la APK adjunta.
- **Actualizaciones sin tienda**: la app compara su versionCode con RC `latest_version_code` y muestra banner de descarga (`latest_apk_url`). Publicar: `npx firebase-tools deploy --only remoteconfig`.

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

## Seguridad ocular

La app avisa de los momentos exactos, pero la regla es una: **nunca mirar al sol sin gafas certificadas ISO 12312-2, salvo durante la totalidad**. Guía del IGN enlazada en Ajustes.
