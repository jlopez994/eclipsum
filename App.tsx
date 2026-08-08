import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  useFonts,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { computeLocalEclipse, type LocalEclipse } from './lib/eclipse';
import { cloudCoverAt, fetchCloudCover } from './lib/weather';
import { findNearestTotality, haversineKm, type TotalityDirection } from './lib/totality';
import { openInMaps } from './lib/maps';
import type { Spot } from './lib/spots';
import { scheduleEclipseAlerts } from './lib/notifications';
import { fetchEclipseMessage, track } from './lib/firebase';
import { loadPrefs, pushRecent, savePrefs, type Prefs } from './lib/prefs';
import { TabBar, type TabKey } from './components/TabBar';
import { SpotSelector } from './components/SpotSelector';
import { MapScreen } from './components/screens/MapScreen';
import { AlertsScreen } from './components/screens/AlertsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { EclipseModeScreen } from './components/screens/EclipseModeScreen';
import { C, F } from './components/theme';

const ECLIPSE_MODE_LEAD_MS = 30 * 60_000;
const ECLIPSE_MODE_TAIL_MS = 5 * 60_000;
const COARSE_TICK_MS = 30_000;
/** Umbral para mostrar «Tú: …» bajo el chip del puesto */
const REAL_PLACE_KM = 1;

interface Geo {
  lat: number;
  lon: number;
  place: string;
}

