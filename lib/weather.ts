import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CloudForecast {
  /** Hora local (Date) → nubosidad total % */
  hours: { time: Date; cloudCover: number }[];
}

export interface CachedCloudForecast {
  forecast: CloudForecast;
  /** ms desde la descarga; 0 = recién obtenida de red */
  ageMs: number;
}

const ECLIPSE_DATE = '2026-08-12'; // ponytail: fecha fija v1, igual que lib/eclipse.ts

/**
 * Nubosidad horaria del día del eclipse vía Open-Meteo (gratis, sin API key).
 * Lanza si no hay red o respuesta inválida — el caller decide cómo degradar.
 */
export async function fetchCloudCover(lat: number, lon: number): Promise<CloudForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=cloud_cover&start_date=${ECLIPSE_DATE}&end_date=${ECLIPSE_DATE}&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const times: unknown = json?.hourly?.time;
  const covers: unknown = json?.hourly?.cloud_cover;
  if (!Array.isArray(times) || !Array.isArray(covers) || times.length !== covers.length) {
    throw new Error('Respuesta Open-Meteo inesperada');
  }
  return {
    hours: times.map((t, i) => ({ time: new Date(String(t) + ':00Z'), cloudCover: Number(covers[i]) })),
  };
}

/**
 * Nubosidad para varios puntos en una sola llamada (Open-Meteo acepta listas separadas por coma).
 * Devuelve un pronóstico por punto, en el mismo orden; null por punto si la respuesta no cuadra.
 */
export async function fetchCloudCoverBatch(
  points: { lat: number; lon: number }[],
): Promise<(CloudForecast | null)[]> {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [await fetchCloudCover(points[0].lat, points[0].lon).catch(() => null)];
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p.lat).join(',')}` +
    `&longitude=${points.map((p) => p.lon).join(',')}` +
    `&hourly=cloud_cover&start_date=${ECLIPSE_DATE}&end_date=${ECLIPSE_DATE}&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const list: unknown = json;
  if (!Array.isArray(list) || list.length !== points.length) {
    throw new Error('Respuesta Open-Meteo por lote inesperada');
  }
  return list.map((item) => {
    const times: unknown = (item as { hourly?: { time?: unknown } })?.hourly?.time;
    const covers: unknown = (item as { hourly?: { cloud_cover?: unknown } })?.hourly?.cloud_cover;
    if (!Array.isArray(times) || !Array.isArray(covers) || times.length !== covers.length) return null;
    return {
      hours: times.map((t, i) => ({ time: new Date(String(t) + ':00Z'), cloudCover: Number(covers[i]) })),
    };
  });
}

const cacheKey = (lat: number, lon: number) => `eclipsum:clouds:${lat.toFixed(2)},${lon.toFixed(2)}`;

interface StoredForecast {
  at: number;
  hours: { t: number; c: number }[];
}

/**
 * Red primero (y guarda en caché); sin red, última respuesta guardada para
 * estas coordenadas. null = ni red ni caché.
 */
export async function fetchCloudCoverCached(lat: number, lon: number): Promise<CachedCloudForecast | null> {
  try {
    const forecast = await fetchCloudCover(lat, lon);
    const stored: StoredForecast = {
      at: Date.now(),
      hours: forecast.hours.map((h) => ({ t: h.time.getTime(), c: h.cloudCover })),
    };
    AsyncStorage.setItem(cacheKey(lat, lon), JSON.stringify(stored)).catch(() => {});
    return { forecast, ageMs: 0 };
  } catch {
    try {
      const raw = await AsyncStorage.getItem(cacheKey(lat, lon));
      if (!raw) return null;
      const stored = JSON.parse(raw) as Partial<StoredForecast>;
      if (typeof stored.at !== 'number' || !Array.isArray(stored.hours)) return null;
      return {
        forecast: { hours: stored.hours.map((h) => ({ time: new Date(h.t), cloudCover: h.c })) },
        ageMs: Date.now() - stored.at,
      };
    } catch {
      return null;
    }
  }
}

/** Nubosidad interpolada a la hora dada, o null si fuera de rango. */
export function cloudCoverAt(forecast: CloudForecast, when: Date): number | null {
  const h = forecast.hours;
  if (h.length === 0) return null;
  const t = when.getTime();
  for (let i = 0; i < h.length - 1; i++) {
    const a = h[i].time.getTime();
    const b = h[i + 1].time.getTime();
    if (t >= a && t <= b) {
      const f = (t - a) / (b - a);
      return Math.round(h[i].cloudCover + f * (h[i + 1].cloudCover - h[i].cloudCover));
    }
  }
  return null;
}
