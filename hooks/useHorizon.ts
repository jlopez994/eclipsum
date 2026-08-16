import { useEffect, useState } from 'react';
import { eventAt, type LocalEclipse } from '../lib/eclipse';
import { terrainHorizonDeg, terrainVerdict, type EventTerrain, type TerrainVerdict } from '../lib/horizon';

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
    // Un perfil POR AZIMUT de contacto visible, no solo el del máximo: entre C1 y C4 el
    // sol se corre hasta ~30° de rumbo. La caché por azimut redondeado deduplica de sobra
    // (C2/C3 suelen caer en el perfil del máximo) y todo va en paralelo.
    const visible = eclipse.events.filter((e) => e.altitude > 0);
    void Promise.all(
      visible.map((e) =>
        terrainHorizonDeg(spot.lat, spot.lon, e.azimuth).then(
          (deg): EventTerrain | null =>
            deg === null ? null : { key: e.key, altitude: e.altitude, horizonDeg: deg },
        ),
      ),
    ).then((list) => {
      if (cancelled) return;
      // Contacto sin dato (red caída a medias) queda fuera de la lista: mejor callar que
      // adivinar. Sin el del máximo, terrainVerdict devuelve null y no se pinta nada.
      setVerdict(terrainVerdict(list.filter((x): x is EventTerrain => x !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [spot.lat, spot.lon, eclipse]);

  return verdict;
}
