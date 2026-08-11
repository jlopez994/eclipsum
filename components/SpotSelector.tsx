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
import { openInMaps } from '../lib/maps';
import type { SuggestedSpot } from '../lib/firebase';
import type { Spot, SpotOption } from '../lib/spots';
import { cloudCoverAt, fetchCloudCoverBatch } from '../lib/weather';
import { localeTag, t } from '../lib/i18n';
import { bearingLabel, findNearestTotality, haversineKm } from '../lib/totality';
import { animateNextLayout, yieldUI } from '../lib/anim';
import { C, F } from './theme';

// Referencia peninsular si no hay GPS: distancias aproximadas mejor que nada
const FALLBACK_REF = { lat: 40.42, lon: -3.7 };

interface SpotSelectorProps {
  visible: boolean;
  onClose: () => void;
  userGeo: { lat: number; lon: number } | null;
  gpsPlace: string;
  activeSpot: Spot | null;
  recentSpots: Spot[];
  /** Lista curada servida por Remote Config; vacía = sin sección de sugerencias */
  suggestedSpots: SuggestedSpot[];
  onSelect: (spot: Spot) => void;
}

interface Row extends SpotOption {
  cloudPct: number | null;
  selectValue: Spot;
}

type Section = { title: string; rows: Row[] };

const fmtHM = (d: Date) => d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });

function isActive(row: Row, activeSpot: Spot | null): boolean {
  if (activeSpot === null) return false;
  return Math.abs(activeSpot.lat - row.lat) < 0.01 && Math.abs(activeSpot.lon - row.lon) < 0.01;
}

function toRow(spot: Spot, ref: { lat: number; lon: number }, selectValue?: Spot): Row {
  const ec = computeLocalEclipse(spot.lat, spot.lon);
  const max = ec.events.find((e) => e.key === 'MAX');
  return {
    ...spot,
    distanceKm: Math.round(haversineKm(ref.lat, ref.lon, spot.lat, spot.lon)),
    kind: ec.kind,
    obscuration: ec.obscuration,
    totalityDurationSec: ec.totalityDurationSec,
    maxTime: max?.time ?? null,
    cloudPct: null,
    selectValue: selectValue ?? spot,
  };
}

export async function localityName(lat: number, lon: number): Promise<string | null> {
  try {
    const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    return addr?.city ?? addr?.subregion ?? addr?.name ?? null;
  } catch {
    return null;
  }
}

function displayGpsName(gpsPlace: string): string {
  return gpsPlace.replace(/\s·\sGPS$/, '') || t('spot.yourPosition');
}

