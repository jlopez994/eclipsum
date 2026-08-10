import { useCallback, useEffect, useState } from 'react';
import { getActiveEclipse, setUserSelectedEclipseDay } from '../lib/eclipseCatalog';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';

/**
 * Prefs persistidas: null mientras cargan del disco; update guarda en background.
 * La selección de eclipse se aplica al catálogo ANTES de exponer prefs: cualquier
 * render posterior ya ve el eclipse elegido en getActiveEclipse.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    void loadPrefs(getActiveEclipse().civilDate).then((p) => {
      setUserSelectedEclipseDay(p.selectedEclipseDay);
      setPrefs(p);
    });
  }, []);

  const update = useCallback((next: Prefs) => {
    setUserSelectedEclipseDay(next.selectedEclipseDay);
    setPrefs(next);
    void savePrefs(next);
  }, []);

  return { prefs, update };
}
