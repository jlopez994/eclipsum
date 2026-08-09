/**
 * Catálogo de eclipses empaquetados en la app.
 * Los horarios locales salen de astronomy-engine con `searchStart`;
 * banda, ciudades, nubes y copy usan el resto de campos.
 */

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

export function getEclipseById(id: string): EclipseEntry | undefined {
  return ECLIPSES.find((e) => e.id === id);
}

/** Fin del día civil UTC (+ cola) a partir del cual el eclipse se considera pasado. */
function eclipseEndMs(entry: EclipseEntry): number {
  return new Date(`${entry.civilDate}T23:59:59Z`).getTime() + 6 * 3_600_000;
}

/**
 * Eclipse activo: RC si el id existe en catálogo; si no, el primero no pasado;
 * si todos pasaron, el último del catálogo.
 */
export function getActiveEclipse(now: Date = new Date()): EclipseEntry {
  if (remoteActiveId) {
    const forced = getEclipseById(remoteActiveId);
    if (forced) return forced;
  }
  const t = now.getTime();
  const upcoming = ECLIPSES.find((e) => eclipseEndMs(e) >= t);
  return upcoming ?? ECLIPSES[ECLIPSES.length - 1];
}

export function activeSearchStart(now?: Date): Date {
  return new Date(getActiveEclipse(now).searchStart);
}
