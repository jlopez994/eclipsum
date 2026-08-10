// Ejecutar: npx tsx scripts/selfcheck.ts
import assert from 'node:assert';
import { computeLocalEclipse, currentPhase, nextEvent } from '../lib/eclipse';
import {
  ECLIPSES,
  getActiveEclipse,
  getEclipseById,
  parseRemoteCatalog,
  setRemoteCatalog,
} from '../lib/eclipseCatalog';
import { cloudCoverAt } from '../lib/weather';
import { bearingLabel, findNearestTotality, haversineKm } from '../lib/totality';
import type { Spot } from '../lib/spots';
import { pushRecent, RECENT_CAP, type RecentSpot } from '../lib/prefs';
import { buildDrillEclipse, clampDrill, DEFAULT_DRILL } from '../lib/drill';

async function main() {
  const active = getActiveEclipse(new Date('2026-01-01T00:00:00Z'));
  assert.equal(active.id, '2026-08-12-iberia', 'Activo pre-evento = Iberia 2026');
  assert.ok(getEclipseById('2026-08-12-iberia'), 'Catálogo incluye Iberia 2026');
  assert.ok(ECLIPSES.length >= 1, 'Catálogo no vacío');

  // Zaragoza: dentro de la banda de totalidad del eclipse activo
  const zgz = computeLocalEclipse(41.65, -0.88, 200);
  assert.equal(zgz.kind, 'total', 'Zaragoza debe ser total');
  assert.ok(zgz.obscuration > 0.999, 'Obscuración ~100%');
  assert.ok(
    zgz.totalityDurationSec! > 60 && zgz.totalityDurationSec! < 120,
    `Duración totalidad plausible: ${zgz.totalityDurationSec}s`,
  );
  assert.deepEqual(zgz.events.map((e) => e.key), ['C1', 'C2', 'MAX', 'C3', 'C4'], 'Cinco contactos ordenados');
  const max = zgz.events.find((e) => e.key === 'MAX')!;
  assert.equal(
    max.time.toISOString().slice(0, 10),
    active.civilDate,
    `Máximo en día civil ${active.civilDate}`,
  );
  assert.equal(max.time.toISOString().slice(0, 16), '2026-08-12T18:29', 'Máximo 18:29 UTC (20:29 CEST)');

  // Sevilla: fuera de la banda → parcial
  const svq = computeLocalEclipse(37.39, -5.99, 10);
  assert.equal(svq.kind, 'partial', 'Sevilla debe ser parcial');
  assert.ok(svq.obscuration < 0.999 && svq.obscuration > 0.5, `Sevilla parcial profunda: ${svq.obscuration}`);

  // nextEvent
  assert.equal(nextEvent(zgz, new Date('2026-08-12T00:00:00Z'))?.key, 'C1');
  assert.equal(nextEvent(zgz, new Date('2026-08-12T18:30:00Z'))?.key, 'C3');
  assert.equal(nextEvent(zgz, new Date('2026-08-13T00:00:00Z')), null);

  // currentPhase
  assert.equal(currentPhase(zgz, new Date('2026-08-12T12:00:00Z')), null, 'Antes de C1 → null');
  assert.equal(currentPhase(zgz, new Date('2026-08-12T18:00:00Z'))?.safeToLook, false, 'Parcial → gafas');
  assert.equal(currentPhase(zgz, new Date('2026-08-12T18:29:30Z'))?.safeToLook, true, 'Totalidad → seguro mirar');
  assert.equal(currentPhase(zgz, new Date('2026-08-12T21:00:00Z')), null, 'Tras C4 → null');

  // cloudCoverAt (interpolación, sin red)
  const forecast = {
    hours: [
      { time: new Date('2026-08-12T18:00:00Z'), cloudCover: 20 },
      { time: new Date('2026-08-12T19:00:00Z'), cloudCover: 60 },
    ],
  };
  assert.equal(cloudCoverAt(forecast, new Date('2026-08-12T18:30:00Z')), 40, 'Interpolación lineal');
  assert.equal(cloudCoverAt(forecast, new Date('2026-08-12T22:00:00Z')), 60, 'Hora cercana del día del eclipse');
  assert.equal(cloudCoverAt(forecast, new Date('2026-08-09T12:00:00Z')), null, 'Día actual → null');

  // findNearestTotality desde Sevilla (parcial) — banda queda al norte
  const dir = await findNearestTotality(37.39, -5.99);
  assert.ok(dir, 'Sevilla debe encontrar totalidad alcanzable');
  assert.ok(dir!.distanceKm > 100 && dir!.distanceKm < 700, `Distancia plausible: ${dir!.distanceKm} km`);
  assert.ok(['N', 'NE', 'E'].includes(bearingLabel(dir!.bearingDeg)), `Rumbo hacia la banda: ${bearingLabel(dir!.bearingDeg)}`);
  const check = computeLocalEclipse(dir!.lat, dir!.lon);
  assert.equal(check.kind, 'total', 'Punto devuelto realmente es total');

  // pushRecent: acumula visitas, ordena por más visitado, tope RECENT_CAP
  const mk = (name: string, lat: number): Spot => ({ name, lat, lon: 0, origin: 'manual' });
  let rec: RecentSpot[] = [];
  for (const sp of [mk('A', 1), mk('B', 2), mk('A', 1), mk('C', 3), mk('D', 4)]) {
    rec = pushRecent(rec, sp);
  }
  assert.equal(rec.length, RECENT_CAP, 'Tope de habituales');
  assert.deepEqual(rec.map((r) => r.name), ['A', 'D', 'C'], 'Más visitado primero; empate → más reciente');
  assert.equal(rec[0].visits, 2, 'Contador acumulado');

  // haversine: Madrid-Zaragoza ~256 km en línea recta
  const mzKm = haversineKm(40.42, -3.7, 41.65, -0.88);
  assert.ok(Math.abs(mzKm - 256) < 20, `Madrid-Zaragoza plausible: ${mzKm.toFixed(0)} km`);

  // Catálogo por Remote Config: validación y rollover con entrada remota
  const rcEntry = {
    id: '2027-08-02-egipto',
    searchStart: '2027-07-20T00:00:00Z',
    civilDate: '2027-08-02',
    label: 'Total · 2 ago 2027',
    bandLabel: 'BANDA DE TOTALIDAD · 2 AGO 2027',
    bandTooltip: 'Banda de totalidad · 2 ago 2027',
    shortDateLabel: '2 AGO',
    windyFallbackMax: '2027-08-02T10:00:00Z',
  };
  assert.equal(parseRemoteCatalog('no es json').length, 0, 'JSON inválido → catálogo vacío');
  assert.equal(parseRemoteCatalog('{"a":1}').length, 0, 'No-array → vacío');
  assert.equal(
    parseRemoteCatalog(JSON.stringify([rcEntry, { id: 'roto', civilDate: 'ayer' }])).length,
    1,
    'Entradas malformadas se descartan; válidas pasan',
  );
  setRemoteCatalog(JSON.stringify([rcEntry]));
  assert.equal(getEclipseById('2027-08-02-egipto')?.label, 'Total · 2 ago 2027', 'Entrada RC resoluble por id');
  assert.equal(
    getActiveEclipse(new Date('2026-01-01T00:00:00Z')).id,
    '2026-08-12-iberia',
    'Con RC extra, 2026 sigue activo antes del evento',
  );
  assert.equal(
    getActiveEclipse(new Date('2027-01-01T00:00:00Z')).id,
    '2027-08-02-egipto',
    'Pasado 2026, rollover a la entrada RC',
  );
  setRemoteCatalog('[]');
  assert.equal(getEclipseById('2027-08-02-egipto'), undefined, 'Reset del catálogo remoto');

  // Simulacro: tramos configurados y geometría copiada del eclipse real
  const drillE = buildDrillEclipse(zgz, new Date('2026-08-10T15:00:00Z'), { partialMin: 15, totalitySec: 120 });
  const dt = (a: number, b: number) => (drillE.events[b].time.getTime() - drillE.events[a].time.getTime()) / 1000;
  assert.equal(drillE.kind, 'total', 'Drill: siempre total');
  assert.equal(dt(0, 1), 900, 'Drill: C1→C2 = 15 min');
  assert.equal(dt(1, 3), 120, 'Drill: totalidad = 120 s');
  assert.equal(dt(3, 4), 900, 'Drill: C3→C4 = 15 min');
  assert.equal(drillE.events[2].azimuth, zgz.events.find((e) => e.key === 'MAX')!.azimuth, 'Drill: azimut del MAX real');
  assert.deepEqual(clampDrill({ partialMin: 999, totalitySec: 1 }), { partialMin: 30, totalitySec: 45 }, 'Drill: clamp a rangos');
  assert.deepEqual(clampDrill(undefined), DEFAULT_DRILL, 'Drill: defaults si no hay config');
  assert.deepEqual(clampDrill({ partialMin: 15, totalitySec: 120 }), DEFAULT_DRILL, 'Drill: migra defaults de beta.7');
  assert.deepEqual(clampDrill({ partialMin: 15, totalitySec: 90 }), { partialMin: 15, totalitySec: 90 }, 'Drill: config elegida se respeta');

  // Catálogo agotado → la app genera sola el siguiente eclipse global con el motor
  const auto = getActiveEclipse(new Date('2030-01-01T00:00:00Z'));
  assert.equal(auto.civilDate, '2030-06-01', 'Auto: tras 2030-01-01 toca el anular del 1 jun 2030');
  assert.equal(auto.id, '2030-06-01-annular', 'Auto: id derivado de fecha y tipo');
  assert.equal(parseRemoteCatalog(JSON.stringify([auto])).length, 1, 'Auto: la entrada pasa el validador de RC');

  console.log('selfcheck OK — Zaragoza total', zgz.totalityDurationSec + 's, máximo', max.time.toISOString());
  console.log(
    'Sevilla → totalidad a', dir!.distanceKm, 'km al', bearingLabel(dir!.bearingDeg),
    `(${dir!.lat.toFixed(2)}, ${dir!.lon.toFixed(2)})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
