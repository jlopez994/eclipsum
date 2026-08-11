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
  eclipseDayOf,
  isActiveEclipse,
  shiftEclipse,
  type LocalEclipse,
} from './lib/eclipse';
import { eclipseForDay, getActiveEclipse } from './lib/eclipseCatalog';
import { haversineKm } from './lib/totality';
import { openInMaps } from './lib/maps';
import { cleanPlaceLabel, REAL_PLACE_KM, type Spot } from './lib/spots';
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
import { SpotSelector, localityName } from './components/SpotSelector';
import { MapScreen } from './components/screens/MapScreen';
import { AlertsScreen } from './components/screens/AlertsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { EclipseModeScreen } from './components/screens/EclipseModeScreen';
import { C, F } from './components/theme';

const ECLIPSE_MODE_LEAD_MS = 30 * 60_000;
const ECLIPSE_MODE_TAIL_MS = 5 * 60_000;
const COARSE_TICK_MS = 30_000;
const FINE_TICK_MS = 1_000;
/** Aviso día D: GPS lejos del puesto elegido → las horas de contacto ya no valen */
const DIVERGENCE_KM = 20;

/** Puesto que se está pintando, con sus circunstancias ya calculadas. */
interface ShownSpot {
  place: string;
  lat: number;
  lon: number;
  eclipse: LocalEclipse;
}

function inFineClockWindow(eclipse: LocalEclipse, t: number): boolean {
  const first = eclipse.events[0];
  const last = eclipse.events[eclipse.events.length - 1];
  if (!first || !last) return false;
  return t >= first.time.getTime() - ECLIPSE_MODE_LEAD_MS && t <= last.time.getTime() + ECLIPSE_MODE_TAIL_MS;
}

function gpsSpot(geo: { place: string; lat: number; lon: number }): Spot {
  return { name: cleanPlaceLabel(geo.place) || t('app.myPosition'), lat: geo.lat, lon: geo.lon, origin: 'gps' };
}

