import { sunPosition } from './eclipse';
import type { Projection } from './skyProjection';

/** Punto del recorrido del sol: dónde está en un instante concreto. */
export interface SunArcPoint {
  /** Instante, ms epoch */
  at: number;
  azimuthDeg: number;
  altitudeDeg: number;
}

/**
 * Paso del muestreo. El sol recorre ~0,25°/min: cada 3 min son <1° entre puntos, muy por
 * debajo de la franja de error que se pinta encima (≥5°) — la polilínea se ve como curva.
 */
export const SUN_ARC_STEP_MS = 3 * 60_000;

/**
 * Recorrido del sol entre dos instantes, para dibujarlo como ARCO en el visor en vez de
 * como un punto: responde «¿qué me tapa durante el eclipse?», no «¿dónde estará a las
 * 20:29?», y además es tolerante al error — un desvío de brújula mueve el arco entero,
 * pero lo que cruza o no cruza se ve igual.
 *
 * Incluye siempre el último instante aunque no caiga en el paso. Los puntos bajo el
 * horizonte se devuelven tal cual: quien pinta decide (p. ej. el sol se pone a mitad).
 */
export function sunArc(
  lat: number,
  lon: number,
  startMs: number,
  endMs: number,
  stepMs = SUN_ARC_STEP_MS,
): SunArcPoint[] {
  if (!(endMs > startMs) || !(stepMs > 0)) return [];
  const count = Math.ceil((endMs - startMs) / stepMs);
  return Array.from({ length: count + 1 }, (_, i) => {
    const at = Math.min(startMs + i * stepMs, endMs);
    return { at, ...sunPosition(lat, lon, 0, new Date(at)) };
  });
}

/** Proyección de un punto del arco ya en coordenadas de pantalla (px, y hacia abajo). */
export interface ArcPixel {
  x: number;
  y: number;
  /** Delante de la cámara: detrás, la proyección está espejada y no se debe unir */
  inFront: boolean;
}

/** Separación angular a partir de la cual un punto cuenta como «detrás» de la cámara. */
export const IN_FRONT_MAX_OFF_AXIS_DEG = 89;

/** Normalizado (−1..1, y hacia arriba) → píxeles (y hacia abajo). */
export function toPixel(shot: Projection, size: { w: number; h: number }): ArcPixel {
  return {
    x: size.w / 2 + (shot.x * size.w) / 2,
    y: size.h / 2 - (shot.y * size.h) / 2,
    inFront: shot.offAxisDeg < IN_FRONT_MAX_OFF_AXIS_DEG,
  };
}

/** Polilínea SVG con un trazo por tramo continuo delante de la cámara. */
export function arcPath(points: ArcPixel[]): string {
  return points
    .reduce<string[]>((acc, p, i) => {
      if (!p.inFront) return acc;
      const prevInFront = i > 0 && points[i - 1].inFront;
      return [...acc, `${prevInFront ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`];
    }, [])
    .join(' ');
}
