import { useEffect, useState } from 'react';
import { computeLocalEclipse, type LocalEclipse } from '../lib/eclipse';
import { cloudCoverAt, fetchCloudCoverCached } from '../lib/weather';
import { findNearestTotality, haversineKm, type TotalityDirection } from '../lib/totality';
import { track } from '../lib/firebase';
import { animateNextLayout } from '../lib/anim';
import type { Geo } from './useGeo';

/** Umbral (km) para considerar GPS y puesto el mismo sitio */
export const REAL_PLACE_KM = 1;

export interface CloudInfo {
  pct: number | null;
  /** Horas de antigüedad cuando el dato viene de caché sin red; null = fresco o sin dato */
  ageH: number | null;
  loading: boolean;
}

export interface HereOnMap {
  isTotal: boolean;
  totality: TotalityDirection | 'none' | null;
  /** km entre GPS y puesto */
  km: number;
  /** Obscuración en el GPS, 0..1; null si aún no calculada */
  obscuration: number | null;
}

/**
 * Datos asíncronos que dependen del puesto activo: nubosidad, totalidad más
 * cercana y el GPS real en la escala del diagrama. Cada cambio de puesto
 * resetea antes de cargar — nunca se enseñan datos del puesto anterior.
 */
export function useSpotData(
  active: { lat: number; lon: number } | null,
  eclipse: LocalEclipse | null,
  geo: Geo | null,
) {
  const [cloud, setCloud] = useState<CloudInfo>({ pct: null, ageH: null, loading: false });
  const [totality, setTotality] = useState<TotalityDirection | 'none' | null>(null);
  const [hereOnMap, setHereOnMap] = useState<HereOnMap | null>(null);

  // Nubosidad + totalidad cercana + analytics al cambiar de puesto
  useEffect(() => {
    if (!active || !eclipse) return;
    let cancelled = false;
    track('eclipse_computed', { kind: eclipse.kind, obscuration: Math.round(eclipse.obscuration * 100) });

    setCloud({ pct: null, ageH: null, loading: true });
    const maxEvent = eclipse.events.find((e) => e.key === 'MAX');
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

  // Segundo punto: GPS real en la escala de la banda cuando no coincide con el puesto
  useEffect(() => {
    if (!geo || !active) {
      setHereOnMap(null);
      return;
    }
    const km = haversineKm(geo.lat, geo.lon, active.lat, active.lon);
    if (km < REAL_PLACE_KM) {
      setHereOnMap(null);
      return;
    }
    let cancelled = false;
    const kmRound = Math.round(km);
    // Provisional ya: que el punto se vea sin esperar al cálculo de km a la banda
    setHereOnMap({ isTotal: false, totality: 'none', km: kmRound, obscuration: null });
    try {
      const hereEc = computeLocalEclipse(geo.lat, geo.lon);
      if (hereEc.kind === 'total') {
        if (!cancelled) {
          animateNextLayout();
          setHereOnMap({ isTotal: true, totality: null, km: kmRound, obscuration: hereEc.obscuration });
        }
        return () => {
          cancelled = true;
        };
      }
      findNearestTotality(geo.lat, geo.lon)
        .then((t) => {
          if (cancelled) return;
          animateNextLayout();
          setHereOnMap({ isTotal: false, totality: t ?? 'none', km: kmRound, obscuration: hereEc.obscuration });
        })
        .catch(() => {
          if (!cancelled)
            setHereOnMap({ isTotal: false, totality: 'none', km: kmRound, obscuration: hereEc.obscuration });
        });
    } catch {
      if (!cancelled) setHereOnMap({ isTotal: false, totality: 'none', km: kmRound, obscuration: null });
    }
    return () => {
      cancelled = true;
    };
  }, [geo?.lat, geo?.lon, active?.lat, active?.lon]);

  return { cloud, totality, hereOnMap };
}
