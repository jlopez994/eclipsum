/**
 * Eclipses de luna del rango navegable, solo para consulta: se ven a simple vista desde
 * todo el hemisferio nocturno, así que no llevan puesto, banda ni alertas — la app no los
 * «activa». Mismos horizontes que el catálogo solar (~8 años adelante, ~25 atrás).
 *
 * Sin imports de react-native: selfcheck lo ejecuta en Node.
 */
import { NextLunarEclipse, SearchLunarEclipse } from 'astronomy-engine';

export interface LunarEclipseHit {
  /** Día civil UTC del máximo */
  civilDate: string;
  kind: 'penumbral' | 'partial' | 'total';
  /** Instante del máximo (hora local al formatear) */
  peak: Date;
}

const YEARS_BACK = 25;
const YEARS_AHEAD = 8;
const YEAR_MS = 365.25 * 86_400_000;

/** Una pasada por día civil: el barrido son ~80 pasos del motor (baratos, pero no gratis). */
let cache: { key: string; list: LunarEclipseHit[] } | null = null;

/** Todos los eclipses lunares del rango, en orden cronológico. Nunca lanza: motor fallando → []. */
export function lunarEclipses(now: Date = new Date()): LunarEclipseHit[] {
  const key = now.toISOString().slice(0, 10);
  if (cache?.key !== key) {
    const to = now.getTime() + YEARS_AHEAD * YEAR_MS;
    const out: LunarEclipseHit[] = [];
    try {
      let ec = SearchLunarEclipse(new Date(now.getTime() - YEARS_BACK * YEAR_MS));
      while (ec.peak.date.getTime() <= to) {
        out.push({
          civilDate: ec.peak.date.toISOString().slice(0, 10),
          kind: ec.kind as LunarEclipseHit['kind'],
          peak: ec.peak.date,
        });
        ec = NextLunarEclipse(ec.peak);
      }
    } catch {
      // motor fallando: lista vacía, la UI enseña su estado vacío
    }
    cache = { key, list: out };
  }
  return cache.list;
}
