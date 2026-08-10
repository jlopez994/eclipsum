import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from 'react-native';
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
import { fetchRemoteExtras, type Sponsor } from './lib/firebase';
import { contextFor, DEFAULT_PREFS, pushRecent, withContext } from './lib/prefs';
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
  return { name: cleanPlaceLabel(geo.place) || 'Mi posición', lat: geo.lat, lon: geo.lon, origin: 'gps' };
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
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [updateUrl, setUpdateUrl] = useState('');
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
    scheduleEclipseAlerts(eclipse, ctx.alertsOn, prefs.alertSound, ctx.alertEarly, ctx.c1PlanAlerts).catch(() => {
      // sin permiso o error puntual: el usuario puede reprogramar desde Alertas
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eclipse, permissions.notifications, ctx, prefs?.alertSound, drill]);

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
    if (!eclipse || !prefs) return 'Elige primero un puesto en el mapa';
    if (!Object.values(ctx.alertsOn).some(Boolean)) return 'Activa alguna alerta en ALERTAS primero';
    const c1At = new Date(Date.now() + DRILL_LEAD_MS);
    const fake = buildDrillEclipse(eclipse, c1At, prefs.drill);
    const ids = await scheduleFakeEclipseAlerts(fake, c1At, ctx.alertsOn, prefs.alertSound, ctx.alertEarly);
    setDrill({ eclipse: fake, ids });
    return `Simulacro en marcha · C1 a las ${c1At.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
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
    return cleanPlaceLabel(geo.place) || 'TÚ';
  })();

  if (activeEclipse && active && (demo || inEclipseWindow)) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <EclipseModeScreen
          eclipse={activeEclipse}
          place={cleanPlaceLabel(active.place)}
          now={now}
          exitLabel={drill ? 'SIMULACRO' : demo ? 'DEMO' : null}
          onExitDemo={drill ? exitDrill : () => setDemo(false)}
          onJumpToEvent={drill ? jumpDrill : null}
        />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {remoteMsg !== '' && (
        <View style={[s.remoteBanner, { marginTop: insets.top + 8 }]}>
          <Text style={s.remoteBannerText}>{remoteMsg}</Text>
        </View>
      )}
      {updateUrl !== '' && (
        <View style={[s.remoteBanner, { marginTop: remoteMsg !== '' ? 8 : insets.top + 8 }]}>
          <Text style={s.remoteBannerText}>Hay una versión nueva de Eclipsum</Text>
          <Text style={s.updateLink} onPress={() => Linking.openURL(updateUrl).catch(() => {})}>
            DESCARGAR →
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        {tab === 'mapa' &&
          (eclipse && active ? (
            <MapScreen
              eclipse={eclipse}
              place={cleanPlaceLabel(active.place)}
              hereLabel={hereLabel}
              spotIsGps={active.origin === 'gps'}
              hereOnMap={hereOnMap}
              cloudPct={cloud.pct}
              cloudAgeHours={cloud.ageH}
              cloudLoading={cloud.loading}
              totality={totality}
              now={now}
              spotCoords={{ lat: active.lat, lon: active.lon }}
              hereCoords={hereOnMap && geo ? { lat: geo.lat, lon: geo.lon } : null}
              mapView={prefs.mapView}
              onToggleMapView={() =>
                onPrefsChange({ ...prefs, mapView: prefs.mapView === 'real' ? 'diagram' : 'real' })
              }
              onOpenSelector={() => setSelectorOpen(true)}
              onOpenMaps={() => openInMaps(active.lat, active.lon, active.place)}
              onSelectMapPoint={selectMapPoint}
              divergenceKm={divergenceKm}
              onRecalcHere={recalcHere}
              sponsor={sponsor}
            />
          ) : (
            <View style={s.loading}>
              {locating ? (
                <>
                  <ActivityIndicator color={C.corona} size="large" />
                  <Text style={s.loadingText}>Obteniendo ubicación…</Text>
                </>
              ) : (
                <>
                  <Text style={s.loadingText}>Sin GPS. Elige un puesto de observación.</Text>
                  <Text style={s.chooseLink} onPress={() => setSelectorOpen(true)}>
                    ELEGIR LUGAR →
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
              <Text style={s.loadingText}>Elige primero un puesto de observación en el mapa.</Text>
            </View>
          ))}
        {tab === 'ajustes' && (
          <SettingsScreen
            permissions={permissions}
            alertSound={prefs.alertSound}
            activeEclipse={activeCatalog}
            glassesUrl={glassesUrl}
            // El efecto de alertas reprograma solo al cambiar alertSound
            onSoundChange={(sound) => onPrefsChange({ ...prefs, alertSound: sound })}
            onDemoEclipse={() => setDemo(true)}
            onSelectEclipse={(day) => onPrefsChange({ ...prefs, selectedEclipseDay: day })}
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
        gpsPlace={geo?.place ?? 'Tu posición'}
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
  remoteBanner: {
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.corona,
    borderRadius: 12,
    padding: 12,
  },
  remoteBannerText: { color: C.corona, fontFamily: F.semibold, fontSize: 13, textAlign: 'center' },
  updateLink: {
    color: C.corona,
    fontFamily: F.bold,
    fontSize: 12,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 6,
  },
});
