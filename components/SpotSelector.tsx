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
import { computeLocalEclipse, eventAt, isActiveEclipse } from '../lib/eclipse';
import { dateLabelOf, getActiveEclipse } from '../lib/eclipseCatalog';
import { findVisiblePoint } from '../lib/visiblePoint';
import { openInMaps } from '../lib/maps';
import type { SuggestedSpot } from '../lib/firebase';
import { cleanPlaceLabel, sameCoords, type Spot, type SpotOption } from '../lib/spots';
import { cloudCoverAt, cloudLevel, fetchCloudCoverBatch } from '../lib/weather';
import { fmtDur, fmtHM } from '../lib/format';
import { t } from '../lib/i18n';
import { bearingLabel, findNearestTotality, haversineKm } from '../lib/totality';
import { animateNextLayout, yieldUI } from '../lib/anim';
import { C, CLOUD_COLOR, F } from './theme';

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
  /** Desde este puesto SÍ se ve el eclipse activo; false = kind/obscuración no valen nada */
  visible: boolean;
}

type Section = { title: string; rows: Row[] };

/**
 * Fila del selector con las circunstancias del puesto.
 *
 * `computeLocalEclipse` devuelve el primer eclipse local del punto, que fuera del footprint
 * del activo es OTRO distinto: sin el filtro de `isActiveEclipse`, Sídney salía como
 * «TOTAL 3m52s» (eclipse de 2028) en la lista donde eliges dónde ver el de este año.
 */
