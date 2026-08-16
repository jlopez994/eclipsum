/**
 * Empaqueta las bandas de TODA la ventana navegable (histórico + próximos) en
 * lib/bandGeo.ts: cero mantenimiento y cero red — el mapa pinta banda para cualquier
 * eclipse de las listas sin depender de Remote Config ni de releases.
 *
 * Incremental: conserva las bandas ya empaquetadas y calcula solo las que falten
 * (la historia no cambia — se paga una vez). Los parciales no tienen path central.
 *
 * Uso:
 *   npx tsx scripts/genBandPack.ts                  # completa las que falten y escribe bandGeo.ts
 *   npx tsx scripts/genBandPack.ts --only 2017-08-21
 *   npx tsx scripts/genBandPack.ts --dry-run
 *
 * Coste: ~1-5 min por banda que falte (miles de llamadas al motor).
 */
import { writeFileSync } from 'node:fs';
import { SearchGlobalSolarEclipse } from 'astronomy-engine';
import { bandForEclipse, type BandSlice } from '../lib/bandGeo';
import { pastEclipses, upcomingEclipses, type EclipseEntry } from '../lib/eclipseCatalog';
import { generateBand } from './bandWalk';

const OUT_URL = new URL('../lib/bandGeo.ts', import.meta.url);
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

// 999 = «todas las que haya»: ambas listas capan en su horizonte interno, así que la
// ventana del pack sigue sola a la del catálogo sin repetir constantes aquí
const candidates: EclipseEntry[] = [...pastEclipses(999).reverse(), ...upcomingEclipses(999)];

const registry: Record<string, BandSlice[]> = {};
let generated = 0;
let failed = 0;
for (const entry of candidates) {
  if (ONLY && entry.civilDate !== ONLY) {
    const existing = bandForEclipse(entry.id);
    if (existing) registry[entry.id] = existing;
    continue;
  }
  const existing = bandForEclipse(entry.id);
  if (existing) {
    registry[entry.id] = existing;
    console.log(`✓ ${entry.id} ya empaquetada (${existing.length} cortes)`);
    continue;
  }
  const kind = SearchGlobalSolarEclipse(new Date(entry.searchStart)).kind as string;
  if (kind === 'partial') continue; // sin path central: no hay banda que dibujar
  console.log(`Generando banda de ${entry.id}…`);
  try {
    registry[entry.id] = generateBand(entry);
    generated++;
    console.log(
      `✓ ${entry.id}: ${registry[entry.id].length} cortes (~${Math.round(JSON.stringify(registry[entry.id]).length / 1024)} KB)`,
    );
  } catch (e) {
    // Un eclipse raro (banda polar recortada, híbrido) no debe tirar el pack entero
    failed++;
    console.error(`✗ ${entry.id}: ${e instanceof Error ? e.message : e}`);
  }
}

const totalKb = Math.round(JSON.stringify(registry).length / 1024);
console.log(`\n${Object.keys(registry).length} bandas (${generated} nuevas, ${failed} fallidas), ~${totalKb} KB`);

if (DRY_RUN) {
  console.log('dry-run: bandGeo.ts sin tocar');
  process.exit(0);
}

const body = Object.entries(registry)
  .map(([id, band]) => `  '${id}': ${JSON.stringify(band)},`)
  .join('\n');

const out = `/** Generado por scripts/genBandPack.ts — bandas de totalidad/anularidad por id (no editar a mano). */
export interface BandSlice {
  lon: number;
  latS: number;
  latN: number;
}

/**
 * Bandas empaquetadas de toda la ventana navegable (histórico + próximos).
 * Regenerar/completar: \`npx tsx scripts/genBandPack.ts\` (incremental: solo las que falten).
 * Eclipses sin banda (parciales): el mapa real pinta marcadores sin polígono.
 */
const BANDS_BY_ECLIPSE: Record<string, BandSlice[]> = {
${body}
};

export function bandForEclipse(id: string): BandSlice[] | null {
  return BANDS_BY_ECLIPSE[id] ?? null;
}
`;
writeFileSync(OUT_URL, out);
console.log(`bandGeo.ts actualizado (${Object.keys(registry).length} bandas).`);
