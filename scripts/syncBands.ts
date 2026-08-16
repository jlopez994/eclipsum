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
import { bandOf, parseRemoteCatalog } from '../lib/eclipseCatalog';
import { generateBand } from './bandWalk';

const TEMPLATE_URL = new URL('../remoteconfig.template.json', import.meta.url);
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

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
