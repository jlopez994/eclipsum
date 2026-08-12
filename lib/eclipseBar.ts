/**
 * Geometría de la barra de la serie del modo eclipse: tramos a ESCALA REAL.
 * La totalidad de un eclipse típico (1m 45s de 1h 48m) es un 1,6 % de la serie, así que
 * a escala pura no se vería; se le reserva una astilla con ancho mínimo. El resto del
 * reparto sí es proporcional, y `xAt` mapea instante → píxel tramo a tramo, de modo que
 * el marcador de «ahora» y la máscara caen siempre dentro del tramo que les toca.
 * Sin imports de react-native — selfcheck lo ejecuta en Node.
 */
import { eventAt, type EclipseEvent, type LocalEclipse } from './eclipse';

/** Hueco entre tramos, en px. */
export const BAR_GAP = 2;
/** La astilla de totalidad nunca baja de esto ni se come la barra. */
export const SLIVER_MIN = 7;
export const SLIVER_MAX = 24;

export interface BarPart {
  /** `all` = eclipse parcial: un solo tramo de C1 a C4 */
  key: 'in' | 'tot' | 'out' | 'all';
  left: number;
  width: number;
  from: number;
  to: number;
}

export interface BarLayout {
  parts: BarPart[];
  /** px desde el borde izquierdo para un instante, recortado a [C1, C4] */
  xAt(t: number): number;
  /** Centro de la astilla de totalidad; en un parcial, el máximo */
  markX: number;
  start: number;
  end: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function barLayout(eclipse: LocalEclipse, width: number): BarLayout | null {
  const at = (k: EclipseEvent['key']) => eventAt(eclipse, k)?.time.getTime();
  const c1 = at('C1');
  const c4 = at('C4');
  if (c1 === undefined || c4 === undefined || c4 <= c1 || width <= 0) return null;
  const c2 = at('C2');
  const c3 = at('C3');

  let parts: BarPart[];
  let markX: number;
  if (c2 === undefined || c3 === undefined || c3 <= c2) {
    parts = [{ key: 'all', left: 0, width, from: c1, to: c4 }];
    markX = (width * ((at('MAX') ?? (c1 + c4) / 2) - c1)) / (c4 - c1);
  } else {
    const avail = Math.max(SLIVER_MIN, width - 2 * BAR_GAP);
    const sliver = clamp(
      Math.round((avail * (c3 - c2)) / (c4 - c1)),
      SLIVER_MIN,
      Math.min(SLIVER_MAX, avail),
    );
    const legs = Math.max(0, avail - sliver);
    const inW = Math.round((legs * (c2 - c1)) / (c2 - c1 + (c4 - c3)));
    const totLeft = inW + BAR_GAP;
    const outLeft = totLeft + sliver + BAR_GAP;
    parts = [
      { key: 'in', left: 0, width: inW, from: c1, to: c2 },
      { key: 'tot', left: totLeft, width: sliver, from: c2, to: c3 },
      { key: 'out', left: outLeft, width: legs - inW, from: c3, to: c4 },
    ];
    markX = totLeft + sliver / 2;
  }

  const xAt = (t: number): number => {
    if (t <= c1) return 0;
    for (const p of parts) {
      if (t >= p.to) continue;
      return p.left + (p.width * (t - p.from)) / (p.to - p.from);
    }
    const last = parts[parts.length - 1];
    return last.left + last.width;
  };

  return { parts, xAt, markX, start: c1, end: c4 };
}
