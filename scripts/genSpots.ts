/**
 * Regenera `suggested_spots` (RC) con ciudades del eclipse ACTIVO: las que de verdad
 * ven totalidad/anularidad, ordenadas por población y repartidas.
 *
 * Por qué automático: la lista se curaba a mano por eclipse, así que al pasar el evento
 * quedaba apuntando a la banda anterior y el filtro de la app (solo puestos dentro de la
 * banda activa) dejaba la sección VACÍA. Sin fecha que vigilar: el eclipse activo rueda
 * solo al siguiente, y el cron mensual de sync-remote-config vuelve a pasar por aquí.
 *
 * Ciudades: fichero de GeoNames (`cities15000.txt`, TSV, dominio público). No se empaqueta
 * —2 MB para 6 nombres— sino que el workflow lo descarga en cada ejecución.
 *
 * Uso:
 *   curl -sSL https://download.geonames.org/export/dump/cities15000.zip -o /tmp/c.zip
 *   unzip -p /tmp/c.zip cities15000.txt > /tmp/cities15000.txt
 *   npx tsx scripts/genSpots.ts --cities /tmp/cities15000.txt            # imprime
 *   npx tsx scripts/genSpots.ts --cities /tmp/cities15000.txt --write    # escribe el template
 *   npx tsx scripts/genSpots.ts --cities … --day 2027-08-02              # otro eclipse
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { computeLocalEclipse, eclipseDayOf, eventAt } from '../lib/eclipse';
import { bandOf, eclipseForDay, getActiveEclipse, type EclipseEntry } from '../lib/eclipseCatalog';
import { haversineKm } from '../lib/totality';

export interface City {
  name: string;
  lat: number;
  lon: number;
  population: number;
  /** Código ISO de GeoNames; decide el tramo de prioridad, no la validez del puesto. */
  country: string;
}

/** Tope de la app (`MAX_SUGGESTED_SPOTS` en lib/firebase): de más no se leen. */
const MAX_SPOTS = 6;
/** Ciudades que se pasan por el motor: las más pobladas de la banda ya cubren de sobra. */
const MAX_CANDIDATES = 400;
/** Sin esto los 6 puestos salen del mismo área metropolitana y no son alternativas. */
const MIN_SEPARATION_KM = 100;
/** Banda muestreada cada 1° de longitud: margen para la ciudad que cae entre dos rodajas. */
const BAND_MARGIN_DEG = 0.5;
/**
 * Público de la app (español por defecto): sus ciudades van primero aunque la banda cruce
 * megaurbes de otro continente. Sin esto el total de 2027 sugería Yeda y Saná mientras
 * Cádiz y Málaga, dentro de la banda, se caían del top 6 por tamaño.
 */
const PRIORITY_COUNTRIES = new Set([
  'ES', 'PT', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GQ', 'GT',
  'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
]);
/** Eclipse sin banda (parcial): radio y mordida mínima para que merezca la pena el viaje. */
const PARTIAL_RADIUS_KM = 3000;
const PARTIAL_MIN_OBSCURATION = 0.5;

/** Ciudades de GeoNames (cities15000.txt): TSV sin cabecera, columnas por posición. */
export function parseCities(tsv: string): City[] {
  const out: City[] = [];
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const population = Number(f[14]);
    if (!f[1] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      name: f[1],
      lat,
      lon,
      population: Number.isFinite(population) ? population : 0,
      country: f[8] ?? '',
    });
  }
  return out;
}

/**
 * Puestos del eclipse: ciudades DENTRO de la banda (o con mordida gorda si es parcial),
 * verificadas una a una con el motor —la banda es una envolvente, no un veredicto—,
 * las del público de la app primero, luego por población y separadas entre sí para que
 * sean alternativas de verdad y no seis barrios de la misma ciudad.
 */
export function pickSpots(cities: City[], entry: EclipseEntry, count = MAX_SPOTS): City[] {
  const band = bandOf(entry);
  const slices = new Map(band?.map((s) => [s.lon, s]) ?? []);
  const peak =
    typeof entry.peakLat === 'number' && typeof entry.peakLon === 'number'
      ? { lat: entry.peakLat, lon: entry.peakLon }
      : null;

  const near = cities.filter((c) => {
    if (band) {
      const slice = slices.get(Math.round(c.lon));
      return !!slice && c.lat >= slice.latS - BAND_MARGIN_DEG && c.lat <= slice.latN + BAND_MARGIN_DEG;
    }
    return peak !== null && haversineKm(peak.lat, peak.lon, c.lat, c.lon) <= PARTIAL_RADIUS_KM;
  });

  const searchStart = new Date(entry.searchStart);
  const picked: City[] = [];
  const ranked = [...near]
    .sort((a, b) => {
      const pa = PRIORITY_COUNTRIES.has(a.country) ? 1 : 0;
      const pb = PRIORITY_COUNTRIES.has(b.country) ? 1 : 0;
      return pb - pa || b.population - a.population;
    })
    .slice(0, MAX_CANDIDATES);
  for (const city of ranked) {
    const local = computeLocalEclipse(city.lat, city.lon, 0, searchStart);
    // El primer eclipse local tras el ancla puede ser OTRO si desde ahí no se ve este
    if (eclipseDayOf(local) !== entry.civilDate) continue;
    const max = eventAt(local, 'MAX');
    // Bajo el horizonte el eclipse existe en los números y no en el cielo
    if (!max || max.altitude <= 0) continue;
    if (band ? local.kind === 'partial' : local.obscuration < PARTIAL_MIN_OBSCURATION) continue;
    if (picked.some((p) => haversineKm(p.lat, p.lon, city.lat, city.lon) < MIN_SEPARATION_KM)) continue;
    picked.push(city);
    if (picked.length === count) break;
  }
  return picked;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const citiesPath = arg('--cities');
  if (!citiesPath) throw new Error('falta --cities <ruta a cities15000.txt>');
  const day = arg('--day');
  const entry = day ? eclipseForDay(day) : getActiveEclipse();
  if (!entry) throw new Error(`sin eclipse para el día ${day}`);

  const cities = parseCities(readFileSync(citiesPath, 'utf8'));
  const picked = pickSpots(cities, entry);
  console.log(`${entry.id} (${entry.civilDate}) · ${cities.length} ciudades · ${picked.length} puestos`);
  for (const c of picked) {
    console.log(
      `— ${c.name} (${c.country}) · ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)} · ${c.population.toLocaleString('es-ES')} hab.`,
    );
  }
  if (picked.length === 0) {
    // Sin puestos no se toca nada: dejar los anteriores es menos malo que vaciar la sección
    console.log('\nAVISO: ninguna ciudad dentro de la banda — template intacto.');
    return;
  }

  const value = JSON.stringify(
    picked.map((c) => ({ name: c.name, lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)) })),
  );
  if (!process.argv.includes('--write')) {
    console.log(`\n${value}`);
    return;
  }
  const path = new URL('../remoteconfig.template.json', import.meta.url);
  const tpl = JSON.parse(readFileSync(path, 'utf8')) as {
    parameters: Record<string, { defaultValue: { value: string } }>;
  };
  tpl.parameters.suggested_spots.defaultValue.value = value;
  writeFileSync(path, `${JSON.stringify(tpl, null, 2)}\n`);
  console.log('\nOK — suggested_spots actualizado en remoteconfig.template.json.');
  console.log('Publicar: firebase deploy --only remoteconfig');
}

// Importado desde selfcheck solo por pickSpots/parseCities: sin --cities no hay nada que hacer
if (process.argv.includes('--cities')) main();