/** Eclipse sintético para la demo: desplaza los eventos para que el siguiente hito caiga en ~2 min. */
function buildDemoEclipse(real: LocalEclipse, now: Date): LocalEclipse {
  const anchor = real.events.find((e) => e.key === 'C2') ?? real.events.find((e) => e.key === 'MAX');
  if (!anchor) return real;
  return shiftEclipse(real, now.getTime() + 2 * 60_000 - anchor.time.getTime());
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
  const { geo, locating, granted: locationGranted } = useGeo();
  const permissions = usePermissions(locationGranted);
  const remote = useRemoteExtras();
  const [tab, setTab] = useState<TabKey>('mapa');
  const [demo, setDemo] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
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

  // Puesto deseado (cálculos); fallback temporal a GPS mientras se siembra
  const activeSpot = ctx.spot;
  const active = activeSpot
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

  // Último puesto con circunstancias reales: es lo que sigue pintándose detrás del aviso
  // cuando el nuevo cae fuera de zona. Se guarda en un ref (y no en estado) porque solo
  // se lee al renderizar el caso raro: mantenerlo en estado provocaría un render de más.
  const lastValidRef = useRef<ShownSpot | null>(null);
  useEffect(() => {
    if (eclipse && active) {
      lastValidRef.current = { place: active.place, lat: active.lat, lon: active.lon, eclipse };
    }
  }, [eclipse, active?.lat, active?.lon, active?.place]);

  /** Lo que se pinta: el puesto elegido si sus datos valen, o el último que valió. */
  const shown: ShownSpot | null =
    eclipse && active
      ? { place: active.place, lat: active.lat, lon: active.lon, eclipse }
      : outOfZone
        ? lastValidRef.current
        : null;

  // Eclipse que SÍ se ve desde el puesto elegido: es justo el que devuelve el motor cuando
  // el activo no es visible. Sin entrada en el catálogo no hay adónde llevar al usuario.
  const otherDay = outOfZone && localEclipse ? eclipseDayOf(localEclipse) : null;
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
    const first = eclipse.events[0]?.time.getTime();
    const last = eclipse.events[eclipse.events.length - 1]?.time.getTime();
    if (first == null || last == null) {
      setFineClock(false);
      return;
    }
    const start = first - ECLIPSE_MODE_LEAD_MS;
    const end = last + ECLIPSE_MODE_TAIL_MS;
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
    scheduleEclipseAlerts(eclipse, ctx.alertsOn, prefs.alertSound, ctx.alertEarly, ctx.c1PlanAlerts).catch((e) => {
      // El efecto solo entra con permiso concedido: fallar aquí es raro y reportable.
      // El usuario siempre puede reprogramar desde Alertas.
      trackError('schedule_alerts', e);
    });
    // prefs?.language: el copy de las notificaciones se hornea al programar — reprogramar al cambiar idioma
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eclipse, permissions.notifications, ctx, prefs?.alertSound, prefs?.language, drill]);

  const selectSpot = useCallback(
    (spot: Spot) => {
      if (!prefs) return;
      animateNextLayout();
      const recentSpots = spot.origin === 'gps' ? prefs.recentSpots : pushRecent(prefs.recentSpots, spot);
      onPrefsChange({ ...withContext(prefs, activeCatalog.civilDate, { spot }), recentSpots });
    },
    [prefs, activeCatalog.civilDate, onPrefsChange],
  );

  // Punto tocado en el mapa real: nombre vía geocoder inverso (fallback coordenadas)
  const selectMapPoint = useCallback(
    ({ lat, lon }: { lat: number; lon: number }) => {
      void (async () => {
        const name = (await localityName(lat, lon)) ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        selectSpot({ name, lat, lon, origin: 'manual' });
      })();
    },
    [selectSpot],
  );

  const recalcHere = useCallback(() => {
    if (geo) selectSpot(gpsSpot(geo));
  }, [geo, selectSpot]);

  if (!fontsLoaded || !prefs) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.corona} size="large" />
      </View>
    );
  }

  // Velo con la explicación; `key` por puesto para que un puesto nuevo vuelva a avisar
  // aunque cerraras el anterior. Solo se ofrece saltar si el otro eclipse está en catálogo.
  const outOfZoneNotice =
    outOfZone && active ? (
      <OutOfZoneNotice
        key={`${active.lat},${active.lon}`}
        place={cleanPlaceLabel(active.place)}
        date={activeCatalog.shortDateLabel}
        keepingPlace={shown ? cleanPlaceLabel(shown.place) : null}
        otherLabel={otherEclipse?.label ?? null}
        onGoToOther={() => {
          if (!otherEclipse) return;
          track('eclipse_selected', { day: otherEclipse.civilDate, from: 'out_of_zone' });
          onPrefsChange({ ...prefs, selectedEclipseDay: otherEclipse.civilDate });
        }}
        top={insets.top + 12}
      />
    ) : null;

  const demoEclipse = demo && eclipse ? buildDemoEclipse(eclipse, now) : null;
  const activeEclipse = drill?.eclipse ?? demoEclipse ?? eclipse;

  // Modo eclipse: automático en ventana del evento, o demo forzada
  const inEclipseWindow = activeEclipse ? inFineClockWindow(activeEclipse, now.getTime()) : false;

  // Distancia GPS ↔ puesto PINTADO (no el elegido): el marcador «TÚ» y el aviso del día D
  // se miden contra lo que hay en pantalla, o dirían una cosa y el mapa otra
  const spotDistanceKm = geo && shown ? haversineKm(geo.lat, geo.lon, shown.lat, shown.lon) : null;

  const divergenceKm = (() => {
    if (spotDistanceKm === null || !activeSpot || !eclipse) return null;
    const c1 = eclipse.events[0];
    if (!c1 || now.getTime() < c1.time.getTime() - 24 * 3_600_000) return null;
    return spotDistanceKm > DIVERGENCE_KM ? spotDistanceKm : null;
  })();

  // Nombre corto del GPS cuando está lo bastante lejos del puesto; null = un solo punto
  const hereLabel =
    spotDistanceKm !== null && spotDistanceKm >= REAL_PLACE_KM && geo
      ? cleanPlaceLabel(geo.place) || t('map.you')
      : null;

  if (activeEclipse && active && (demo || inEclipseWindow)) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <EclipseModeScreen
          eclipse={activeEclipse}
          place={cleanPlaceLabel(active.place)}
          now={now}
          exitLabel={drill ? t('settings.drill') : demo ? 'DEMO' : null}
          onExitDemo={drill ? exitDrill : () => setDemo(false)}
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
        top={insets.top}
      />
      <View style={{ flex: 1 }}>
        {tab === 'mapa' &&
          (shown ? (
            <MapScreen
              eclipse={shown.eclipse}
              place={cleanPlaceLabel(shown.place)}
              hereLabel={hereLabel}
              cloudPct={cloud.pct}
              cloudAgeHours={cloud.ageH}
              cloudLoading={cloud.loading}
              totality={totality}
              now={now}
              spotCoords={{ lat: shown.lat, lon: shown.lon }}
              hereCoords={hereLabel !== null && geo ? { lat: geo.lat, lon: geo.lon } : null}
              gpsCoords={geo ? { lat: geo.lat, lon: geo.lon } : null}
              onOpenSelector={() => setSelectorOpen(true)}
              onOpenMaps={() => openInMaps(shown.lat, shown.lon, shown.place)}
              onSelectMapPoint={selectMapPoint}
              divergenceKm={divergenceKm}
              onRecalcHere={recalcHere}
              sponsor={remote.sponsor}
              glassesUrl={remote.glassesUrl}
            />
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
          (eclipse ? (
            <AlertsScreen
              eclipse={eclipse}
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
                {outOfZone && active
                  ? t('app.outOfZone', {
                      place: cleanPlaceLabel(active.place),
                      date: activeCatalog.shortDateLabel,
                    })
                  : t('app.chooseSpotFirst')}
              </Text>
            </View>
          ))}
        {/* Encima del contenido y bajo la barra de pestañas: deja ver el mapa al cerrarse */}
        {tab === 'mapa' && outOfZoneNotice}
        {tab === 'ajustes' && (
          <SettingsScreen
            permissions={permissions}
            alertSound={prefs.alertSound}
            activeEclipse={activeCatalog}
            donateUrl={remote.donateUrl}
            // El efecto de alertas reprograma solo al cambiar alertSound
            onSoundChange={(sound) => onPrefsChange({ ...prefs, alertSound: sound })}
            onDemoEclipse={() => setDemo(true)}
            language={prefs.language}
            onLanguageChange={(lang) => onPrefsChange({ ...prefs, language: lang })}
            onSelectEclipse={(day) => {
              track('eclipse_selected', { day: day || 'auto' });
              onPrefsChange({ ...prefs, selectedEclipseDay: day });
            }}
            onStartDrill={startDrill}
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
