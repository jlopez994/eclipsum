import { useEffect, useState } from 'react';
import { InteractionManager, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bandOf, pastEclipses, upcomingEclipses, type EclipseEntry } from '../../lib/eclipseCatalog';
import { lunarEclipses, type LunarEclipseHit } from '../../lib/lunar';
import { fmtHM, fmtRelativeDay } from '../../lib/format';
import { monthShort, t, type I18nKey } from '../../lib/i18n';
import { EclipseTypesInfo } from '../EclipseTypesInfo';
import { C, F } from '../theme';

interface EclipsesScreenProps {
  /** Entrada activa resuelta por App (única fuente de verdad; no leer el catálogo aquí) */
  activeEclipse: EclipseEntry;
  /** Recibe el día civil elegido; '' = automático */
  onSelectEclipse: (day: string) => void;
}

/** Tamaño de página de ambas listas; cada «Ver más» añade otra. */
const PAGE = 5;

/** Filtro por tipo; 'lunar' cambia de catálogo (lib/lunar), el resto filtra el solar. */
type KindFilter = 'all' | 'total' | 'annular' | 'partial' | 'lunar';
const FILTERS: KindFilter[] = ['all', 'total', 'annular', 'partial', 'lunar'];

/** Sin tildes y en minúsculas: «Anular» casa con «anular», «AGO» con «ago». */
const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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

  const [filter, setFilter] = useState<KindFilter>('all');
  const [typesOpen, setTypesOpen] = useState(false);
  /** Listas del filtro activo, calculadas en diferido; null = aún calculando */
  const [lunar, setLunar] = useState<LunarEclipseHit[] | null>(null);
  const [solarFiltered, setSolarFiltered] = useState<{
    key: KindFilter;
    upcoming: EclipseEntry[];
    past: EclipseEntry[];
  } | null>(null);

  /**
   * El filtro barre el rango completo (la caché de 25 años del motor, o el barrido lunar):
   * se calcula tras la animación del toque, no en el render del chip, para no trabarla.
   * Entradas RC sin `kind` no pueden clasificarse: solo salen en TODOS.
   */
  useEffect(() => {
    if (filter === 'all') return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (filter === 'lunar') {
        setLunar(lunarEclipses());
        return;
      }
      setSolarFiltered({
        key: filter,
        upcoming: upcomingEclipses(999).filter((e) => e.kind === filter),
        past: pastEclipses(999).filter((e) => e.kind === filter),
      });
    });
    return () => task.cancel();
  }, [filter]);

  const [query, setQuery] = useState('');
  const tokens = norm(query.trim()).split(/\s+/).filter(Boolean);
  /**
   * Búsqueda sobre todo el rango que el motor expone (los horizontes capan dentro, ~8 años
   * de próximos y ~25 de histórico). El campo es label localizado + civilDate ISO («Total ·
   * 12 ago 2026 2026-08-12»), y cada palabra debe aparecer: «total 2027» cruza tipo Y año,
   * que como substring única no casaría. Dedupe por día civil: en la cola de ~6 h tras un
   * eclipse las dos cachés pueden traer el mismo. null = sin query, no se calcula nada.
   */
  const seen = new Set<string>();
  const results = tokens.length
    ? [...upcomingEclipses(999), ...pastEclipses(999)].filter((e) => {
        if (seen.has(e.civilDate)) return false;
        seen.add(e.civilDate);
        const hay = norm(`${e.label} ${e.civilDate}`);
        return tokens.every((tok) => hay.includes(tok));
      })
    : null;

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

  /**
   * Fila lunar: solo consulta. Los lunares se ven desde medio planeta a la vez, sin puesto
   * ni banda ni alertas que programar, así que no hay radio ni selección — la nota bajo la
   * lista lo explica.
   */
  const lunarRow = (h: LunarEclipseHit, hasDivider: boolean) => {
    const d = new Date(`${h.civilDate}T00:00:00Z`);
    const label = `${t(`lunar.${h.kind}` as I18nKey)} · ${d.getUTCDate()} ${monthShort(d.getUTCMonth())} ${d.getUTCFullYear()}`;
    const sub = `${fmtRelativeDay(h.civilDate)} · ${t('real.maxAt', { time: fmtHM(h.peak) })}`;
    return (
      <View
        key={h.civilDate}
        style={[s.rowItem, hasDivider && s.rowDivider]}
        accessible
        accessibilityLabel={`${label}. ${sub}`}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowTitle}>{label}</Text>
          <Text style={s.rowSub}>{sub}</Text>
        </View>
      </View>
    );
  };

  // filter/reverse devuelven copias: la caché de lib/lunar no se toca
  const lunarUp = filter === 'lunar' && lunar ? lunar.filter((h) => h.civilDate >= todayKey) : [];
  const lunarPast = filter === 'lunar' && lunar ? lunar.filter((h) => h.civilDate < todayKey).reverse() : [];
  /** Listas solares del filtro activo; null mientras el diferido calcula (o al cambiar de chip) */
  const solar =
    filter !== 'all' && filter !== 'lunar' && solarFiltered?.key === filter ? solarFiltered : null;

  /** Filas del histórico con cabecera al cambiar de año: 25 años de lista piden ancla. */
  const pastRows = past.flatMap((e, i) => {
    const year = e.civilDate.slice(0, 4);
    const header =
      year !== past[i - 1]?.civilDate.slice(0, 4)
        ? [
            <Text key={`y-${year}`} style={s.yearHeader}>
              {year}
            </Text>,
          ]
        : [];
    return [...header, eclipseRow(e, i < past.length - 1, true)];
  });

  return (
    <View style={s.root}>
      <Text style={[s.title, { paddingTop: insets.top + 14 }]}>{t('eclipses.title')}</Text>
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder={t('eclipses.search')}
          accessibilityLabel={t('eclipses.search')}
          placeholderTextColor={C.dim}
          value={query}
          onChangeText={setQuery}
          // La caché de 25 años de histórico se paga al enfocar, no en el primer tecleo:
          // se espera a que acabe la animación del teclado para no trabarla con el cálculo
          onFocus={() => InteractionManager.runAfterInteractions(() => pastEclipses(999))}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query !== '' && (
          <Pressable
            style={s.searchClear}
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('eclipses.searchClear')}
          >
            <Text style={s.searchClearTxt}>✕</Text>
          </Pressable>
        )}
      </View>
      {/* Filtro por tipo + enlace a la hoja de tipos; la búsqueda por texto tiene prioridad */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChips}>
          {FILTERS.map((f) => (
            <Pressable
              key={f}
              style={[s.filterChip, filter === f && s.filterChipOn]}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f }}
              accessibilityLabel={t('eclipses.filter.a11y', { label: t(`eclipses.filter.${f}` as I18nKey) })}
            >
              <Text style={[s.filterChipTxt, filter === f && s.filterChipTxtOn]}>
                {t(`eclipses.filter.${f}` as I18nKey)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => setTypesOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('eclipses.types.a11y')}
        >
          <Text style={s.typesLink}>{t('eclipses.types')}</Text>
        </Pressable>
      </View>
      <ScrollView
        style={s.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 22, paddingBottom: 36 }}
      >
        {results !== null ? (
          <View>
            <Text style={s.section}>{t('eclipses.results', { n: results.length })}</Text>
            <View style={s.card}>
              {results.length === 0 && <Text style={s.emptyTxt}>{t('eclipses.searchEmpty')}</Text>}
              {results.map((e, i) => eclipseRow(e, i < results.length - 1, e.civilDate < todayKey))}
            </View>
          </View>
        ) : filter === 'lunar' ? (
          <>
            <View>
              <Text style={s.section}>{t('settings.upcoming')}</Text>
              <View style={s.card}>
                {lunar === null && <Text style={s.emptyTxt}>{t('eclipses.computing')}</Text>}
                {lunar !== null && lunarUp.length === 0 && (
                  <Text style={s.emptyTxt}>{t('eclipses.filterEmpty')}</Text>
                )}
                {lunarUp.map((h, i) => lunarRow(h, i < lunarUp.length - 1))}
              </View>
              <Text style={s.note}>{t('eclipses.lunar.note')}</Text>
            </View>
            {lunarPast.length > 0 && (
              <View>
                <Text style={s.section}>{t('settings.past')}</Text>
                <View style={s.card}>{lunarPast.map((h, i) => lunarRow(h, i < lunarPast.length - 1))}</View>
              </View>
            )}
          </>
        ) : filter !== 'all' ? (
          <>
            <View>
              <Text style={s.section}>{t('settings.upcoming')}</Text>
              <View style={s.card}>
                {solar === null && <Text style={s.emptyTxt}>{t('eclipses.computing')}</Text>}
                {solar !== null && solar.upcoming.length === 0 && (
                  <Text style={s.emptyTxt}>{t('eclipses.filterEmpty')}</Text>
                )}
                {solar?.upcoming.map((e, i) => eclipseRow(e, i < solar.upcoming.length - 1, false))}
              </View>
            </View>
            {solar !== null && solar.past.length > 0 && (
              <View>
                <Text style={s.section}>{t('settings.past')}</Text>
                <View style={s.card}>
                  {solar.past.map((e, i) => eclipseRow(e, i < solar.past.length - 1, true))}
                </View>
                <Text style={s.note}>{t('settings.past.note')}</Text>
              </View>
            )}
          </>
        ) : (
          <>
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
                {pastRows}
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
          </>
        )}
      </ScrollView>
      <EclipseTypesInfo visible={typesOpen} onClose={() => setTypesOpen(false)} />
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
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 6 },
  searchInput: {
    flex: 1,
    backgroundColor: C.surface,
    color: C.text,
    borderRadius: 12,
    padding: 13,
    // Hueco del ✕ superpuesto: sin él, el final del texto queda debajo del botón
    paddingRight: 40,
    fontSize: 15,
    fontFamily: F.medium,
    borderWidth: 1,
    borderColor: C.border,
  },
  /** Encima del extremo derecho del input, no al lado: el campo conserva todo el ancho */
  searchClear: { position: 'absolute', right: 32, padding: 8 },
  searchClearTxt: { fontFamily: F.bold, fontSize: 14, color: C.dim },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 24,
    paddingRight: 24,
    paddingBottom: 4,
  },
  filterChips: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  filterChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipOn: { borderColor: 'rgba(255,184,77,0.5)', backgroundColor: 'rgba(255,184,77,0.08)' },
  filterChipTxt: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 1.5, color: C.dim },
  filterChipTxtOn: { color: C.corona },
  typesLink: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1, color: C.corona },
  yearHeader: {
    fontFamily: F.semibold,
    fontSize: 10,
    letterSpacing: 2,
    color: C.dim,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 2,
  },
  emptyTxt: { fontFamily: F.regular, fontSize: 13, color: C.dim, padding: 16 },
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
