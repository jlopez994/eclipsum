import { Body, Equator, Horizon, Observer, SearchLocalSolarEclipse, SearchRiseSet } from 'astronomy-engine';
import { activeSearchStart, getActiveEclipse } from './eclipseCatalog';
// alias: este módulo ya usa `t` como variable de tiempo en currentPhase
import { t as i18n } from './i18n';

export interface EclipseEvent {
  key: 'C1' | 'C2' | 'MAX' | 'C3' | 'C4';
  label: string;
  time: Date;
  /** Altitud del sol en grados; <0 = bajo el horizonte */
  altitude: number;
  /** Azimut del sol en grados (0=N, 90=E, 180=S, 270=O) */
  azimuth: number;
}

export interface LocalEclipse {
  kind: 'partial' | 'annular' | 'total';
  /** Fracción del disco solar oculta en el máximo, 0..1 */
  obscuration: number;
  events: EclipseEvent[];
  totalityDurationSec: number | null;
  /** Ocaso del sol el día del eclipse; los contactos posteriores no son visibles */
  sunset: Date | null;
}

// Resultado determinista por coordenada y eclipse: memo evita recomputar (~10-30 ms por llamada)
const CACHE = new Map<string, LocalEclipse>();
const CACHE_MAX = 400;

export function computeLocalEclipse(
  lat: number,
  lon: number,
  elevationM = 0,
  searchStart: Date = activeSearchStart(),
): LocalEclipse {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${elevationM},${searchStart.getTime()}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const result = computeLocalEclipseUncached(lat, lon, elevationM, searchStart);
  if (CACHE.size >= CACHE_MAX) CACHE.clear(); // ponytail: reset simple; LRU si algún día hiciera falta
  CACHE.set(key, result);
  return result;
}

function computeLocalEclipseUncached(
  lat: number,
  lon: number,
  elevationM: number,
  searchStart: Date,
): LocalEclipse {
  const observer = new Observer(lat, lon, elevationM);
  const ec = SearchLocalSolarEclipse(searchStart, observer);

  const events: EclipseEvent[] = [];
  const push = (key: EclipseEvent['key'], label: string, e?: { time: { date: Date }; altitude: number }) => {
    if (!e) return;
    const eq = Equator(Body.Sun, e.time.date, observer, true, true);
    const hor = Horizon(e.time.date, observer, eq.ra, eq.dec, 'normal');
    events.push({ key, label, time: e.time.date, altitude: e.altitude, azimuth: hor.azimuth });
  };

  push('C1', 'Inicio parcial', ec.partial_begin);
  push('C2', 'Inicio totalidad', ec.total_begin);
  push('MAX', 'Máximo', ec.peak);
  push('C3', 'Fin totalidad', ec.total_end);
  push('C4', 'Fin parcial', ec.partial_end);

  const totalityDurationSec =
    ec.total_begin && ec.total_end
      ? Math.round((ec.total_end.time.date.getTime() - ec.total_begin.time.date.getTime()) / 1000)
      : null;

  let sunset: Date | null = null;
  try {
    // Anclado en C1, no en el pico: el ocaso que importa es el primero que corta la
    // visibilidad del eclipse ya empezado. Con «pico − 12 h» los eclipses de mañana
    // devolvían la puesta de la VÍSPERA (Azores 2027-08-02: máx 08:32, ocaso 21:01 del día 1).
    sunset = SearchRiseSet(Body.Sun, observer, -1, ec.partial_begin.time.date, 1)?.date ?? null;
  } catch {
    sunset = null;
  }

  return { kind: ec.kind as LocalEclipse['kind'], obscuration: ec.obscuration, events, totalityDurationSec, sunset };
}

/**
 * Tolerancia al comparar el día del máximo LOCAL con el día civil del pico GLOBAL.
 * El máximo local se separa hasta ~2 h del global, así que con el pico global cerca de
 * medianoche UTC hay observadores que lo ven al día siguiente (anular 2035-03-09, pico
 * 23:04 UTC: media malla del Pacífico sur da máximo el día 10). Un día de margen es
 * inequívoco — dos eclipses consecutivos distan ≥29 días.
 */
const SAME_ECLIPSE_DAYS = 1;

/**
 * ¿La serie calculada es la del eclipse activo?
 *
 * `SearchLocalSolarEclipse` devuelve el PRIMER eclipse local posterior a `searchStart`:
 * desde un punto fuera de la zona de visibilidad del activo contesta con otro distinto
 * (Sídney → total de 2028) y sus circunstancias no tienen nada que ver con el nuestro.
 * Todo lo que pinte datos de un puesto debe filtrar por aquí primero.
 */
export function isActiveEclipse(eclipse: LocalEclipse): boolean {
  const max = eventAt(eclipse, 'MAX');
  if (!max) return false;
  const activeDay = Date.parse(`${getActiveEclipse().civilDate}T12:00:00Z`);
  return Math.abs(max.time.getTime() - activeDay) <= (SAME_ECLIPSE_DAYS + 0.5) * 86_400_000;
}

