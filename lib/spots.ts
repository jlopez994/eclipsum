import { computeLocalEclipse } from './eclipse';
import { getActiveEclipse } from './eclipseCatalog';
import { haversineKm } from './totality';

export interface Spot {
  name: string;
  lat: number;
  lon: number;
  origin: 'gps' | 'city' | 'nearest' | 'manual';
}

export interface SpotOption extends Spot {
  distanceKm: number;
  kind: 'total' | 'annular' | 'partial';
  obscuration: number;
  totalityDurationSec: number | null;
  maxTime: Date | null;
}

type City = { name: string; lat: number; lon: number };

/** Municipios de referencia por eclipse. El motor decide total/parcial. */
const CITIES_BY_ECLIPSE: Record<string, City[]> = {
  '2026-08-12-iberia': [
  { name: 'A Coruña', lat: 43.36, lon: -8.41 },
  { name: 'Santiago', lat: 42.88, lon: -8.54 },
  { name: 'Lugo', lat: 43.01, lon: -7.56 },
  { name: 'Ourense', lat: 42.34, lon: -7.86 },
  { name: 'Oviedo', lat: 43.36, lon: -5.85 },
  { name: 'Gijón', lat: 43.54, lon: -5.66 },
  { name: 'Santander', lat: 43.46, lon: -3.8 },
  { name: 'Bilbao', lat: 43.26, lon: -2.93 },
  { name: 'Vitoria-Gasteiz', lat: 42.85, lon: -2.67 },
  { name: 'San Sebastián', lat: 43.32, lon: -1.98 },
  { name: 'Pamplona', lat: 42.82, lon: -1.64 },
  { name: 'Logroño', lat: 42.47, lon: -2.44 },
  { name: 'Burgos', lat: 42.34, lon: -3.7 },
  { name: 'León', lat: 42.6, lon: -5.57 },
  { name: 'Palencia', lat: 42.01, lon: -4.53 },
  { name: 'Valladolid', lat: 41.65, lon: -4.72 },
  { name: 'Zamora', lat: 41.5, lon: -5.75 },
  { name: 'Salamanca', lat: 40.96, lon: -5.66 },
  { name: 'Soria', lat: 41.77, lon: -2.46 },
  { name: 'Zaragoza', lat: 41.65, lon: -0.88 },
  { name: 'Huesca', lat: 42.14, lon: -0.41 },
  { name: 'Teruel', lat: 40.34, lon: -1.11 },
  { name: 'Lleida', lat: 41.62, lon: 0.62 },
  { name: 'Tarragona', lat: 41.12, lon: 1.25 },
  { name: 'Barcelona', lat: 41.39, lon: 2.17 },
  { name: 'Girona', lat: 41.98, lon: 2.82 },
  { name: 'Castellón', lat: 39.99, lon: -0.04 },
  { name: 'Valencia', lat: 39.47, lon: -0.38 },
  { name: 'Cuenca', lat: 40.07, lon: -2.14 },
  { name: 'Guadalajara', lat: 40.63, lon: -3.17 },
  { name: 'Madrid', lat: 40.42, lon: -3.7 },
  { name: 'Segovia', lat: 40.95, lon: -4.12 },
  { name: 'Ávila', lat: 40.66, lon: -4.7 },
  { name: 'Toledo', lat: 39.86, lon: -4.03 },
  { name: 'Albacete', lat: 38.99, lon: -1.86 },
  { name: 'Alicante', lat: 38.35, lon: -0.48 },
  { name: 'Murcia', lat: 37.98, lon: -1.13 },
  { name: 'Almería', lat: 36.84, lon: -2.46 },
  { name: 'Granada', lat: 37.18, lon: -3.6 },
  { name: 'Málaga', lat: 36.72, lon: -4.42 },
  { name: 'Sevilla', lat: 37.39, lon: -5.99 },
  { name: 'Córdoba', lat: 37.89, lon: -4.78 },
  { name: 'Jaén', lat: 37.77, lon: -3.79 },
  { name: 'Badajoz', lat: 38.88, lon: -6.97 },
  { name: 'Cáceres', lat: 39.48, lon: -6.37 },
  { name: 'Ciudad Real', lat: 38.99, lon: -3.93 },
  { name: 'Palma', lat: 39.57, lon: 2.65 },
  { name: 'Ibiza', lat: 38.91, lon: 1.43 },
  ],
};

function citiesForActive(): City[] {
  return CITIES_BY_ECLIPSE[getActiveEclipse().id] ?? [];
}

function toOption(spot: Spot, userLat: number, userLon: number): SpotOption {
  const ec = computeLocalEclipse(spot.lat, spot.lon);
  const max = ec.events.find((e) => e.key === 'MAX');
  return {
    ...spot,
    distanceKm: Math.round(haversineKm(userLat, userLon, spot.lat, spot.lon)),
    kind: ec.kind,
    obscuration: ec.obscuration,
    totalityDurationSec: ec.totalityDurationSec,
    maxTime: max?.time ?? null,
  };
}

/**
 * Ciudades más cercanas al usuario con sus circunstancias locales, ordenadas por distancia.
 * Cálculo por tandas cediendo el hilo (~10-30 ms por ciudad con astronomy-engine).
 */
export async function listSpotOptions(userLat: number, userLon: number, limit = 10): Promise<SpotOption[]> {
  const nearest = citiesForActive()
    .map((c) => ({
      ...c,
      distanceKm: haversineKm(userLat, userLon, c.lat, c.lon),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  const out: SpotOption[] = [];
  for (const c of nearest) {
    // Promesa inline y no yieldUI de lib/anim: este módulo debe seguir libre de react-native (selfcheck en Node)
    await new Promise((r) => setTimeout(r, 0));
    out.push(toOption({ name: c.name, lat: c.lat, lon: c.lon, origin: 'city' }, userLat, userLon));
  }
  return out;
}
