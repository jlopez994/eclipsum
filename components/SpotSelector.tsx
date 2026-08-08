import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { computeLocalEclipse } from '../lib/eclipse';
import { listSpotOptions, type Spot, type SpotOption } from '../lib/spots';
import { cloudCoverAt, fetchCloudCoverBatch } from '../lib/weather';
import { bearingLabel, findNearestTotality } from '../lib/totality';
import { C, F } from './theme';

// Referencia peninsular si no hay GPS: distancias aproximadas mejor que nada
const FALLBACK_REF = { lat: 40.42, lon: -3.7 };

interface SpotSelectorProps {
  visible: boolean;
  onClose: () => void;
  userGeo: { lat: number; lon: number } | null;
  gpsPlace: string;
  activeSpot: Spot | null;
  onSelect: (spot: Spot | null) => void;
}

interface Row extends SpotOption {
  cloudPct: number | null;
  /** null = volver a GPS */
  selectValue: Spot | null;
}

const fmtHM = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function isActive(row: Row, activeSpot: Spot | null): boolean {
  if (row.selectValue === null) return activeSpot === null;
  if (activeSpot === null) return false;
  return Math.abs(activeSpot.lat - row.lat) < 0.01 && Math.abs(activeSpot.lon - row.lon) < 0.01;
}

export function SpotSelector({ visible, onClose, userGeo, gpsPlace, activeSpot, onSelect }: SpotSelectorProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const ref = userGeo ?? FALLBACK_REF;
      const base: Row[] = [];

      if (userGeo) {
        const ec = computeLocalEclipse(userGeo.lat, userGeo.lon);
        const max = ec.events.find((e) => e.key === 'MAX');
        base.push({
          name: gpsPlace,
          lat: userGeo.lat,
          lon: userGeo.lon,
          origin: 'gps',
          distanceKm: 0,
          kind: ec.kind,
          obscuration: ec.obscuration,
          totalityDurationSec: ec.totalityDurationSec,
          maxTime: max?.time ?? null,
          cloudPct: null,
          selectValue: null,
        });
        if (ec.kind !== 'total') {
          const near = await findNearestTotality(userGeo.lat, userGeo.lon).catch(() => null);
          if (near && !cancelled) {
            base.push({
              name: 'Totalidad más cercana',
              lat: near.lat,
              lon: near.lon,
              origin: 'nearest',
              distanceKm: near.distanceKm,
              kind: 'total',
              obscuration: 1,
              totalityDurationSec: near.durationSec,
              maxTime: null,
              cloudPct: null,
              selectValue: { name: `Totalidad (${near.distanceKm} km ${bearingLabel(near.bearingDeg)})`, lat: near.lat, lon: near.lon, origin: 'nearest' },
            });
          }
        }
      }

      const options = await listSpotOptions(ref.lat, ref.lon);
      if (cancelled) return;
      base.push(
        ...options.map((o) => ({
          ...o,
          cloudPct: null,
          selectValue: { name: o.name, lat: o.lat, lon: o.lon, origin: o.origin },
        })),
      );
      setRows(base);

      try {
        const forecasts = await fetchCloudCoverBatch(base.map((r) => ({ lat: r.lat, lon: r.lon })));
        if (cancelled) return;
        const refMax = base.find((r) => r.maxTime)?.maxTime ?? null;
        setRows(
          base.map((r, i) => {
            const f = forecasts[i];
            const when = r.maxTime ?? refMax;
            return f && when ? { ...r, cloudPct: cloudCoverAt(f, when) } : r;
          }),
        );
      } catch {
        // sin red: lista sin nubes
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, userGeo?.lat, userGeo?.lon, gpsPlace]);

  const applySearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearchError(null);
    const m = q.match(/^(-?\d{1,2}(?:\.\d+)?)[\s,;]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) {
      const la = parseFloat(m[1]);
      const lo = parseFloat(m[2]);
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
        onSelect({ name: q, lat: la, lon: lo, origin: 'manual' });
        onClose();
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
      onSelect({ name: q, lat: results[0].latitude, lon: results[0].longitude, origin: 'manual' });
      setQuery('');
      onClose();
    } catch {
      setSearchError('Buscador no disponible. Comprueba la conexión.');
    } finally {
      setSearching(false);
    }
  };

  const pick = (row: Row) => {
    onSelect(row.selectValue);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.panel}>
        <View style={s.handle} />
        <Text style={s.title}>PUESTO DE OBSERVACIÓN</Text>
        <View style={s.searchRow}>
          <TextInput
            style={s.input}
            placeholder="Buscar lugar (o «lat, lon»)"
            placeholderTextColor={C.dim}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={applySearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          <Pressable style={[s.searchButton, searching && { opacity: 0.6 }]} onPress={applySearch} disabled={searching}>
            <Text style={s.searchButtonText}>{searching ? '…' : 'IR'}</Text>
          </Pressable>
        </View>
        {searchError && <Text style={s.error}>{searchError}</Text>}
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {rows === null && <Text style={s.loading}>Calculando lugares cercanos…</Text>}
          {rows?.map((row) => {
            const active = isActive(row, activeSpot);
            const cloudColor =
              row.cloudPct === null ? C.dim : row.cloudPct < 25 ? C.ok : row.cloudPct < 60 ? C.corona : C.danger;
            return (
              <Pressable key={`${row.origin}-${row.name}`} style={[s.row, active && s.rowActive]} onPress={() => pick(row)}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={s.rowMeta}>
                    {row.origin === 'gps' ? 'aquí' : `${row.distanceKm} km`}
                    {row.maxTime ? ` · máx ${fmtHM(row.maxTime)}` : ''}
                    {row.cloudPct !== null ? ` · ${row.cloudPct}% nubes` : ''}
                  </Text>
                </View>
                {row.kind === 'total' ? (
                  <Text style={s.rowTotal}>
                    TOTAL
                    {row.totalityDurationSec != null
                      ? ` ${Math.floor(row.totalityDurationSec / 60)}m${String(row.totalityDurationSec % 60).padStart(2, '0')}s`
                      : ''}
                  </Text>
                ) : (
                  <Text style={s.rowPartial}>{(row.obscuration * 100).toFixed(0)}%</Text>
                )}
                <Text style={[s.rowCloudDot, { color: cloudColor }]}>●</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    maxHeight: '78%',
    backgroundColor: C.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: C.knobTrack,
    marginTop: 12,
    marginBottom: 14,
  },
  title: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim, marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    backgroundColor: C.bg,
    color: C.text,
    borderRadius: 12,
    padding: 13,
    fontSize: 15,
    fontFamily: F.medium,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchButton: {
    backgroundColor: C.corona,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: { fontFamily: F.bold, fontSize: 14, color: C.bg, letterSpacing: 1 },
  error: { fontFamily: F.medium, fontSize: 12, color: C.danger, marginTop: 8 },
  loading: { fontFamily: F.medium, fontSize: 13, color: C.dim, paddingVertical: 16 },
  list: { marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(38,38,58,0.5)',
  },
  rowActive: { backgroundColor: 'rgba(255,184,77,0.08)', borderBottomColor: 'transparent' },
  rowName: { fontFamily: F.bold, fontSize: 15, color: C.text },
  rowMeta: { fontFamily: F.medium, fontSize: 12, color: C.dim, marginTop: 2, fontVariant: ['tabular-nums'] },
  rowTotal: { fontFamily: F.bold, fontSize: 13, color: C.violet },
  rowPartial: { fontFamily: F.bold, fontSize: 13, color: C.corona },
  rowCloudDot: { fontSize: 10 },
});
