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

/** Umbral (km) para considerar GPS y puesto el mismo sitio */
export const REAL_PLACE_KM = 1;

/** Tolerancia en grados (~1 km) con la que dos puestos cuentan como el mismo. */
const SAME_COORDS_DEG = 0.01;

/** Mismo sitio a efectos de UI y de histórico (dedupe de recientes, fila activa del selector). */
export function sameCoords(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < SAME_COORDS_DEG && Math.abs(a.lon - b.lon) < SAME_COORDS_DEG;
}

/** Nombre de lugar sin el sufijo de origen: «Madrid · GPS» → «Madrid». */
export function cleanPlaceLabel(name: string): string {
  return name.replace(/\s·\s(GPS|Manual)$/, '').trim();
}
