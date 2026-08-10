/**
 * Genera entradas de catálogo (`eclipse_catalog`) para los próximos eclipses solares.
 * Fechas y pico salen de astronomy-engine; labels en español derivados de la fecha.
 *
 * Uso:
 *   npx tsx scripts/genEclipse.ts                              # próximos 5 desde hoy
 *   npx tsx scripts/genEclipse.ts --from 2027-01-01 --count 3 --kind total
 *   npx tsx scripts/genEclipse.ts --kind total --write         # fusiona en remoteconfig.template.json
 *
 * Tras --write: revisar labels/ids, y `firebase deploy --only remoteconfig`.
 * El pico (lat/lon) que imprime sirve para centrar --lon-from/--lon-to de genBand.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  EclipseKind,
  NextGlobalSolarEclipse,
  SearchGlobalSolarEclipse,
  type GlobalSolarEclipseInfo,
} from 'astronomy-engine';
import { ECLIPSES, parseRemoteCatalog, type EclipseEntry } from '../lib/eclipseCatalog';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const FROM = new Date(arg('--from') ?? Date.now());
const COUNT = Number(arg('--count') ?? 5);
const KIND = arg('--kind') ?? 'all'; // total | annular | partial | all
const WRITE = process.argv.includes('--write');

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const KIND_LABEL: Record<string, string> = { total: 'Total', annular: 'Anular', partial: 'Parcial' };
const BAND_WORD: Record<string, string> = { total: 'totalidad', annular: 'anularidad' };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Margen del ancla searchStart: SearchLocalSolarEclipse busca el primer eclipse local tras ella. */
const SEARCH_START_DAYS_BEFORE = 15;

function entryFor(ev: GlobalSolarEclipseInfo): EclipseEntry {
  const peak = ev.peak.date;
  const kind = ev.kind as string;
  const civilDate = peak.toISOString().slice(0, 10);
  const d = peak.getUTCDate();
  const mes = MES[peak.getUTCMonth()];
  const year = peak.getUTCFullYear();
  const fecha = `${d} ${mes} ${year}`;
  const fechaMayus = `${d} ${mes.toUpperCase()} ${year}`;
  const word = BAND_WORD[kind];
  return {
    id: `${civilDate}-${kind}`,
    searchStart: `${new Date(peak.getTime() - SEARCH_START_DAYS_BEFORE * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`,
    civilDate,
    label: `${KIND_LABEL[kind]} · ${fecha}`,
    bandLabel: word ? `BANDA DE ${word.toUpperCase()} · ${fechaMayus}` : `ECLIPSE PARCIAL · ${fechaMayus}`,
    bandTooltip: word ? `Banda de ${word} · ${fecha}` : `Eclipse parcial · ${fecha}`,
    shortDateLabel: `${d} ${mes.toUpperCase()}`,
    windyFallbackMax: new Date(Math.round(peak.getTime() / HOUR_MS) * HOUR_MS)
      .toISOString()
      .replace('.000Z', 'Z'),
  };
}

const entries: EclipseEntry[] = [];
let ev = SearchGlobalSolarEclipse(FROM);
while (entries.length < COUNT) {
  const kind = ev.kind as string;
  if ((KIND === 'all' || KIND === kind) && kind !== EclipseKind.Penumbral) {
    const pico =
      ev.latitude !== undefined && ev.longitude !== undefined
        ? ` · pico lat ${ev.latitude.toFixed(1)} lon ${ev.longitude.toFixed(1)}`
        : '';
    const obs = ev.obscuration !== undefined ? ` · obscuración ${ev.obscuration.toFixed(2)}` : '';
    console.log(`— ${ev.peak.date.toISOString().slice(0, 16)}Z ${kind}${pico}${obs}`);
    entries.push(entryFor(ev));
  }
  ev = NextGlobalSolarEclipse(ev.peak);
}

// Autovalidación contra el validador real de la app: lo generado debe pasar el filtro de RC.
const validated = parseRemoteCatalog(JSON.stringify(entries));
if (validated.length !== entries.length) {
  throw new Error(`generadas ${entries.length} entradas pero solo ${validated.length} pasan parseRemoteCatalog`);
}

console.log('');
console.log(JSON.stringify(entries, null, 2));

const packaged = entries.filter((e) => ECLIPSES.some((p) => p.civilDate === e.civilDate));
if (packaged.length > 0) {
  console.log(`\nAVISO: ${packaged.map((e) => e.id).join(', ')} ya empaquetado en ECLIPSES (fusión por id lo ignorará si coincide el id).`);
}

if (WRITE) {
  const path = new URL('../remoteconfig.template.json', import.meta.url);
  const tpl = JSON.parse(readFileSync(path, 'utf8'));
  const current: EclipseEntry[] = parseRemoteCatalog(tpl.parameters.eclipse_catalog.defaultValue.value || '[]');
  const nuevos = entries.filter((e) => !current.some((c) => c.id === e.id));
  const merged = [...current, ...nuevos].sort((a, b) => a.civilDate.localeCompare(b.civilDate));
  tpl.parameters.eclipse_catalog.defaultValue.value = JSON.stringify(merged);
  writeFileSync(path, `${JSON.stringify(tpl, null, 2)}\n`);
  console.log(`\nOK — ${nuevos.length} entradas nuevas fusionadas en remoteconfig.template.json (total ${merged.length}).`);
  console.log('Publicar: firebase deploy --only remoteconfig');
}
