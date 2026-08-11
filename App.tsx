import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  useFonts,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { computeLocalEclipse, type EclipseEvent, type LocalEclipse } from './lib/eclipse';
import { getActiveEclipse } from './lib/eclipseCatalog';
import { haversineKm } from './lib/totality';
import { openInMaps } from './lib/maps';
import type { Spot } from './lib/spots';
import { cancelAlertsByIds, scheduleEclipseAlerts, scheduleFakeEclipseAlerts } from './lib/notifications';
import { buildDrillEclipse } from './lib/drill';
import { fetchRemoteExtras, track, trackError, type Sponsor } from './lib/firebase';
import {
  contextFor,
  DEFAULT_PREFS,
  DONATE_PROMPT_AFTER,
  DONATE_PROMPT_DONE,
  pushRecent,
  withContext,
} from './lib/prefs';
import { localeTag, t } from './lib/i18n';
import { animateNextLayout } from './lib/anim';
import { useGeo } from './hooks/useGeo';
import { usePrefs } from './hooks/usePrefs';
import { REAL_PLACE_KM, useSpotData } from './hooks/useSpotData';
import { TabBar, type TabKey } from './components/TabBar';
import { SpotSelector, localityName } from './components/SpotSelector';
import { MapScreen } from './components/screens/MapScreen';
import { AlertsScreen } from './components/screens/AlertsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { EclipseModeScreen } from './components/screens/EclipseModeScreen';
import { C, F } from './components/theme';

const ECLIPSE_MODE_LEAD_MS = 30 * 60_000;
/** Espera hasta el C1 del simulacro: da tiempo a bloquear el móvil y esperar el aviso */
const DRILL_LEAD_MS = 2 * 60_000;
/** Al saltar de fase, el hito cae en 20 s: los avisos con antelación (15 s) aún suenan */
const DRILL_JUMP_LEAD_MS = 20_000;
const ECLIPSE_MODE_TAIL_MS = 5 * 60_000;
const COARSE_TICK_MS = 30_000;
const FINE_TICK_MS = 1_000;

function inFineClockWindow(eclipse: LocalEclipse, t: number): boolean {
  const first = eclipse.events[0];
  const last = eclipse.events[eclipse.events.length - 1];
  if (!first || !last) return false;
  return t >= first.time.getTime() - ECLIPSE_MODE_LEAD_MS && t <= last.time.getTime() + ECLIPSE_MODE_TAIL_MS;
}

function cleanPlaceLabel(name: string): string {
  return name.replace(/\s·\sGPS$/, '').replace(/\s·\sManual$/, '').trim();
}

function gpsSpot(geo: { place: string; lat: number; lon: number }): Spot {
  return { name: cleanPlaceLabel(geo.place) || t('app.myPosition'), lat: geo.lat, lon: geo.lon, origin: 'gps' };
}

/** Eclipse sintético para la demo: desplaza los eventos para que el siguiente hito caiga en ~2 min. */
function buildDemoEclipse(real: LocalEclipse, now: Date): LocalEclipse {
  const anchor = real.events.find((e) => e.key === 'C2') ?? real.events.find((e) => e.key === 'MAX');
  if (!anchor) return real;
  const shift = now.getTime() + 2 * 60_000 - anchor.time.getTime();
  return {
    ...real,
    events: real.events.map((e) => ({ ...e, time: new Date(e.time.getTime() + shift) })),
  };
}

