/**
 * Walker de bandas de centralidad, compartido por syncBands (RC) y genBandPack (bundle):
 * camina el path desde el pico global a ambos lados sin necesitar rangos manuales.
 * Coste: miles de llamadas al motor, ~1-5 min por eclipse.
 */
import { SearchGlobalSolarEclipse } from 'astronomy-engine';
import { computeLocalEclipse } from '../lib/eclipse';
import type { BandSlice } from '../lib/bandGeo';
import type { EclipseEntry } from '../lib/eclipseCatalog';
import { refineEdge as refine } from './bandEdge';

const LON_STEP = 1; // 1° basta para el polígono global y deja la banda en ~2-3 KB

const wrapLon = (lon: number): number => ((lon + 540) % 360) - 180;

/** El punto ve la centralidad (total/anular) de ESTE eclipse (guard por día civil). */
function makeInBand(entry: EclipseEntry, kind: string) {
  const searchStart = new Date(entry.searchStart);
  return (lat: number, lon: number): boolean => {
    if (lat < -85 || lat > 85) return false;
    try {
      const ec = computeLocalEclipse(lat, lon, 0, searchStart);
      if (ec.kind !== kind) return false;
      const max = ec.events.find((e) => e.key === 'MAX');
      return max?.time.toISOString().slice(0, 10) === entry.civilDate;
    } catch {
      return false;
    }
  };
}

/**
 * Corte de banda en `lon` buscando alrededor de `hintLat`; null = la banda no pasa por aquí.
 * `step` fija la rejilla del barrido: las bandas híbridas y anulares finas miden <1° de
 * alto y una rejilla de 1° se las salta enteras.
 */
function sliceAt(
  inBand: (lat: number, lon: number) => boolean,
  lon: number,
  hintLat: number,
  window: number,
  step = 1,
): BandSlice | null {
  let seed: number | null = null;
  for (let d = 0; d <= window; d += step) {
    if (inBand(hintLat + d, lon)) seed = hintLat + d;
    else if (d > 0 && inBand(hintLat - d, lon)) seed = hintLat - d;
    if (seed !== null) break;
  }
  if (seed === null) return null;
  let n = seed;
  while (n < 85 && inBand(n + step, lon)) n += step;
  let s = seed;
  while (s > -85 && inBand(s - step, lon)) s -= step;
  const latN = refine(inBand, lon, n, n + step);
  const latS = refine(inBand, lon, s, s - step);
  return { lon, latS: +latS.toFixed(3), latN: +latN.toFixed(3) };
}

/** Camina el path desde el pico hacia ambos lados hasta que la banda se acaba. */
export function generateBand(entry: EclipseEntry): BandSlice[] {
  const ev = SearchGlobalSolarEclipse(new Date(entry.searchStart));
  if (ev.peak.date.toISOString().slice(0, 10) !== entry.civilDate) {
    throw new Error(`${entry.id}: el motor no encuentra el eclipse en ${entry.civilDate}`);
  }
  const kind = ev.kind as string;
  const peakLat = ev.latitude ?? 0;
  const peakLon = wrapLon(Math.round(ev.longitude ?? 0));
  const inBand = makeInBand(entry, kind);

  // Primero rejilla fina sobre el pico EXACTO: en híbridos y anulares estrechas la banda
  // mide <1° y el pico redondeado a grado entero puede caer justo fuera. El barrido
  // grueso de siempre queda como fallback para picos con longitud «rara».
  const start =
    sliceAt(inBand, peakLon, peakLat, 3, 0.25) ?? sliceAt(inBand, peakLon, Math.round(peakLat), 30);
  if (!start) throw new Error(`${entry.id}: sin centralidad en el pico (${peakLat}, ${peakLon})`);
  // Banda fina → caminar también con rejilla fina (×4 llamadas, solo para estos eclipses)
  const step = start.latN - start.latS < 1.5 ? 0.25 : 1;

  const walk = (dir: 1 | -1): BandSlice[] => {
    const out: BandSlice[] = [];
    let hint = (start.latS + start.latN) / 2;
    let misses = 0;
    // El path cubre como mucho media vuelta por lado; 2 fallos seguidos = fin de banda
    for (let i = 1; i <= 180 / LON_STEP && misses < 2; i++) {
      const slice = sliceAt(inBand, wrapLon(peakLon + dir * i * LON_STEP), hint, 8, step);
      if (!slice) {
        misses++;
        continue;
      }
      misses = 0;
      hint = (slice.latS + slice.latN) / 2;
      out.push(slice);
      process.stdout.write(`  lon ${slice.lon}: ${slice.latS.toFixed(1)}..${slice.latN.toFixed(1)}\n`);
    }
    return out;
  };

  return [...walk(-1).reverse(), start, ...walk(1)];
}
