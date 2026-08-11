#!/bin/bash
# Publica una build vía GitHub Actions (release-apk.yml).
#
#   npm run release [-- <vc>]   ESTABLE: Release b<vc> (asset fijo eclipsum.apk)
#                               + aviso de actualización en RC
#   npm run beta    [-- <vc>]   BETA: pre-release b<vc>, sin tocar
#                               releases/latest ni avisar a usuarios
#
# Identidad única = expo.android.versionCode (monótono); expo.version se
# deriva de él (b<vc> / b<vc>-beta), nunca se edita a mano.
set -e
MODE="${1:?uso: release.sh stable|beta [versionCode]}"
[ "$MODE" = "stable" ] || [ "$MODE" = "beta" ] || { echo "ERROR: modo «$MODE» (stable|beta)"; exit 1; }

[ -z "$(git status --porcelain)" ] || { echo "ERROR: árbol sucio — commitea o stashea antes"; exit 1; }
BRANCH=$(git branch --show-current)
[ "$BRANCH" = "main" ] || { echo "ERROR: estás en «$BRANCH» — las releases salen de main"; exit 1; }
git pull --rebase origin main

CUR=$(node -p "require('./app.json').expo.android.versionCode")
VC=${2:-$((CUR + 1))}
[ "$VC" -gt "$CUR" ] 2>/dev/null || { echo "ERROR: versionCode $VC no es mayor que el actual ($CUR)"; exit 1; }

# La versión ES el build: b<vc> estable, b<vc>-beta en canal beta (el workflow
# detecta «beta» para publicar pre-release). Nadie la edita a mano.
node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('app.json', 'utf8'));
a.expo.version = '$MODE' === 'beta' ? 'b' + $VC + '-beta' : 'b' + $VC;
a.expo.android.versionCode = $VC;
fs.writeFileSync('app.json', JSON.stringify(a, null, 2) + '\n');
"
V=$(node -p "require('./app.json').expo.version")
git add app.json
git commit -m "chore(release): build $VC ($V)"
git push origin main

echo ""
echo "build $VC ($V, $MODE) empujada — Actions compila y publica (~15 min)"
echo "Seguir el run:     gh run watch \$(gh run list --workflow=release-apk --limit 1 --json databaseId -q '.[0].databaseId')"
echo "Release al acabar: https://github.com/jlopez994/eclipsum/releases/tag/b$VC"
[ "$MODE" = "beta" ] && echo "Beta: descarga desde la página de la release (pre-release; el canal estable no se entera)"
