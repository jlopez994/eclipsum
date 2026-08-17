/**
 * Calibración de la brújula con el sol real: el usuario centra el sol en el visor y pulsa;
 * la diferencia entre el azimut astronómico del sol (exacto) y el rumbo que declara la
 * brújula es el error LOCAL del magnetómetro — declinación residual, metal cercano, funda.
 *
 * El offset se suma al rumbo de brújula ANTES de reanclar la base (withCompassBearing),
 * en todos los modos del visor: es una corrección del sensor, no del objetivo.
 *
 * Sin imports de react-native: selfcheck lo ejecuta en Node.
 */
import { bearingOf, shortDelta, type CameraBasis } from './skyProjection';
import { haversineKm } from './totality';

export interface CompassCalibration {
  /** Corrección aditiva al rumbo de brújula, grados con signo en [−180, 180) */
  offsetDeg: number;
  /** Instante de la medición, ms epoch */
  at: number;
  /** Dónde se midió: el error incluye el campo magnético de ESE sitio */
  lat: number;
  lon: number;
}

/**
 * Vigencia temporal: 2 h. La declinación no cambia en horas, pero sí lo demás que entró
 * en la medida — el entorno del móvil (coche, mochila, funda) y la deriva del magnetómetro.
 */
export const CALIBRATION_MAX_AGE_MS = 2 * 3_600_000;
/**
 * Vigencia espacial: 1 km. El offset medido incluye el campo magnético local (hierro del
 * terreno, edificios, catenarias); a un kilómetro ya es otro campo y la corrección vieja
 * puede empujar en la dirección equivocada.
 */
export const CALIBRATION_MAX_DRIFT_KM = 1;

/**
 * Mide la calibración al pulsar «centrar en el sol». `aimed` es la base ya filtrada y
 * reanclada a la brújula CRUDA — sin el offset vigente: recalibrar sustituye, no acumula.
 *
 * Devuelve null si el sol real no puede estar en el encuadre: bajo el horizonte, o con un
 * cabeceo de cámara incompatible con su altura. El cabeceo sí es de fiar —lo ancla la
 * gravedad, no el magnetómetro—, así que descarta pulsaciones sin sol delante sin tener
 * que juzgar el azimut, que es justo lo que se está calibrando.
 */
export function calibrate(
  sunAzimuthDeg: number,
  sunAltitudeDeg: number,
  aimed: CameraBasis,
  verticalFovDeg: number,
  at: number,
  lat: number,
  lon: number,
): CompassCalibration | null {
  if (sunAltitudeDeg <= 0) return null;
  const pitchDeg = (Math.asin(Math.min(1, Math.max(-1, aimed.forward.z))) * 180) / Math.PI;
  if (Math.abs(sunAltitudeDeg - pitchDeg) > verticalFovDeg / 2) return null;
  return { offsetDeg: shortDelta(bearingOf(aimed.forward), sunAzimuthDeg), at, lat, lon };
}

/** ¿Sigue valiendo la calibración aquí y ahora? Caduca por edad o por alejarse del punto. */
export function isCalibrationFresh(
  cal: CompassCalibration | null,
  atMs: number,
  lat: number,
  lon: number,
): cal is CompassCalibration {
  return (
    cal !== null &&
    // Reloj hacia atrás (medición «en el futuro»): mejor recalibrar que fiarse
    atMs >= cal.at &&
    atMs - cal.at <= CALIBRATION_MAX_AGE_MS &&
    haversineKm(cal.lat, cal.lon, lat, lon) <= CALIBRATION_MAX_DRIFT_KM
  );
}
