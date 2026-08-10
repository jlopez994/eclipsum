import AsyncStorage from '@react-native-async-storage/async-storage';
import { clampDrill, DEFAULT_DRILL, type DrillConfig } from './drill';
import type { EclipseEvent } from './eclipse';
import type { Spot } from './spots';

export type AlertToggles = Record<EclipseEvent['key'], boolean>;

/**
 * Si true, el aviso del contacto salta unos segundos antes (margen práctico).
 * Si false, en el instante del contacto.
 */
export type AlertEarly = Record<EclipseEvent['key'], boolean>;

/** Margen fijo cuando `alertEarly` está activo. */
export const ALERT_EARLY_SECONDS = 15;

/** Sonido de alerta: el WAV propio de la app, o el tono por defecto del sistema. */
export type AlertSound = 'eclipse' | 'default';

/** Avisos de planificación opcionales antes de C1 (independientes del anticipo del contacto). */
export interface C1PlanAlerts {
  before24h: boolean;
  before1h: boolean;
}

export interface RecentSpot extends Spot {
  /** Veces que se ha elegido este puesto */
  visits: number;
}

export interface Prefs {
  alertsOn: AlertToggles;
  /** Aviso unos segundos antes del contacto (por hito) */
  alertEarly: AlertEarly;
  /** Avisos opcionales de planificación ligados a C1 (apagados por defecto) */
  c1PlanAlerts: C1PlanAlerts;
  /** Puesto de observación deseado; null solo hasta la 1ª elección / siembra GPS */
  spot: Spot | null;
  /** Puestos habituales (más visitados primero), máx. RECENT_CAP */
  recentSpots: RecentSpot[];
  /** Vista de la pestaña mapa: diagrama esquemático o mapa real */
  mapView: 'diagram' | 'real';
  /** Audio de las notificaciones locales */
  alertSound: AlertSound;
  /** Tramos del modo simulacro */
  drill: DrillConfig;
}

const KEY = 'eclipsum:prefs';
export const RECENT_CAP = 3;

export const DEFAULT_ALERT_EARLY: AlertEarly = {
  C1: false,
  C2: false,
  MAX: false,
  C3: false,
  C4: false,
};

export const DEFAULT_C1_PLAN_ALERTS: C1PlanAlerts = {
  before24h: false,
  before1h: false,
};

export const DEFAULT_PREFS: Prefs = {
  alertsOn: { C1: true, C2: true, MAX: true, C3: true, C4: true },
  alertEarly: { ...DEFAULT_ALERT_EARLY },
  c1PlanAlerts: { ...DEFAULT_C1_PLAN_ALERTS },
  spot: null,
  recentSpots: [],
  mapView: 'diagram',
  alertSound: 'eclipse',
  drill: { ...DEFAULT_DRILL },
};

function parseAlertEarly(raw: unknown, legacyLeads: unknown): AlertEarly {
  if (raw && typeof raw === 'object') {
    const src = raw as Partial<AlertEarly>;
    return {
      C1: src.C1 === true,
      C2: src.C2 === true,
      MAX: src.MAX === true,
      C3: src.C3 === true,
      C4: src.C4 === true,
    };
  }
  // Migración desde anticipos en minutos: cualquier valor > 0 → margen de segundos
  if (legacyLeads && typeof legacyLeads === 'object') {
    const src = legacyLeads as Record<string, unknown>;
    const wasEarly = (k: string) => typeof src[k] === 'number' && (src[k] as number) > 0;
    return {
      C1: wasEarly('C1'),
      C2: wasEarly('C2'),
      MAX: wasEarly('MAX'),
      C3: wasEarly('C3'),
      C4: wasEarly('C4'),
    };
  }
  return { ...DEFAULT_ALERT_EARLY };
}

function parseC1PlanAlerts(raw: unknown): C1PlanAlerts {
  const src = raw && typeof raw === 'object' ? (raw as Partial<C1PlanAlerts>) : {};
  return {
    before24h: src.before24h === true,
    before1h: src.before1h === true,
  };
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
    const parsed = JSON.parse(raw) as Partial<Prefs> & { alertLeads?: unknown };
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
    const { alertLeads: _legacyLeads, ...parsedRest } = parsed as Partial<Prefs> & {
      alertLeads?: unknown;
    };
    return {
      ...DEFAULT_PREFS,
      ...parsedRest,
      alertsOn: { ...DEFAULT_PREFS.alertsOn, ...(parsed.alertsOn ?? {}) },
      alertEarly: parseAlertEarly(parsed.alertEarly, _legacyLeads),
      c1PlanAlerts: parseC1PlanAlerts(parsed.c1PlanAlerts),
      recentSpots,
      mapView: parsed.mapView === 'real' ? 'real' : 'diagram',
      alertSound: parsed.alertSound === 'default' ? 'default' : 'eclipse',
      drill: clampDrill(parsed.drill),
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