/** ✕ de un aviso flotante: esquina superior derecha, área táctil generosa */
function CloseBanner({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={s.bannerClose}
      accessibilityRole="button"
      accessibilityLabel={t('app.bannerClose')}
    >
      <Text style={s.bannerCloseTxt}>✕</Text>
    </Pressable>
  );
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
  const [permissions, setPermissions] = useState({ location: false, notifications: false });
  const [remoteMsg, setRemoteMsg] = useState('');
  const [glassesUrl, setGlassesUrl] = useState('');
  const [donateUrl, setDonateUrl] = useState('');
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [updateUrl, setUpdateUrl] = useState('');
  /** Avisos ocultados con la ✕; en memoria a propósito: vuelven al reiniciar la app */
  const [updateHidden, setUpdateHidden] = useState(false);
  const [remoteMsgHidden, setRemoteMsgHidden] = useState(false);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [tab, setTab] = useState<TabKey>('mapa');
  const [demo, setDemo] = useState(false);
  /** Simulacro activo: eclipse sintético + ids de sus avisos [PRUEBA] (para cancelarlos al salir) */
  const [drill, setDrill] = useState<{ eclipse: LocalEclipse; ids: string[] } | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [fineClock, setFineClock] = useState(false);

  // Eclipse activo: selección del usuario, override RC o el más próximo
  const activeCatalog = getActiveEclipse();
  // Contexto per-eclipse (puesto + alertas), clave = día civil; identidad estable sin memo
  const ctx = contextFor(prefs ?? DEFAULT_PREFS, activeCatalog.civilDate);

  useEffect(() => {
    setPermissions((p) => ({ ...p, location: locationGranted }));
  }, [locationGranted]);

  // Una apertura en frío por lanzamiento: el aviso de donación llega tras varios usos,
  // nunca al primer contacto con la app
  const openCounted = useRef(false);
  useEffect(() => {
    if (!prefs || openCounted.current) return;
    openCounted.current = true;
    if (prefs.donateOpens === DONATE_PROMPT_DONE || prefs.donateOpens >= DONATE_PROMPT_AFTER) return;
    onPrefsChange({ ...prefs, donateOpens: prefs.donateOpens + 1 });
  }, [prefs, onPrefsChange]);

  /**
   * Los avisos flotan BAJO el cromo propio de cada pestaña —chips en el mapa, título en
   * el resto—: así no tapan nada ni empujan nada. Alturas fijas porque ese cromo lo es.
   */
  const bannerTop = insets.top + (tab === 'mapa' ? 52 : 64);

  // Ocultar un aviso dura lo que dure la sesión: al reiniciar vuelve si sigue vigente
  const showRemoteMsg = remoteMsg !== '' && !remoteMsgHidden;
  const showUpdate = updateUrl !== '' && !updateHidden;

  // Sin URL en Remote Config no hay aviso; DONATE_PROMPT_DONE (-1) nunca alcanza el umbral
  const showDonatePrompt = donateUrl !== '' && (prefs?.donateOpens ?? 0) >= DONATE_PROMPT_AFTER;

  /** Cierra el aviso para siempre; `donated` abre Buy Me a Coffee */
  const resolveDonate = useCallback(
    (donated: boolean) => {
      if (!prefs) return;
      onPrefsChange({ ...prefs, donateOpens: DONATE_PROMPT_DONE });
      track(donated ? 'donate_click' : 'donate_dismiss', { from: 'banner' });
      if (donated) Linking.openURL(donateUrl).catch(() => {});
    },
    [prefs, onPrefsChange, donateUrl],
  );

  useEffect(() => {
    // Relee permisos sin pedirlos: el usuario puede cambiarlos en Ajustes del sistema
    const refreshPermissions = () => {
      void Notifications.getPermissionsAsync().then(({ status }) =>
        setPermissions((p) => ({ ...p, notifications: status === 'granted' })),
      );
      void Location.getForegroundPermissionsAsync().then(({ status }) =>
        setPermissions((p) => ({ ...p, location: status === 'granted' })),
      );
    };
    const pullRemote = () =>
      void fetchRemoteExtras().then((r) => {
        setRemoteMsg(r.message);
        setGlassesUrl(r.glassesUrl);
        setDonateUrl(r.donateUrl);
        setSponsor(r.sponsor);
        // Aviso de actualización sin tienda: RC anuncia versionCode y URL de la APK
        const ownVc = Constants.expoConfig?.android?.versionCode ?? 0;
        setUpdateUrl(r.latestVersionCode > ownVc && r.latestApkUrl ? r.latestApkUrl : '');
        // RC puede cambiar el eclipse activo → recalcular circunstancias
        setCatalogEpoch((n) => n + 1);
      });
    pullRemote();
    refreshPermissions();
    // Al volver a primer plano: Remote Config (respeta caché) y permisos actualizados
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        pullRemote();
        refreshPermissions();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Simulacro incluido: su ventana no coincide con la del eclipse real que vigila fineClock
    const ms = demo || drill !== null || fineClock ? FINE_TICK_MS : COARSE_TICK_MS;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [demo, drill, fineClock]);

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

  const eclipse = useMemo(
    () => (active ? computeLocalEclipse(active.lat, active.lon) : null),
    // activeCatalog.id: selección de usuario o rollover; catalogEpoch: RC puede cambiar la entrada
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.lat, active?.lon, activeCatalog.id, catalogEpoch],
  );

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

  const { cloud, totality, hereOnMap } = useSpotData(active, eclipse, geo);

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

  // Simulacro: eclipse sintético con los tramos configurados, C1 en 2 min.
  // La app entra en modo eclipse (ventana de 30 min) y los avisos [PRUEBA] son aditivos.
  const startDrill = useCallback(async () => {
    if (!eclipse || !prefs) return t('app.drill.needSpot');
    if (!Object.values(ctx.alertsOn).some(Boolean)) return t('app.drill.needAlert');
    const c1At = new Date(Date.now() + DRILL_LEAD_MS);
    const fake = buildDrillEclipse(eclipse, c1At, prefs.drill);
    const ids = await scheduleFakeEclipseAlerts(fake, c1At, ctx.alertsOn, prefs.alertSound, ctx.alertEarly);
    setDrill({ eclipse: fake, ids });
    track('drill_started');
    return t('app.drill.running', {
      time: c1At.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' }),
    });
  }, [eclipse, prefs, ctx]);

  const exitDrill = useCallback(() => {
    if (drill) void cancelAlertsByIds(drill.ids);
    setDrill(null);
  }, [drill]);

  // Salto de fase: desplaza la serie para que el hito tocado caiga en 20 s
  // (los avisos con antelación de 15 s siguen entrando) y reprograma los [PRUEBA] restantes.
  const jumpDrill = useCallback(
    (key: EclipseEvent['key']) => {
      if (!drill || !prefs) return;
      const target = drill.eclipse.events.find((e) => e.key === key);
      if (!target) return;
      const shift = Date.now() + DRILL_JUMP_LEAD_MS - target.time.getTime();
      const shifted: LocalEclipse = {
        ...drill.eclipse,
        events: drill.eclipse.events.map((e) => ({ ...e, time: new Date(e.time.getTime() + shift) })),
      };
      void cancelAlertsByIds(drill.ids);
      const c1 = shifted.events[0];
      scheduleFakeEclipseAlerts(shifted, c1.time, ctx.alertsOn, prefs.alertSound, ctx.alertEarly)
        .then((ids) => setDrill({ eclipse: shifted, ids }))
        .catch(() => setDrill({ eclipse: shifted, ids: [] }));
      setNow(new Date()); // repintar fase al instante, sin esperar al tick
    },
    [drill, prefs, ctx],
  );

  // Fin natural del simulacro: pasado C4 + margen, la app vuelve sola al modo normal
  useEffect(() => {
    if (!drill) return;
    const last = drill.eclipse.events[drill.eclipse.events.length - 1];
    if (now.getTime() > last.time.getTime() + 60_000) setDrill(null);
  }, [now, drill]);

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

  const demoEclipse = demo && eclipse ? buildDemoEclipse(eclipse, now) : null;
  const activeEclipse = drill?.eclipse ?? demoEclipse ?? eclipse;

  // Modo eclipse: automático en ventana del evento, o demo forzada
  const inEclipseWindow = activeEclipse ? inFineClockWindow(activeEclipse, now.getTime()) : false;

  // Aviso día D: GPS lejos del puesto elegido (>20 km) → las horas de contacto ya no valen
  const divergenceKm = (() => {
    if (!geo || !activeSpot || !eclipse) return null;
    const c1 = eclipse.events[0];
    if (!c1 || now.getTime() < c1.time.getTime() - 24 * 3_600_000) return null;
    const km = haversineKm(geo.lat, geo.lon, activeSpot.lat, activeSpot.lon);
    return km > 20 ? km : null;
  })();

  const hereLabel = (() => {
    if (!geo || !active) return null;
    const km = haversineKm(geo.lat, geo.lon, active.lat, active.lon);
    if (km < REAL_PLACE_KM) return null;
    return cleanPlaceLabel(geo.place) || t('map.you');
  })();

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
          onJumpToEvent={drill ? jumpDrill : null}
        />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {/*
        Los avisos FLOTAN sobre el contenido: si empujaran el layout, el WebView del
        mapa se redimensionaría en cada aparición. box-none = los toques pasan al mapa
        salvo en los propios banners.
      */}
      <View
        style={[s.bannerStack, { top: bannerTop }]}
        pointerEvents="box-none"
      >
        {showRemoteMsg && (
          <View style={[s.infoBanner, s.bannerShadow]}>
            <Text style={[s.infoBannerText, s.bannerTextInset]}>{remoteMsg}</Text>
            <CloseBanner onPress={() => setRemoteMsgHidden(true)} />
          </View>
        )}
        {showUpdate && (
          <View style={[s.updateBanner, s.bannerShadow]}>
            <Text style={[s.updateText, s.bannerTextInset]}>{t('app.updateBanner')}</Text>
            <Text style={s.updateLink} onPress={() => Linking.openURL(updateUrl).catch(() => {})}>
              {t('app.updateCta')}
            </Text>
            <CloseBanner onPress={() => setUpdateHidden(true)} />
          </View>
        )}
        {/* Propina: solo tras varios usos, una vez en la vida y nunca en modo eclipse (return aparte) */}
        {showDonatePrompt && (
          <View style={[s.donateBanner, s.bannerShadow]}>
            <Text style={s.donateText}>{t('app.donateBanner')}</Text>
            <View style={s.donateActions}>
              <Text style={s.donateLater} onPress={() => resolveDonate(false)}>
                {t('app.donateLater')}
              </Text>
              <Text style={s.donateCta} onPress={() => resolveDonate(true)}>
                {t('app.donateCta')}
              </Text>
            </View>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'mapa' &&
          (eclipse && active ? (
            <MapScreen
              eclipse={eclipse}
              place={cleanPlaceLabel(active.place)}
              hereLabel={hereLabel}
              cloudPct={cloud.pct}
              cloudAgeHours={cloud.ageH}
              cloudLoading={cloud.loading}
              totality={totality}
              now={now}
              spotCoords={{ lat: active.lat, lon: active.lon }}
              hereCoords={hereOnMap && geo ? { lat: geo.lat, lon: geo.lon } : null}
              gpsCoords={geo ? { lat: geo.lat, lon: geo.lon } : null}
              onOpenSelector={() => setSelectorOpen(true)}
              onOpenMaps={() => openInMaps(active.lat, active.lon, active.place)}
              onSelectMapPoint={selectMapPoint}
              divergenceKm={divergenceKm}
              onRecalcHere={recalcHere}
              sponsor={sponsor}
              glassesUrl={glassesUrl}
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
              <Text style={s.loadingText}>{t('app.chooseSpotFirst')}</Text>
            </View>
          ))}
        {tab === 'ajustes' && (
          <SettingsScreen
            permissions={permissions}
            alertSound={prefs.alertSound}
            activeEclipse={activeCatalog}
            donateUrl={donateUrl}
            // El efecto de alertas reprograma solo al cambiar alertSound
            onSoundChange={(sound) => onPrefsChange({ ...prefs, alertSound: sound })}
            onDemoEclipse={() => setDemo(true)}
            language={prefs.language}
            onLanguageChange={(lang) => onPrefsChange({ ...prefs, language: lang })}
            onSelectEclipse={(day) => {
              track('eclipse_selected', { day: day || 'auto' });
              onPrefsChange({ ...prefs, selectedEclipseDay: day });
            }}
            drill={prefs.drill}
            onDrillChange={(drillCfg) => onPrefsChange({ ...prefs, drill: drillCfg })}
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  loadingText: { color: C.dim, fontSize: 14, fontFamily: F.medium },
  chooseLink: { color: C.corona, fontSize: 14, fontFamily: F.bold, letterSpacing: 1 },
  /**
   * Escala de intensidad de los avisos: violeta = informativo, corona = hay algo que
   * puedes hacer, rojo = atención (aviso de distancia del mapa), neutro = petición.
   * Mismo molde en todos: tinte del acento, borde translúcido, texto blanco y acción en color.
   */
  bannerStack: { position: 'absolute', left: 0, right: 0, zIndex: 20, gap: 8 },
  /** Hueco para que el texto no pase por debajo de la ✕ */
  bannerTextInset: { paddingRight: 26 },
  bannerClose: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerCloseTxt: { fontFamily: F.semibold, fontSize: 13, color: C.dim },
  /**
   * Fondos OPACOS: flotan sobre el mapa, y un tinte translúcido dejaba pasar las
   * teselas y volvía ilegible el texto. Cada color es su tinte ya fundido sobre el
   * fondo de la app, más sombra para despegarlo del contenido.
   */
  bannerShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  infoBanner: {
    marginHorizontal: 16,
    backgroundColor: '#1D1A33',
    borderWidth: 1,
    borderColor: 'rgba(124,108,255,0.45)',
    borderRadius: 12,
    padding: 12,
  },
  infoBannerText: { fontFamily: F.semibold, fontSize: 13, lineHeight: 18, color: C.text },
  updateBanner: {
    marginHorizontal: 16,
    backgroundColor: '#2B2116',
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.5)',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  /** El más apagado de la escala a propósito: pide, no avisa */
  donateBanner: {
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  donateText: { fontFamily: F.regular, fontSize: 13, lineHeight: 18, color: C.dim },
  donateActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 18 },
  donateLater: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.2, color: C.dim, padding: 4 },
  donateCta: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.2, color: C.corona, padding: 4 },
  // El texto explica qué pasa (blanco) y el color queda para lo que puedes pulsar
  updateText: { fontFamily: F.semibold, fontSize: 13, lineHeight: 18, color: C.text },
  updateLink: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1, color: C.corona },
});
