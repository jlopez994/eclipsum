/**
 * Dónde ver un eclipse que no se ve desde el puesto elegido.
 *
 * El catálogo resuelve el caso fácil sin coste: los totales y anulares traen banda
 * empaquetada o punto de máximo. Los PARCIALES no traen ninguna de las dos cosas —el eje de
 * la sombra no llega a tocar la Tierra, así que el motor deja `latitude`/`longitude` sin
 * definir—, y son ~30 % de los eclipses navegables. Sin punto, la app no tenía adónde llevar
 * al usuario y lo dejaba en «aquí no se ve» sin salida.
 *
 * Para esos se barre el globo en malla gruesa y gana el punto de mayor ocultación. Basta con
 * malla gruesa: el destino solo tiene que caer DENTRO de la zona de visibilidad —que en un
 * parcial abarca miles de km—, y una vez allí el mapa ya calcula las cifras finas del sitio.
 */
import { computeLocalEclipse, eclipseDayOf } from './eclipse';
import { visiblePointFor, type EclipseEntry } from './eclipseCatalog';

export interface VisiblePoint {
  lat: number;
  lon: number;
}

/** Paso de la malla. 20° ≈ 162 puntos: suficiente para acertar la zona, barato de barrer. */
const STEP_DEG = 20;
/** Los polos se dejan fuera: nadie viaja ahí y el motor se vuelve inestable con el sol rasante. */
const LAT_LIMIT = 80;

// Una búsqueda por eclipse: el resultado es determinista y la pantalla lo pide al reubicar
const CACHE = new Map<string, Promise<VisiblePoint | null>>();
const CACHE_MAX = 40;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Punto desde el que SÍ se ve `e`. Null solo si el motor no encuentra el eclipse en ninguna
 * parte del globo (no debería pasar: todo eclipse se ve desde algún sitio).
 * Nunca lanza; memoizada por id.
 */
export function findVisiblePoint(e: EclipseEntry): Promise<VisiblePoint | null> {
  // Banda o punto de máximo: instantáneo, sin barrido ni caché que ensuciar
  const known = visiblePointFor(e);
  if (known) return Promise.resolve(known);

  let p = CACHE.get(e.id);
  if (!p) {
    if (CACHE.size >= CACHE_MAX) CACHE.clear(); // ponytail: reset simple, como el memo de eclipse.ts
    p = scanGlobe(e);
    CACHE.set(e.id, p);
  }
  return p;
}

async function scanGlobe(e: EclipseEntry): Promise<VisiblePoint | null> {
  const start = new Date(e.searchStart);
  let best: { lat: number; lon: number; obscuration: number } | null = null;
  for (let lat = -LAT_LIMIT; lat <= LAT_LIMIT; lat += STEP_DEG) {
    // El motor tarda ~10-30 ms por punto en el móvil: se cede el hilo en cada fila
    await tick();
    for (let lon = -180; lon < 180; lon += STEP_DEG) {
      try {
        const local = computeLocalEclipse(lat, lon, 0, start);
        // El motor busca hacia delante desde searchStart: desde un punto que no ve ESTE
        // eclipse devuelve el siguiente que sí, así que hay que comprobar el día
        if (eclipseDayOf(local) !== e.civilDate) continue;
        if (best === null || local.obscuration > best.obscuration) {
          best = { lat, lon, obscuration: local.obscuration };
        }
      } catch {
        // Punto sin solución para el motor: el barrido sigue con el resto
      }
    }
  }
  return best === null ? null : { lat: best.lat, lon: best.lon };
}
