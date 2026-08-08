#!/bin/bash
# Cambia el banner remoto de la app (Remote Config) sin pasar por la consola.
# Uso:
#   npm run mensaje -- "Nubes en el norte: revisa el pronóstico"
#   npm run mensaje -- ""        ← banner oculto
set -e
MSG="${1-}"

node -e "
const fs = require('fs');
const t = JSON.parse(fs.readFileSync('remoteconfig.template.json', 'utf8'));
t.parameters.eclipse_message.defaultValue.value = process.argv[1];
fs.writeFileSync('remoteconfig.template.json', JSON.stringify(t, null, 2) + '\n');
" "$MSG"

firebase deploy --only remoteconfig --project eclipsum-app-jl

if [ -z "$MSG" ]; then
  echo "✅ Banner OCULTO (valor vacío publicado)"
else
  echo "✅ Banner publicado: \"$MSG\""
fi
echo "La app lo recoge al volver a primer plano (caché 0 en fase de pruebas)."
