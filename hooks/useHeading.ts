import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';

/**
 * Suscripción cruda a la brújula: fallback trueHeading→magHeading, normalización a
 * [0,360) y limpieza a prueba de la carrera del await (desmontar mientras
 * watchHeadingAsync resolvía dejaba el magnetómetro suscrito para siempre).
 *
 * UN solo consumidor activo a la vez en toda la app: expo-location guarda un único
 * mHeadingId por módulo y dos observadores se rompen entre sí (ver CompassChip.paused).
 * El filtrado (suavizado, precisión) es cosa de cada consumidor: aquí llega la muestra tal cual.
 */
export function useHeading(
  active: boolean,
  onSample: (deg: number, accuracy: number | null) => void,
): void {
  const cb = useRef(onSample);
  cb.current = onSample;

  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      try {
        sub = await Location.watchHeadingAsync((h) => {
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (cancelled || !Number.isFinite(deg)) return;
          cb.current(((deg % 360) + 360) % 360, typeof h.accuracy === 'number' ? h.accuracy : null);
        });
        // Desmontado mientras resolvía: la limpieza ya corrió con sub=null
        if (cancelled) sub.remove();
      } catch {
        // sin brújula disponible
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);
}
