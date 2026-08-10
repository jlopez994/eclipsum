/**
 * Catálogo de eclipses empaquetados en la app.
 * Los horarios locales salen de astronomy-engine con `searchStart`;
 * banda, ciudades, nubes y copy usan el resto de campos.
 */
import { SearchGlobalSolarEclipse, type GlobalSolarEclipseInfo } from 'astronomy-engine';

export interface EclipseEntry {
  id: string;
  /** Ancla ISO para SearchLocalSolarEclipse (primer eclipse local tras esta fecha). */
  searchStart: string;
  /** Día civil UTC del evento (Open-Meteo / Windy / caché). */
  civilDate: string;
  /** Texto «Acerca de» / próximo eclipse. */
  label: string;
  /** Etiqueta de la banda en el diagrama. */
  bandLabel: string;
  /** Tooltip corto de la banda en el mapa real. */
  bandTooltip: string;
  /** Abreviatura en chips de nubes y cronología (p. ej. «12 AGO»). */
  shortDateLabel: string;
  /** Fallback ISO si aún no hay evento MAX calculado (Windy). */
  windyFallbackMax: string;
}

export const ECLIPSES: EclipseEntry[] = [
  {
    id: '2026-08-12-iberia',
    searchStart: '2026-08-01T00:00:00Z',
    civilDate: '2026-08-12',
    label: 'Total · 12 ago 2026',
    bandLabel: 'BANDA DE TOTALIDAD · 12 AGO 2026',
    bandTooltip: 'Banda de totalidad · 12 ago 2026',
    shortDateLabel: '12 AGO',
    windyFallbackMax: '2026-08-12T18:00:00Z',
  },
];

/** Override desde Remote Config (`active_eclipse_id`); vacío = resolución local. */
let remoteActiveId = '';

export function setRemoteActiveEclipseId(id: string): void {
  remoteActiveId = id.trim();
}

/** Entradas añadidas por Remote Config (`eclipse_catalog`); no requieren release. */
let remoteEntries: EclipseEntry[] = [];

const ENTRY_STRING_FIELDS = [
  'id',
  'searchStart',
  'civilDate',
  'label',
  'bandLabel',
  'bandTooltip',
  'shortDateLabel',
  'windyFallbackMax',
] as const;

function isValidEntry(e: unknown): e is EclipseEntry {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  if (!ENTRY_STRING_FIELDS.every((k) => typeof r[k] === 'string' && (r[k] as string).length > 0)) return false;
  return (
    !Number.isNaN(Date.parse(r.searchStart as string)) &&
    !Number.isNaN(Date.parse(`${r.civilDate}T00:00:00Z`)) &&
    !Number.isNaN(Date.parse(r.windyFallbackMax as string))
  );
}

/** Valida el JSON de RC; entradas malformadas se descartan en silencio (nunca rompe la app). */
export function parseRemoteCatalog(json: string): EclipseEntry[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidEntry).map((e) => ({ ...e }));
  } catch {
    return [];
  }
}

export function setRemoteCatalog(json: string): void {
  remoteEntries = parseRemoteCatalog(json);
}

/** Catálogo completo: empaquetado + RC (sin duplicar ids), ordenado por fecha para el rollover. */
function allEclipses(): EclipseEntry[] {
  const extras = remoteEntries.filter((r) => !ECLIPSES.some((e) => e.id === r.id));
  return [...ECLIPSES, ...extras].sort((a, b) => a.civilDate.localeCompare(b.civilDate));
}

export function getEclipseById(id: string): EclipseEntry | undefined {
  return allEclipses().find((e) => e.id === id);
}

/** Fin del día civil UTC (+ cola) a partir del cual el eclipse se considera pasado. */
function eclipseEndMs(entry: EclipseEntry): number {
  return new Date(`${entry.civilDate}T23:59:59Z`).getTime() + 6 * 3_600_000;
}

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const KIND_LABEL: Record<string, string> = { total: 'Total', annular: 'Anular', partial: 'Parcial' };
const BAND_WORD: Record<string, string> = { total: 'totalidad', annular: 'anularidad' };
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Margen del ancla searchStart: SearchLocalSolarEclipse busca el primer eclipse local tras ella. */
const SEARCH_START_DAYS_BEFORE = 15;

/** Entrada de catálogo derivada de un eclipse global del motor (labels en español). */
export function entryFromGlobalEclipse(ev: GlobalSolarEclipseInfo): EclipseEntry {
  const peak = ev.peak.date;
  const kind = ev.kind as string;
  const civilDate = peak.toISOString().slice(0, 10);
  const d = peak.getUTCDate();
  const mes = MES[peak.getUTCMonth()];
  const year = peak.getUTCFullYear();
  const fecha = `${d} ${mes} ${year}`;
  const fechaMayus = `${d} ${mes.toUpperCase()} ${year}`;
  const word = BAND_WORD[kind];
  return {
    id: `${civilDate}-${kind}`,
    searchStart: `${new Date(peak.getTime() - SEARCH_START_DAYS_BEFORE * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`,
    civilDate,
    label: `${KIND_LABEL[kind] ?? kind} · ${fecha}`,
    bandLabel: word ? `BANDA DE ${word.toUpperCase()} · ${fechaMayus}` : `ECLIPSE PARCIAL · ${fechaMayus}`,
    bandTooltip: word ? `Banda de ${word} · ${fecha}` : `Eclipse parcial · ${fecha}`,
    shortDateLabel: `${d} ${mes.toUpperCase()}`,
    windyFallbackMax: new Date(Math.round(peak.getTime() / HOUR_MS) * HOUR_MS)
      .toISOString()
      .replace('.000Z', 'Z'),
  };
}

/** Catálogo agotado: la app genera sola el siguiente eclipse global (vive sin releases ni RC). */
let autoEntry: EclipseEntry | null = null;
function nextAutoEclipse(now: Date): EclipseEntry {
  if (!autoEntry || eclipseEndMs(autoEntry) < now.getTime()) {
    autoEntry = entryFromGlobalEclipse(SearchGlobalSolarEclipse(now));
  }
  return autoEntry;
}

/**
 * Eclipse activo: RC si el id existe en catálogo; si no, el primero no pasado;
 * si todos pasaron, el siguiente eclipse global autogenerado con el motor.
 */
export function getActiveEclipse(now: Date = new Date()): EclipseEntry {
  if (remoteActiveId) {
    const forced = getEclipseById(remoteActiveId);
    if (forced) return forced;
  }
  const all = allEclipses();
  const t = now.getTime();
  const upcoming = all.find((e) => eclipseEndMs(e) >= t);
  if (upcoming) return upcoming;
  try {
    return nextAutoEclipse(now);
  } catch {
    return all[all.length - 1]; // motor fallando: último conocido antes que crash
  }
}

export function activeSearchStart(now?: Date): Date {
  return new Date(getActiveEclipse(now).searchStart);
}
