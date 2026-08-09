import { useCallback, useEffect, useState } from 'react';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';

/** Prefs persistidas: null mientras cargan del disco; update guarda en background. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
  }, []);

  const update = useCallback((next: Prefs) => {
    setPrefs(next);
    void savePrefs(next);
  }, []);

  return { prefs, update };
}