function toRow(spot: Spot, ref: { lat: number; lon: number }, selectValue?: Spot): Row {
  const ec = computeLocalEclipse(spot.lat, spot.lon);
  const visible = isActiveEclipse(ec);
  const max = visible ? eventAt(ec, 'MAX') : undefined;
  return {
    ...spot,
    distanceKm: Math.round(haversineKm(ref.lat, ref.lon, spot.lat, spot.lon)),
    kind: visible ? ec.kind : 'partial',
    obscuration: visible ? ec.obscuration : 0,
    totalityDurationSec: visible ? ec.totalityDurationSec : null,
    maxTime: max?.time ?? null,
    cloudPct: null,
    selectValue: selectValue ?? spot,
    visible,
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
  return cleanPlaceLabel(gpsPlace) || t('spot.yourPosition');
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
  /** Puesto sin visibilidad pendiente de confirmar; null = sin diálogo */
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);
  /** Punto desde el que SÍ se ve, ya resuelto; deja al diálogo ofrecer la salida */
  const [visibleSpot, setVisibleSpot] = useState<Spot | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setConfirmRow(null);
      return;
    }
    setVisibleSpot(null);
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

      /**
       * Referencia para sugerir: el puesto que el usuario está MIRANDO —el elegido, o el
       * GPS mientras no haya elegido ninguno—. Antes mandaba el GPS, con dos efectos malos:
       * sin permiso de ubicación no se sugería NADA (justo a quien más depende de elegir a
       * mano), y con un puesto lejano elegido se razonaba sobre un sitio que no era el suyo.
       */
      const refSpot = activeSpot ?? (userGeo ? { lat: userGeo.lat, lon: userGeo.lon } : null);
      const refEclipse = refSpot ? computeLocalEclipse(refSpot.lat, refSpot.lon) : null;
      const refSees = refEclipse !== null && isActiveEclipse(refEclipse);

      // Desde ahí SÍ se ve, pero en parcial: lo útil es la banda más cercana. Su CPU se
      // solapa con la red de nubes/geocoder.
      const nearestP =
        refSpot && refSees && refEclipse.kind !== 'total'
          ? findNearestTotality(refSpot.lat, refSpot.lon).catch(() => null)
          : Promise.resolve(null);

      // Desde ahí NO se ve (o no hay referencia todavía): buscar la banda a 700 km es
      // trabajo inútil —el eclipse puede estar en otro continente— y lo único que sirve es
      // decir dónde se ve, aunque quede lejos. Sin esto la lista era un muro de «NO SE VE».
      const wherePpromise = !refSees
        ? findVisiblePoint(getActiveEclipse()).catch(() => null)
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
          // findNearestTotality ya filtra por el eclipse activo
          visible: true,
        };
        allForClouds.push(nearRow);
        next.splice(1, 0, { title: t('spot.nearestTotality'), rows: [nearRow] });
        publish();
      }

      const where = await wherePpromise;
      if (where && !cancelled) {
        const place = await localityName(where.lat, where.lon);
        const km = Math.round(haversineKm(ref.lat, ref.lon, where.lat, where.lon));
        const name = place ? t('spot.visibleFrom', { place }) : t('spot.visibleAt', { km });
        // toRow calcula las circunstancias reales del punto (tipo, obscuración, máximo)
        const whereRow = toRow({ name, lat: where.lat, lon: where.lon, origin: 'manual' }, ref);
        // El punto sale de la geometría de la banda, no de la geografía: si en ese punto
        // concreto el sol queda bajo el horizonte, la fila diría «aquí sí se ve» y saldría
        // marcada NO SE VE. Antes de prometer nada, se comprueba.
        if (whereRow.visible) {
          allForClouds.push(whereRow);
          next.splice(1, 0, { title: t('spot.whereVisible'), rows: [whereRow] });
          setVisibleSpot(whereRow.selectValue);
          publish();
        }
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
    // userGeo y activeSpot por coordenadas: como objetos relanzarían toda la lista
    // (motor + red) en cada render del padre. activeSpot entra porque decide qué sección
    // se sugiere; en la práctica no cambia con el modal abierto, pero dejarlo fuera sería
    // un cierre obsoleto esperando a que eso deje de ser cierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userGeo?.lat, userGeo?.lon, activeSpot?.lat, activeSpot?.lon, gpsPlace, recentSpots, suggestedSpots]);

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
        setQuery('');
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

  /**
   * Elegir un puesto que no ve el eclipse casi siempre es un descuido: la fila lo marca,
   * pero el resultado —el mapa entero sustituido por «aquí no se ve»— es brusco de más
   * para no preguntar. Se confirma antes en vez de explicarlo después.
   */
  const pick = (row: Row) => {
    if (!row.visible) {
      setConfirmRow(row);
      return;
    }
    onSelect(row.selectValue);
    onClose();
  };

  const confirmPick = () => {
    if (!confirmRow) return;
    onSelect(confirmRow.selectValue);
    setConfirmRow(null);
    onClose();
  };

  /** Salida útil del diálogo: en vez de solo advertir, lleva donde el eclipse sí se ve. */
  const goWhereVisible = () => {
    if (!visibleSpot) return;
    onSelect(visibleSpot);
    setConfirmRow(null);
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
            accessibilityLabel={t('spot.searchPlaceholder')}
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
          {/* `undefined === 0` es false, así que carga y vacío no se solapan */}
          {sections?.length === 0 && <Text style={s.loading}>{t('spot.empty')}</Text>}
          {sections?.map((sec) => (
            <View key={sec.title}>
              <Text style={s.sectionTitle}>{sec.title}</Text>
              {sec.rows.map((row) => {
                const active = activeSpot !== null && sameCoords(activeSpot, row);
                const level = cloudLevel(row.cloudPct);
                const cloudColor = level ? CLOUD_COLOR[level] : C.dim;
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
                      {/* Fuera de zona: decirlo. Un «0%» sería otra mentira, solo que más barata */}
                      {!row.visible ? (
                        <Text style={s.rowUnseen}>{t('spot.notVisible')}</Text>
                      ) : row.kind === 'total' ? (
                        <Text style={s.rowTotal}>
                          {t('spot.total')}
                          {row.totalityDurationSec != null ? ` ${fmtDur(row.totalityDurationSec)}` : ''}
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

      {/* Confirmación sobre el propio selector: la app no usa diálogos del sistema, y este
          no debe sacarte de la lista — cancelar te deja donde estabas, eligiendo. */}
      {confirmRow !== null && (
        <View style={s.confirmWrap}>
          <Pressable style={s.confirmBackdrop} onPress={() => setConfirmRow(null)} />
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>{t('spot.unseen.title')}</Text>
            <Text style={s.confirmBody}>
              {t('spot.unseen.body', {
                place: confirmRow.name,
                date: dateLabelOf(getActiveEclipse()),
              })}
            </Text>
            {/* Principal la salida, no la insistencia: se abrió esto para ver el eclipse,
                no para elegir un sitio desde el que no se ve */}
            {visibleSpot !== null && (
              <Pressable style={s.confirmCta} onPress={goWhereVisible}>
                <Text style={s.confirmCtaText}>{t('spot.unseen.goVisible')}</Text>
              </Pressable>
            )}
            <Pressable style={visibleSpot === null ? s.confirmCta : s.confirmGhost} onPress={confirmPick}>
              <Text style={visibleSpot === null ? s.confirmCtaText : s.confirmGhostText}>
                {t('spot.unseen.confirm')}
              </Text>
            </Pressable>
            <Pressable style={s.confirmGhost} onPress={() => setConfirmRow(null)} hitSlop={8}>
              <Text style={s.confirmGhostText}>{t('spot.unseen.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  confirmWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  confirmBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  confirmCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.45)',
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  confirmTitle: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2.5, color: C.danger },
  confirmBody: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.text },
  confirmCta: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.45)',
    backgroundColor: 'rgba(255,184,77,0.10)',
  },
  confirmCtaText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1.4, color: C.corona },
  confirmGhost: { alignItems: 'center', paddingVertical: 11 },
  confirmGhostText: { fontFamily: F.bold, fontSize: 12.5, letterSpacing: 1.4, color: C.dim },
  // Velo ligero y panel a C.surface con algo de aire: el mapa se intuye detrás
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    maxHeight: '78%',
    backgroundColor: 'rgba(21,21,30,0.92)',
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
  rowUnseen: { fontFamily: F.semibold, fontSize: 11, color: C.dim },
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
