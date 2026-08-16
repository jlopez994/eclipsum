import { computeLocalEclipse, isActiveEclipse } from './eclipse';
import { activeSearchStart } from './eclipseCatalog';
import { t } from './i18n';

export interface TotalityDirection {
  distanceKm: number;
  /** Rumbo en grados desde el norte (0=N, 90=E) */
  bearingDeg: number;
  /** Punto destino dentro de la banda de totalidad */
  lat: number;
  lon: number;
  /** Duración de la totalidad en el punto destino, en segundos */
  durationSec: number | null;
}

const EARTH_R = 6371; // km

/** Distancia haversine en km entre dos puntos. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dφ = (lat2 - lat1) * r;
  const dλ = (lon2 - lon1) * r;
  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}
const PROBE_DISTANCES_KM = [25, 50, 100, 200, 400, 700];
const PRECISION_KM = 2;
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/** Punto destino desde (lat,lon) siguiendo un rumbo una distancia dada (fórmula esférica). */
export function destination(lat: number, lon: number, bearingDeg: number, distKm: number): { lat: number; lon: number } {
  const δ = distKm / EARTH_R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lon: ((((λ2 * 180) / Math.PI + 540) % 360) - 180) };
}

function isTotalAt(lat: number, lon: number, searchStart: Date, now?: Date): boolean {
  try {
    const ec = computeLocalEclipse(lat, lon, 0, searchStart);
    // `searchStart` solo fija DESDE CUÁNDO buscar, no QUÉ eclipse contesta el motor: fuera
    // del footprint del activo devuelve el siguiente de ese punto. Sin este filtro, desde
    // Melbourne salía «totalidad a 604 km» apuntando a la banda de 2028.
    return ec.kind === 'total' && isActiveEclipse(ec, now);
  } catch {
    return false;
  }
}

// Yield local (sin lib/anim: este módulo debe seguir libre de react-native para el selfcheck)
const tick = () => new Promise((r) => setTimeout(r, 0));

// Resultado determinista por origen: la app lo pide varias veces (pantalla + selector)
const NEAREST_CACHE = new Map<string, Promise<TotalityDirection | null>>();

/**
 * Busca el punto de totalidad más cercano probando 8 rumbos:
 * sondeo creciente (25→700 km) + bisección a ±2 km.
 * Devuelve null si la totalidad queda a más de 700 km en todas direcciones.
 * Memoizada por coordenada; cede el hilo en cada llamada al motor (~10-30 ms cada una).
 */
export function findNearestTotality(lat: number, lon: number, now?: Date): Promise<TotalityDirection | null> {
  // El ancla del eclipse activo va en la clave Y se fija para toda la búsqueda:
  // sin ella, cambiar de eclipse devolvía la totalidad memoizada del anterior.
  const searchStart = activeSearchStart(now);
  const key = `${searchStart.getTime()}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  let p = NEAREST_CACHE.get(key);
  if (!p) {
    p = searchNearestTotality(lat, lon, searchStart, now);
    NEAREST_CACHE.set(key, p);
  }
  return p;
}

async function searchNearestTotality(
  lat: number,
  lon: number,
  searchStart: Date,
  now?: Date,
): Promise<TotalityDirection | null> {
  let best: TotalityDirection | null = null;

  for (const bearing of BEARINGS) {
    let lo = 0; // último km conocido NO total
    let hi: number | null = null; // primer km conocido total
    for (const d of PROBE_DISTANCES_KM) {
      if (best && d >= best.distanceKm) break; // no puede mejorar
      await tick();
      const p = destination(lat, lon, bearing, d);
      if (isTotalAt(p.lat, p.lon, searchStart, now)) {
        hi = d;
        break;
      }
      lo = d;
    }
    if (hi === null) continue;
    let hiKm: number = hi;

    while (hiKm - lo > PRECISION_KM) {
      const mid = (lo + hiKm) / 2;
      await tick();
      const p = destination(lat, lon, bearing, mid);
      if (isTotalAt(p.lat, p.lon, searchStart, now)) hiKm = mid;
      else lo = mid;
    }

    if (!best || hiKm < best.distanceKm) {
      const p = destination(lat, lon, bearing, hiKm);
      // Punto justo en el límite tiene totalidad ~0 s; medimos 5 km más adentro para un dato útil
      const inner = destination(lat, lon, bearing, hiKm + 5);
      let durationSec: number | null = null;
      try {
        // Mismo filtro que isTotalAt: una duración de otro eclipse sería un dato falso
        const ecInner = computeLocalEclipse(inner.lat, inner.lon, 0, searchStart);
        durationSec = isActiveEclipse(ecInner, now) ? ecInner.totalityDurationSec : null;
      } catch {
        durationSec = null;
      }
      best = { distanceKm: Math.round(hiKm), bearingDeg: bearing, lat: p.lat, lon: p.lon, durationSec };
    }
  }
  return best;
}

const BEARING_KEYS = [
  'bearing.N', 'bearing.NE', 'bearing.E', 'bearing.SE',
  'bearing.S', 'bearing.SW', 'bearing.W', 'bearing.NW',
] as const;

export function bearingLabel(deg: number): string {
  return t(BEARING_KEYS[Math.round(deg / 45) % 8]);
}
