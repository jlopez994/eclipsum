import { useEffect, useState } from 'react';
import { eventAt, type LocalEclipse } from '../lib/eclipse';
import { cloudCoverAt, fetchCloudCoverCached } from '../lib/weather';
import { findNearestTotality, type TotalityDirection } from '../lib/totality';
import { track } from '../lib/firebase';
import { animateNextLayout } from '../lib/anim';

export interface CloudInfo {
  pct: number | null;
  /** Horas de antigüedad cuando el dato viene de caché sin red; null = fresco o sin dato */
  ageH: number | null;
  loading: boolean;
}

/**
 * Datos asíncronos que dependen del puesto activo: nubosidad y totalidad más
 * cercana. Cada cambio de puesto resetea antes de cargar — nunca se enseñan
 * datos del puesto anterior.
 */
export function useSpotData(active: { lat: number; lon: number } | null, eclipse: LocalEclipse | null) {
  const [cloud, setCloud] = useState<CloudInfo>({ pct: null, ageH: null, loading: false });
  const [totality, setTotality] = useState<TotalityDirection | 'none' | null>(null);

  // Nubosidad + totalidad cercana + analytics al cambiar de puesto
  useEffect(() => {
    if (!active || !eclipse) return;
    let cancelled = false;
    track('eclipse_computed', { kind: eclipse.kind, obscuration: Math.round(eclipse.obscuration * 100) });

    setCloud({ pct: null, ageH: null, loading: true });
    const maxEvent = eventAt(eclipse, 'MAX');
    fetchCloudCoverCached(active.lat, active.lon).then((c) => {
      if (cancelled) return;
      animateNextLayout();
      if (!c || !maxEvent) {
        setCloud({ pct: null, ageH: null, loading: false });
        return;
      }
      setCloud({
        pct: cloudCoverAt(c.forecast, maxEvent.time),
        // Solo marcamos antigüedad si el dato viene de caché con más de media hora
        ageH: c.ageMs > 30 * 60_000 ? Math.max(1, Math.round(c.ageMs / 3_600_000)) : null,
        loading: false,
      });
    });

    // La totalidad NO se resetea al cambiar de puesto: el punto desliza directo
    // del valor viejo al nuevo al resolver (reset = salto a "lejos" y vuelta)
    if (eclipse.kind === 'total') {
      setTotality(null);
    } else {
      findNearestTotality(active.lat, active.lon)
        .then((t) => {
          if (cancelled) return;
          animateNextLayout();
          setTotality(t ?? 'none');
        })
        .catch(() => !cancelled && setTotality('none'));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.lat, active?.lon, eclipse]);

  return { cloud, totality };
}
