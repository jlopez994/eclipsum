import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EclipseEvent } from './eclipse';
import type { Spot } from './spots';

export type AlertToggles = Record<EclipseEvent['key'], boolean>;

export interface RecentSpot extends Spot {
  /** Veces que se ha elegido este puesto */
  visits: number;
}

export interface Prefs {
  alertsOn: AlertToggles;
  /** Puesto de observación deseado; null solo hasta la 1ª elección / siembra GPS */
  spot: Spot | null;
  /** Puestos habituales (más visitados primero), máx. RECENT_CAP */
  recentSpots: RecentSpot[];
  /** Vista de la pestaña mapa: diagrama esquemático o mapa real */
  mapView: 'diagram' | 'real';
}

const KEY = 'eclipsum:prefs';
export const RECENT_CAP = 3;

export const DEFAULT_PREFS: Prefs = {
  alertsOn: { C1: true, C2: true, MAX: true, C3: true, C4: true },
  spot: null,
  recentSpots: [],
  mapView: 'diagram',
};

function sameCoords(a: Spot, b: Spot): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

/**
 * Suma una visita al spot (dedupe por coords) y devuelve los RECENT_CAP más
 * visitados; a igualdad de visitas gana el más reciente (sort estable).
 */
export function pushRecent(recent: RecentSpot[], spot: Spot): RecentSpot[] {
  const prev = recent.find((r) => sameCoords(r, spot));
  const rest = recent.filter((r) => !sameCoords(r, spot));
  return [{ ...spot, visits: (prev?.visits ?? 0) + 1 }, ...rest]
    .sort((a, b) => b.visits - a.visits)
    .slice(0, RECENT_CAP);
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const recentSpots = Array.isArray(parsed.recentSpots)
      ? parsed.recentSpots
          .filter(
            (s): s is RecentSpot =>
              !!s &&
              typeof s.name === 'string' &&
              typeof s.lat === 'number' &&
              typeof s.lon === 'number' &&
              typeof s.origin === 'string',
          )
          // Migración desde listas sin contador: cada entrada vale 1 visita
          .map((s) => ({ ...s, visits: typeof s.visits === 'number' ? s.visits : 1 }))
          .slice(0, RECENT_CAP)
      : [];
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      alertsOn: { ...DEFAULT_PREFS.alertsOn, ...(parsed.alertsOn ?? {}) },
      recentSpots,
      mapView: parsed.mapView === 'real' ? 'real' : 'diagram',
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
