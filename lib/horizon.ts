/**
 * Horizonte del terreno hacia el sol: ¿el relieve en la dirección del máximo puede
 * tapar el eclipse desde el puesto elegido? («¿me tapa ese monte?»)
 *
 * Modelo: perfil de elevaciones a lo largo del azimut del máximo (Open-Meteo Elevation,
 * rejilla de ~90 m) y, por muestra, el ángulo que ese punto subtiende desde el
 * observador descontando la caída por curvatura terrestre con refracción estándar.
 * El horizonte hacia ese azimut es el MÁXIMO de esos ángulos. Con 90 m de rejilla el
 * resultado no da para décimas de grado: es una estimación y el copy debe decirlo.
 *
 * Solo la descarga toca red y AsyncStorage; la geometría y el veredicto son puros
 * (selfcheck los ejecuta en Node).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { destination } from './totality';
import { fetchJson } from './weather';

/**
 * Muestreo logarítmico 0,2→20 km: el relieve cercano subtiende más grados por metro
 * (a 500 m, un talud de 50 m ya son ~6°; a 15 km ni se nota), así que la densidad va
 * donde importa. 24 muestras + el propio puesto = 25 puntos, una sola llamada (el API
 * admite hasta 100).
 * ponytail: 20 km de tope cubre el «¿me tapa ese monte?» típico; una cordillera lejana
 * con el sol muy bajo queda fuera — subir FAR_KM si algún día importa. Por debajo de
 * 0,2 km ya no es orografía sino edificios o árboles, que la rejilla de ~90 m ni ve.
 */
const NEAR_KM = 0.2;
const FAR_KM = 20;
const N_SAMPLES = 24;
export const SAMPLE_DISTANCES_KM: readonly number[] = Array.from(
  { length: N_SAMPLES },
  (_, i) => NEAR_KM * Math.pow(FAR_KM / NEAR_KM, i / (N_SAMPLES - 1)),
);

/**
 * Radio terrestre efectivo con refracción estándar: la luz se curva hacia la superficie
 * ~13 % de la curvatura de la Tierra, así que a efectos de visibilidad el mundo se
 * «aplana» ese 13 % — el clásico k = 0,13 de los cálculos de línea de vista.
 */
const R_EFF_KM = 6371 / (1 - 0.13);

/**
 * Ángulo de horizonte (grados, ≥0) que impone el perfil de elevaciones al observador.
 * Por muestra: atan((elev − elevObservador − caída) / dist), con caída por curvatura y
 * refracción `d²/(2·R_efectiva)`. Muestras sin dato del API (NaN) se ignoran. Mínimo 0°:
 * el mar o un valle por debajo del observador no tapan el sol, y un horizonte deprimido
 * solo adelantaría el ocaso unos segundos — nada que avisar.
 */
export function horizonAngleDeg(
  observerElevM: number,
  samples: readonly { distKm: number; elevM: number }[],
): number {
  let best = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.elevM) || s.distKm <= 0) continue;
    const dropM = (s.distKm * s.distKm * 1000) / (2 * R_EFF_KM);
    const angle = (Math.atan2(s.elevM - observerElevM - dropM, s.distKm * 1000) * 180) / Math.PI;
    if (angle > best) best = angle;
  }
  return best;
}

export interface TerrainVerdict {
  /** Ángulo de horizonte del terreno hacia el azimut del MÁXIMO (lo que pinta el diagrama) */
  horizonDeg: number;
  /** Altura del sol en el máximo: la referencia del copy «sol a X°» */
  sunAltDeg: number;
  /** Hitos con el sol sobre el horizonte astronómico pero por debajo del relieve */
  blockedKeys: string[];
}

/** Hito con el horizonte del terreno muestreado hacia SU azimut, no el del máximo. */
export interface EventTerrain {
  key: string;
  altitude: number;
  horizonDeg: number;
}

/**
 * Veredicto por hito: sol por debajo del ángulo del terreno en un contacto visible ⇒
 * ese contacto posiblemente oculto tras el relieve. Cada contacto se compara contra el
 * horizonte de SU azimut: entre C1 y C4 el sol se corre hasta ~30° de rumbo y el monte
 * que tapa uno puede no pintar nada en otro — con un solo perfil el aviso mentiría con
 * nombre y apellido de contacto. Los hitos ya bajo el horizonte real (altitude < 0) no
 * cuentan — no se ven con o sin monte y la cronología ya los marca.
 * null si el máximo no es visible: sin sol no hay nada que tapar. La altura del sol
 * lleva la refracción de astronomy-engine y el terreno la suya (R efectiva): comparar
 * ambas directamente es coherente al nivel de precisión de la rejilla.
 */
