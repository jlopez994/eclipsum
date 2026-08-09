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

/** Fecha del eclipse (UTC civil). Misma ancla que lib/eclipse.ts. */
export const ECLIPSE_DATE = '2026-08-12';

const CACHE_VER = 'v2';

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
  const forecast = parseHours(times, covers);
  if (!isEclipseDayForecast(forecast)) throw new Error('Pronóstico no es del día del eclipse');
  return forecast;
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
    const forecast = parseHours(times, covers);
    return isEclipseDayForecast(forecast) ? forecast : null;
  });
}

function parseHours(times: unknown[], covers: unknown[]): CloudForecast {
  return {
    hours: times.map((t, i) => ({
      time: new Date(String(t) + (String(t).endsWith('Z') ? '' : ':00Z')),
      cloudCover: Number(covers[i]),
    })),
  };
}

/** True si todas las horas caen en el día civil UTC del eclipse. */
function isEclipseDayForecast(forecast: CloudForecast): boolean {
  if (forecast.hours.length === 0) return false;
  return forecast.hours.every((h) => h.time.toISOString().startsWith(ECLIPSE_DATE));
}

const cacheKey = (lat: number, lon: number) =>
  `eclipsum:clouds:${CACHE_VER}:${ECLIPSE_DATE}:${lat.toFixed(2)},${lon.toFixed(2)}`;

interface StoredForecast {
  at: number;
  day: string;
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
      day: ECLIPSE_DATE,
      hours: forecast.hours.map((h) => ({ t: h.time.getTime(), c: h.cloudCover })),
    };
    AsyncStorage.setItem(cacheKey(lat, lon), JSON.stringify(stored)).catch(() => {});
    return { forecast, ageMs: 0 };
  } catch {
    try {
      const raw = await AsyncStorage.getItem(cacheKey(lat, lon));
      if (!raw) return null;
      const stored = JSON.parse(raw) as Partial<StoredForecast>;
      if (stored.day !== ECLIPSE_DATE || typeof stored.at !== 'number' || !Array.isArray(stored.hours)) {
        return null;
      }
      const forecast: CloudForecast = {
        hours: stored.hours.map((h) => ({ time: new Date(h.t), cloudCover: h.c })),
      };
      if (!isEclipseDayForecast(forecast)) return null;
      return { forecast, ageMs: Date.now() - stored.at };
    } catch {
      return null;
    }
  }
}

/** Nubosidad interpolada a la hora dada, o la hora más cercana del día del eclipse. */
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
  // Fuera del rango estricto: hora más cercana (sigue siendo del 12 ago si el forecast lo es)
  let best = h[0];
  let bestD = Math.abs(h[0].time.getTime() - t);
  for (let i = 1; i < h.length; i++) {
    const d = Math.abs(h[i].time.getTime() - t);
    if (d < bestD) {
      bestD = d;
      best = h[i];
    }
  }
  // Evitar muestrear «hoy» si por error llega un when muy lejos del eclipse (>36 h)
  if (bestD > 36 * 3_600_000) return null;
  return Math.round(best.cloudCover);
}

/**
 * Enlace a Windy centrado en el máximo del eclipse (no en «ahora»).
 * HH de Windy solo admite 00/03/06/09/12/15/18/21 UTC.
 */
export function windyEclipseCloudsUrl(lat: number, lon: number, at: Date): string {
  const slot = Math.round(at.getUTCHours() / 3) * 3;
  const hh = String(Math.min(21, Math.max(0, slot))).padStart(2, '0');
  return `https://www.windy.com/?clouds,${ECLIPSE_DATE}-${hh},${lat.toFixed(3)},${lon.toFixed(3)},9`;
}
