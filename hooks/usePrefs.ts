import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocales } from 'expo-localization';
import { getActiveEclipse, setUserSelectedEclipseDay } from '../lib/eclipseCatalog';
import { setLang, type Lang } from '../lib/i18n';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';

/** '' = automático: es si el sistema está en español, en para el resto. */
function resolveLang(pref: Lang | ''): Lang {
  if (pref) return pref;
  return getLocales()[0]?.languageCode === 'es' ? 'es' : 'en';
}

/** Parche de prefs: objeto completo, o función que lo deriva del valor MÁS RECIENTE. */
export type PrefsUpdate = Prefs | ((prev: Prefs) => Prefs);

/**
 * Prefs persistidas: null mientras cargan del disco; update guarda en background.
 * Selección de eclipse E idioma se aplican ANTES de exponer prefs: cualquier
 * render posterior ya ve el eclipse elegido y los textos en el idioma correcto.
 *
 * `update` acepta forma funcional para las escrituras que nacen de un valor viejo:
 * dos efectos del mismo commit —o una escritura tras esperar al geocoder— derivaban
 * ambas del `prefs` de SU render y la última pisaba a la primera. El espejo en ref
 * resuelve el parche de forma síncrona sin meter efectos dentro del updater de React
 * (StrictMode lo invoca dos veces) ni romper la invariante de arriba.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const latest = useRef<Prefs | null>(null);

  const apply = useCallback((next: Prefs) => {
    // Idioma primero: la resolución del eclipse hornea labels con getLang()
    setLang(resolveLang(next.language));
    setUserSelectedEclipseDay(next.selectedEclipseDay, next.selectedEclipsePast);
    latest.current = next;
    setPrefs(next);
  }, []);

  useEffect(() => {
    void loadPrefs(getActiveEclipse().civilDate).then(apply);
  }, [apply]);

  const update = useCallback(
    (patch: PrefsUpdate) => {
      // Sin base cargada no hay nada que parchear (el llamante funcional se descarta solo)
      const next = typeof patch === 'function' ? (latest.current ? patch(latest.current) : null) : patch;
      if (!next) return;
      apply(next);
      void savePrefs(next);
    },
    [apply],
  );

  return { prefs, update };
}
