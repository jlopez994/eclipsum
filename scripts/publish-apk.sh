#!/bin/bash
# Publica la APK release en el DAS (la CDN apunta ahí). Tolerante: sin volumen no falla.
set -e
APK="android/app/build/outputs/apk/release/app-release.apk"
DEST="/Volumes/DAS/s3/eclipsum"

echo "APK: $APK"
if [ -d "/Volumes/DAS/s3" ]; then
  mkdir -p "$DEST"
  cp "$APK" "$DEST/eclipsum.apk"
  echo "Subida a CDN: $DEST/eclipsum.apk"
else
  echo "AVISO: /Volumes/DAS no montado — APK solo en local"
fi
