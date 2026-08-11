import { useCallback, useEffect, useState } from 'react';
import { getLocales } from 'expo-localization';
import { getActiveEclipse, setUserSelectedEclipseDay } from '../lib/eclipseCatalog';
import { setLang, type Lang } from '../lib/i18n';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';

/** '' = automático: es si el sistema está en español, en para el resto. */
function resolveLang(pref: Lang | ''): Lang {
  if (pref) return pref;
  return getLocales()[0]?.languageCode === 'es' ? 'es' : 'en';
}

/**
 * Prefs persistidas: null mientras cargan del disco; update guarda en background.
 * Selección de eclipse E idioma se aplican ANTES de exponer prefs: cualquier
 * render posterior ya ve el eclipse elegido y los textos en el idioma correcto.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    void loadPrefs(getActiveEclipse().civilDate).then((p) => {
      // Idioma primero: la resolución del eclipse hornea labels con getLang()
      setLang(resolveLang(p.language));
      setUserSelectedEclipseDay(p.selectedEclipseDay);
      setPrefs(p);
    });
  }, []);

  const update = useCallback((next: Prefs) => {
    setLang(resolveLang(next.language));
    setUserSelectedEclipseDay(next.selectedEclipseDay);
    setPrefs(next);
    void savePrefs(next);
  }, []);

  return { prefs, update };
}
