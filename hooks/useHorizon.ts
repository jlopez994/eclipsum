import { useEffect, useState } from 'react';
import { eventAt, type LocalEclipse } from '../lib/eclipse';
import { terrainHorizonDeg, terrainVerdict, type TerrainVerdict } from '../lib/horizon';

/**
 * Horizonte del terreno hacia el sol para el puesto pintado: perfil de elevaciones
 * (red o caché) cruzado con los hitos del eclipse. null = cargando, sin red o sol bajo
 * el horizonte en el máximo — en todos los casos el aviso simplemente no se pinta
 * (carga silenciosa, mismo trato que la meteo).
 */
export function useTerrainHorizon(
  spot: { lat: number; lon: number },
  eclipse: LocalEclipse,
): TerrainVerdict | null {
  const [verdict, setVerdict] = useState<TerrainVerdict | null>(null);

  useEffect(() => {
    // Reset al cambiar de puesto o eclipse: nunca se enseña el veredicto del anterior
    setVerdict(null);
    const max = eventAt(eclipse, 'MAX');
    if (!max || max.altitude <= 0) return;
    let cancelled = false;
    terrainHorizonDeg(spot.lat, spot.lon, max.azimuth).then((deg) => {
      if (cancelled || deg === null) return;
      setVerdict(terrainVerdict(deg, eclipse.events));
    });
    return () => {
      cancelled = true;
    };
  }, [spot.lat, spot.lon, eclipse]);

  return verdict;
}
