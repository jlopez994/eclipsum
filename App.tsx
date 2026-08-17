import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFonts,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  computeLocalEclipse,
  currentPhase,
  eclipseDayOf,
  eclipseSpan,
  eventAt,
  isActiveEclipse,
  shiftEclipse,
  type LocalEclipse,
} from './lib/eclipse';
import { eclipseForDay, getActiveEclipse, upcomingEclipses, visiblePointFor } from './lib/eclipseCatalog';
import { haversineKm } from './lib/totality';
import { openInMaps } from './lib/maps';
import { cleanPlaceLabel, DIVERGENCE_KM, REAL_PLACE_KM, sameCoords, type Spot } from './lib/spots';
import { scheduleEclipseAlerts } from './lib/notifications';
import { track, trackError } from './lib/firebase';
import {
  contextFor,
  DEFAULT_PREFS,
  DONATE_PROMPT_AFTER,
  DONATE_PROMPT_DONE,
  pushRecent,
  withContext,
} from './lib/prefs';
import { t } from './lib/i18n';
import { animateNextLayout } from './lib/anim';
import { useGeo } from './hooks/useGeo';
import { usePrefs } from './hooks/usePrefs';
import { usePermissions } from './hooks/usePermissions';
import { useRemoteExtras } from './hooks/useRemoteExtras';
import { useDrill } from './hooks/useDrill';
import { useSpotData } from './hooks/useSpotData';
import { NoticeStack } from './components/NoticeStack';
import { OutOfZoneNotice } from './components/OutOfZoneNotice';
import { TabBar, type TabKey } from './components/TabBar';
import { Tour } from './components/Tour';
import { SpotSelector, localityName } from './components/SpotSelector';
import { MapScreen } from './components/screens/MapScreen';
import { AlertsScreen } from './components/screens/AlertsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { EclipsesScreen } from './components/screens/EclipsesScreen';
import { EclipseModeScreen } from './components/screens/EclipseModeScreen';
import { C, F } from './components/theme';

const ECLIPSE_MODE_LEAD_MS = 30 * 60_000;
const ECLIPSE_MODE_TAIL_MS = 5 * 60_000;
const COARSE_TICK_MS = 30_000;
const FINE_TICK_MS = 1_000;

/** Puesto que se está pintando, con sus circunstancias ya calculadas. */
interface ShownSpot {
  spot: Spot;
  eclipse: LocalEclipse;
}

function inFineClockWindow(eclipse: LocalEclipse, t: number): boolean {
  const span = eclipseSpan(eclipse);
  if (!span) return false;
  return t >= span.start - ECLIPSE_MODE_LEAD_MS && t <= span.end + ECLIPSE_MODE_TAIL_MS;
}

function gpsSpot(geo: { place: string; lat: number; lon: number }): Spot {
  return { name: cleanPlaceLabel(geo.place) || t('app.myPosition'), lat: geo.lat, lon: geo.lon, origin: 'gps' };
}

/**
 * Eclipse sintético para la demo: desplaza los eventos para que el siguiente hito caiga en ~2 min.
 * `startedAt` es el instante en que se PULSÓ la demo, no el reloj: recalcularlo con `now`
 * desplazaba la serie un segundo por cada segundo y la cuenta atrás no bajaba nunca.
 */
function buildDemoEclipse(real: LocalEclipse, startedAt: Date): LocalEclipse {
  const anchor = eventAt(real, 'C2') ?? eventAt(real, 'MAX');
  if (!anchor) return real;
  return shiftEclipse(real, startedAt.getTime() + 2 * 60_000 - anchor.time.getTime());
}

