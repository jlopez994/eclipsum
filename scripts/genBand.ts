/**
 * Genera lib/bandGeo.ts: límites norte/sur de la banda de totalidad por longitud.
 * Conserva las bandas ya registradas de otros eclipses (solo recalcula la del --id).
 *
 * Uso:
 *   npx tsx scripts/genBand.ts
 *   npx tsx scripts/genBand.ts --id 2026-08-12-iberia
 *   npx tsx scripts/genBand.ts --id <id> --lon-from -80 --lon-to -60 --lat-min 10 --lat-max 40
 *   npx tsx scripts/genBand.ts --id <id> --rc   # imprime la entrada con banda para eclipse_catalog (RC)
 *
 * Sin args usa el primer eclipse del catálogo empaquetado; --id acepta también entradas
 * autogeneradas (próximos 12 del motor). Los rangos por defecto son Iberia; para otros
 * continentes centrar con el pico lat/lon que imprime scripts/genEclipse.ts (o el propio
 * peakLat/peakLon de la entrada). LAT_MAX=60 recorta bandas polares: subir el tope si aplica.
 */
import { writeFileSync } from 'node:fs';
import { computeLocalEclipse } from '../lib/eclipse';
import { bandForEclipse, type BandSlice } from '../lib/bandGeo';
import { ECLIPSES, getEclipseById, upcomingEclipses, type EclipseEntry } from '../lib/eclipseCatalog';
import { refineEdge } from './bandEdge';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const id = arg('--id');
const entry: EclipseEntry =
  (id ? getEclipseById(id) ?? upcomingEclipses(12).find((e) => e.id === id) : undefined) ?? ECLIPSES[0];
const searchStart = new Date(entry.searchStart);
const RC_MODE = process.argv.includes('--rc');

const LON_FROM = Number(arg('--lon-from') ?? -25);
const LON_TO = Number(arg('--lon-to') ?? 8);
const LON_STEP = Number(arg('--lon-step') ?? 0.5);
const LAT_MIN = Number(arg('--lat-min') ?? 30);
const LAT_MAX = Number(arg('--lat-max') ?? 60);

const isTotal = (lat: number, lon: number): boolean => {
  try {
    return computeLocalEclipse(lat, lon, 0, searchStart).kind === 'total';
  } catch {
    return false;
  }
};

const refine = (lon: number, inside: number, outside: number) => refineEdge(isTotal, lon, inside, outside);

const rows: BandSlice[] = [];
for (let lon = LON_FROM; lon <= LON_TO; lon += LON_STEP) {
  // Barrido grueso para encontrar algún punto dentro de la banda
  let seed: number | null = null;
  for (let lat = LAT_MIN; lat <= LAT_MAX; lat += 0.25) {
    if (isTotal(lat, lon)) {
      seed = lat;
      break;
    }
  }
  if (seed === null) continue;
  // Extiende hasta salir de la banda por ambos lados
  let n = seed;
  while (n < LAT_MAX && isTotal(n + 0.25, lon)) n += 0.25;
  let s = seed;
  while (s > LAT_MIN && isTotal(s - 0.25, lon)) s -= 0.25;
  const latN = refine(lon, n, Math.min(LAT_MAX, n + 0.25));
  const latS = refine(lon, s, Math.max(LAT_MIN, s - 0.25));
  rows.push({ lon, latS: +latS.toFixed(3), latN: +latN.toFixed(3) });
  process.stdout.write(`lon ${lon}: ${latS.toFixed(2)}..${latN.toFixed(2)}\n`);
}

if (rows.length === 0) {
  throw new Error('0 cortes: la banda no cruza el rango dado — ajustar --lon-from/--lon-to/--lat-min/--lat-max');
}

if (RC_MODE) {
  // Entrada completa con banda, lista para pegar en el array `eclipse_catalog` de RC
  console.log(JSON.stringify({ ...entry, band: rows }));
  process.exit(0);
}

// Registro nuevo = bandas existentes de los demás eclipses empaquetados + la recalculada.
const registry: Record<string, BandSlice[]> = {};
for (const e of ECLIPSES) {
  if (e.id === entry.id) continue;
  const band = bandForEclipse(e.id);
  if (band) registry[e.id] = band;
}
registry[entry.id] = rows;

const body = Object.entries(registry)
  .map(([id, band]) => `  '${id}': ${JSON.stringify(band)},`)
  .join('\n');

const out = `/** Generado por scripts/genBand.ts — bandas de totalidad por id de eclipse (no editar a mano). */
export interface BandSlice {
  lon: number;
  latS: number;
  latN: number;
}

/**
 * Bandas empaquetadas. Añadir/regenerar: \`npx tsx scripts/genBand.ts --id <id>\`
 * (conserva las demás bandas). Eclipses solo-RC sin banda: el mapa real pinta marcadores sin polígono.
 */
const BANDS_BY_ECLIPSE: Record<string, BandSlice[]> = {
${body}
};

export function bandForEclipse(id: string): BandSlice[] | null {
  return BANDS_BY_ECLIPSE[id] ?? null;
}
`;
writeFileSync(new URL('../lib/bandGeo.ts', import.meta.url), out);
console.log(
  `OK — ${entry.id}: ${rows.length} cortes; bandas en lib/bandGeo.ts: ${Object.keys(registry).join(', ')}`
);
