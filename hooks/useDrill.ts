import { useCallback, useEffect, useState } from 'react';
import { shiftEclipse, type EclipseEvent, type LocalEclipse } from '../lib/eclipse';
import { buildDrillEclipse } from '../lib/drill';
import { cancelAlertsByIds, scheduleFakeEclipseAlerts } from '../lib/notifications';
import { track } from '../lib/firebase';
import { fmtHM } from '../lib/format';
import { t } from '../lib/i18n';
import type { EclipseContext, Prefs } from '../lib/prefs';

/** Espera hasta el C1 del simulacro: lo justo para bloquear el móvil y esperar el aviso */
const DRILL_LEAD_MS = 60_000;
/** Al saltar de fase, el hito cae en 20 s: los avisos con antelación (15 s) aún suenan */
const DRILL_JUMP_LEAD_MS = 20_000;
/** Margen tras el último contacto antes de volver solo al modo normal */
const DRILL_TAIL_MS = 60_000;

/** Simulacro en curso: eclipse sintético + ids de sus avisos [PRUEBA] (para cancelarlos al salir) */
interface Drill {
  eclipse: LocalEclipse;
  ids: string[];
}

/**
 * Ciclo de vida del simulacro: eclipse sintético de tramos mínimos con C1 en 1 min,
 * avisos [PRUEBA] aditivos (no tocan los reales), salto de fase y fin automático.
 * `now` viene del reloj de App para detectar el final sin un segundo temporizador.
 */
export function useDrill(
  eclipse: LocalEclipse | null,
  prefs: Prefs | null,
  ctx: EclipseContext,
  now: Date,
) {
  const [drill, setDrill] = useState<Drill | null>(null);

  /** Arranca y devuelve el mensaje a enseñar en Ajustes (motivo del fallo incluido). */
  const startDrill = useCallback(async () => {
    if (!eclipse || !prefs) return t('app.drill.needSpot');
    if (!Object.values(ctx.alertsOn).some(Boolean)) return t('app.drill.needAlert');
    const c1At = new Date(Date.now() + DRILL_LEAD_MS);
    const fake = buildDrillEclipse(eclipse, c1At);
    const ids = await scheduleFakeEclipseAlerts(fake, c1At, ctx.alertsOn, prefs.alertSound, ctx.alertEarly);
    setDrill({ eclipse: fake, ids });
    track('drill_started');
    return t('app.drill.running', { time: fmtHM(c1At) });
  }, [eclipse, prefs, ctx]);

  const exitDrill = useCallback(() => {
    if (drill) void cancelAlertsByIds(drill.ids);
    setDrill(null);
  }, [drill]);

  // Salto de fase: desplaza la serie para que el hito tocado caiga en 20 s
  // (los avisos con antelación de 15 s siguen entrando) y reprograma los [PRUEBA] restantes.
  const jumpDrill = useCallback(
    (key: EclipseEvent['key']) => {
      if (!drill || !prefs) return;
      const target = drill.eclipse.events.find((e) => e.key === key);
      if (!target) return;
      const shifted = shiftEclipse(drill.eclipse, Date.now() + DRILL_JUMP_LEAD_MS - target.time.getTime());
      void cancelAlertsByIds(drill.ids);
      const c1 = shifted.events[0];
      scheduleFakeEclipseAlerts(shifted, c1.time, ctx.alertsOn, prefs.alertSound, ctx.alertEarly)
        .then((ids) => setDrill({ eclipse: shifted, ids }))
        .catch(() => setDrill({ eclipse: shifted, ids: [] }));
    },
    [drill, prefs, ctx],
  );

  // Fin natural: pasado C4 + margen, la app vuelve sola al modo normal
  useEffect(() => {
    if (!drill) return;
    const last = drill.eclipse.events[drill.eclipse.events.length - 1];
    if (now.getTime() > last.time.getTime() + DRILL_TAIL_MS) setDrill(null);
  }, [now, drill]);

  return { drill, startDrill, exitDrill, jumpDrill };
}
