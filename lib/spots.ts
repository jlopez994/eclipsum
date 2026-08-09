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
