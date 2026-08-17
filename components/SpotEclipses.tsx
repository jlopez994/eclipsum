import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { eclipsesFromSpot, type SpotEclipseHit } from '../lib/spotEclipses';
import { fmtRelativeDay } from '../lib/format';
import { monthShort, t, type I18nKey } from '../lib/i18n';
import { C, F } from './theme';

interface SpotEclipsesProps {
  visible: boolean;
  onClose: () => void;
  /** Coordenadas del puesto PINTADO: la pregunta es «desde aquí» */
  lat: number;
  lon: number;
  place: string;
  /** Día civil del eclipse activo; su fila se marca como tal */
  activeCivilDate: string;
  /** Recibe el día civil elegido; el caller decide cómo saltar (conservando el puesto) */
  onSelectDay: (day: string) => void;
}

/** «Total · 12 ago 2026» a partir del día civil y el tipo, en el idioma activo. */
function hitLabel(hit: SpotEclipseHit): string {
  const d = new Date(`${hit.civilDate}T00:00:00Z`);
  return `${t(`kind.${hit.kind}` as I18nKey)} · ${d.getUTCDate()} ${monthShort(d.getUTCMonth())} ${d.getUTCFullYear()}`;
}

/**
 * Modal «Eclipses desde aquí»: todos los eclipses visibles desde el puesto pintado,
 * próximos y pasados, con su ocultación local. Tocar uno lo abre en toda la app
 * (conservando este puesto), pasado o futuro.
 */
export function SpotEclipses({ visible, onClose, lat, lon, place, activeCivilDate, onSelectDay }: SpotEclipsesProps) {
  const [hits, setHits] = useState<SpotEclipseHit[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setHits(null);
    eclipsesFromSpot(lat, lon).then((list) => {
      if (alive) setHits(list);
    });
    return () => {
      alive = false;
    };
  }, [visible, lat, lon]);

  const today = new Date().toISOString().slice(0, 10);
  const future = hits?.filter((h) => h.civilDate >= today) ?? [];
  const past = hits?.filter((h) => h.civilDate < today).reverse() ?? [];

  const row = (hit: SpotEclipseHit) => {
    const on = hit.civilDate === activeCivilDate;
    const sub = `${t('map.history.hidden', { pct: Math.round(hit.obscuration * 100) })} · ${fmtRelativeDay(hit.civilDate)}`;
    return (
      <Pressable
        key={hit.civilDate}
        style={s.row}
        onPress={() => {
          onSelectDay(hit.civilDate);
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${hitLabel(hit)}. ${sub}`}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.rowName, hit.kind === 'total' && { color: C.corona }]}>{hitLabel(hit)}</Text>
          <Text style={s.rowMeta}>{sub}</Text>
        </View>
        {on && <Text style={s.rowOn}>{t('settings.upcoming.active')}</Text>}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.panel}>
        <View style={s.handle} />
        <Text style={s.title}>{t('map.history.title', { place })}</Text>
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {hits === null && <Text style={s.loading}>{t('spot.computing')}</Text>}
          {hits?.length === 0 && <Text style={s.loading}>{t('map.history.empty')}</Text>}
          {future.length > 0 && <Text style={s.sectionTitle}>{t('settings.upcoming')}</Text>}
          {future.map(row)}
          {past.length > 0 && <Text style={s.sectionTitle}>{t('settings.past')}</Text>}
          {past.map(row)}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // Mismo velo/panel que SpotSelector: el mapa se intuye detrás
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
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.knobTrack,
    marginTop: 10,
  },
  title: { fontFamily: F.bold, fontSize: 18, letterSpacing: -0.3, color: C.text, marginTop: 16 },
  list: { marginTop: 6 },
  loading: { fontFamily: F.regular, fontSize: 13, color: C.dim, paddingVertical: 18 },
  sectionTitle: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.dim,
    marginTop: 18,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(38,38,58,0.5)',
  },
  rowName: { fontFamily: F.semibold, fontSize: 15, color: C.text },
  rowMeta: { fontFamily: F.regular, fontSize: 12, color: C.dim, marginTop: 2 },
  rowOn: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2, color: C.corona },
});
