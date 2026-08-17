// Ejecutar: npx tsx scripts/selfcheck.ts
import assert from 'node:assert';
import {
  computeLocalEclipse,
  currentPhase,
  eclipseSpan,
  eventAt,
  isActiveEclipse,
  nextEvent,
  sunCoverage,
  sunPosition,
} from '../lib/eclipse';
import {
  calibrate,
  CALIBRATION_MAX_AGE_MS,
  isCalibrationFresh,
  type CompassCalibration,
} from '../lib/compassCalibration';
import { BAR_GAP, barLayout, SLIVER_MAX, SLIVER_MIN } from '../lib/eclipseBar';
import {
  bandOf,
  ECLIPSES,
  getActiveEclipse,
  getEclipseById,
  parseRemoteCatalog,
  pastEclipses,
  setRemoteCatalog,
  setUserSelectedEclipseDay,
  upcomingEclipses,
} from '../lib/eclipseCatalog';
import { cloudCoverAt } from '../lib/weather';
import { apparentAngleDeg, horizonAngleDeg, profileAngles, SAMPLE_DISTANCES_KM, terrainVerdict } from '../lib/horizon';
import { eclipsesFromSpot } from '../lib/spotEclipses';
import { bearingLabel, findNearestTotality, haversineKm } from '../lib/totality';
import type { Spot } from '../lib/spots';
import {
  ALERT_EARLY_SECONDS,
  contextFor,
  DEFAULT_PREFS,
  DONATE_PROMPT_AFTER,
  DONATE_PROMPT_DONE,
  pushRecent,
  RECENT_CAP,
  withContext,
  type RecentSpot,
} from '../lib/prefs';
import { buildDrillEclipse, DRILL_PARTIAL_SEC, DRILL_TOTALITY_SEC } from '../lib/drill';
import {
  bearingOf,
  cameraBasis,
  fovFor,
  norm360,
  project,
  skyVector,
  smoothBasis,
  smoothBearing,
  withCompassBearing,
  type CameraBasis,
} from '../lib/skyProjection';

