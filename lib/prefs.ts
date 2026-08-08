import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EclipseEvent } from './eclipse';
import type { Spot } from './spots';

export type AlertToggles = Record<EclipseEvent['key'], boolean>;

export interface Prefs {
  useGps: boolean;
  manual: { lat: number; lon: number; name?: string } | null;
  alertsOn: AlertToggles;
  /** Puesto de observación activo; null = seguir al GPS */
  spot: Spot | null;
}

const KEY = 'eclipsum:prefs';

export const DEFAULT_PREFS: Prefs = {
  useGps: true,
  manual: null,
  alertsOn: { C1: true, C2: true, MAX: true, C3: true, C4: true },
  spot: null,
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      alertsOn: { ...DEFAULT_PREFS.alertsOn, ...(parsed.alertsOn ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // preferencias no críticas: la app funciona con defaults
  }
}
