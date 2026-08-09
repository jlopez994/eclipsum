#!/bin/bash
# Publica la APK release en el DAS (la CDN apunta ahí). Tolerante: sin volumen no falla.
# Deja histórico versionado y actualiza eclipsum.apk como «latest».
set -e
APK="android/app/build/outputs/apk/release/app-release.apk"
DEST="/Volumes/DAS/s3/eclipsum"
VERSION="$(node -p "require('./app.json').expo.version" 2>/dev/null || echo "0.0.0")"
STAMP="$(date +%Y%m%d-%H%M)"
NAMED="eclipsum-${VERSION}-${STAMP}.apk"
# Canal beta aparte: no pisar el «latest» estable que usa la gente el día del eclipse
case "$VERSION" in
  *beta*|*rc*) LATEST="eclipsum-beta.apk" ;;
  *) LATEST="eclipsum.apk" ;;
esac

echo "APK: $APK"
if [ ! -f "$APK" ]; then
  echo "ERROR: no existe $APK — ejecuta el assembleRelease antes"
  exit 1
fi

if [ -d "/Volumes/DAS/s3" ]; then
  mkdir -p "$DEST"
  cp "$APK" "$DEST/$NAMED"
  cp "$APK" "$DEST/$LATEST"
  echo "Subida (histórico): $DEST/$NAMED"
  echo "Subida (latest):    $DEST/$LATEST"
  VC="$(node -p "require('./app.json').expo.android?.versionCode ?? 1" 2>/dev/null || echo "?")"
  echo ""
  echo "Para avisar de la actualización en la app, publica en Remote Config:"
  echo "  latest_version_code = $VC"
  echo "  latest_apk_url      = https://cdn.jlh.app/eclipsum/$LATEST"
else
  echo "AVISO: /Volumes/DAS no montado — APK solo en local"
  echo "Nombre previsto: $NAMED"
fi