function cleanPlaceLabel(name: string): string {
  return name.replace(/\s·\sGPS$/, '').replace(/\s·\sManual$/, '').trim();
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

export default function App() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [locating, setLocating] = useState(true);
  const [permissions, setPermissions] = useState({ location: false, notifications: false });
  const [cloudPct, setCloudPct] = useState<number | null>(null);
  const [totality, setTotality] = useState<TotalityDirection | 'none' | null>(null);
  /** GPS en la escala del diagrama cuando difiere del puesto; null = solapado */
  const [hereOnMap, setHereOnMap] = useState<{
    isTotal: boolean;
    totality: TotalityDirection | 'none' | null;
    /** km entre GPS y puesto */
    km: number;
    /** Obscuración en el GPS, 0..1; null si aún no calculada */
    obscuration: number | null;
  } | null>(null);
  const [remoteMsg, setRemoteMsg] = useState('');
  const [tab, setTab] = useState<TabKey>('mapa');
  const [demo, setDemo] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const onPrefsChange = useCallback((next: Prefs) => {
    setPrefs(next);
    void savePrefs(next);
  }, []);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void fetchEclipseMessage().then(setRemoteMsg);
    void Notifications.getPermissionsAsync().then(({ status }) =>
      setPermissions((p) => ({ ...p, notifications: status === 'granted' })),
    );
    // Reconsultar Remote Config al volver a primer plano (respeta el intervalo mínimo de caché)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchEclipseMessage().then(setRemoteMsg);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), COARSE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Resolver posición GPS (única fuente de «dónde estoy»; los puestos van aparte)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        setPermissions((p) => ({ ...p, location: status === 'granted' }));
        if (status !== 'granted') {
          setGeo(null);
          return;
        }
        // GPS puede fallar (emulador, interiores): caemos a la última posición conocida
        let coords: { lat: number; lon: number } | null = null;
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        } catch {
          const last = await Location.getLastKnownPositionAsync().catch(() => null);
          if (last) coords = { lat: last.coords.latitude, lon: last.coords.longitude };
        }
        if (cancelled) return;
        if (!coords) {
          setGeo(null);
          return;
        }
        let place = 'GPS';
        try {
          const [addr] = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon });
          if (addr?.city) place = `${addr.city} · GPS`;
        } catch {
          // sin geocoder: mostramos solo GPS
        }
        if (!cancelled) setGeo({ lat: coords.lat, lon: coords.lon, place });
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sembrar puesto deseado con GPS si aún no hay ninguno guardado
  useEffect(() => {
    if (!prefs || !geo || prefs.spot) return;
    const spot: Spot = {
      name: cleanPlaceLabel(geo.place) || 'Mi posición',
      lat: geo.lat,
      lon: geo.lon,
      origin: 'gps',
    };
    onPrefsChange({ ...prefs, spot });
  }, [prefs, geo, onPrefsChange]);

  // Puesto deseado (cálculos); fallback temporal a GPS mientras se siembra
  const activeSpot = prefs?.spot ?? null;
  const active = activeSpot
    ? { lat: activeSpot.lat, lon: activeSpot.lon, place: activeSpot.name, origin: activeSpot.origin }
    : geo
      ? { lat: geo.lat, lon: geo.lon, place: cleanPlaceLabel(geo.place), origin: 'gps' as const }
      : null;

  const eclipse = useMemo(
    () => (active ? computeLocalEclipse(active.lat, active.lon) : null),
    [active?.lat, active?.lon],
  );

  // Nubosidad + totalidad cercana + analytics al cambiar de puesto
  useEffect(() => {
    if (!active || !eclipse) return;
    let cancelled = false;
    track('eclipse_computed', { kind: eclipse.kind, obscuration: Math.round(eclipse.obscuration * 100) });
    const maxEvent = eclipse.events.find((e) => e.key === 'MAX');
    fetchCloudCover(active.lat, active.lon)
      .then((f) => {
        if (!cancelled && maxEvent) setCloudPct(cloudCoverAt(f, maxEvent.time));
      })
      .catch(() => !cancelled && setCloudPct(null));
    if (eclipse.kind === 'total') {
      setTotality(null);
    } else {
      findNearestTotality(active.lat, active.lon)
        .then((t) => !cancelled && setTotality(t ?? 'none'))
        .catch(() => !cancelled && setTotality('none'));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.lat, active?.lon, eclipse]);

  // Segundo punto: GPS real en la escala de la banda cuando no coincide con el puesto
  useEffect(() => {
    if (!geo || !active) {
      setHereOnMap(null);
      return;
    }
    const km = haversineKm(geo.lat, geo.lon, active.lat, active.lon);
    if (km < REAL_PLACE_KM) {
      setHereOnMap(null);
      return;
    }
    let cancelled = false;
    const kmRound = Math.round(km);
    // Provisional ya: que el punto se vea sin esperar al cálculo de km a la banda
    setHereOnMap({ isTotal: false, totality: 'none', km: kmRound, obscuration: null });
    try {
      const hereEc = computeLocalEclipse(geo.lat, geo.lon);
      if (hereEc.kind === 'total') {
        if (!cancelled)
          setHereOnMap({ isTotal: true, totality: null, km: kmRound, obscuration: hereEc.obscuration });
        return () => {
          cancelled = true;
        };
      }
      findNearestTotality(geo.lat, geo.lon)
        .then((t) => {
          if (!cancelled)
            setHereOnMap({ isTotal: false, totality: t ?? 'none', km: kmRound, obscuration: hereEc.obscuration });
        })
        .catch(() => {
          if (!cancelled)
            setHereOnMap({ isTotal: false, totality: 'none', km: kmRound, obscuration: hereEc.obscuration });
        });
    } catch {
      if (!cancelled) setHereOnMap({ isTotal: false, totality: 'none', km: kmRound, obscuration: null });
    }
    return () => {
      cancelled = true;
    };
  }, [geo?.lat, geo?.lon, active?.lat, active?.lon]);

  // Reprogramar alertas al cambiar de puesto (las horas de contacto varían por ubicación)
  useEffect(() => {
    if (!eclipse || !prefs || !permissions.notifications) return;
    if (!Object.values(prefs.alertsOn).some(Boolean)) return;
    scheduleEclipseAlerts(eclipse, prefs.alertsOn).catch(() => {
      // sin permiso o error puntual: el usuario puede reprogramar desde Alertas
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eclipse]);

  const selectSpot = useCallback(
    (spot: Spot) => {
      if (!prefs) return;
      const recentSpots = spot.origin === 'gps' ? prefs.recentSpots : pushRecent(prefs.recentSpots, spot);
      onPrefsChange({ ...prefs, spot, recentSpots });
    },
    [prefs, onPrefsChange],
  );

  const recalcHere = useCallback(() => {
    if (!prefs || !geo) return;
    const spot: Spot = {
      name: cleanPlaceLabel(geo.place) || 'Mi posición',
      lat: geo.lat,
      lon: geo.lon,
      origin: 'gps',
    };
    onPrefsChange({ ...prefs, spot });
  }, [prefs, geo, onPrefsChange]);

  if (!fontsLoaded || !prefs) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.corona} size="large" />
      </View>
    );
  }

  const demoEclipse = demo && eclipse ? buildDemoEclipse(eclipse, now) : null;
  const activeEclipse = demoEclipse ?? eclipse;

  // Modo eclipse: automático en ventana del evento, o demo forzada
  const first = activeEclipse?.events[0];
  const last = activeEclipse ? activeEclipse.events[activeEclipse.events.length - 1] : undefined;
  const inEclipseWindow =
    first !== undefined &&
    last !== undefined &&
    now.getTime() >= first.time.getTime() - ECLIPSE_MODE_LEAD_MS &&
    now.getTime() <= last.time.getTime() + ECLIPSE_MODE_TAIL_MS;

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
          isDemo={demo}
          onExitDemo={() => setDemo(false)}
        />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {remoteMsg !== '' && (
        <View style={s.remoteBanner}>
          <Text style={s.remoteBannerText}>{remoteMsg}</Text>
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
              cloudPct={cloudPct}
              totality={totality}
              now={now}
              spotCoords={{ lat: active.lat, lon: active.lon }}
              hereCoords={hereOnMap && geo ? { lat: geo.lat, lon: geo.lon } : null}
              mapView={prefs?.mapView ?? 'diagram'}
              onToggleMapView={() => {
                if (prefs)
                  onPrefsChange({ ...prefs, mapView: prefs.mapView === 'real' ? 'diagram' : 'real' });
              }}
              onOpenSelector={() => setSelectorOpen(true)}
              onOpenMaps={() => openInMaps(active.lat, active.lon, active.place)}
              divergenceKm={divergenceKm}
              onRecalcHere={recalcHere}
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
              toggles={prefs.alertsOn}
              onToggle={(key, value) => onPrefsChange({ ...prefs, alertsOn: { ...prefs.alertsOn, [key]: value } })}
            />
          ) : (
            <View style={s.loading}>
              <Text style={s.loadingText}>Elige primero un puesto de observación en el mapa.</Text>
            </View>
          ))}
        {tab === 'ajustes' && (
          <SettingsScreen permissions={permissions} onDemoEclipse={() => setDemo(true)} />
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  loadingText: { color: C.dim, fontSize: 14, fontFamily: F.medium },
  chooseLink: { color: C.corona, fontSize: 14, fontFamily: F.bold, letterSpacing: 1 },
  remoteBanner: {
    marginTop: 44,
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.corona,
    borderRadius: 12,
    padding: 12,
  },
  remoteBannerText: { color: C.corona, fontFamily: F.semibold, fontSize: 13, textAlign: 'center' },
});
