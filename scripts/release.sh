#!/bin/bash
# Despliega una build: sube expo.android.versionCode, commitea y pushea a main.
# GitHub Actions (release-apk.yml) hace el resto: selfcheck+typecheck → APK →
# Release b<vc> → aviso de actualización en Remote Config.
#
# Uso: npm run release            versionCode actual + 1
#      npm run release -- 25      versionCode explícito (debe ser mayor)
set -e

[ -z "$(git status --porcelain)" ] || { echo "ERROR: árbol sucio — commitea o stashea antes"; exit 1; }
BRANCH=$(git branch --show-current)
[ "$BRANCH" = "main" ] || { echo "ERROR: estás en «$BRANCH» — las releases salen de main"; exit 1; }
git pull --rebase origin main

CUR=$(node -p "require('./app.json').expo.android.versionCode")
VC=${1:-$((CUR + 1))}
[ "$VC" -gt "$CUR" ] 2>/dev/null || { echo "ERROR: versionCode $VC no es mayor que el actual ($CUR)"; exit 1; }

node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('app.json', 'utf8'));
a.expo.android.versionCode = $VC;
fs.writeFileSync('app.json', JSON.stringify(a, null, 2) + '\n');
"
git add app.json
git commit -m "chore(release): build $VC"
git push origin main

VERSION=$(node -p "require('./app.json').expo.version")
echo ""
echo "build $VC ($VERSION) empujada — Actions compila y publica (~15 min)"
echo "Seguir el run:   gh run watch \$(gh run list --workflow=release-apk --limit 1 --json databaseId -q '.[0].databaseId')"
echo "Release al acabar: https://github.com/jlopez994/eclipsum/releases/tag/b$VC"