export function terrainVerdict(events: readonly EventTerrain[]): TerrainVerdict | null {
  const max = events.find((e) => e.key === 'MAX');
  if (!max || max.altitude <= 0) return null;
  return {
    horizonDeg: max.horizonDeg,
    sunAltDeg: max.altitude,
    blockedKeys: events.filter((e) => e.altitude > 0 && e.altitude < e.horizonDeg).map((e) => e.key),
  };
}

const CACHE_PREFIX = 'eclipsum:horizon:v1:';

/**
 * El terreno no cambia: caché primero (AsyncStorage, sin caducidad) y red solo la
 * primera vez por puesto+azimut — al revés que la meteo, que es red-primero porque su
 * dato envejece. La clave lleva el azimut redondeado (dos hitos o eclipses con el sol
 * en el mismo rumbo comparten perfil) y el puesto a 3 decimales: ~111 m, la propia
 * rejilla del modelo de elevación — dos puestos más juntos que eso ven el mismo dato.
 * Promesa memoizada en memoria como findNearestTotality;
 * un fallo (sin red) se olvida para poder reintentar en la siguiente consulta.
 * ponytail: la caché crece ~20 bytes por puesto consultado; poda si algún día pesa.
 */
const MEM = new Map<string, Promise<number | null>>();

export function terrainHorizonDeg(lat: number, lon: number, azimuthDeg: number): Promise<number | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}:${Math.round(azimuthDeg)}`;
  let p = MEM.get(key);
  if (!p) {
    p = loadOrFetchHorizon(lat, lon, azimuthDeg, CACHE_PREFIX + key).then((v) => {
      if (v === null) MEM.delete(key);
      return v;
    });
    MEM.set(key, p);
  }
  return p;
}

async function loadOrFetchHorizon(
  lat: number,
  lon: number,
  azimuthDeg: number,
  storageKey: string,
): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    const cached = raw === null ? NaN : Number(raw);
    if (Number.isFinite(cached)) return cached;
  } catch {
    // Caché ilegible: se sigue a red como si no existiera
  }
  try {
    // El puesto va de primer punto: su elevación sale de la misma llamada
    const points = [{ lat, lon }, ...SAMPLE_DISTANCES_KM.map((d) => destination(lat, lon, azimuthDeg, d))];
    const elevations = await fetchElevations(points);
    const deg = horizonAngleDeg(
      elevations[0],
      SAMPLE_DISTANCES_KM.map((d, i) => ({ distKm: d, elevM: elevations[i + 1] })),
    );
    AsyncStorage.setItem(storageKey, String(deg)).catch(() => {});
    return deg;
  } catch {
    // Sin red o respuesta inválida: null y silencio — el aviso simplemente no aparece
    return null;
  }
}

/**
 * Elevaciones (m) de varios puntos en una llamada (Open-Meteo Elevation acepta listas
 * separadas por coma). Respuesta real: {"elevation":[224.0, …]} en el mismo orden.
 * Lanza si no cuadra; la del observador debe ser finita — sin referencia no hay ángulo.
 */
async function fetchElevations(points: { lat: number; lon: number }[]): Promise<number[]> {
  const url =
    'https://api.open-meteo.com/v1/elevation' +
    `?latitude=${points.map((p) => p.lat.toFixed(4)).join(',')}` +
    `&longitude=${points.map((p) => p.lon.toFixed(4)).join(',')}`;
  const json = (await fetchJson(url)) as { elevation?: unknown } | null;
  const elevation: unknown = json?.elevation;
  if (!Array.isArray(elevation) || elevation.length !== points.length) {
    throw new Error('Respuesta de elevación inesperada');
  }
  // Number(null) es 0, no NaN: sin esta guarda un punto sin dato pasaría por nivel del
  // mar y podría suprimir una obstrucción real (o colar un observador sin elevación)
  const values = elevation.map((v) => (v === null ? NaN : Number(v)));
  if (!Number.isFinite(values[0])) throw new Error('Elevación del observador sin dato');
  return values;
}
