import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EclipseEvent } from './eclipse';
import type { Spot } from './spots';

export type AlertToggles = Record<EclipseEvent['key'], boolean>;

/** Minutos de anticipo del aviso principal de cada contacto (0 = en el instante). */
export type AlertLeads = Record<EclipseEvent['key'], number>;

/** Sonido de alerta: el WAV propio de la app, o el tono por defecto del sistema. */
export type AlertSound = 'eclipse' | 'default';

export interface RecentSpot extends Spot {
  /** Veces que se ha elegido este puesto */
  visits: number;
}

export interface Prefs {
  alertsOn: AlertToggles;
  /** Anticipo en minutos del aviso principal por contacto */
  alertLeads: AlertLeads;
  /** Puesto de observación deseado; null solo hasta la 1ª elección / siembra GPS */
  spot: Spot | null;
  /** Puestos habituales (más visitados primero), máx. RECENT_CAP */
  recentSpots: RecentSpot[];
  /** Vista de la pestaña mapa: diagrama esquemático o mapa real */
  mapView: 'diagram' | 'real';
  /** Audio de las notificaciones locales */
  alertSound: AlertSound;
}

const KEY = 'eclipsum:prefs';
export const RECENT_CAP = 3;

/** Presets al tocar el chip de anticipo en Alertas. */
export const ALERT_LEAD_PRESETS = [0, 1, 2, 5, 10, 15, 30, 60] as const;

export const DEFAULT_ALERT_LEADS: AlertLeads = {
  C1: 0,
  C2: 0,
  MAX: 0,
  C3: 0,
  C4: 0,
};

export const DEFAULT_PREFS: Prefs = {
  alertsOn: { C1: true, C2: true, MAX: true, C3: true, C4: true },
  alertLeads: { ...DEFAULT_ALERT_LEADS },
  spot: null,
  recentSpots: [],
  mapView: 'diagram',
  alertSound: 'eclipse',
};

function clampLead(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(24 * 60, Math.round(n));
}

function parseAlertLeads(raw: unknown): AlertLeads {
  const src = raw && typeof raw === 'object' ? (raw as Partial<AlertLeads>) : {};
  const leads: AlertLeads = {
    C1: clampLead(src.C1 ?? DEFAULT_ALERT_LEADS.C1),
    C2: clampLead(src.C2 ?? DEFAULT_ALERT_LEADS.C2),
    MAX: clampLead(src.MAX ?? DEFAULT_ALERT_LEADS.MAX),
    C3: clampLead(src.C3 ?? DEFAULT_ALERT_LEADS.C3),
    C4: clampLead(src.C4 ?? DEFAULT_ALERT_LEADS.C4),
  };
  // Migración: defaults antiguos (10/2/1) → aviso en el contacto
  if (leads.C1 === 10 && leads.C2 === 2 && leads.MAX === 1 && leads.C3 === 0 && leads.C4 === 0) {
    return { ...DEFAULT_ALERT_LEADS };
  }
  return leads;
}

/** Siguiente preset de anticipo (ciclo). */
export function nextAlertLead(current: number): number {
  const list = ALERT_LEAD_PRESETS as readonly number[];
  const i = list.indexOf(current);
  if (i < 0) {
    const greater = list.find((p) => p > current);
    return greater ?? list[0];
  }
  return list[(i + 1) % list.length];
}

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
      alertLeads: parseAlertLeads(parsed.alertLeads),
      recentSpots,
      mapView: parsed.mapView === 'real' ? 'real' : 'diagram',
      alertSound: parsed.alertSound === 'default' ? 'default' : 'eclipse',
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