function AppInner() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const { prefs, update: onPrefsChange } = usePrefs();
  const { geo, locating, granted: locationGranted, refresh: refreshGeo } = useGeo();
  const { permissions, request: requestPermission } = usePermissions(locationGranted);
  // Antes de cargar prefs, canal estable: nunca ofrecer una beta a quien no la pidió
  const remote = useRemoteExtras(prefs?.updateChannel ?? 'stable');
  const [tab, setTab] = useState<TabKey>('mapa');
  /** Instante en que se lanzó la demo; null = demo apagada. Ancla fija de la serie sintética */
  const [demoAt, setDemoAt] = useState<Date | null>(null);
  const demo = demoAt !== null;
  const [selectorOpen, setSelectorOpen] = useState(false);
  /** Repetición manual desde Ajustes; el primer pase lo dispara prefs.tourSeen */
  const [tourOpen, setTourOpen] = useState(false);
  /** Modo eclipse real cerrado a mano; la totalidad lo recupera (ver más abajo) */
  const [modeExited, setModeExited] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [fineClock, setFineClock] = useState(false);

  // Eclipse activo: selección del usuario, override RC o el más próximo
  const activeCatalog = getActiveEclipse();
  // Contexto per-eclipse (puesto + alertas), clave = día civil; identidad estable sin memo
  const ctx = contextFor(prefs ?? DEFAULT_PREFS, activeCatalog.civilDate);

  // Una apertura en frío por lanzamiento: el aviso de donación llega tras varios usos,
  // nunca al primer contacto con la app
  const openCounted = useRef(false);
  useEffect(() => {
    if (!prefs || openCounted.current) return;
    openCounted.current = true;
    if (prefs.donateOpens === DONATE_PROMPT_DONE || prefs.donateOpens >= DONATE_PROMPT_AFTER) return;
    onPrefsChange({ ...prefs, donateOpens: prefs.donateOpens + 1 });
  }, [prefs, onPrefsChange]);

  // Sin URL en Remote Config no hay aviso; DONATE_PROMPT_DONE (-1) nunca alcanza el umbral
  const showDonatePrompt = remote.donateUrl !== '' && (prefs?.donateOpens ?? 0) >= DONATE_PROMPT_AFTER;

  /** Cierra el aviso para siempre; `donated` abre Buy Me a Coffee */
  const resolveDonate = useCallback(
    (donated: boolean) => {
      if (!prefs) return;
      onPrefsChange({ ...prefs, donateOpens: DONATE_PROMPT_DONE });
      track(donated ? 'donate_click' : 'donate_dismiss', { from: 'banner' });
      if (donated) Linking.openURL(remote.donateUrl).catch(() => {});
    },
    [prefs, onPrefsChange, remote.donateUrl],
  );

  // Sembrar puesto deseado con GPS si el eclipse activo aún no tiene ninguno
  useEffect(() => {
    if (!prefs || !geo || ctx.spot) return;
    onPrefsChange(withContext(prefs, activeCatalog.civilDate, { spot: gpsSpot(geo) }));
  }, [prefs, geo, ctx.spot, activeCatalog.civilDate, onPrefsChange]);

  // Puesto deseado (cálculos); fallback temporal a GPS mientras se siembra.
  // Nada que calcular hasta que carguen las prefs: el GPS cubre el hueco de la SIEMBRA,
  // no el de la carga (la pantalla es un spinner igual). Sin esta guarda, un arranque con
  // puesto guardado lejano lanzaba búsqueda de totalidad + nubes + analytics para el GPS
  // y lo repetía entero al llegar las prefs.
  const activeSpot = ctx.spot;
  const active = !prefs
    ? null
    : activeSpot
      ? { lat: activeSpot.lat, lon: activeSpot.lon, place: activeSpot.name, origin: activeSpot.origin }
      : geo
        ? { lat: geo.lat, lon: geo.lon, place: cleanPlaceLabel(geo.place), origin: 'gps' as const }
        : null;

  const localEclipse = useMemo(
    () => (active ? computeLocalEclipse(active.lat, active.lon) : null),
    // activeCatalog.id: selección de usuario o rollover; catalogEpoch: RC puede cambiar la entrada
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.lat, active?.lon, activeCatalog.id, remote.catalogEpoch],
  );

  /**
   * Puesto fuera de la zona de visibilidad: el motor ha contestado con OTRO eclipse
   * (el siguiente visible desde ahí). Se anula para que nada aguas abajo —cronología,
   * nubes, alertas, modo eclipse— pinte ni programe datos que no son de este evento.
   */
  const outOfZone = localEclipse !== null && !isActiveEclipse(localEclipse);
  const eclipse = outOfZone ? null : localEclipse;

  /** El puesto elegido como Spot, venga de prefs o del GPS mientras se siembra. */
  const chosenSpot: Spot | null = active
    ? activeSpot ?? { name: active.place, lat: active.lat, lon: active.lon, origin: active.origin }
    : null;

  /**
   * Lo que se pinta: SOLO el puesto elegido cuando sus datos valen.
   *
   * Fuera de zona no hay nada que enseñar. Antes se caía al último puesto válido y el mapa
   * seguía pintando sus cifras bajo el velo: horas de contacto, % de ocultación y nubes de
   * un sitio que no es el elegido, para un eclipse que desde ahí no se ve. Es justo la
   * información que sobra, así que el mapa cede el sitio a la explicación y a la salida.
   */
  const shown: ShownSpot | null = eclipse && chosenSpot ? { spot: chosenSpot, eclipse } : null;

  /**
   * Próximo eclipse visible desde el puesto elegido, contando DESDE HOY.
   *
   * No sirve el que devuelve el cálculo normal: ese va anclado al eclipse activo, así que
   * tras saltar a uno lejano propondría el siguiente a ESA fecha y se saltaría los de en
   * medio (con el activo en 2028, Seseña proponía 2030 en vez del de mañana).
   *
   * El ancla es el día civil de hoy, no `now`: con la hora exacta la clave de la memo del
   * motor cambiaría en cada render y recalcularía (~10-30 ms) sin parar.
   */
  const todayKey = now.toISOString().slice(0, 10);
  /**
   * Consulta del histórico: el activo ya pasó. El mapa y la cronología funcionan igual
   * (el motor calcula cualquier fecha) y las nubes salen del archivo de Open-Meteo;
   * lo único que se apaga son las alertas (scheduleEclipseAlerts ya filtra hitos
   * pasados y aquí la pestaña lo explica).
   */
  const isPastActive = activeCatalog.civilDate < todayKey;
  const nextHere = useMemo(() => {
    if (!outOfZone || !active) return null;
    try {
      return computeLocalEclipse(active.lat, active.lon, 0, new Date(`${todayKey}T00:00:00Z`));
    } catch {
      return null; // el motor no encuentra ninguno: sin sugerencia, solo la explicación
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfZone, active?.lat, active?.lon, todayKey]);

  // Sin entrada en el catálogo no hay adónde llevar al usuario: la acción se oculta
  const otherDay = nextHere ? eclipseDayOf(nextHere) : null;
  const otherEclipse = otherDay !== null ? eclipseForDay(otherDay) : null;

  const { drill, startDrill, exitDrill, jumpDrill } = useDrill(eclipse, prefs, ctx, now);

  useEffect(() => {
    // Simulacro incluido: su ventana no coincide con la del eclipse real que vigila fineClock
    const ms = demo || drill !== null || fineClock ? FINE_TICK_MS : COARSE_TICK_MS;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [demo, drill, fineClock]);

  // Reloj fino en la ventana del modo eclipse (fase/seguridad a 1 s)
  useEffect(() => {
    if (!eclipse) {
      setFineClock(false);
      return;
    }
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const span = eclipseSpan(eclipse);
    if (!span) {
      setFineClock(false);
      return;
    }
    const start = span.start - ECLIPSE_MODE_LEAD_MS;
    const end = span.end + ECLIPSE_MODE_TAIL_MS;
    const t = Date.now();
    if (t > end) {
      setFineClock(false);
      return;
    }
    if (t >= start) {
      setFineClock(true);
      exitTimer = setTimeout(() => setFineClock(false), end - t);
      return () => clearTimeout(exitTimer);
    }
    setFineClock(false);
    const enterTimer = setTimeout(() => {
      setFineClock(true);
      exitTimer = setTimeout(() => setFineClock(false), end - start);
    }, start - t);
    return () => {
      clearTimeout(enterTimer);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [eclipse]);

  const { cloud, totality } = useSpotData(active, eclipse);

  // Reprogramar alertas al cambiar puesto, toggles, eclipse activo o permiso.
  // Sin toggles activos también entra: cancela avisos huérfanos del contexto anterior.
  useEffect(() => {
    if (!eclipse || !prefs || !permissions.notifications) return;
    // Durante el simulacro no se reprograma: el cancelAll interno mataría los avisos
    // [PRUEBA] (p. ej. al volver a primer plano, catalogEpoch cambia la identidad de
    // eclipse). Al salir del simulacro el efecto vuelve a entrar y reprograma.
    if (drill) return;
    scheduleEclipseAlerts(eclipse, ctx.alertsOn, prefs.alertSound, ctx.alertEarly, ctx.c1PlanAlerts)
      .then((n) => track('alerts_scheduled', { count: n }))
      .catch((e) => {
        // El efecto solo entra con permiso concedido: fallar aquí es raro y reportable.
        // El usuario siempre puede reprogramar desde Alertas.
        trackError('schedule_alerts', e);
      });
    // prefs?.language: el copy de las notificaciones se hornea al programar — reprogramar al cambiar idioma
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eclipse, permissions.notifications, ctx, prefs?.alertSound, prefs?.language, drill]);

  // Primera página de la pestaña Eclipses (PAGE+1 = 6) precalentada en un respiro tras
  // arrancar: la primera llamada del día al motor tarda varios frames y la pestaña
  // abría con un retardo perceptible al primer toque
  useEffect(() => {
    const id = setTimeout(() => upcomingEclipses(6), 1500);
    return () => clearTimeout(id);
  }, []);

  /**
   * Línea base del efecto de reubicación (más abajo). Tres estados: null = prefs sin
   * cargar (su llegada NO es un cambio de eclipse); día ≠ activo = cambio de eclipse
   * pendiente de evaluar; día = activo = al día.
   */
  const prevEclipseDayRef = useRef<string | null>(null);

  const selectSpot = useCallback(
    (spot: Spot) => {
      if (!prefs) return;
      // Elegir un puesto a mano consume cualquier cambio de eclipse pendiente: esa
      // elección es del usuario y el efecto de reubicación no debe deshacerla
      prevEclipseDayRef.current = activeCatalog.civilDate;
      animateNextLayout();
      const recentSpots = spot.origin === 'gps' ? prefs.recentSpots : pushRecent(prefs.recentSpots, spot);
      onPrefsChange({ ...withContext(prefs, activeCatalog.civilDate, { spot }), recentSpots });
    },
    [prefs, activeCatalog.civilDate, onPrefsChange],
  );

  /**
   * Punto tocado en el mapa real. El puesto se aplica YA con sus coordenadas y el geocoder
   * solo lo renombra después: esperar a la red antes de escribir significaba persistir un
   * `prefs` congelado en el instante del toque (revertía toggles cambiados entre medias) y
   * dejar que dos toques seguidos se pisaran según cuál resolviera antes.
   */
  const selectMapPoint = useCallback(
    ({ lat, lon }: { lat: number; lon: number }) => {
      const day = activeCatalog.civilDate;
      selectSpot({ name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon, origin: 'manual' });
      void localityName(lat, lon).then((name) => {
        if (!name) return;
        onPrefsChange((p) => {
          // Otro puesto elegido mientras resolvía: el renombrado ya no le corresponde
          const current = contextFor(p, day).spot;
          if (!current || current.lat !== lat || current.lon !== lon) return p;
          return {
            ...withContext(p, day, { spot: { ...current, name } }),
            // La entrada de habituales se creó con las coordenadas: renombrarla también
            recentSpots: p.recentSpots.map((r) => (sameCoords(r, current) ? { ...r, name } : r)),
          };
        });
      });
    },
    [selectSpot, activeCatalog.civilDate, onPrefsChange],
  );

  const recalcHere = useCallback(() => {
    if (geo) selectSpot(gpsSpot(geo));
  }, [geo, selectSpot]);

  /**
   * Reubicación SOLO al cambiar de eclipse. Elegir uno en la pestaña Eclipses es decir
   * «quiero ver ESTE»: si tu puesto no lo ve, el mapa se pinta en su banda con cifras
   * reales y desde ahí se ajusta. Sin punto conocido (eclipse sin banda ni pico) no se
   * toca nada.
   *
   * Un puesto buscado o tocado a mano que queda fuera NO se toca nunca: la pestaña Mapa
   * pasa al aviso de fuera de zona, con las dos salidas (otro puesto dentro, o saltar al
   * eclipse que sí se ve desde ahí). Antes este efecto también reubicaba la primera
   * búsqueda fuera de banda —una por eclipse y sesión— y la segunda sí se respetaba: el
   * mismo gesto hacía dos cosas distintas según cuántas veces lo repitieras.
   *
   * Guardas de la línea base (prevEclipseDayRef, declarado junto a selectSpot):
   * — Sin prefs no se toca: la selección persistida entra con la carga y tratarla como
   *   cambio reubicaría en cada arranque un puesto fuera de banda dejado a propósito.
   * — Sin puesto evaluable (localEclipse null: GPS pendiente, día recién sembrado) el
   *   cambio queda PENDIENTE — el ref no avanza— y se evalúa cuando la siembra llegue;
   *   si entre medias el usuario elige puesto a mano, selectSpot lo consume.
   */
  /**
   * Identidad del aviso por MUDANZA («día#n»), no por día civil: NoticeStack silencia el
   * descarte por valor exacto, y una segunda reubicación del mismo eclipse (ida y vuelta
   * por la tab con un puesto fuera puesto a mano entre medias) debe reabrirlo.
   */
  const relocSeq = useRef(0);
  const [relocatedTag, setRelocatedTag] = useState<string | null>(null);
  useEffect(() => {
    if (!prefs) return;
    if (prevEclipseDayRef.current === null) {
      // Primera pasada con prefs: línea base, nunca un cambio que evaluar
      prevEclipseDayRef.current = activeCatalog.civilDate;
      return;
    }
    if (localEclipse === null) return;
    const eclipseChanged = prevEclipseDayRef.current !== activeCatalog.civilDate;
    prevEclipseDayRef.current = activeCatalog.civilDate;
    if (!eclipseChanged || !outOfZone) return;
    const point = visiblePointFor(activeCatalog);
    if (!point) return;
    relocSeq.current += 1;
    setRelocatedTag(`${activeCatalog.civilDate}#${relocSeq.current}`);
    track('spot_relocated', { day: activeCatalog.civilDate });
    selectMapPoint(point);
  }, [prefs, localEclipse, outOfZone, activeCatalog, selectMapPoint]);

  // El aviso pertenece al eclipse que provocó la mudanza: con otro activo no viene a cuento,
  // y comparar aquí evita tener que apagarlo con un efecto al cambiar de eclipse
  const relocated =
    relocatedTag !== null && relocatedTag.startsWith(`${activeCatalog.civilDate}#`) ? relocatedTag : null;

  // Memoizado: en DEMO el reloj tica cada segundo y sin esto se reconstruiría el LocalEclipse
  // en cada tick, invalidando el barLayout memoizado de EclipseTimeline
  const demoEclipse = useMemo(
    () => (demoAt && eclipse ? buildDemoEclipse(eclipse, demoAt) : null),
    [demoAt, eclipse],
  );
  const activeEclipse = drill?.eclipse ?? demoEclipse ?? eclipse;

  // Modo eclipse: automático en ventana del evento, o demo forzada
  const inEclipseWindow = activeEclipse ? inFineClockWindow(activeEclipse, now.getTime()) : false;
  /**
   * La ventana empieza hora y media antes del primer contacto, y durante toda la parcial el
   * usuario todavía quiere mirar nubes, cambiar de puesto o ver la cronología. Así que el
   * modo real se puede cerrar… salvo en la TOTALIDAD, que lo recupera sí o sí: son los
   * segundos en los que mirar el móvil en el instante justo decide si te quitas las gafas.
   * Los ensayos (demo/simulacro) no pasan por aquí — tienen su propia salida explícita.
   */
  const inTotality = activeEclipse !== null && currentPhase(activeEclipse, now)?.safeToLook === true;
  const showEclipseMode = demo || drill !== null || (inEclipseWindow && (!modeExited || inTotality));

  // Recuperado por la totalidad, la salida previa caduca: tras C3 el aviso de volver a
  // ponerse las gafas es lo más importante de la pantalla. Fuera de ventana también se
  // limpia, para que un eclipse futuro no herede el cierre de este.
  useEffect(() => {
    if (inTotality || !inEclipseWindow) setModeExited(false);
  }, [inTotality, inEclipseWindow]);

  // Al abrirse la ventana, posición fresca: el aviso de divergencia decide si las horas que
  // vas a mirar durante dos horas son las de donde estás o las de un puesto que no pisaste
  useEffect(() => {
    if (inEclipseWindow) refreshGeo();
  }, [inEclipseWindow, refreshGeo]);

  if (!fontsLoaded || !prefs) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.corona} size="large" />
      </View>
    );
  }

  // Ocupa la pestaña Mapa entera cuando el puesto no ve el eclipse: ya no es un velo sobre
  // datos, porque detrás no queda ninguno. Sin ✕ ni descarte: no tapa nada que recuperar, y
  // es la única pantalla con la explicación y las salidas.
  //
  // Depende de `chosenSpot` y no de `shown`, que fuera de zona es siempre null: es el
  // puesto elegido —el que no ve el eclipse— el que hay que nombrar en el aviso.
  const outOfZoneNotice =
    outOfZone && chosenSpot ? (
      <OutOfZoneNotice
        place={cleanPlaceLabel(chosenSpot.name)}
        date={activeCatalog.shortDateLabel}
        otherLabel={otherEclipse?.label ?? null}
        onChoosePlace={() => setSelectorOpen(true)}
        // El puesto viaja con el salto: el contexto se guarda por día civil, y sin esto
        // el eclipse nuevo nacería sin puesto y la siembra lo rellenaría con el GPS
        onGoToOther={() => {
          if (!otherEclipse) return;
          track('eclipse_selected', { day: otherEclipse.civilDate, from: 'out_of_zone' });
          onPrefsChange(
            withContext(
              // El destino siempre es futuro (nextHere busca desde hoy): si venías de una
              // consulta del histórico, el salto la termina y vuelve el rollover normal
              { ...prefs, selectedEclipseDay: otherEclipse.civilDate, selectedEclipsePast: false },
              otherEclipse.civilDate,
              { spot: chosenSpot },
            ),
          );
        }}
      />
    ) : null;

  // Distancia GPS ↔ puesto PINTADO (no el elegido): el marcador «TÚ» y el aviso del día D
  // se miden contra lo que hay en pantalla, o dirían una cosa y el mapa otra
  const spotDistanceKm = geo && shown ? haversineKm(geo.lat, geo.lon, shown.spot.lat, shown.spot.lon) : null;

  const divergenceKm = (() => {
    if (spotDistanceKm === null || !activeSpot || !eclipse) return null;
    const span = eclipseSpan(eclipse);
    if (!span || now.getTime() < span.start - 24 * 3_600_000) return null;
    return spotDistanceKm > DIVERGENCE_KM ? spotDistanceKm : null;
  })();

  // Nombre corto del GPS cuando está lo bastante lejos del puesto; null = un solo punto
  const hereLabel =
    spotDistanceKm !== null && spotDistanceKm >= REAL_PLACE_KM && geo
      ? cleanPlaceLabel(geo.place) || t('map.you')
      : null;

  if (activeEclipse && active && showEclipseMode) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <EclipseModeScreen
          eclipse={activeEclipse}
          place={cleanPlaceLabel(active.place)}
          now={now}
          exitLabel={drill ? t('settings.drill') : demo ? 'DEMO' : null}
          // El aviso de «no estás donde planeaste» vivía solo en el mapa, la pantalla que
          // esta tapa. Sin ensayo de por medio: en la demo estorbaría.
          divergenceKm={drill || demo ? null : divergenceKm}
          onRecalcHere={recalcHere}
          onExit={drill ? exitDrill : demo ? () => setDemoAt(null) : () => setModeExited(true)}
          // El salto repinta la fase al instante, sin esperar al tick del reloj
          onJumpToEvent={
            drill
              ? (key) => {
                  jumpDrill(key);
                  setNow(new Date());
                }
              : null
          }
        />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <NoticeStack
        message={remote.message}
        updateUrl={remote.updateUrl}
        showDonate={showDonatePrompt}
        onDonateResolve={resolveDonate}
        showBackToMode={inEclipseWindow && modeExited}
        onBackToMode={() => setModeExited(false)}
        relocated={relocated}
        divergenceKm={divergenceKm}
        // El aviso se mide contra el puesto PINTADO: cambiar de puesto es otra discrepancia
        // y el cierre anterior no la cubre
        divergenceSpotKey={shown ? `${shown.spot.lat},${shown.spot.lon}` : ''}
        onRecalcHere={recalcHere}
        top={insets.top}
      />
      <View style={{ flex: 1 }}>
        {tab === 'mapa' &&
          (shown ? (
            <MapScreen
              eclipse={shown.eclipse}
              place={cleanPlaceLabel(shown.spot.name)}
              hereLabel={hereLabel}
              cloudPct={cloud.pct}
              cloudAgeHours={cloud.ageH}
              cloudLoading={cloud.loading}
              totality={totality}
              now={now}
              spotCoords={{ lat: shown.spot.lat, lon: shown.spot.lon }}
              hereCoords={hereLabel !== null && geo ? { lat: geo.lat, lon: geo.lon } : null}
              gpsCoords={geo ? { lat: geo.lat, lon: geo.lon } : null}
              onOpenSelector={() => setSelectorOpen(true)}
              onOpenMaps={() => openInMaps(shown.spot.lat, shown.spot.lon, shown.spot.name)}
              onSelectMapPoint={selectMapPoint}
              sponsor={remote.sponsor}
              glassesUrl={remote.glassesUrl}
              compassCal={prefs.compassCal}
              // Forma funcional: la calibración llega desde el visor tras un rato abierto y
              // no debe pisar prefs escritas entre medias
              onCalibrate={(cal) => onPrefsChange((prev) => ({ ...prev, compassCal: cal }))}
              // Salto desde «Eclipses desde aquí»: el puesto viaja con el eclipse elegido
              // (el contexto es per-día y sin esto la siembra lo pisaría con el GPS)
              onSelectEclipseDay={(day) => {
                track('eclipse_selected', { day, from: 'spot_history', past: day < todayKey });
                onPrefsChange(
                  withContext(
                    { ...prefs, selectedEclipseDay: day, selectedEclipsePast: day < todayKey },
                    day,
                    { spot: shown.spot },
                  ),
                );
              }}
            />
          ) : outOfZoneNotice ? (
            // Fuera de zona el aviso ES la pantalla: dice por qué no hay mapa y ofrece las
            // salidas. Antes caía en «Sin GPS» con el GPS funcionando, igual que ya hace
            // Alertas; y con el velo encima repetía el mismo texto dos veces.
            outOfZoneNotice
          ) : (
            <View style={s.loading}>
              {locating ? (
                <>
                  <ActivityIndicator color={C.corona} size="large" />
                  <Text style={s.loadingText}>{t('app.locating')}</Text>
                </>
              ) : (
                <>
                  <Text style={s.loadingText}>{t('app.noGps')}</Text>
                  <Text style={s.chooseLink} onPress={() => setSelectorOpen(true)}>
                    {t('app.choosePlace')}
                  </Text>
                </>
              )}
            </View>
          ))}
        {tab === 'alertas' &&
          (eclipse && !isPastActive ? (
            <AlertsScreen
              eclipse={eclipse}
              notificationsGranted={permissions.notifications}
              toggles={ctx.alertsOn}
              early={ctx.alertEarly}
              c1Plan={ctx.c1PlanAlerts}
              alertSound={prefs.alertSound}
              onToggle={(key, value) =>
                onPrefsChange(
                  withContext(prefs, activeCatalog.civilDate, { alertsOn: { ...ctx.alertsOn, [key]: value } }),
                )
              }
              onEarlyChange={(key, value) =>
                onPrefsChange(
                  withContext(prefs, activeCatalog.civilDate, { alertEarly: { ...ctx.alertEarly, [key]: value } }),
                )
              }
              onC1PlanChange={(c1PlanAlerts) =>
                onPrefsChange(withContext(prefs, activeCatalog.civilDate, { c1PlanAlerts }))
              }
            />
          ) : (
            <View style={s.loading}>
              <Text style={s.loadingText}>
                {isPastActive
                  ? t('alerts.pastEclipse')
                  : outOfZone && active
                    ? t('app.outOfZone', {
                        place: cleanPlaceLabel(active.place),
                        date: activeCatalog.shortDateLabel,
                      })
                    : t('app.chooseSpotFirst')}
              </Text>
            </View>
          ))}
        {tab === 'eclipses' && (
          <EclipsesScreen
            activeEclipse={activeCatalog}
            onSelectEclipse={(day) => {
              const past = day !== '' && day < todayKey;
              track('eclipse_selected', { day: day || 'auto', past });
              onPrefsChange({ ...prefs, selectedEclipseDay: day, selectedEclipsePast: past });
            }}
          />
        )}
        {tab === 'ajustes' && (
          <SettingsScreen
            permissions={permissions}
            onRequestPermission={(kind) => void requestPermission(kind)}
            alertSound={prefs.alertSound}
            donateUrl={remote.donateUrl}
            // El efecto de alertas reprograma solo al cambiar alertSound
            onSoundChange={(sound) => onPrefsChange({ ...prefs, alertSound: sound })}
            updateChannel={prefs.updateChannel}
            onUpdateChannelChange={(channel) => onPrefsChange({ ...prefs, updateChannel: channel })}
            onDemoEclipse={() => setDemoAt(new Date())}
            language={prefs.language}
            onLanguageChange={(lang) => onPrefsChange({ ...prefs, language: lang })}
            onStartDrill={startDrill}
            onShowTour={() => setTourOpen(true)}
          />
        )}
      </View>
      <TabBar active={tab} onChange={setTab} />
      <SpotSelector
        visible={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        userGeo={geo ? { lat: geo.lat, lon: geo.lon } : null}
        gpsPlace={geo?.place ?? t('spot.yourPosition')}
        activeSpot={activeSpot}
        recentSpots={prefs.recentSpots}
        suggestedSpots={remote.suggestedSpots}
        onSelect={selectSpot}
      />
      {/* Primer arranque o repetición desde Ajustes. Fuera del modo eclipse: ese return
          va antes, así que el día D nunca se cruza por delante del evento. */}
      {(tourOpen || !prefs.tourSeen) && (
        <Tour
          onClose={() => {
            setTourOpen(false);
            if (!prefs.tourSeen) onPrefsChange({ ...prefs, tourSeen: true });
          }}
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    // El aviso de fuera de zona lleva nombre de lugar y fecha: sin aire moriría en los bordes
    paddingHorizontal: 32,
    backgroundColor: C.bg,
  },
  loadingText: { color: C.dim, fontSize: 14, fontFamily: F.medium, textAlign: 'center' },
  chooseLink: { color: C.corona, fontSize: 14, fontFamily: F.bold, letterSpacing: 1 },
});