export function SpotSelector({
  visible,
  onClose,
  userGeo,
  gpsPlace,
  activeSpot,
  recentSpots,
  suggestedSpots,
  onSelect,
}: SpotSelectorProps) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const ref = userGeo ?? FALLBACK_REF;
      let next: Section[] = [];
      const allForClouds: Row[] = [];
      const publish = () => {
        if (cancelled) return;
        animateNextLayout();
        setSections([...next]);
      };

      // Aplica nubosidades ya descargadas a las secciones visibles
      const applyClouds = (byCoord: Map<string, unknown>) => {
        const refMax = allForClouds.find((r) => r.maxTime)?.maxTime ?? null;
        next = next.map((sec) => ({
          ...sec,
          rows: sec.rows.map((r) => {
            const f = byCoord.get(`${r.lat},${r.lon}`) as Parameters<typeof cloudCoverAt>[0] | undefined;
            const when = r.maxTime ?? refMax;
            return f && when ? { ...r, cloudPct: cloudCoverAt(f, when) } : r;
          }),
        }));
        publish();
      };

      // Deja arrancar la animación del modal antes del primer cálculo pesado
      await yieldUI();
      if (cancelled) return;

      let gpsRow: Row | null = null;
      if (userGeo) {
        const gpsSpot: Spot = {
          name: displayGpsName(gpsPlace),
          lat: userGeo.lat,
          lon: userGeo.lon,
          origin: 'gps',
        };
        gpsRow = toRow(gpsSpot, ref);
        gpsRow.distanceKm = 0;
        allForClouds.push(gpsRow);
        next.push({ title: t('spot.myPosition'), rows: [gpsRow] });
      }

      // Búsqueda de totalidad lanzada ya: su CPU se solapa con la red de nubes/geocoder
      const nearestP =
        userGeo && gpsRow && gpsRow.kind !== 'total'
          ? findNearestTotality(userGeo.lat, userGeo.lon).catch(() => null)
          : Promise.resolve(null);

      if (recentSpots.length > 0) {
        const recentRows: Row[] = [];
        for (const spot of recentSpots) {
          await yieldUI();
          if (cancelled) return;
          recentRows.push(toRow(spot, ref));
        }
        allForClouds.push(...recentRows);
        next.push({ title: t('spot.recent'), rows: recentRows });
      }

      // Sugerencias curadas (RC). Se filtran contra el eclipse activo: una lista
      // pensada para un eclipse no debe recomendar sitios en parcial para otro.
      if (suggestedSpots.length > 0) {
        const suggestedRows: Row[] = [];
        for (const s of suggestedSpots) {
          await yieldUI();
          if (cancelled) return;
          const row = toRow({ name: s.name, lat: s.lat, lon: s.lon, origin: 'city' }, ref);
          if (row.kind !== 'partial') suggestedRows.push(row);
        }
        if (suggestedRows.length > 0) {
          allForClouds.push(...suggestedRows);
          next.push({ title: t('spot.suggested'), rows: suggestedRows });
        }
      }
      // Primer pintado con lo ya calculado; el resto llega por tandas
      publish();

      // Nubes de lo ya visible: red en paralelo con la búsqueda de totalidad
      const mainCoords = allForClouds.map((r) => ({ lat: r.lat, lon: r.lon }));
      const cloudsP = fetchCloudCoverBatch(mainCoords)
        .then((fcs) => new Map(mainCoords.map((c, i) => [`${c.lat},${c.lon}`, fcs[i]])))
        .catch(() => null); // sin red: lista sin nubes

      const near = await nearestP;
      if (near && !cancelled) {
        const place = await localityName(near.lat, near.lon);
        const dir = bearingLabel(near.bearingDeg);
        const name = place
          ? t('spot.totalitySuffix', { place })
          : t('spot.totalityAt', { km: near.distanceKm, dir });
        const nearSpot: Spot = { name, lat: near.lat, lon: near.lon, origin: 'nearest' };
        const nearRow: Row = {
          name,
          lat: near.lat,
          lon: near.lon,
          origin: 'nearest',
          distanceKm: near.distanceKm,
          kind: 'total',
          obscuration: 1,
          totalityDurationSec: near.durationSec,
          maxTime: null,
          cloudPct: null,
          selectValue: nearSpot,
        };
        allForClouds.push(nearRow);
        next.splice(1, 0, { title: t('spot.nearestTotality'), rows: [nearRow] });
        publish();
      }

      const nearCloudP = near
        ? fetchCloudCoverBatch([{ lat: near.lat, lon: near.lon }]).catch(() => [])
        : Promise.resolve([]);
      const [byCoord, nearFcs] = await Promise.all([cloudsP, nearCloudP]);
      if (cancelled || !byCoord) return;
      if (near && nearFcs[0]) byCoord.set(`${near.lat},${near.lon}`, nearFcs[0]);
      applyClouds(byCoord);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, userGeo?.lat, userGeo?.lon, gpsPlace, recentSpots, suggestedSpots]);

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
        setSearchError(t('spot.notFound'));
        return;
      }
      const { latitude, longitude } = results[0];
      // Nombre canónico del geocoder inverso: «madrid» y «Madrid, España» acaban iguales
      const name = (await localityName(latitude, longitude)) ?? q;
      onSelect({ name, lat: latitude, lon: longitude, origin: 'manual' });
      setQuery('');
      onClose();
    } catch {
      setSearchError(t('spot.searchOffline'));
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
        <Text style={s.title}>{t('spot.title')}</Text>
        <View style={s.searchRow}>
          <TextInput
            style={s.input}
            placeholder={t('spot.searchPlaceholder')}
            placeholderTextColor={C.dim}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={applySearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          <Pressable style={[s.searchButton, searching && { opacity: 0.6 }]} onPress={applySearch} disabled={searching}>
            <Text style={s.searchButtonText}>{searching ? '…' : t('spot.go')}</Text>
          </Pressable>
        </View>
        {searchError && <Text style={s.error}>{searchError}</Text>}
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {sections === null && <Text style={s.loading}>{t('spot.computing')}</Text>}
          {sections?.map((sec) => (
            <View key={sec.title}>
              <Text style={s.sectionTitle}>{sec.title}</Text>
              {sec.rows.map((row) => {
                const active = isActive(row, activeSpot);
                const cloudColor =
                  row.cloudPct === null ? C.dim : row.cloudPct < 25 ? C.ok : row.cloudPct < 60 ? C.corona : C.danger;
                return (
                  <View key={`${sec.title}-${row.origin}-${row.name}-${row.lat}`} style={[s.row, active && s.rowActive]}>
                    <Pressable style={s.rowMain} onPress={() => pick(row)}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.rowName} numberOfLines={1}>
                          {row.name}
                        </Text>
                        <Text style={s.rowMeta}>
                          {row.origin === 'gps' ? t('spot.here') : `${row.distanceKm} km`}
                          {row.maxTime ? ` · ${t('spot.max', { time: fmtHM(row.maxTime) })}` : ''}
                          {row.cloudPct !== null ? ` · ${t('spot.clouds', { pct: row.cloudPct })}` : ''}
                        </Text>
                      </View>
                      {row.kind === 'total' ? (
                        <Text style={s.rowTotal}>
                          {t('spot.total')}
                          {row.totalityDurationSec != null
                            ? ` ${Math.floor(row.totalityDurationSec / 60)}m${String(row.totalityDurationSec % 60).padStart(2, '0')}s`
                            : ''}
                        </Text>
                      ) : (
                        <Text style={s.rowPartial}>{(row.obscuration * 100).toFixed(0)}%</Text>
                      )}
                      <Text style={[s.rowCloudDot, { color: cloudColor }]}>●</Text>
                    </Pressable>
                    <Pressable
                      style={s.mapsBtn}
                      onPress={() => openInMaps(row.lat, row.lon, row.name)}
                      hitSlop={8}
                    >
                      <Text style={s.mapsBtnText}>{t('spot.maps')}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
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
  sectionTitle: {
    fontFamily: F.semibold,
    fontSize: 10,
    letterSpacing: 2,
    color: C.dim,
    marginTop: 16,
    marginBottom: 4,
    marginHorizontal: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(38,38,58,0.5)',
  },
  rowActive: { backgroundColor: 'rgba(255,184,77,0.08)', borderBottomColor: 'transparent' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  rowName: { fontFamily: F.bold, fontSize: 15, color: C.text },
  rowMeta: { fontFamily: F.medium, fontSize: 12, color: C.dim, marginTop: 2, fontVariant: ['tabular-nums'] },
  rowTotal: { fontFamily: F.bold, fontSize: 13, color: C.violet },
  rowPartial: { fontFamily: F.bold, fontSize: 13, color: C.corona },
  rowCloudDot: { fontSize: 10 },
  mapsBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  mapsBtnText: { fontFamily: F.bold, fontSize: 9, letterSpacing: 0.8, color: C.dim },
});
