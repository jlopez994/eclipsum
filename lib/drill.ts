/**
 * Modo simulacro: eclipse sintético para ensayar las alertas y el modo eclipse
 * sin esperar al evento real. Tramos fijos y mínimos — es una prueba, no un ensayo
 * a escala: cuanto antes acabe la serie, antes se sabe si todo va bien.
 * Sin imports de react-native — selfcheck lo ejecuta en Node.
 */
import type { EclipseEvent, LocalEclipse } from './eclipse';

/**
 * Mínimos que respetan la mecánica de avisos: el aviso anticipado de C2
 * (ALERT_EARLY_SECONDS = 15 s) debe caer tras C1, y el Máximo debe sonar antes
 * que el aviso anticipado de C3. 30 y 45 s dejan margen sin alargar la prueba.
 */
export const DRILL_PARTIAL_SEC = 30;
export const DRILL_TOTALITY_SEC = 45;

/**
 * Eclipse sintético: C1 en `c1At`, tramos fijos, geometría solar
 * (altitud/azimut) copiada del eclipse real de referencia.
 */
export function buildDrillEclipse(template: LocalEclipse, c1At: Date): LocalEclipse {
  const geom = (key: EclipseEvent['key']) => {
    const e = template.events.find((ev) => ev.key === key) ?? template.events.find((ev) => ev.key === 'MAX');
    return e ? { altitude: e.altitude, azimuth: e.azimuth } : { altitude: 30, azimuth: 270 };
  };
  const t0 = c1At.getTime();
  const partial = DRILL_PARTIAL_SEC * 1000;
  const totality = DRILL_TOTALITY_SEC * 1000;
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
    totalityDurationSec: DRILL_TOTALITY_SEC,
    sunset: null,
  };
}