/** Día civil UTC (AAAA-MM-DD) de la serie calculada, por su máximo; null si no tiene. */
export function eclipseDayOf(eclipse: LocalEclipse): string | null {
  const max = eventAt(eclipse, 'MAX');
  return max ? max.time.toISOString().slice(0, 10) : null;
}

/** Contacto de la serie por su clave; undefined si este eclipse no lo tiene (parcial: sin C2/C3). */
export function eventAt(eclipse: LocalEclipse, key: EclipseEvent['key']): EclipseEvent | undefined {
  return eclipse.events.find((e) => e.key === key);
}

/** Instantes del primer y el último contacto; null si la serie viene vacía. */
export function eclipseSpan(eclipse: LocalEclipse): { start: number; end: number } | null {
  const first = eclipse.events[0];
  const last = eclipse.events[eclipse.events.length - 1];
  return first && last ? { start: first.time.getTime(), end: last.time.getTime() } : null;
}

/** Abreviatura del hito para raíles y cronologías: «MAX» se localiza, el resto es su clave. */
export function eventShortLabel(key: EclipseEvent['key'] | string): string {
  return key === 'MAX' ? i18n('event.maxShort') : key;
}

/**
 * Copia del eclipse con TODA la serie desplazada `ms` milisegundos.
 * Base de los eclipses sintéticos: demo, simulacro y salto de fase.
 */
export function shiftEclipse(eclipse: LocalEclipse, ms: number): LocalEclipse {
  return {
    ...eclipse,
    events: eclipse.events.map((e) => ({ ...e, time: new Date(e.time.getTime() + ms) })),
  };
}

export function nextEvent(eclipse: LocalEclipse, now: Date): EclipseEvent | null {
  return eclipse.events.find((e) => e.time.getTime() > now.getTime()) ?? null;
}

export interface PhaseStatus {
  label: string;
  /** true solo durante la totalidad: seguro mirar sin gafas */
  safeToLook: boolean;
}

/** Fase en curso, o null si el eclipse no ha empezado o ya terminó. */
export function currentPhase(eclipse: LocalEclipse, now: Date): PhaseStatus | null {
  const t = now.getTime();
  const at = (k: EclipseEvent['key']) => eventAt(eclipse, k)?.time.getTime();
  const c1 = at('C1');
  const c2 = at('C2');
  const c3 = at('C3');
  const c4 = at('C4');
  if (c1 === undefined || c4 === undefined || t < c1 || t >= c4) return null;
  if (c2 !== undefined && c3 !== undefined && t >= c2 && t < c3) {
    return { label: i18n('phase.totality'), safeToLook: true };
  }
  return { label: i18n('phase.partial'), safeToLook: false };
}

/**
 * Fracción del disco solar tapada cuando los centros distan `x` (1 = discos tangentes,
 * 0 = concéntricos). Área de intersección de dos círculos IGUALES, normalizada.
 */
function coveredAt(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return (2 * Math.acos(c) - 2 * c * Math.sqrt(1 - c * c)) / Math.PI;
}

/** Inversa de `coveredAt` por bisección: separación que deja tapada esa fracción. */
function separationFor(covered: number): number {
  if (covered <= 0) return 1;
  if (covered >= 1) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    // coveredAt decrece con x: si tapa de más, hay que separar los discos
    if (coveredAt(mid) > covered) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Fracción del disco solar tapada AHORA (0..1); null fuera del eclipse.
 *
 * Modelo: la separación de los centros cae en tramos lineales entre contactos —el cono
 * de sombra cruza a velocidad casi constante— y luna y sol se toman con el MISMO radio
 * aparente. Con eso la obscuración es el área común de dos círculos iguales, dentro del
 * ~2 % de la real en eclipses típicos: suficiente para un dato de apoyo y, al no tocar
 * efemérides, igual de válido en el simulacro, cuya serie es sintética.
 * ponytail: si algún día hace falta precisión de catálogo, aquí entra la separación real
 * sol-luna de astronomy-engine en vez de la interpolación.
 */
export function sunCoverage(eclipse: LocalEclipse, now: Date): number | null {
  const t = now.getTime();
  const at = (k: EclipseEvent['key']) => eventAt(eclipse, k)?.time.getTime();
  const c1 = at('C1');
  const c4 = at('C4');
  if (c1 === undefined || c4 === undefined || t < c1 || t > c4) return null;
  const c2 = at('C2');
  const c3 = at('C3');
  // Nodos (instante, separación): 1 en los contactos exteriores, 0 en toda la totalidad
  const knots: [number, number][] =
    c2 !== undefined && c3 !== undefined
      ? [
          [c1, 1],
          [c2, 0],
          [c3, 0],
          [c4, 1],
        ]
      : [
          [c1, 1],
          [at('MAX') ?? (c1 + c4) / 2, separationFor(eclipse.obscuration)],
          [c4, 1],
        ];
  for (let i = 1; i < knots.length; i++) {
    const [t0, x0] = knots[i - 1];
    const [t1, x1] = knots[i];
    if (t > t1) continue;
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    return coveredAt(x0 + (x1 - x0) * k);
  }
  return 0;
}
