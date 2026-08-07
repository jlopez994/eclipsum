import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { computeLocalEclipse, type LocalEclipse } from './lib/eclipse';
import { EclipsePanel } from './components/EclipsePanel';
import { C } from './components/theme';

type Status =
  | { phase: 'locating' }
  | { phase: 'manual' }
  | { phase: 'ready'; eclipse: LocalEclipse; lat: number; lon: number; place: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ phase: 'locating' });
  const [now, setNow] = useState(() => new Date());
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  const loadFromCoords = useCallback((lat: number, lon: number) => {
    const eclipse = computeLocalEclipse(lat, lon);
    setStatus({ phase: 'ready', eclipse, lat, lon, place: `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== 'granted') {
          setStatus({ phase: 'manual' });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        loadFromCoords(pos.coords.latitude, pos.coords.longitude);
      } catch {
        setStatus({ phase: 'manual' });
      }
    })();
  }, [loadFromCoords]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const onManualSubmit = () => {
    const lat = parseFloat(manualLat.replace(',', '.'));
    const lon = parseFloat(manualLon.replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      loadFromCoords(lat, lon);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.brand}>ECLIPSUM</Text>
        <Text style={styles.subtitle}>Eclipse solar · 12 agosto 2026</Text>

        {status.phase === 'locating' && (
          <View style={styles.center}>
            <ActivityIndicator color={C.corona} size="large" />
            <Text style={styles.dimText}>Obteniendo ubicación…</Text>
          </View>
        )}

        {status.phase === 'manual' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ubicación manual</Text>
            <Text style={styles.dimText}>Sin permiso de GPS. Introduce coordenadas:</Text>
            <TextInput
              style={styles.input}
              placeholder="Latitud (ej. 41.65)"
              placeholderTextColor={C.dim}
              keyboardType="numbers-and-punctuation"
              value={manualLat}
              onChangeText={setManualLat}
            />
            <TextInput
              style={styles.input}
              placeholder="Longitud (ej. -0.88)"
              placeholderTextColor={C.dim}
              keyboardType="numbers-and-punctuation"
              value={manualLon}
              onChangeText={setManualLon}
            />
            <Pressable style={styles.button} onPress={onManualSubmit}>
              <Text style={styles.buttonText}>Calcular</Text>
            </Pressable>
          </View>
        )}

        {status.phase === 'ready' && (
          <EclipsePanel
            eclipse={status.eclipse}
            lat={status.lat}
            lon={status.lon}
            place={status.place}
            now={now}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 24, paddingTop: 72, paddingBottom: 48 },
  brand: { color: C.text, fontSize: 34, fontWeight: '800', letterSpacing: 6 },
  subtitle: { color: C.corona, fontSize: 14, marginTop: 4, marginBottom: 24, letterSpacing: 1 },
  center: { alignItems: 'center', gap: 12, marginTop: 64 },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 20, marginTop: 20 },
  cardTitle: { color: C.dim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 },
  dimText: { color: C.dim, fontSize: 14, marginTop: 4 },
  input: {
    backgroundColor: C.bg,
    color: C.text,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  button: { backgroundColor: C.corona, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: C.bg, fontWeight: '800', fontSize: 16, letterSpacing: 1 },
});