async function main() {
  // Nota: la caché del automático es monótona en el tiempo — los asserts van en fechas crecientes
  assert.equal(
    getActiveEclipse(new Date('2026-01-01T00:00:00Z')).id,
    '2026-02-17-annular',
    'Auto cronológico: el anular de feb 2026 va antes que Iberia',
  );
  // Ancla temporal de TODOS los asserts de Iberia 2026: sin fecha explícita, el motor usa
  // el reloj real y el día después del eclipse el activo rueda al siguiente — el selfcheck
  // debe pasar igual antes, durante y después de cada evento del catálogo
  const T0 = new Date('2026-06-01T00:00:00Z');
  const active = getActiveEclipse(T0);
  assert.equal(active.id, '2026-08-12-iberia', 'Pasado feb 2026, activo = Iberia');
  const start = new Date(active.searchStart);
  assert.equal(
    upcomingEclipses(1, T0)[0].id,
    active.id,
    'Lista y activo comparten la definición de «próximo»',
  );
  assert.ok(getEclipseById('2026-08-12-iberia'), 'Catálogo incluye Iberia 2026');
  assert.ok(ECLIPSES.length >= 1, 'Catálogo no vacío');

  // Zaragoza: dentro de la banda de totalidad del eclipse activo
  const zgz = computeLocalEclipse(41.65, -0.88, 200, start);
  assert.equal(zgz.kind, 'total', 'Zaragoza debe ser total');
  assert.ok(zgz.obscuration > 0.999, 'Obscuración ~100%');
  assert.ok(
    zgz.totalityDurationSec! > 60 && zgz.totalityDurationSec! < 120,
    `Duración totalidad plausible: ${zgz.totalityDurationSec}s`,
  );
  assert.deepEqual(zgz.events.map((e) => e.key), ['C1', 'C2', 'MAX', 'C3', 'C4'], 'Cinco contactos ordenados');
  const max = eventAt(zgz, 'MAX')!;

  // eclipseSpan: primer y último contacto (ventana del modo eclipse y del raíl)
  const span = eclipseSpan(zgz)!;
  assert.equal(span.start, eventAt(zgz, 'C1')!.time.getTime(), 'Span: arranca en C1');
  assert.equal(span.end, eventAt(zgz, 'C4')!.time.getTime(), 'Span: termina en C4');
  assert.equal(eclipseSpan({ ...zgz, events: [] }), null, 'Span: serie vacía → null');
  assert.equal(eventAt(zgz, 'C2')?.key, 'C2', 'eventAt: encuentra el contacto pedido');

  // El ocaso debe ser POSTERIOR a C1: anclarlo en el pico − 12 h devolvía la puesta de
  // la víspera en eclipses de mañana (Azores 2027-08-02)
  assert.ok(
    zgz.sunset !== null && zgz.sunset.getTime() > span.start,
    `Ocaso posterior a C1: ${zgz.sunset?.toISOString()}`,
  );
  assert.equal(
    max.time.toISOString().slice(0, 10),
    active.civilDate,
    `Máximo en día civil ${active.civilDate}`,
  );
  assert.equal(max.time.toISOString().slice(0, 16), '2026-08-12T18:29', 'Máximo 18:29 UTC (20:29 CEST)');

  // Sevilla: fuera de la banda → parcial
  const svq = computeLocalEclipse(37.39, -5.99, 10, start);
  assert.equal(svq.kind, 'partial', 'Sevilla debe ser parcial');
  assert.ok(svq.obscuration < 0.999 && svq.obscuration > 0.5, `Sevilla parcial profunda: ${svq.obscuration}`);
  assert.equal(eventAt(svq, 'C2'), undefined, 'eventAt: un parcial no tiene C2');

  // Fuera del footprint del activo el motor contesta con OTRO eclipse: nada que lo pinte
  // puede fiarse de kind/obscuración/duración sin pasar por isActiveEclipse
  assert.ok(isActiveEclipse(zgz, T0), 'Zaragoza ve el eclipse activo');
  const syd = computeLocalEclipse(-33.87, 151.21, 0, start);
  assert.equal(syd.kind, 'total', 'Sídney: el motor devuelve un total… de otro eclipse');
  assert.ok(!isActiveEclipse(syd, T0), 'Sídney NO ve el eclipse activo (serie de 2028)');
  assert.equal(
    await findNearestTotality(-37.81, 144.96, T0),
    null,
    'Melbourne: sin totalidad del activo cerca — no debe ofrecer la banda de 2028',
  );

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

  // Horizonte del terreno (sin red): muestreo, ángulo con curvatura y veredicto
  assert.equal(SAMPLE_DISTANCES_KM.length, 24, 'Terreno: 24 muestras — con el puesto, una sola llamada');
  assert.ok(
    Math.abs(SAMPLE_DISTANCES_KM[0] - 0.2) < 1e-9 && Math.abs(SAMPLE_DISTANCES_KM[23] - 20) < 1e-9,
    'Terreno: muestreo de 0,2 a 20 km',
  );
  assert.ok(
    SAMPLE_DISTANCES_KM.every((d, i) => i === 0 || d > SAMPLE_DISTANCES_KM[i - 1]),
    'Terreno: distancias estrictamente crecientes',
  );
  // Todo el perfil por debajo del observador (mar, valle): nada tapa → 0°
  assert.equal(
    horizonAngleDeg(50, SAMPLE_DISTANCES_KM.map((d) => ({ distKm: d, elevM: 0 }))),
    0,
    'Terreno: el mar no tapa (mínimo 0°)',
  );
  // Monte 500 m por encima a 3 km: atan(500/3000) ≈ 9,45° (la caída a 3 km es <1 m)
  const hill = horizonAngleDeg(200, [{ distKm: 3, elevM: 700 }]);
  assert.ok(Math.abs(hill - 9.45) < 0.1, `Terreno: monte claro ≈ 9,5° (${hill})`);
  // Curvatura+refracción: a 20 km una loma de 100 m «pierde» ~27 m → ángulo menor que el plano
  const farAngle = horizonAngleDeg(0, [{ distKm: 20, elevM: 100 }]);
  const flatAngle = (Math.atan2(100, 20_000) * 180) / Math.PI;
  assert.ok(farAngle > 0 && farAngle < flatAngle, `Terreno: la curvatura rebaja lo lejano (${farAngle} < ${flatAngle})`);
  // Muestras sin dato del API se ignoran en vez de romper el máximo
  assert.equal(
    horizonAngleDeg(0, [{ distKm: 1, elevM: NaN }, { distKm: 2, elevM: -50 }]),
    0,
    'Terreno: NaN del API ignorado',
  );
  // Silueta: mismo cálculo por muestra que el máximo del horizonte, y sin las vacías
  assert.ok(
    Math.abs(apparentAngleDeg(200, 3, 700) - horizonAngleDeg(200, [{ distKm: 3, elevM: 700 }])) < 1e-9,
    'Silueta: el ángulo por muestra coincide con el horizonte de una sola muestra',
  );
  const profElev = SAMPLE_DISTANCES_KM.map((_, i) => (i === 3 ? NaN : 50));
  const prof = profileAngles({ obsElevM: 0, elevM: profElev });
  assert.equal(prof.length, SAMPLE_DISTANCES_KM.length - 1, 'Silueta: muestras sin dato fuera');
  assert.ok(
    prof.every((p, i) => i === 0 || p.angleDeg < prof[i - 1].angleDeg),
    'Silueta: misma loma cada vez más lejos → ángulo aparente decreciente',
  );
  // Veredicto: cada contacto contra el terreno de SU azimut — C1 con el sol a 2° tras
  // un terreno de 5° hacia su rumbo → posiblemente oculto, aunque hacia el máximo el
  // horizonte sea de 1°; C4 ya bajo el horizonte real no cuenta (no se ve con o sin monte)
  const terrainEvents = [
    { key: 'C1', altitude: 2, horizonDeg: 5 },
    { key: 'MAX', altitude: 12, horizonDeg: 1 },
    { key: 'C4', altitude: -3, horizonDeg: 8 },
  ];
  const blockedVerdict = terrainVerdict(terrainEvents)!;
  assert.deepEqual(blockedVerdict.blockedKeys, ['C1'], 'Veredicto: obstrucción solo en C1, con su azimut');
  assert.equal(blockedVerdict.sunAltDeg, 12, 'Veredicto: altura del sol en el máximo');
  assert.equal(blockedVerdict.horizonDeg, 1, 'Veredicto: el copy enseña el horizonte hacia el máximo');
  assert.deepEqual(
    terrainVerdict(terrainEvents.map((e) => ({ ...e, horizonDeg: 1.5 })))!.blockedKeys,
    [],
    'Veredicto: terreno bajo en todos los rumbos → despejado',
  );
  assert.equal(
    terrainVerdict([{ key: 'MAX', altitude: -5, horizonDeg: 3 }]),
    null,
    'Veredicto: sin sol en el máximo → sin aviso',
  );

  // findNearestTotality desde Sevilla (parcial) — banda queda al norte
  const dir = await findNearestTotality(37.39, -5.99, T0);
  assert.ok(dir, 'Sevilla debe encontrar totalidad alcanzable');
  assert.ok(dir!.distanceKm > 100 && dir!.distanceKm < 700, `Distancia plausible: ${dir!.distanceKm} km`);
  assert.ok(['N', 'NE', 'E'].includes(bearingLabel(dir!.bearingDeg)), `Rumbo hacia la banda: ${bearingLabel(dir!.bearingDeg)}`);
  const check = computeLocalEclipse(dir!.lat, dir!.lon, 0, start);
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

  // Aviso de donación: silencioso hasta el umbral y definitivo tras resolverlo
  const donateVisible = (opens: number) => opens >= DONATE_PROMPT_AFTER;
  assert.ok(!donateVisible(DEFAULT_PREFS.donateOpens), 'Recién instalada: sin aviso de donación');
  assert.ok(!donateVisible(DONATE_PROMPT_AFTER - 1), 'Bajo el umbral: sin aviso');
  assert.ok(donateVisible(DONATE_PROMPT_AFTER), 'Alcanzado el umbral: aviso visible');
  assert.ok(!donateVisible(DONATE_PROMPT_DONE), 'Resuelto (donó o descartó): nunca vuelve');

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
    getActiveEclipse(new Date('2026-06-01T00:00:00Z')).id,
    '2026-08-12-iberia',
    'Con RC extra, 2026 sigue activo antes del evento',
  );
  assert.equal(
    getActiveEclipse(new Date('2027-01-01T00:00:00Z')).id,
    '2027-02-06-annular',
    'Pasado 2026, el próximo cronológico gana (RC no adelanta la cola)',
  );
  assert.equal(
    upcomingEclipses(4, new Date('2027-01-01T00:00:00Z')).some((e) => e.id === '2027-08-02-egipto'),
    true,
    'La entrada RC aparece en la lista con su id propio (dedupe por día)',
  );
  // Banda por RC: viaja en la entrada, inválida se descarta sola, bundled cae a bandGeo
  const band = [
    { lon: 30, latS: 24, latN: 27 },
    { lon: 31, latS: 24.2, latN: 27.2 },
  ];
  setRemoteCatalog(JSON.stringify([{ ...rcEntry, band }]));
  assert.deepEqual(bandOf(getEclipseById('2027-08-02-egipto')!), band, 'Banda RC resoluble vía bandOf');
  setRemoteCatalog(JSON.stringify([{ ...rcEntry, band: [{ lon: 'x' }] }]));
  const noBand = getEclipseById('2027-08-02-egipto')!;
  assert.equal(noBand.band, undefined, 'Banda malformada se descarta; la entrada sobrevive');
  assert.equal(bandOf(noBand), null, 'Sin banda RC ni empaquetada → null');
  assert.ok(bandOf(getEclipseById('2026-08-12-iberia')!), 'Entrada empaquetada cae a la banda de bandGeo');

  // Dos entradas remotas del mismo día (copia-pega en RC): solo la primera entra
  setRemoteCatalog(JSON.stringify([rcEntry, { ...rcEntry, id: '2027-08-02-duplicado' }]));
  assert.equal(
    upcomingEclipses(6, new Date('2027-01-01T00:00:00Z')).filter((e) => e.civilDate === '2027-08-02').length,
    1,
    'RC: entradas remotas duplicadas por día no duplican la lista',
  );
  assert.equal(getEclipseById('2027-08-02-duplicado'), undefined, 'RC: el duplicado no es resoluble');

  setRemoteCatalog('[]');
  assert.equal(getEclipseById('2027-08-02-egipto'), undefined, 'Reset del catálogo remoto');

  // Simulacro: tramos fijos mínimos y geometría copiada del eclipse real
  const drillE = buildDrillEclipse(zgz, new Date('2026-08-10T15:00:00Z'));
  const dt = (a: number, b: number) => (drillE.events[b].time.getTime() - drillE.events[a].time.getTime()) / 1000;
  assert.equal(drillE.kind, 'total', 'Drill: siempre total');
  assert.equal(dt(0, 1), DRILL_PARTIAL_SEC, 'Drill: C1→C2 = parcial fijo');
  assert.equal(dt(1, 3), DRILL_TOTALITY_SEC, 'Drill: totalidad fija');
  assert.equal(dt(3, 4), DRILL_PARTIAL_SEC, 'Drill: C3→C4 = parcial fijo');
  assert.equal(drillE.events[2].azimuth, zgz.events.find((e) => e.key === 'MAX')!.azimuth, 'Drill: azimut del MAX real');
  // Los mínimos deben dejar sitio a los avisos anticipados sin cruzarse entre hitos
  assert.ok(DRILL_PARTIAL_SEC > ALERT_EARLY_SECONDS, 'Drill: aviso previo a C2 cae tras C1');
  assert.ok(DRILL_TOTALITY_SEC / 2 > ALERT_EARLY_SECONDS, 'Drill: MAX suena antes del aviso previo a C3');

  // Sol cubierto: 0 en los contactos exteriores, 1 en toda la totalidad, null fuera
  const zC1 = eventAt(zgz, 'C1')!.time;
  const zC2 = eventAt(zgz, 'C2')!.time;
  const zC4 = eventAt(zgz, 'C4')!.time;
  assert.equal(sunCoverage(zgz, new Date(zC1.getTime() - 1000)), null, 'Cubierto: null antes de C1');
  assert.equal(sunCoverage(zgz, new Date(zC4.getTime() + 1000)), null, 'Cubierto: null tras C4');
  assert.ok(sunCoverage(zgz, zC1)! < 0.001, 'Cubierto: 0 en C1');
  assert.equal(sunCoverage(zgz, eventAt(zgz, 'MAX')!.time), 1, 'Cubierto: 1 en el máximo de un total');
  // A mitad del parcial la magnitud vale 0,5 → un 39 % de área, no un 50 %
  const halfCov = sunCoverage(zgz, new Date((zC1.getTime() + zC2.getTime()) / 2))!;
  assert.ok(Math.abs(halfCov - 0.391) < 0.01, `Cubierto: media magnitud ≈ 39 % (${halfCov})`);
  let prevCov = -1;
  for (let k = 0; k <= 20; k++) {
    const cov = sunCoverage(zgz, new Date(zC1.getTime() + ((zC2.getTime() - zC1.getTime()) * k) / 20))!;
    assert.ok(cov >= prevCov, 'Cubierto: crece sin saltos hasta C2');
    prevCov = cov;
  }
  // Parcial profundo: el pico coincide con la obscuración que da el motor
  const svqMax = sunCoverage(svq, eventAt(svq, 'MAX')!.time)!;
  assert.ok(Math.abs(svqMax - svq.obscuration) < 0.01, `Cubierto: pico = obscuración (${svqMax})`);
  // El simulacro no tiene geometría celeste real y aun así da una curva coherente
  assert.equal(sunCoverage(drillE, eventAt(drillE, 'MAX')!.time), 1, 'Cubierto: simulacro tapa del todo');

  // Barra de la serie: tramos a escala, astilla con ancho mínimo y mapeo instante → px
  const bar = barLayout(zgz, 380)!;
  const [legIn, sliver, legOut] = bar.parts;
  assert.equal(bar.parts.length, 3, 'Barra: parcial + totalidad + parcial');
  assert.equal(sliver.width, SLIVER_MIN, 'Barra: la totalidad real cabe en el mínimo');
  assert.ok(legIn.width > 100 && legOut.width > 100, 'Barra: los parciales se reparten el resto');
  assert.equal(sliver.left, legIn.width + BAR_GAP, 'Barra: la astilla arranca tras el primer hueco');
  assert.ok(legOut.left + legOut.width <= 380, 'Barra: la serie no se sale del ancho dado');
  assert.equal(bar.xAt(zC1.getTime() - 60_000), 0, 'Barra: antes de C1 pega al origen');
  assert.equal(bar.xAt(zC4.getTime() + 60_000), legOut.left + legOut.width, 'Barra: tras C4 llega al final');
  assert.ok(Math.abs(bar.xAt(zC2.getTime()) - sliver.left) < 0.001, 'Barra: C2 cae al empezar la astilla');
  assert.ok(
    bar.markX > sliver.left && bar.markX < sliver.left + sliver.width,
    'Barra: la marca centra la astilla',
  );
  let prevX = -1;
  for (let k = 0; k <= 50; k++) {
    const x = bar.xAt(zC1.getTime() + ((zC4.getTime() - zC1.getTime()) * k) / 50);
    assert.ok(x >= prevX, 'Barra: el marcador avanza siempre');
    prevX = x;
  }
  // Simulacro: la totalidad ocupa el 43 % de la serie, así que la astilla llega al tope
  assert.equal(barLayout(drillE, 380)!.parts[1].width, SLIVER_MAX, 'Barra: simulacro tope la astilla');
  // Un parcial no tiene astilla: un solo tramo de C1 a C4
  assert.equal(barLayout(svq, 380)!.parts.length, 1, 'Barra: eclipse parcial, tramo único');

  // upcomingEclipses: catálogo + autogenerados, sin duplicar el día del empaquetado
  const up = upcomingEclipses(5, new Date('2026-01-01T00:00:00Z'));
  assert.equal(up.length, 5, 'Upcoming: cinco entradas');
  assert.equal(up[0].id, '2026-02-17-annular', 'Upcoming: incluye el anular de feb 2026 previo a Iberia');
  assert.ok(up.some((e) => e.id === '2026-08-12-iberia'), 'Upcoming: la entrada empaquetada, con su id propio');
  assert.equal(up.filter((e) => e.civilDate === '2026-08-12').length, 1, 'Upcoming: sin duplicados por día');
  assert.ok(
    up.every((e, i) => i === 0 || up[i - 1].civilDate < e.civilDate),
    'Upcoming: orden cronológico',
  );
  assert.ok(up[0].peakLat !== undefined && up[0].peakLon !== undefined, 'Upcoming: autogenerados llevan pico');

  // Contexto per-eclipse: defaults, parche inmutable y aislamiento entre eclipses
  const ctxDefault = contextFor(DEFAULT_PREFS, 'x');
  assert.equal(ctxDefault.spot, null, 'Contexto: sin puesto por defecto');
  assert.deepEqual(ctxDefault.alertsOn, { C1: true, C2: true, MAX: true, C3: true, C4: true }, 'Contexto: alertas on por defecto');
  const spotA: Spot = { name: 'A', lat: 1, lon: 2, origin: 'manual' };
  const p1 = withContext(DEFAULT_PREFS, 'e1', { spot: spotA });
  assert.equal(DEFAULT_PREFS.byEclipse.e1, undefined, 'Contexto: withContext no muta el original');
  assert.equal(contextFor(p1, 'e1').spot?.name, 'A', 'Contexto: parche aplicado');
  const p2 = withContext(p1, 'e2', { alertsOn: { C1: false, C2: false, MAX: false, C3: false, C4: false } });
  assert.equal(contextFor(p2, 'e1').spot?.name, 'A', 'Contexto: e1 intacto al tocar e2');
  assert.equal(contextFor(p2, 'e2').spot, null, 'Contexto: e2 no hereda el puesto de e1');
  assert.equal(contextFor(p2, 'e1').alertsOn.C1, true, 'Contexto: alertas de e1 no afectadas');

  // Selección de usuario (por día civil): prioridad sobre el automático, caduca sola
  setUserSelectedEclipseDay('2027-08-02');
  assert.equal(
    getActiveEclipse(new Date('2026-06-01T00:00:00Z')).id,
    '2027-08-02-total',
    'Selección: gana al automático y resuelve entradas autogeneradas',
  );
  setUserSelectedEclipseDay('2026-02-17'); // ya pasado y SIN marca de consulta → rollover
  assert.equal(
    getActiveEclipse(new Date('2026-09-01T00:00:00Z')).id,
    '2027-02-06-annular',
    'Selección pasada → vuelve al automático',
  );
  setUserSelectedEclipseDay('9999-01-01');
  assert.equal(
    getActiveEclipse(new Date('2027-01-01T00:00:00Z')).id,
    '2027-02-06-annular',
    'Selección irresoluble → automático',
  );
  setUserSelectedEclipseDay('');

  // Histórico: día arbitrario resuelto con el motor y marcado como consulta → se respeta
  setUserSelectedEclipseDay('2017-08-21', true);
  const great = getActiveEclipse(new Date('2026-06-01T00:00:00Z'));
  assert.equal(great.id, '2017-08-21-total', 'Histórico: día fuera de catálogo resuelto con el motor');
  const nash = computeLocalEclipse(36.16, -86.78, 0, new Date(great.searchStart));
  assert.equal(nash.kind, 'total', 'Histórico: Nashville vio la totalidad de 2017');
  assert.ok(
    isActiveEclipse(nash, new Date('2026-06-01T00:00:00Z')),
    'Histórico: la serie calculada es la del eclipse consultado',
  );
  // Mismo día pero como selección normal → rollover (el memo del automático es monótono:
  // se comprueba en 2027, coherente con los saltos de tiempo de los asserts anteriores)
  setUserSelectedEclipseDay('2017-08-21');
  assert.equal(
    getActiveEclipse(new Date('2027-01-01T00:00:00Z')).id,
    '2027-02-06-annular',
    'Histórico: sin marca de consulta, lo pasado rueda al automático',
  );
  setUserSelectedEclipseDay('');

  // pastEclipses: descendente, todo anterior al ancla, sin duplicados por día
  const past = pastEclipses(6, new Date('2026-06-01T00:00:00Z'));
  assert.equal(past.length, 6, 'Histórico: seis entradas');
  assert.equal(past[0].civilDate, '2026-02-17', 'Histórico: el más reciente primero');
  assert.ok(past.every((e) => e.civilDate < '2026-06-01'), 'Histórico: todos anteriores al ancla');
  assert.ok(
    past.every((e, i) => i === 0 || past[i - 1].civilDate > e.civilDate),
    'Histórico: orden descendente estricto (sin duplicados)',
  );
  assert.equal(pastEclipses(0, new Date('2026-06-01T00:00:00Z')).length, 0, 'Histórico: 0 pedidos, 0 calculados');

  // Eclipses desde un puesto: Zaragoza debe listar el total de 2026 y el parcial de 2025,
  // con día civil GLOBAL (identidad de selección) y en orden cronológico
  const zgzHits = await eclipsesFromSpot(41.65, -0.88);
  assert.ok(zgzHits.length >= 5, `Puesto: Zaragoza ve varios eclipses en ±rango (${zgzHits.length})`);
  const zgz2026 = zgzHits.find((h) => h.civilDate === '2026-08-12');
  assert.ok(zgz2026 && zgz2026.kind === 'total', 'Puesto: el total de 2026 aparece como total');
  assert.ok(zgzHits.some((h) => h.civilDate === '2025-03-29'), 'Puesto: el parcial de marzo 2025 aparece');
  assert.ok(
    zgzHits.every((h, i) => i === 0 || zgzHits[i - 1].civilDate < h.civilDate),
    'Puesto: orden cronológico sin duplicados',
  );
  assert.ok(
    zgzHits.every((h) => h.obscuration > 0 && h.obscuration <= 1),
    'Puesto: obscuración local en (0, 1]',
  );

  // Catálogo agotado → la app genera sola el siguiente eclipse global con el motor
  const auto = getActiveEclipse(new Date('2030-01-01T00:00:00Z'));
  assert.equal(auto.civilDate, '2030-06-01', 'Auto: tras 2030-01-01 toca el anular del 1 jun 2030');
  assert.equal(auto.id, '2030-06-01-annular', 'Auto: id derivado de fecha y tipo');
  assert.equal(parseRemoteCatalog(JSON.stringify([auto])).length, 1, 'Auto: la entrada pasa el validador de RC');

  // i18n: mismos keys en ambos idiomas y el cambio de idioma surte efecto real
  const { dictKeys, getLang, setLang, t: tr, LANGS } = await import('../lib/i18n');
  for (const l of LANGS) {
    assert.deepEqual(dictKeys(l), dictKeys('es'), `i18n: paridad de claves es/${l}`);
  }

  // Claves construidas por plantilla (t(`notif.${key}…` as I18nKey)): el compilador no las
  // ve y t() degrada a devolver la clave cruda, así que el dominio entero se cubre aquí
  const dict = new Set(dictKeys('es'));
  for (const k of ['C1', 'C2', 'MAX', 'C3', 'C4']) {
    for (const key of [
      `notif.${k}.title`,
      `notif.${k}.body`,
      `notif.${k}.early.title`,
      `notif.${k}.early.body`,
      `event.${k}`,
      `alerts.desc.${k}`,
      `mode.next.${k}`,
      `mode.after.${k}`,
    ]) {
      assert.ok(dict.has(key), `i18n: clave interpolada ${key} presente`);
    }
  }
  for (const kind of ['total', 'annular', 'partial']) assert.ok(dict.has(`kind.${kind}`), `i18n: kind.${kind}`);
  for (const kind of ['total', 'annular']) assert.ok(dict.has(`band.word.${kind}`), `i18n: band.word.${kind}`);
  for (const k of ['C2', 'C3']) assert.ok(dict.has(`mode.warn.${k}`), `i18n: mode.warn.${k}`);
  for (const lv of ['few', 'mid', 'many']) {
    assert.ok(dict.has(`map.clouds.${lv}`) && dict.has(`map.clouds.${lv}.word`), `i18n: map.clouds.${lv}`);
  }
  assert.equal(getLang(), 'es', 'i18n: idioma por defecto es');
  const esWest = tr('bearing.W');
  setLang('en');
  assert.equal(tr('bearing.W'), 'W', 'i18n: rumbo O localizado a W en inglés');
  assert.notEqual(tr('notif.C3.title'), '', 'i18n: copy crítico de fin de totalidad presente en inglés');
  setLang('es');
  assert.equal(tr('bearing.W'), esWest, 'i18n: vuelta a español restaura los textos');

  // i18n del catálogo: labels del empaquetado y de la selección siguen el idioma activo
  setLang('en');
  assert.equal(
    getActiveEclipse(new Date('2026-06-01T00:00:00Z')).bandLabel,
    'PATH OF TOTALITY · 12 AUG 2026',
    'i18n: labels del eclipse empaquetado regenerados en inglés',
  );
  setUserSelectedEclipseDay('2027-08-02'); // resuelta bajo en → labels ingleses horneados
  setLang('es');
  assert.equal(
    getActiveEclipse(new Date('2026-06-01T00:00:00Z')).label,
    'Total · 2 ago 2027',
    'i18n: selección de usuario re-resuelta al cambiar de idioma',
  );
  setUserSelectedEclipseDay('');

  // --- Proyección del cielo (visor de cámara) ---
  // Base sintética: cámara mirando al horizonte hacia el rumbo `b`, pantalla vertical.
  const lookAt = (b: number): CameraBasis => ({
    forward: skyVector(b, 0),
    right: skyVector(b + 90, 0),
    up: { x: 0, y: 0, z: 1 },
  });
  const fov = fovFor(1080, 1920); // vertical > horizontal en retrato
  assert.ok(fov.verticalDeg > fov.horizontalDeg, 'fov: en retrato el vertical es el mayor');

  assert.equal(Math.round(bearingOf(skyVector(90, 0))), 90, 'rumbo: azimut 90 apunta al este');
  assert.equal(Math.round(bearingOf(skyVector(180, 30))), 180, 'rumbo: la altura no altera el rumbo');

  // Sol justo en el eje de la cámara → centro del encuadre
  const centered = project(skyVector(200, 0), lookAt(200), fov);
  assert.ok(centered.inFrame, 'proyección: sol en el eje cae dentro del encuadre');
  assert.ok(Math.abs(centered.x) < 1e-9 && Math.abs(centered.y) < 1e-9, 'proyección: y en el centro');
  assert.ok(centered.offAxisDeg < 1e-6, 'proyección: separación nula en el eje');

  // Sol a la derecha del rumbo de la cámara → x positivo (misma mano que la pantalla)
  const right = project(skyVector(220, 0), lookAt(200), fov);
  assert.ok(right.x > 0, 'proyección: sol 20° a la derecha cae a la derecha del encuadre');
  assert.ok(Math.abs(right.y) < 1e-9, 'proyección: sin altura no se desplaza en vertical');
  assert.equal(Math.round(right.offAxisDeg), 20, 'proyección: separación angular = 20°');

  // Sol alto → y positivo
  const high = project(skyVector(200, 20), lookAt(200), fov);
  assert.ok(high.y > 0, 'proyección: sol elevado cae arriba del encuadre');

  // A la espalda: nunca dentro de encuadre, y manda girar hacia un lado
  const behind = project(skyVector(20, 10), lookAt(200), fov);
  assert.ok(!behind.inFrame, 'proyección: sol a la espalda queda fuera de encuadre');
  assert.ok(behind.offAxisDeg > 90, 'proyección: separación mayor de 90° a la espalda');

  // Fuera del encuadre por poco: turnDeg apunta al lado correcto (90 = derecha)
  const farRight = project(skyVector(280, 0), lookAt(200), fov);
  assert.ok(!farRight.inFrame, 'proyección: 80° a la derecha se sale del encuadre');
  assert.equal(Math.round(farRight.turnDeg), 90, 'proyección: manda girar a la derecha');

  // Reanclado con brújula: el guiñado pasa a ser el del compás, el cabeceo se conserva
  const drifted = cameraBasis(0, 90, 0); // móvil vertical, guiñado sin calibrar
  const fixed = withCompassBearing(drifted, 135);
  assert.equal(Math.round(bearingOf(fixed.forward)), 135, 'brújula: el rumbo se reancla al compás');
  assert.ok(
    Math.abs(fixed.forward.z - drifted.forward.z) < 1e-9,
    'brújula: el reanclado no toca el cabeceo',
  );

  // --- Filtros del visor: sin ellos la marca nada con el ruido de los sensores ---
  assert.equal(norm360(-10), 350, 'norm360: negativos al rango [0,360)');
  assert.equal(norm360(370), 10, 'norm360: envuelve por arriba');

  // El rumbo se promedia por el camino corto del círculo, no interpolando grados
  assert.equal(smoothBearing(null, 42, 0.5), 42, 'rumbo: la primera muestra entra tal cual');
  assert.equal(smoothBearing(0, 10, 0.5), 5, 'rumbo: media hacia la muestra nueva');
  assert.equal(smoothBearing(350, 10, 0.5), 0, 'rumbo: cruzar el 0 va por el lado corto');
  assert.equal(smoothBearing(10, 350, 0.5), 0, 'rumbo: y en sentido contrario también');
  assert.ok(
    Math.abs(smoothBearing(90, 91, 0.06) - 90.06) < 1e-9,
    'rumbo: con factor bajo, una muestra ruidosa apenas mueve la marca',
  );

  // El filtro de la base debe seguir devolviendo una base ORTONORMAL: interpolar los tres
  // vectores por separado los saca de ángulo recto y la proyección se deforma
  const b0 = cameraBasis(0, 90, 0);
  const b1 = cameraBasis(20, 85, 5);
  const sm = smoothBasis(b0, b1, 0.2);
  const dot3 = (u: typeof sm.forward, v: typeof sm.forward) => u.x * v.x + u.y * v.y + u.z * v.z;
  const norm3 = (u: typeof sm.forward) => Math.hypot(u.x, u.y, u.z);
  for (const [name, v] of [['forward', sm.forward], ['up', sm.up], ['right', sm.right]] as const) {
    assert.ok(Math.abs(norm3(v) - 1) < 1e-9, `base filtrada: ${name} unitario`);
  }
  assert.ok(Math.abs(dot3(sm.forward, sm.up)) < 1e-9, 'base filtrada: forward ⟂ up');
  assert.ok(Math.abs(dot3(sm.forward, sm.right)) < 1e-9, 'base filtrada: forward ⟂ right');
  assert.ok(Math.abs(dot3(sm.up, sm.right)) < 1e-9, 'base filtrada: up ⟂ right');
  // Y quedarse ENTRE las dos, más cerca de la vieja (factor 0.2 = 20% de la nueva)
  assert.ok(
    dot3(sm.forward, b0.forward) > dot3(sm.forward, b1.forward),
    'base filtrada: con factor 0.2 pesa más la muestra previa',
  );
  assert.deepEqual(smoothBasis(null, b1, 0.2), b1, 'base filtrada: la primera muestra entra tal cual');
  // Salto imposible en una muestra (>90°): se salta el filtro en vez de colapsar la base
  assert.deepEqual(
    smoothBasis(lookAt(0), lookAt(180), 0.2),
    lookAt(180),
    'base filtrada: un giro de 180° en una muestra no se interpola',
  );

  // --- Sol ahora (modo live del visor) ---
  // Mismas efemérides que los contactos: en el instante del máximo debe dar SU posición
  const sunAtMax = sunPosition(41.65, -0.88, 200, max.time);
  assert.ok(Math.abs(sunAtMax.azimuthDeg - max.azimuth) < 0.01, 'sol ahora: azimut del máximo clavado');
  assert.ok(Math.abs(sunAtMax.altitudeDeg - max.altitude) < 0.1, 'sol ahora: altura del máximo coherente');
  // Mediodía solar de agosto en Zaragoza: sol al sur y alto; de madrugada, bajo el horizonte
  const noon = sunPosition(41.65, -0.88, 200, new Date('2026-08-12T12:00:00Z'));
  assert.ok(Math.abs(noon.azimuthDeg - 180) < 10, `sol ahora: mediodía al sur (${noon.azimuthDeg.toFixed(1)}°)`);
  assert.ok(noon.altitudeDeg > 50, `sol ahora: alto en verano (${noon.altitudeDeg.toFixed(1)}°)`);
  assert.ok(
    sunPosition(41.65, -0.88, 200, new Date('2026-08-12T02:00:00Z')).altitudeDeg < 0,
    'sol ahora: de madrugada bajo el horizonte',
  );

  // --- Calibración de brújula con el sol real ---
  // Base sintética mirando a `bearing` con cabeceo `pitch`; calibrate solo lee forward
  const aimAt = (bearing: number, pitch: number): CameraBasis => ({
    forward: skyVector(bearing, pitch),
    right: skyVector(bearing + 90, 0),
    up: { x: 0, y: 0, z: 1 },
  });
  const vFov = fovFor(1080, 1920).verticalDeg;
  const calOk = calibrate(110, 40, aimAt(100, 40), vFov, 0, 41.65, -0.88);
  assert.ok(calOk !== null && Math.abs(calOk.offsetDeg - 10) < 1e-9, 'calibración: brújula 10° corta → offset +10');
  const calWrap = calibrate(350, 40, aimAt(10, 40), vFov, 0, 41.65, -0.88);
  assert.ok(calWrap !== null && Math.abs(calWrap.offsetDeg + 20) < 1e-9, 'calibración: cruza el norte por el lado corto');
  assert.equal(calibrate(110, -5, aimAt(100, -5), vFov, 0, 41.65, -0.88), null, 'calibración: sol bajo el horizonte → descartada');
  // El cabeceo lo fija la gravedad: mirando al suelo el sol NO puede estar encuadrado
  assert.equal(calibrate(110, 40, aimAt(100, -20), vFov, 0, 41.65, -0.88), null, 'calibración: cabeceo incompatible → descartada');

  // Vigencia: caduca por edad, por alejarse ~1 km del punto o con el reloj hacia atrás
  const cal0: CompassCalibration = { offsetDeg: 10, at: 0, lat: 41.65, lon: -0.88 };
  assert.ok(isCalibrationFresh(cal0, 3_600_000, 41.65, -0.88), 'vigencia: 1 h y mismo sitio → vale');
  assert.ok(isCalibrationFresh(cal0, 1000, 41.655, -0.88), 'vigencia: a ~500 m sigue valiendo');
  assert.ok(!isCalibrationFresh(cal0, CALIBRATION_MAX_AGE_MS + 1, 41.65, -0.88), 'vigencia: pasadas 2 h caduca');
  assert.ok(!isCalibrationFresh(cal0, 1000, 41.66, -0.88), 'vigencia: a ~1,1 km el campo local ya es otro');
  assert.ok(!isCalibrationFresh(cal0, -1000, 41.65, -0.88), 'vigencia: reloj hacia atrás → recalibrar');
  assert.ok(!isCalibrationFresh(null, 0, 41.65, -0.88), 'vigencia: sin calibración no hay nada vigente');

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
