// Ejecutar: npx tsx scripts/selfcheck.ts
import assert from 'node:assert';
import { computeLocalEclipse, currentPhase, nextEvent } from '../lib/eclipse';
import { cloudCoverAt } from '../lib/weather';
import { bearingLabel, findNearestTotality, haversineKm } from '../lib/totality';
import { listSpotOptions, type Spot } from '../lib/spots';
import { pushRecent, RECENT_CAP, type RecentSpot } from '../lib/prefs';

async function main() {
  // Zaragoza: dentro de la banda de totalidad del 2026-08-12
  const zgz = computeLocalEclipse(41.65, -0.88, 200);
  assert.equal(zgz.kind, 'total', 'Zaragoza debe ser total');
  assert.ok(zgz.obscuration > 0.999, 'Obscuración ~100%');
  assert.ok(
    zgz.totalityDurationSec! > 60 && zgz.totalityDurationSec! < 120,
    `Duración totalidad plausible: ${zgz.totalityDurationSec}s`,
  );
  assert.deepEqual(zgz.events.map((e) => e.key), ['C1', 'C2', 'MAX', 'C3', 'C4'], 'Cinco contactos ordenados');
  const max = zgz.events.find((e) => e.key === 'MAX')!;
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
  assert.equal(cloudCoverAt(forecast, new Date('2026-08-12T22:00:00Z')), null, 'Fuera de rango → null');

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

  // spots: desde Madrid, 10 lugares ordenados por distancia con circunstancias
  const spots = await listSpotOptions(40.42, -3.7);
  assert.equal(spots.length, 10, '10 lugares');
  assert.equal(spots[0].name, 'Madrid', 'El más cercano a Madrid es Madrid');
  for (let i = 1; i < spots.length; i++) {
    assert.ok(spots[i].distanceKm >= spots[i - 1].distanceKm, 'Orden por distancia');
  }
  assert.ok(spots.some((sp) => sp.kind === 'total'), 'Alguna ciudad cercana en la banda');
  assert.ok(spots.every((sp) => sp.maxTime !== null && sp.obscuration > 0.85), 'Circunstancias calculadas');

  console.log('selfcheck OK — Zaragoza total', zgz.totalityDurationSec + 's, máximo', max.time.toISOString());
  console.log(
    'Spots desde Madrid:',
    spots.slice(0, 4).map((sp) => `${sp.name} ${sp.distanceKm}km ${sp.kind}`).join(' · '),
  );
  console.log(
    'Sevilla → totalidad a', dir!.distanceKm, 'km al', bearingLabel(dir!.bearingDeg),
    `(${dir!.lat.toFixed(2)}, ${dir!.lon.toFixed(2)})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
