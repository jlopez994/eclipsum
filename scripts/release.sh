#!/bin/bash
# Publica una build vía GitHub Actions (release-apk.yml).
#
#   npm run release [-- <vc>]   ESTABLE: version sin sufijo → Release b<vc>
#                               (asset fijo eclipsum.apk) + aviso de actualización en RC
#   npm run beta    [-- <vc>]   BETA: version <base>-beta.<vc> → pre-release,
#                               sin tocar releases/latest ni avisar a usuarios
#
# La identidad de build es siempre expo.android.versionCode (monótono).
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

node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const base = a.expo.version.replace(/-(beta|rc)[^ ]*$/, '');
a.expo.version = '$MODE' === 'beta' ? base + '-beta.' + $VC : base;
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
