export interface CloudForecast {
  /** Hora local (Date) → nubosidad total % */
  hours: { time: Date; cloudCover: number }[];
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
