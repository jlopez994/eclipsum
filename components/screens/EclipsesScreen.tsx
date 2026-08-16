import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bandOf, pastEclipses, upcomingEclipses, type EclipseEntry } from '../../lib/eclipseCatalog';
import { fmtRelativeDay } from '../../lib/format';
import { t } from '../../lib/i18n';
import { C, F } from '../theme';

interface EclipsesScreenProps {
  /** Entrada activa resuelta por App (única fuente de verdad; no leer el catálogo aquí) */
  activeEclipse: EclipseEntry;
  /** Recibe el día civil elegido; '' = automático */
  onSelectEclipse: (day: string) => void;
}

/** Tamaño de página de ambas listas; cada «Ver más» añade otra. */
const PAGE = 5;

/** «Pico 41°N 3°O» a partir del pico global (solo entradas autogeneradas). */
function fmtPeak(e: EclipseEntry): string | null {
  if (e.peakLat === undefined || e.peakLon === undefined) return null;
  const lat = `${Math.abs(e.peakLat).toFixed(0)}°${e.peakLat >= 0 ? t('bearing.N') : t('bearing.S')}`;
  const lon = `${Math.abs(e.peakLon).toFixed(0)}°${e.peakLon >= 0 ? t('bearing.E') : t('bearing.W')}`;
  return t('settings.upcoming.peak', { lat, lon });
}

/**
 * Pestaña Eclipses: navegador del catálogo completo — próximos con más rango e histórico
 * paginado. Elegir uno lo activa en toda la app (pasado = modo consulta, sin avisos).
 */
export function EclipsesScreen({ activeEclipse, onSelectEclipse }: EclipsesScreenProps) {
  const insets = useSafeAreaInsets();
  const todayKey = new Date().toISOString().slice(0, 10);
  const activeIsPast = activeEclipse.civilDate < todayKey;
  const [futureCount, setFutureCount] = useState(PAGE);
  /** 0 = histórico plegado; se abre solo si el activo es una consulta del pasado. */
  const [pastCount, setPastCount] = useState(activeIsPast ? PAGE : 0);
  // Sin memo: upcomingEclipses/pastEclipses ya cachean por día+catálogo, y así un catálogo
  // RC recién activado refresca las listas sin esperar a remontar la pantalla.
  // Se pide una entrada extra: si llega, hay más que enseñar tras el «Ver más».
  const nextFew = upcomingEclipses(futureCount + 1);
  const hasMoreFuture = nextFew.length > futureCount;
  const futureFew = nextFew.slice(0, futureCount);
  /**
   * El activo SIEMPRE en su lista. Se puede llegar a uno más lejano que la página visible
   * (p. ej. desde el aviso de «aquí no se ve»), y sin su fila no habría ninguna marcada
   * como activa ni forma de volver a otro desde aquí.
   */
  const upcoming =
    activeIsPast || futureFew.some((e) => e.civilDate === activeEclipse.civilDate)
      ? futureFew
      : [...futureFew, activeEclipse].sort((a, b) => a.civilDate.localeCompare(b.civilDate));
  // Plegado (pastCount 0) ni se calcula: la primera página ya paga la caché entera del motor
  const pastFew = pastCount > 0 ? pastEclipses(pastCount + 1) : [];
  const hasMorePast = pastFew.length > pastCount;
  const pastShown = pastFew.slice(0, pastCount);
  const past =
    !activeIsPast || pastShown.some((e) => e.civilDate === activeEclipse.civilDate)
      ? pastShown
      : [...pastShown, activeEclipse].sort((a, b) => b.civilDate.localeCompare(a.civilDate));
  // Elegir el más próximo (fila 0) equivale al modo automático; misma regla que getActiveEclipse
  const isManualSelection = activeEclipse.civilDate !== upcoming[0]?.civilDate;

  /** Fila compartida por próximos e histórico; solo cambia la regla del modo automático. */
  const eclipseRow = (e: EclipseEntry, hasDivider: boolean, isPastRow: boolean) => {
    const on = e.civilDate === activeEclipse.civilDate;
    const sub = [fmtRelativeDay(e.civilDate), fmtPeak(e), bandOf(e) ? t('settings.upcoming.band') : null]
      .filter(Boolean)
      .join(' · ');
    return (
      <Pressable
        key={e.civilDate}
        style={[s.rowItem, hasDivider && s.rowDivider]}
        onPress={() => onSelectEclipse(!isPastRow && e.civilDate === upcoming[0]?.civilDate ? '' : e.civilDate)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${e.label}. ${sub}`}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowTitle}>{e.label}</Text>
          <Text style={s.rowSub}>{sub}</Text>
        </View>
        {on && <Text style={s.active}>{t('settings.upcoming.active')}</Text>}
        <View style={[s.radio, on && s.radioOn, { marginLeft: 10 }]}>{on && <View style={s.radioDot} />}</View>
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <Text style={[s.title, { paddingTop: insets.top + 14 }]}>{t('eclipses.title')}</Text>
      <ScrollView style={s.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 22, paddingBottom: 36 }}>
        <View>
          <Text style={s.section}>{t('settings.upcoming')}</Text>
          <View style={s.card}>
            {upcoming.map((e, i) => eclipseRow(e, i < upcoming.length - 1, false))}
            {hasMoreFuture && (
              <Pressable
                style={s.moreBtn}
                onPress={() => setFutureCount((n) => n + PAGE)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.more')}
              >
                <Text style={s.moreBtnTxt}>{t('settings.more')}</Text>
              </Pressable>
            )}
          </View>
          <Text style={s.note}>
            {t('settings.upcoming.note', { manual: isManualSelection ? t('settings.upcoming.noteManual') : '' })}
          </Text>
        </View>

        <View>
          <Text style={s.section}>{t('settings.past')}</Text>
          <View style={s.card}>
            {past.map((e, i) => eclipseRow(e, i < past.length - 1, true))}
            {(pastCount === 0 || hasMorePast) && (
              <Pressable
                style={[s.moreBtn, past.length === 0 && s.moreBtnFirst]}
                onPress={() => setPastCount((n) => n + PAGE)}
                accessibilityRole="button"
                accessibilityLabel={pastCount === 0 ? t('settings.past.show') : t('settings.more')}
              >
                <Text style={s.moreBtnTxt}>{pastCount === 0 ? t('settings.past.show') : t('settings.more')}</Text>
              </Pressable>
            )}
          </View>
          {past.length > 0 && <Text style={s.note}>{t('settings.past.note')}</Text>}
        </View>
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
  rowItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowTitle: { fontFamily: F.semibold, fontSize: 15, color: C.text },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: C.dim, marginTop: 2 },
  active: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2, color: C.corona },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.knobTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: C.corona },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.corona },
  moreBtn: { paddingVertical: 13, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border },
  /** Histórico plegado: el botón es el único hijo de la tarjeta y el borde sobraría */
  moreBtnFirst: { borderTopWidth: 0 },
  moreBtnTxt: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.corona },
  note: { fontFamily: F.regular, fontSize: 11, lineHeight: 16, color: C.dim, marginTop: 8 },
});
