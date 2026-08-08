import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EclipseEvent } from './eclipse';
import type { Spot } from './spots';

export type AlertToggles = Record<EclipseEvent['key'], boolean>;

export interface Prefs {
  alertsOn: AlertToggles;
  /** Puesto de observación deseado; null solo hasta la 1ª elección / siembra GPS */
  spot: Spot | null;
  /** Últimos puestos elegidos (más reciente primero), máx. RECENT_CAP */
  recentSpots: Spot[];
}

const KEY = 'eclipsum:prefs';
export const RECENT_CAP = 8;

export const DEFAULT_PREFS: Prefs = {
  alertsOn: { C1: true, C2: true, MAX: true, C3: true, C4: true },
  spot: null,
  recentSpots: [],
};

function sameCoords(a: Spot, b: Spot): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

/** Prepende un spot al historial, dedupe por coords, tope RECENT_CAP. */
export function pushRecent(recent: Spot[], spot: Spot): Spot[] {
  const rest = recent.filter((r) => !sameCoords(r, spot));
  return [spot, ...rest].slice(0, RECENT_CAP);
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const recentSpots = Array.isArray(parsed.recentSpots)
      ? parsed.recentSpots.filter(
          (s): s is Spot =>
            !!s &&
            typeof s.name === 'string' &&
            typeof s.lat === 'number' &&
            typeof s.lon === 'number' &&
            typeof s.origin === 'string',
        )
      : [];
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      alertsOn: { ...DEFAULT_PREFS.alertsOn, ...(parsed.alertsOn ?? {}) },
      recentSpots,
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
