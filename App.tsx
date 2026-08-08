import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import type { Spot } from './lib/spots';
import { scheduleEclipseAlerts } from './lib/notifications';
import { fetchEclipseMessage, track } from './lib/firebase';
import { loadPrefs, savePrefs, type Prefs } from './lib/prefs';
import { TabBar, type TabKey } from './components/TabBar';
import { MapScreen } from './components/screens/MapScreen';
import { AlertsScreen } from './components/screens/AlertsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { EclipseModeScreen } from './components/screens/EclipseModeScreen';
import { C, F } from './components/theme';

const ECLIPSE_MODE_LEAD_MS = 30 * 60_000;
const ECLIPSE_MODE_TAIL_MS = 5 * 60_000;
const COARSE_TICK_MS = 30_000;

interface Geo {
  lat: number;
  lon: number;
  place: string;
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
  const [remoteMsg, setRemoteMsg] = useState('');
  const [tab, setTab] = useState<TabKey>('mapa');
  const [demo, setDemo] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void fetchEclipseMessage().then(setRemoteMsg);
    void Notifications.getPermissionsAsync().then(({ status }) =>
      setPermissions((p) => ({ ...p, notifications: status === 'granted' })),
    );
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), COARSE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Resolver ubicación según prefs (GPS o manual)
  useEffect(() => {
    if (!prefs) return;
    let cancelled = false;
    (async () => {
      setLocating(true);
      try {
        if (!prefs.useGps && prefs.manual) {
          const { lat, lon } = prefs.manual;
          if (!cancelled) setGeo({ lat, lon, place: `${lat.toFixed(2)}, ${lon.toFixed(2)} · Manual` });
          return;
        }
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        setPermissions((p) => ({ ...p, location: status === 'granted' }));
        if (status !== 'granted') {
          if (prefs.manual) {
            const { lat, lon } = prefs.manual;
            setGeo({ lat, lon, place: `${lat.toFixed(2)}, ${lon.toFixed(2)} · Manual` });
          } else {
            setGeo(null);
            setTab('ajustes');
          }
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const { latitude: lat, longitude: lon } = pos.coords;
        let place = 'GPS';
        try {
          const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
          if (addr?.city) place = `${addr.city} · GPS`;
        } catch {
          // sin geocoder: mostramos solo GPS
        }
        if (!cancelled) setGeo({ lat, lon, place });
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefs]);

  // Puesto de observación activo: spot elegido o, si no hay, el GPS
  const activeSpot = prefs?.spot ?? null;
  const active = activeSpot
    ? { lat: activeSpot.lat, lon: activeSpot.lon, place: activeSpot.name }
    : geo;

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

  // Reprogramar alertas al cambiar de puesto (las horas de contacto varían por ubicación)
  useEffect(() => {
    if (!eclipse || !prefs || !permissions.notifications) return;
    if (!Object.values(prefs.alertsOn).some(Boolean)) return;
    scheduleEclipseAlerts(eclipse, prefs.alertsOn).catch(() => {
      // sin permiso o error puntual: el usuario puede reprogramar desde Alertas
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eclipse]);

  const onPrefsChange = useCallback((next: Prefs) => {
    setPrefs(next);
    void savePrefs(next);
  }, []);

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

  if (activeEclipse && active && (demo || inEclipseWindow)) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <EclipseModeScreen
          eclipse={activeEclipse}
          place={active.place.replace(' · GPS', '').replace(' · Manual', '')}
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
              place={active.place}
              cloudPct={cloudPct}
              totality={totality}
              now={now}
              userGeo={geo ? { lat: geo.lat, lon: geo.lon } : null}
              gpsPlace={geo?.place ?? 'Tu posición'}
              activeSpot={activeSpot}
              onSelectSpot={(spot) => onPrefsChange({ ...prefs, spot })}
              divergenceKm={divergenceKm}
              onRecalcHere={() => onPrefsChange({ ...prefs, spot: null })}
            />
          ) : (
            <View style={s.loading}>
              {locating ? (
                <>
                  <ActivityIndicator color={C.corona} size="large" />
                  <Text style={s.loadingText}>Obteniendo ubicación…</Text>
                </>
              ) : (
                <Text style={s.loadingText}>Sin ubicación. Configúrala en Ajustes.</Text>
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
              <Text style={s.loadingText}>Sin ubicación. Configúrala en Ajustes.</Text>
            </View>
          ))}
        {tab === 'ajustes' && (
          <SettingsScreen
            prefs={prefs}
            place={geo ? geo.place.replace(' · GPS', '').replace(' · Manual', '') : '—'}
            coords={geo ? { lat: geo.lat, lon: geo.lon } : null}
            permissions={permissions}
            onChange={onPrefsChange}
            onDemoEclipse={() => setDemo(true)}
          />
        )}
      </View>
      <TabBar active={tab} onChange={setTab} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  loadingText: { color: C.dim, fontSize: 14, fontFamily: F.medium },
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
