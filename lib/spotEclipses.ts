/**
 * Eclipses visibles desde UN punto concreto, pasados y futuros: responde «¿cuándo hubo
 * (o habrá) eclipse en esta zona?» iterando el motor local hacia delante desde el pasado.
 */
import { NextLocalSolarEclipse, Observer, SearchGlobalSolarEclipse, SearchLocalSolarEclipse } from 'astronomy-engine';

export interface SpotEclipseHit {
  /** Día civil UTC del PICO GLOBAL: la identidad de selección que entiende el catálogo. */
  civilDate: string;
  kind: 'partial' | 'annular' | 'total';
  /** Fracción del disco oculta en el máximo local, 0..1 */
  obscuration: number;
  /** Instante del máximo local */
  maxTime: Date;
}

/** Rango del barrido, alineado con los horizontes del catálogo (Ajustes). */
const YEARS_BACK = 25;
const YEARS_AHEAD = 8;
const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

// Una búsqueda por coordenada redondeada: la lista es determinista y cuesta ~0,5 s
const CACHE = new Map<string, Promise<SpotEclipseHit[]>>();
const CACHE_MAX = 40;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export function eclipsesFromSpot(lat: number, lon: number): Promise<SpotEclipseHit[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let p = CACHE.get(key);
  if (!p) {
    if (CACHE.size >= CACHE_MAX) CACHE.clear(); // ponytail: reset simple, como el memo de eclipse.ts
    p = searchSpotEclipses(lat, lon);
    CACHE.set(key, p);
  }
  return p;
}

/**
 * El día civil del máximo LOCAL puede caer ±1 del día del pico GLOBAL (picos cerca de
 * medianoche UTC). La selección viaja por día civil global, así que se canoniza aquí:
 * el primer eclipse global tras «máximo local − 2 días» es necesariamente el mismo evento.
 */
function globalCivilDate(localMax: Date): string {
  try {
    return SearchGlobalSolarEclipse(new Date(localMax.getTime() - 2 * DAY_MS))
      .peak.date.toISOString()
      .slice(0, 10);
  } catch {
    return localMax.toISOString().slice(0, 10);
  }
}

async function searchSpotEclipses(lat: number, lon: number): Promise<SpotEclipseHit[]> {
  const observer = new Observer(lat, lon, 0);
  const to = Date.now() + YEARS_AHEAD * YEAR_MS;
  const out: SpotEclipseHit[] = [];
  let ec = SearchLocalSolarEclipse(new Date(Date.now() - YEARS_BACK * YEAR_MS), observer);
  while (ec.peak.time.date.getTime() <= to) {
    // El motor también devuelve series con el eclipse entero bajo el horizonte
    // («might be partly or completely invisible»): sin sol a la vista no cuenta
    const anyAboveHorizon =
      ec.peak.altitude > 0 || ec.partial_begin.altitude > 0 || ec.partial_end.altitude > 0;
    if (anyAboveHorizon) {
      const localMax = ec.peak.time.date;
      out.push({
        civilDate: globalCivilDate(localMax),
        kind: ec.kind as SpotEclipseHit['kind'],
        obscuration: ec.obscuration,
        maxTime: localMax,
      });
    }
    await tick(); // cede el hilo: cada paso del motor son ~10-30 ms
    ec = NextLocalSolarEclipse(ec.peak.time, observer);
  }
  return out;
}
