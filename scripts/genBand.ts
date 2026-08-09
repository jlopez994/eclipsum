/**
 * Genera lib/bandGeo.ts: límites norte/sur de la banda de totalidad por longitud.
 *
 * Uso:
 *   npx tsx scripts/genBand.ts
 *   npx tsx scripts/genBand.ts --id 2026-08-12-iberia --export BAND_2026
 *
 * Sin args usa el eclipse activo del catálogo (o el primero) y export BAND_2026.
 * Nota: LAT_MAX=60 recorta la umbra al norte de Iberia; subir el tope para bandas polares.
 */
import { writeFileSync } from 'node:fs';
import { computeLocalEclipse } from '../lib/eclipse';
import { ECLIPSES, getEclipseById, type EclipseEntry } from '../lib/eclipseCatalog';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const entry: EclipseEntry =
  (arg('--id') ? getEclipseById(arg('--id')!) : undefined) ?? ECLIPSES[0];
const exportName = arg('--export') ?? 'BAND_2026';
const searchStart = new Date(entry.searchStart);

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

/** Refina el borde entre un lat total y uno no total (precisión ~0.01°). */
function refine(lon: number, inside: number, outside: number): number {
  let a = inside;
  let b = outside;
  for (let i = 0; i < 12; i++) {
    const mid = (a + b) / 2;
    if (isTotal(mid, lon)) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

const rows: { lon: number; latS: number; latN: number }[] = [];
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

const out = `/** Generado por scripts/genBand.ts — banda de totalidad ${entry.civilDate} (id ${entry.id}; no editar a mano). */
export interface BandSlice {
  lon: number;
  latS: number;
  latN: number;
}

export const ${exportName}: BandSlice[] = ${JSON.stringify(rows)};
`;
writeFileSync(new URL('../lib/bandGeo.ts', import.meta.url), out);
console.log(`OK — ${rows.length} cortes escritos en lib/bandGeo.ts (${exportName}, ${entry.id})`);
