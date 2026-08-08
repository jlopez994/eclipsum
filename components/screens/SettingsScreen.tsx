import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { Prefs } from '../../lib/prefs';
import { C, F } from '../theme';

const IGN_URL = 'https://eclipses.ign.es';

interface SettingsScreenProps {
  prefs: Prefs;
  place: string;
  coords: { lat: number; lon: number } | null;
  permissions: { location: boolean; notifications: boolean };
  onChange: (prefs: Prefs) => void;
  onDemoEclipse: () => void;
}

function Radio({ on }: { on: boolean }) {
  return (
    <View style={[s.radio, { borderColor: on ? C.corona : C.knobTrack }]}>
      {on && <View style={s.radioInner} />}
    </View>
  );
}

export function SettingsScreen({ prefs, place, coords, permissions, onChange, onDemoEclipse }: SettingsScreenProps) {
  const [query, setQuery] = useState(prefs.manual?.name ?? '');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const applySearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearchError(null);
    // Atajo avanzado: "lat, lon" directo sigue funcionando
    const m = q.match(/^(-?\d{1,2}(?:\.\d+)?)[\s,;]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) {
      const la = parseFloat(m[1]);
      const lo = parseFloat(m[2]);
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
        onChange({ ...prefs, useGps: false, manual: { lat: la, lon: lo } });
        return;
      }
    }
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(q);
      if (results.length === 0) {
        setSearchError('No encontrado. Prueba «ciudad» o «ciudad, provincia».');
        return;
      }
      onChange({ ...prefs, useGps: false, manual: { lat: results[0].latitude, lon: results[0].longitude, name: q } });
    } catch {
      setSearchError('Buscador no disponible. Comprueba la conexión.');
    } finally {
      setSearching(false);
    }
  };

  const coordsLabel = coords
    ? `${coords.lat.toFixed(3).replace('.', ',')} · ${coords.lon.toFixed(3).replace('.', ',')} — ${place}`
    : 'Sin ubicación todavía';

  return (
    <View style={s.root}>
      <Text style={s.title}>Ajustes</Text>
      <ScrollView style={s.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 22 }}>
        <View>
          <Text style={s.section}>UBICACIÓN</Text>
          <View style={s.card}>
            <Pressable style={[s.rowItem, s.rowDivider]} onPress={() => onChange({ ...prefs, useGps: true })}>
              <Radio on={prefs.useGps} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>GPS automático</Text>
                <Text style={s.rowSub}>{coordsLabel}</Text>
              </View>
              {prefs.useGps && <Text style={s.activeTag}>ACTIVO</Text>}
            </Pressable>
            <Pressable style={s.rowItem} onPress={() => onChange({ ...prefs, useGps: false })}>
              <Radio on={!prefs.useGps} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Otra ubicación</Text>
                <Text style={s.rowSub}>Busca por nombre: «Teruel», «Sanabria»…</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
            {!prefs.useGps && (
              <View style={s.manualBox}>
                <TextInput
                  style={s.input}
                  placeholder="Lugar (o «lat, lon»)"
                  placeholderTextColor={C.dim}
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={applySearch}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {searchError && <Text style={s.error}>{searchError}</Text>}
                <Pressable style={[s.applyButton, searching && { opacity: 0.6 }]} onPress={applySearch} disabled={searching}>
                  <Text style={s.applyText}>{searching ? 'BUSCANDO…' : 'BUSCAR'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        <View>
          <Text style={s.section}>PERMISOS</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider, { justifyContent: 'space-between' }]}>
              <Text style={s.rowTitle}>Ubicación</Text>
              <Text style={permissions.location ? s.activeTag : s.deniedTag}>
                {permissions.location ? 'PERMITIDO' : 'DENEGADO'}
              </Text>
            </View>
            <View style={[s.rowItem, { justifyContent: 'space-between' }]}>
              <Text style={s.rowTitle}>Notificaciones</Text>
              <Text style={permissions.notifications ? s.activeTag : s.deniedTag}>
                {permissions.notifications ? 'PERMITIDO' : 'DENEGADO'}
              </Text>
            </View>
          </View>
        </View>

        <View>
          <Text style={[s.section, { color: C.danger }]}>SEGURIDAD OCULAR</Text>
          <View style={s.safetyCard}>
            <Text style={s.safetyTitle}>
              Nunca mires al sol sin gafas certificadas <Text style={{ color: C.danger }}>ISO 12312-2</Text>
            </Text>
            <Text style={s.safetyBody}>
              Solo durante la totalidad es seguro mirar sin protección. La app te avisará del inicio y del fin
              exactos.
            </Text>
            <Pressable onPress={() => Linking.openURL(IGN_URL)}>
              <Text style={s.safetyLink}>GUÍA DE SEGURIDAD (IGN) →</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onLongPress={onDemoEclipse} delayLongPress={1500}>
          <Text style={s.about}>
            Eclipsum 1.0 · Cálculo: astronomy-engine · Nubosidad: Open-Meteo{'\n'}
            Eclipse total de sol · 12 de agosto de 2026
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: {
    fontFamily: F.bold,
    fontSize: 32,
    letterSpacing: -0.5,
    color: C.text,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 8,
  },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  section: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim, marginBottom: 10 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.corona },
  rowTitle: { fontFamily: F.semibold, fontSize: 15, color: C.text },
  rowSub: { fontFamily: F.regular, fontSize: 12.5, color: C.dim, marginTop: 2, fontVariant: ['tabular-nums'] },
  activeTag: { fontFamily: F.medium, fontSize: 12, color: C.ok },
  deniedTag: { fontFamily: F.medium, fontSize: 12, color: C.danger },
  chevron: { color: C.dim, fontSize: 16 },
  manualBox: { padding: 16, paddingTop: 0, gap: 10 },
  input: {
    backgroundColor: C.bg,
    color: C.text,
    borderRadius: 10,
    padding: 13,
    fontSize: 15,
    fontFamily: F.medium,
    borderWidth: 1,
    borderColor: C.border,
  },
  error: { fontFamily: F.medium, fontSize: 12, color: C.danger },
  applyButton: { backgroundColor: C.corona, borderRadius: 10, padding: 13, alignItems: 'center' },
  applyText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1, color: C.bg },
  safetyCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.4)',
    borderRadius: 18,
    padding: 18,
    backgroundColor: 'rgba(255,107,94,0.06)',
  },
  safetyTitle: { fontFamily: F.bold, fontSize: 16, lineHeight: 21, color: C.text },
  safetyBody: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim, marginTop: 8 },
  safetyLink: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1, color: C.corona, marginTop: 12 },
  about: { fontFamily: F.regular, fontSize: 12, lineHeight: 19, color: C.dim, paddingBottom: 24 },
});
