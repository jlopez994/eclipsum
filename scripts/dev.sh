#!/bin/bash
# Levanta el entorno de pruebas completo: emulador + app + Metro.
# Uso: npm run dev   (Ctrl+C para parar Metro; el emulador queda abierto)
set -e
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
AVD="${AVD:-Medium_Phone_API_36.1}"
PKG="com.jlopez.eclipsum"

# 1. Emulador (si no hay dispositivo ya conectado)
if ! adb devices | grep -q "device$"; then
  echo "▶ Arrancando emulador $AVD…"
  "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-snapshot-save -no-audio >/dev/null 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
  # GPS simulado (Madrid) para que la app tenga posición
  adb emu geo fix -3.7038 40.4168 || true
fi

# 2. App instalada? Si falta, compila e instala (esto ya arranca Metro y termina aquí)
if ! adb shell pm list packages | grep -q "$PKG"; then
  echo "▶ App no instalada: compilando (tarda unos minutos)…"
  exec npx expo run:android
fi

# 3. Relanzar app y arrancar Metro en primer plano (r = recargar, j = devtools)
adb shell am force-stop "$PKG"
(sleep 6 && adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1) &
exec npx expo start
