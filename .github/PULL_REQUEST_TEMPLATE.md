## Qué cambia

<!-- Una frase por cambio. Enlaza el issue si existe: Fixes #N -->

## Cómo se ha probado

- [ ] `npm run typecheck` pasa
- [ ] `npm run selfcheck` pasa
- [ ] Probado en dispositivo/emulador (indica cuál)

## Checklist

- [ ] `lib/{eclipse,totality,spots,prefs,weather,eclipseCatalog}.ts` siguen sin imports de react-native (selfcheck corre en Node)
- [ ] Lo que deba funcionar offline sigue funcionando offline (errores de red degradan, no rompen)
- [ ] Sin secretos ni credenciales en el diff
- [ ] Si cambia el esquema de Remote Config: `remoteconfig.template.json` actualizado (descripciones ≤256 chars)
