/**
 * Genera las bandas que falten en el `eclipse_catalog` de remoteconfig.template.json.
 * Para cada entrada sin `band` (y sin banda empaquetada en bandGeo) camina el path de
 * centralidad desde el pico global: no necesita rangos manuales como genBand.ts.
 *
 * Uso:
 *   npx tsx scripts/syncBands.ts                    # completa todas las que falten y escribe el template
 *   npx tsx scripts/syncBands.ts --only 2027-08-02  # solo ese día civil
 *   npx tsx scripts/syncBands.ts --dry-run          # calcula e informa, sin escribir
 *
 * Coste: miles de llamadas al motor (~1-5 min por eclipse). Tras escribir:
 *   firebase deploy --only remoteconfig
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SearchGlobalSolarEclipse } from 'astronomy-engine';
import { computeLocalEclipse } from '../lib/eclipse';
import type { BandSlice } from '../lib/bandGeo';
import { bandOf, parseRemoteCatalog, type EclipseEntry } from '../lib/eclipseCatalog';

const TEMPLATE_URL = new URL('../remoteconfig.template.json', import.meta.url);
const LON_STEP = 1; // 1° basta para el polígono global y deja la banda en ~2-3 KB
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

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

/** Borde de banda por bisección entre un lat dentro y uno fuera (~0.01°). */
function refine(inBand: (lat: number, lon: number) => boolean, lon: number, inside: number, outside: number): number {
  let a = inside;
  let b = outside;
  for (let i = 0; i < 12; i++) {
    const mid = (a + b) / 2;
    if (inBand(mid, lon)) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** Corte de banda en `lon` buscando alrededor de `hintLat`; null = la banda no pasa por aquí. */
function sliceAt(
  inBand: (lat: number, lon: number) => boolean,
  lon: number,
  hintLat: number,
  window: number,
): BandSlice | null {
  let seed: number | null = null;
  for (let d = 0; d <= window; d += 1) {
    if (inBand(hintLat + d, lon)) seed = hintLat + d;
    else if (d > 0 && inBand(hintLat - d, lon)) seed = hintLat - d;
    if (seed !== null) break;
  }
  if (seed === null) return null;
  let n = seed;
  while (n < 85 && inBand(n + 1, lon)) n += 1;
  let s = seed;
  while (s > -85 && inBand(s - 1, lon)) s -= 1;
  const latN = refine(inBand, lon, n, n + 1);
  const latS = refine(inBand, lon, s, s - 1);
  return { lon, latS: +latS.toFixed(3), latN: +latN.toFixed(3) };
}

/** Camina el path desde el pico hacia ambos lados hasta que la banda se acaba. */
function generateBand(entry: EclipseEntry): BandSlice[] {
  const ev = SearchGlobalSolarEclipse(new Date(entry.searchStart));
  if (ev.peak.date.toISOString().slice(0, 10) !== entry.civilDate) {
    throw new Error(`${entry.id}: el motor no encuentra el eclipse en ${entry.civilDate}`);
  }
  const kind = ev.kind as string;
  const peakLat = ev.latitude ?? 0;
  const peakLon = wrapLon(Math.round(ev.longitude ?? 0));
  const inBand = makeInBand(entry, kind);

  const start = sliceAt(inBand, peakLon, Math.round(peakLat), 30);
  if (!start) throw new Error(`${entry.id}: sin centralidad en el pico (${peakLat}, ${peakLon})`);

  const walk = (dir: 1 | -1): BandSlice[] => {
    const out: BandSlice[] = [];
    let hint = (start.latS + start.latN) / 2;
    let misses = 0;
    // El path cubre como mucho media vuelta por lado; 2 fallos seguidos = fin de banda
    for (let i = 1; i <= 180 / LON_STEP && misses < 2; i++) {
      const slice = sliceAt(inBand, wrapLon(peakLon + dir * i * LON_STEP), Math.round(hint), 8);
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

const template = JSON.parse(readFileSync(TEMPLATE_URL, 'utf8')) as {
  parameters: Record<string, { defaultValue: { value: string } }>;
};
const catalogParam = template.parameters.eclipse_catalog;
const entries = parseRemoteCatalog(catalogParam.defaultValue.value);
if (entries.length === 0) throw new Error('eclipse_catalog vacío o inválido en el template');

let generated = 0;
for (const entry of entries) {
  if (ONLY && entry.civilDate !== ONLY) continue;
  if (bandOf(entry)) {
    console.log(`✓ ${entry.id} ya tiene banda`);
    continue;
  }
  console.log(`Generando banda de ${entry.id}…`);
  entry.band = generateBand(entry);
  generated++;
  console.log(`✓ ${entry.id}: ${entry.band.length} cortes (~${Math.round(JSON.stringify(entry.band).length / 1024)} KB)`);
}

if (generated === 0) {
  console.log('Nada que generar.');
} else if (DRY_RUN) {
  console.log(`dry-run: ${generated} banda(s) calculadas, template sin tocar`);
} else {
  catalogParam.defaultValue.value = JSON.stringify(entries);
  writeFileSync(TEMPLATE_URL, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`Template actualizado con ${generated} banda(s). Publicar: firebase deploy --only remoteconfig`);
}
