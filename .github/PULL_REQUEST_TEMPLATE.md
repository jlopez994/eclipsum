## What changes

<!-- One sentence per change. Link the issue if it exists: Fixes #N -->

## How it was tested

- [ ] `npm run typecheck` passes
- [ ] `npm run selfcheck` passes
- [ ] Tested on device/emulator (say which)

## Checklist

- [ ] `lib/{eclipse,totality,spots,prefs,weather,eclipseCatalog}.ts` still have no react-native imports (selfcheck runs in Node)
- [ ] Whatever must work offline still works offline (network errors degrade, never break)
- [ ] No secrets or credentials in the diff
- [ ] If the Remote Config schema changes: `remoteconfig.template.json` updated (descriptions ≤256 chars)
