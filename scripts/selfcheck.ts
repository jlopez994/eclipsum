// Ejecutar: npx tsx scripts/selfcheck.ts
import assert from 'node:assert';
import {
  computeLocalEclipse,
  currentPhase,
  eclipseSpan,
  eventAt,
  isActiveEclipse,
  nextEvent,
} from '../lib/eclipse';
import {
  bandOf,
  ECLIPSES,
  getActiveEclipse,
  getEclipseById,
  parseRemoteCatalog,
  setRemoteCatalog,
  setUserSelectedEclipseDay,
  upcomingEclipses,
} from '../lib/eclipseCatalog';
import { cloudCoverAt } from '../lib/weather';
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
  project,
  skyVector,
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
  const active = getActiveEclipse(new Date('2026-06-01T00:00:00Z'));
  assert.equal(active.id, '2026-08-12-iberia', 'Pasado feb 2026, activo = Iberia');
  assert.equal(
    upcomingEclipses(1, new Date('2026-06-01T00:00:00Z'))[0].id,
    active.id,
    'Lista y activo comparten la definición de «próximo»',
  );
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
  const svq = computeLocalEclipse(37.39, -5.99, 10);
  assert.equal(svq.kind, 'partial', 'Sevilla debe ser parcial');
  assert.ok(svq.obscuration < 0.999 && svq.obscuration > 0.5, `Sevilla parcial profunda: ${svq.obscuration}`);
  assert.equal(eventAt(svq, 'C2'), undefined, 'eventAt: un parcial no tiene C2');

  // Fuera del footprint del activo el motor contesta con OTRO eclipse: nada que lo pinte
  // puede fiarse de kind/obscuración/duración sin pasar por isActiveEclipse
  assert.ok(isActiveEclipse(zgz), 'Zaragoza ve el eclipse activo');
  const syd = computeLocalEclipse(-33.87, 151.21);
  assert.equal(syd.kind, 'total', 'Sídney: el motor devuelve un total… de otro eclipse');
  assert.ok(!isActiveEclipse(syd), 'Sídney NO ve el eclipse activo (serie de 2028)');
  assert.equal(
    await findNearestTotality(-37.81, 144.96),
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
  setUserSelectedEclipseDay('2026-02-17'); // ya pasado a fecha de hoy → irresoluble
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
