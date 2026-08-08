import { Body, Equator, Horizon, Observer, SearchLocalSolarEclipse, SearchRiseSet } from 'astronomy-engine';

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

// ponytail: v1 fija el eclipse del 2026-08-12; parametrizar fecha cuando haya catálogo multi-eclipse
const SEARCH_START = new Date('2026-08-01T00:00:00Z');

export function computeLocalEclipse(lat: number, lon: number, elevationM = 0): LocalEclipse {
  const observer = new Observer(lat, lon, elevationM);
  const ec = SearchLocalSolarEclipse(SEARCH_START, observer);

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
    // Desde 12h antes del pico: el siguiente ocaso es el de la tarde del eclipse
    const from = new Date(ec.peak.time.date.getTime() - 12 * 3600 * 1000);
    sunset = SearchRiseSet(Body.Sun, observer, -1, from, 1)?.date ?? null;
  } catch {
    sunset = null;
  }

  return { kind: ec.kind as LocalEclipse['kind'], obscuration: ec.obscuration, events, totalityDurationSec, sunset };
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
  const at = (k: EclipseEvent['key']) => eclipse.events.find((e) => e.key === k)?.time.getTime();
  const c1 = at('C1');
  const c2 = at('C2');
  const c3 = at('C3');
  const c4 = at('C4');
  if (c1 === undefined || c4 === undefined || t < c1 || t >= c4) return null;
  if (c2 !== undefined && c3 !== undefined && t >= c2 && t < c3) {
    return { label: 'TOTALIDAD — puedes mirar sin gafas', safeToLook: true };
  }
  return { label: 'Eclipse parcial en curso — gafas puestas', safeToLook: false };
}
