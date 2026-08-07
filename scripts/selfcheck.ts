// Ejecutar: npx tsx scripts/selfcheck.ts
import assert from 'node:assert';
import { computeLocalEclipse, currentPhase, nextEvent } from '../lib/eclipse';
import { cloudCoverAt } from '../lib/weather';
import { bearingLabel, findNearestTotality } from '../lib/totality';

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
