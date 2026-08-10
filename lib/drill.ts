/**
 * Modo simulacro: eclipse sintético con tramos configurables para ensayar
 * las alertas y el modo eclipse sin esperar al evento real.
 * Sin imports de react-native — selfcheck lo ejecuta en Node.
 */
import type { EclipseEvent, LocalEclipse } from './eclipse';

export interface DrillConfig {
  /** Duración de cada parcial (C1→C2 y C3→C4), en minutos */
  partialMin: number;
  /** Duración de la totalidad (C2→C3), en segundos */
  totalitySec: number;
}

/** Parcial corta pero con margen para prepararse; totalidad como la real (~2 min). */
export const DEFAULT_DRILL: DrillConfig = { partialMin: 15, totalitySec: 120 };

export const DRILL_PARTIAL = { min: 5, max: 60, step: 5 };
export const DRILL_TOTALITY = { min: 30, max: 300, step: 30 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Valida config cargada de prefs (o parcial/ausente) contra los rangos. */
export function clampDrill(raw: unknown): DrillConfig {
  const src = (raw ?? {}) as Partial<DrillConfig>;
  return {
    partialMin:
      typeof src.partialMin === 'number'
        ? clamp(Math.round(src.partialMin), DRILL_PARTIAL.min, DRILL_PARTIAL.max)
        : DEFAULT_DRILL.partialMin,
    totalitySec:
      typeof src.totalitySec === 'number'
        ? clamp(Math.round(src.totalitySec), DRILL_TOTALITY.min, DRILL_TOTALITY.max)
        : DEFAULT_DRILL.totalitySec,
  };
}

/**
 * Eclipse sintético: C1 en `c1At`, tramos de la config, geometría solar
 * (altitud/azimut) copiada del eclipse real de referencia.
 */
export function buildDrillEclipse(template: LocalEclipse, c1At: Date, cfg: DrillConfig): LocalEclipse {
  const geom = (key: EclipseEvent['key']) => {
    const e = template.events.find((ev) => ev.key === key) ?? template.events.find((ev) => ev.key === 'MAX');
    return e ? { altitude: e.altitude, azimuth: e.azimuth } : { altitude: 30, azimuth: 270 };
  };
  const t0 = c1At.getTime();
  const partial = cfg.partialMin * 60_000;
  const totality = cfg.totalitySec * 1000;
  const mk = (key: EclipseEvent['key'], label: string, time: number): EclipseEvent => ({
    key,
    label,
    time: new Date(time),
    ...geom(key),
  });
  return {
    kind: 'total',
    obscuration: 1,
    events: [
      mk('C1', 'Inicio parcial', t0),
      mk('C2', 'Inicio totalidad', t0 + partial),
      mk('MAX', 'Máximo', t0 + partial + totality / 2),
      mk('C3', 'Fin totalidad', t0 + partial + totality),
      mk('C4', 'Fin parcial', t0 + partial + totality + partial),
    ],
    totalityDurationSec: cfg.totalitySec,
    sunset: null,
  };
}
