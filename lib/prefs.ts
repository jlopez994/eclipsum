import AsyncStorage from '@react-native-async-storage/async-storage';
import { clampDrill, DEFAULT_DRILL, type DrillConfig } from './drill';
import type { EclipseEvent } from './eclipse';
import type { Lang } from './i18n';
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

/** Estado propio de cada eclipse: puesto elegido y configuración de avisos. */
export interface EclipseContext {
  /** Puesto de observación deseado; null hasta la 1ª elección / siembra GPS */
  spot: Spot | null;
  alertsOn: AlertToggles;
  /** Aviso unos segundos antes del contacto (por hito) */
  alertEarly: AlertEarly;
  /** Avisos opcionales de planificación ligados a C1 (apagados por defecto) */
  c1PlanAlerts: C1PlanAlerts;
}

export interface Prefs {
  /** Día civil (YYYY-MM-DD) del eclipse elegido; '' = automático (el más próximo) */
  selectedEclipseDay: string;
  /**
   * Contexto por eclipse, clave = día civil (los ids varían entre catálogo y motor);
   * los pasados se conservan como histórico
   */
  byEclipse: Record<string, EclipseContext>;
  /** Puestos habituales globales (más visitados primero), máx. RECENT_CAP */
  recentSpots: RecentSpot[];
  /** Audio de las notificaciones locales */
  alertSound: AlertSound;
  /** Tramos del modo simulacro */
  drill: DrillConfig;
  /** Idioma de la app; '' = automático (el del sistema) */
  language: Lang | '';
  /**
   * Aperturas en frío contadas para el aviso de donación.
   * DONATE_PROMPT_DONE = resuelto (donó o lo descartó): no se vuelve a mostrar.
   */
  donateOpens: number;
}

/** Centinela de `donateOpens`: el aviso ya no volverá a aparecer */
export const DONATE_PROMPT_DONE = -1;
/** Aperturas antes de sugerir la donación: primero utilidad, luego la petición */
export const DONATE_PROMPT_AFTER = 8;

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

// Constante compartida (nunca se muta: withContext/parseContext solo hacen spread);
// identidad estable → los efectos que dependen del contexto no se disparan de más
const DEFAULT_ECLIPSE_CONTEXT: EclipseContext = {
  spot: null,
  alertsOn: { C1: true, C2: true, MAX: true, C3: true, C4: true },
  alertEarly: DEFAULT_ALERT_EARLY,
  c1PlanAlerts: DEFAULT_C1_PLAN_ALERTS,
};

export const DEFAULT_PREFS: Prefs = {
  selectedEclipseDay: '',
  byEclipse: {},
  recentSpots: [],
  alertSound: 'eclipse',
  drill: { ...DEFAULT_DRILL },
  language: '',
  donateOpens: 0,
};

/** Contexto del eclipse con día civil `day`; defaults si aún no tiene nada guardado. */
export function contextFor(prefs: Prefs, day: string): EclipseContext {
  return prefs.byEclipse[day] ?? DEFAULT_ECLIPSE_CONTEXT;
}

/** Copia de prefs con el contexto del día `day` parcheado. */
export function withContext(prefs: Prefs, day: string, patch: Partial<EclipseContext>): Prefs {
  return {
    ...prefs,
    byEclipse: { ...prefs.byEclipse, [day]: { ...contextFor(prefs, day), ...patch } },
  };
}

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

const SPOT_ORIGINS: Spot['origin'][] = ['gps', 'city', 'nearest', 'manual'];

function parseSpot(raw: unknown): Spot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.name !== 'string' || typeof s.lat !== 'number' || typeof s.lon !== 'number') return null;
  if (!SPOT_ORIGINS.includes(s.origin as Spot['origin'])) return null;
  return { name: s.name, lat: s.lat, lon: s.lon, origin: s.origin as Spot['origin'] };
}

/** Sanea un contexto guardado (o los campos planos legacy pasando el objeto raíz). */
function parseContext(raw: unknown, legacyLeads?: unknown): EclipseContext {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    spot: parseSpot(src.spot),
    alertsOn: {
      ...DEFAULT_ECLIPSE_CONTEXT.alertsOn,
      ...(src.alertsOn && typeof src.alertsOn === 'object' ? (src.alertsOn as Partial<AlertToggles>) : {}),
    },
    alertEarly: parseAlertEarly(src.alertEarly, legacyLeads),
    c1PlanAlerts: parseC1PlanAlerts(src.c1PlanAlerts),
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

/** `migrationDay`: día civil del eclipse activo, bajo el que migrar prefs planas legacy. */
export async function loadPrefs(migrationDay: string): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const recentSpots = Array.isArray(parsed.recentSpots)
      ? (parsed.recentSpots as unknown[])
          .map((s) => {
            const spot = parseSpot(s);
            if (!spot) return null;
            // Migración desde listas sin contador: cada entrada vale 1 visita
            const visits = (s as { visits?: unknown }).visits;
            return { ...spot, visits: typeof visits === 'number' ? visits : 1 };
          })
          .filter((s): s is RecentSpot => s !== null)
          .slice(0, RECENT_CAP)
      : [];
    const byEclipse: Record<string, EclipseContext> = {};
    if (parsed.byEclipse && typeof parsed.byEclipse === 'object') {
      for (const [day, ctx] of Object.entries(parsed.byEclipse as Record<string, unknown>)) {
        byEclipse[day] = parseContext(ctx);
      }
    } else {
      // Migración: prefs planas (una sola configuración) → contexto del eclipse activo
      byEclipse[migrationDay] = parseContext(parsed, parsed.alertLeads);
    }
    return {
      selectedEclipseDay: typeof parsed.selectedEclipseDay === 'string' ? parsed.selectedEclipseDay : '',
      byEclipse,
      recentSpots,
      alertSound: parsed.alertSound === 'default' ? 'default' : 'eclipse',
      drill: clampDrill(parsed.drill),
      language: parsed.language === 'es' || parsed.language === 'en' ? parsed.language : '',
      donateOpens: typeof parsed.donateOpens === 'number' ? parsed.donateOpens : 0,
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
