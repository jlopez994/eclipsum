import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bandOf, upcomingEclipses, type EclipseEntry } from '../../lib/eclipseCatalog';
import { alertSoundOptions, sendTestNotification } from '../../lib/notifications';
import { previewAlertSound } from '../../lib/soundPreview';
import { track } from '../../lib/firebase';
import { LANG_META, LANGS, t, type Lang } from '../../lib/i18n';
import type { AlertSound } from '../../lib/prefs';
import { DRILL_PARTIAL, DRILL_TOTALITY, type DrillConfig } from '../../lib/drill';
import { C, F } from '../theme';

const IGN_URL = 'https://eclipses.ign.es/como-observar-eclipses.html';

interface SettingsScreenProps {
  permissions: { location: boolean; notifications: boolean };
  alertSound: AlertSound;
  /** Entrada activa resuelta por App (única fuente de verdad; no leer el catálogo aquí) */
  activeEclipse: EclipseEntry;
  /** URL de gafas certificadas (afiliado, vía Remote Config); vacío = botón oculto */
  glassesUrl?: string;
  /** URL de donaciones (Buy Me a Coffee, vía Remote Config); vacío = sección oculta */
  donateUrl?: string;
  onSoundChange: (sound: AlertSound) => void;
  onDemoEclipse: () => void;
  /** Idioma elegido; '' = automático (sistema) */
  language: Lang | '';
  onLanguageChange: (lang: Lang | '') => void;
  /** Recibe el día civil elegido; '' = automático */
  onSelectEclipse: (day: string) => void;
  /** Tramos del simulacro (persisten en prefs) */
  drill: DrillConfig;
  onDrillChange: (drill: DrillConfig) => void;
  /** Arranca el simulacro (modo eclipse + avisos [PRUEBA]); devuelve mensaje de resultado */
  onStartDrill: () => Promise<string>;
}

const UPCOMING_COUNT = 5;

function fmtCountdown(civilDate: string): string {
  const d = Math.max(0, Math.ceil((Date.parse(`${civilDate}T00:00:00Z`) - Date.now()) / 86_400_000));
  return d === 0 ? t('settings.upcoming.today') : d === 1 ? t('settings.upcoming.tomorrow') : t('settings.upcoming.inDays', { n: d });
}

/** «Pico 41°N 3°O» a partir del pico global (solo entradas autogeneradas). */
function fmtPeak(e: EclipseEntry): string | null {
  if (e.peakLat === undefined || e.peakLon === undefined) return null;
  const lat = `${Math.abs(e.peakLat).toFixed(0)}°${e.peakLat >= 0 ? t('bearing.N') : t('bearing.S')}`;
  const lon = `${Math.abs(e.peakLon).toFixed(0)}°${e.peakLon >= 0 ? t('bearing.E') : t('bearing.W')}`;
  return t('settings.upcoming.peak', { lat, lon });
}

/** 90 → «1m 30s»; 120 → «2 min» */
function fmtTotality(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

/** Stepper con el valor entre los botones; en los topes el botón se apaga y no responde. */
function Stepper({
  value,
  range,
  onLess,
  onMore,
  a11y,
}: {
  value: number;
  range: { min: number; max: number };
  onLess: () => void;
  onMore: () => void;
  a11y: string;
}) {
  const atMin = value <= range.min;
  const atMax = value >= range.max;
  return (
    <View style={s.stepper}>
      <Pressable
        style={[s.stepBtn, atMin && s.stepBtnOff]}
        onPress={onLess}
        disabled={atMin}
        hitSlop={6}
        accessibilityLabel={t('settings.drill.less', { what: a11y })}
      >
        <Text style={[s.stepTxt, atMin && s.stepTxtOff]}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{fmtTotality(value)}</Text>
      <Pressable
        style={[s.stepBtn, atMax && s.stepBtnOff]}
        onPress={onMore}
        disabled={atMax}
        hitSlop={6}
        accessibilityLabel={t('settings.drill.more', { what: a11y })}
      >
        <Text style={[s.stepTxt, atMax && s.stepTxtOff]}>+</Text>
      </Pressable>
    </View>
  );
}

/** Chips del selector de idioma: «Automático» localizado + endónimo de cada idioma (LANG_META). */
function languageOptions(): { id: Lang | ''; label: string; a11y: string }[] {
  return [
    { id: '', label: t('settings.language.auto'), a11y: `${t('settings.language.auto')}. ${t('settings.language.autoHint')}` },
    ...LANGS.map((l) => ({ id: l, label: LANG_META[l].name, a11y: LANG_META[l].name })),
  ];
}

export function SettingsScreen({
  permissions,
  alertSound,
  glassesUrl,
  donateUrl,
  onSoundChange,
  onDemoEclipse,
  language,
  onLanguageChange,
  activeEclipse,
  onSelectEclipse,
  drill,
  onDrillChange,
  onStartDrill,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [drillMsg, setDrillMsg] = useState<string | null>(null);
  // Sin memo: upcomingEclipses ya cachea por día+catálogo, y así un catálogo RC
  // recién activado refresca la lista sin esperar a remontar la pantalla
  const upcoming = upcomingEclipses(UPCOMING_COUNT);
  // Elegir el más próximo (fila 0) equivale al modo automático; misma regla que getActiveEclipse
  const isManualSelection = activeEclipse.civilDate !== upcoming[0]?.civilDate;

  const step = (key: keyof DrillConfig, dir: 1 | -1) => {
    const range = key === 'partialSec' ? DRILL_PARTIAL : DRILL_TOTALITY;
    const next = Math.min(range.max, Math.max(range.min, drill[key] + dir * range.step));
    onDrillChange({ ...drill, [key]: next });
  };

  const runDrill = () => {
    onStartDrill()
      .then(setDrillMsg)
      .catch(() => setDrillMsg(t('notif.permissionDenied')));
  };

  // El tono de sistema no es reproducible en la app (content:// no carga en expo-audio):
  // se escucha con una notificación real, que además valida canal y permisos.
  const preview = (id: AlertSound) => {
    if (id === 'default') void sendTestNotification('default').catch(() => {});
    else void previewAlertSound(id);
  };

  const soundOptions = alertSoundOptions();
  return (
    <View style={s.root}>
      <Text style={[s.title, { paddingTop: insets.top + 14 }]}>{t('settings.title')}</Text>
      <ScrollView style={s.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 22, paddingBottom: 36 }}>
        <Text style={s.hint}>{t('settings.hint')}</Text>

        <View>
          <Text style={[s.section, { color: C.danger }]}>{t('settings.safety')}</Text>
          <View style={s.safetyCard}>
            <Text style={s.safetyTitle}>
              {t('settings.safety.title')}
              <Text style={{ color: C.danger }}>ISO 12312-2</Text>
            </Text>
            <Text style={s.safetyBody}>{t('settings.safety.body')}</Text>
            <Pressable onPress={() => Linking.openURL(IGN_URL)}>
              <Text style={s.safetyLink}>{t('settings.safety.guide')}</Text>
            </Pressable>
            {!!glassesUrl && (
              <>
                <Pressable onPress={() => Linking.openURL(glassesUrl)}>
                  <Text style={s.safetyLink}>{t('settings.safety.buy')}</Text>
                </Pressable>
                <Text style={s.affiliateNote}>{t('settings.safety.affiliate')}</Text>
              </>
            )}
          </View>
        </View>

        <View>
          <Text style={s.section}>{t('settings.permissions')}</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider]}>
              <Text style={s.rowTitle}>{t('settings.location')}</Text>
              <Text style={permissions.location ? s.activeTag : s.deniedTag}>
                {permissions.location ? t('settings.granted') : t('settings.denied')}
              </Text>
            </View>
            <View style={s.rowItem}>
              <Text style={s.rowTitle}>{t('settings.notifications')}</Text>
              <Text style={permissions.notifications ? s.activeTag : s.deniedTag}>
                {permissions.notifications ? t('settings.granted') : t('settings.denied')}
              </Text>
            </View>
          </View>
        </View>

        <View>
          <Text style={s.section}>{t('settings.upcoming')}</Text>
          <View style={s.card}>
            {upcoming.map((e, i) => {
              const on = e.civilDate === activeEclipse.civilDate;
              const sub = [fmtCountdown(e.civilDate), fmtPeak(e), bandOf(e) ? t('settings.upcoming.band') : null]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={e.civilDate}
                  style={[s.rowItem, i < upcoming.length - 1 && s.rowDivider]}
                  onPress={() => onSelectEclipse(e.civilDate === upcoming[0]?.civilDate ? '' : e.civilDate)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${e.label}. ${sub}`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowTitle}>{e.label}</Text>
                    <Text style={s.soundHint}>{sub}</Text>
                  </View>
                  {on && <Text style={s.upcomingActive}>{t('settings.upcoming.active')}</Text>}
                  <View style={[s.radio, on && s.radioOn, { marginLeft: 10 }]}>{on && <View style={s.radioDot} />}</View>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.upcomingNote}>
            {t('settings.upcoming.note', { manual: isManualSelection ? t('settings.upcoming.noteManual') : '' })}
          </Text>
        </View>

        <View>
          <Text style={s.section}>{t('settings.sound')}</Text>
          <View style={s.card}>
            {soundOptions.map((opt, i) => {
              const on = alertSound === opt.id;
              return (
                <View
                  key={opt.id}
                  style={[s.soundRow, i < soundOptions.length - 1 && s.rowDivider]}
                >
                  <Pressable
                    onPress={() => onSoundChange(opt.id)}
                    style={s.soundMain}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${opt.label}. ${opt.hint}`}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.rowTitle}>{opt.label}</Text>
                      <Text style={s.soundHint}>{opt.hint}</Text>
                    </View>
                    <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
                  </Pressable>
                  <Pressable
                    onPress={() => preview(opt.id)}
                    hitSlop={8}
                    accessibilityLabel={t('settings.sound.play', { label: opt.label })}
                    style={s.playBtn}
                  >
                    <Text style={s.playIcon}>▶</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>

        <View>
          <Text style={s.section}>{t('settings.drill')}</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle}>{t('settings.drill.partial')}</Text>
                <Text style={s.soundHint}>{t('settings.drill.partialHint')}</Text>
              </View>
              <Stepper
                value={drill.partialSec}
                range={DRILL_PARTIAL}
                onLess={() => step('partialSec', -1)}
                onMore={() => step('partialSec', 1)}
                a11y={t('settings.drill.partialA11y')}
              />
            </View>
            <View style={s.rowItem}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle}>{t('settings.drill.totality')}</Text>
                <Text style={s.soundHint}>{t('settings.drill.totalityHint')}</Text>
              </View>
              <Stepper
                value={drill.totalitySec}
                range={DRILL_TOTALITY}
                onLess={() => step('totalitySec', -1)}
                onMore={() => step('totalitySec', 1)}
                a11y={t('settings.drill.totalityA11y')}
              />
            </View>
          </View>
          <Pressable style={s.drillCta} onPress={runDrill} accessibilityLabel={t('settings.drill.startA11y')}>
            <Text style={s.drillCtaIcon}>▶</Text>
            <Text style={s.drillCtaText}>{t('settings.drill.start')}</Text>
          </Pressable>
          <Text style={s.drillNote}>{drillMsg ?? t('settings.drill.startHint')}</Text>
        </View>

        <View>
          <Text style={s.section}>{t('settings.language')}</Text>
          <View style={s.langWrap}>
            {languageOptions().map((opt) => {
              const on = language === opt.id;
              return (
                <Pressable
                  key={opt.id || 'auto'}
                  onPress={() => onLanguageChange(opt.id)}
                  style={[s.langChip, on && s.langChipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={opt.a11y}
                >
                  <Text style={[s.langChipTxt, on && s.langChipTxtOn]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!!donateUrl && (
          <View>
            <Text style={s.section}>{t('settings.support')}</Text>
            <View style={[s.card, { padding: 18 }]}>
              <Text style={s.aboutNote}>{t('settings.support.body')}</Text>
              <Pressable
                onPress={() => {
                  track('donate_click');
                  Linking.openURL(donateUrl);
                }}
              >
                <Text style={s.safetyLink}>{t('settings.support.button')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View>
          <Text style={s.section}>{t('settings.about')}</Text>
          <Pressable onLongPress={onDemoEclipse} delayLongPress={1500}>
            <View style={s.card}>
              <View style={[s.rowItem, s.rowDivider]}>
                <Text style={s.rowTitle}>{t('settings.version')}</Text>
                {/* La versión ES el build (b<versionCode>, ver release.sh) */}
                <Text style={s.aboutValue}>
                  Eclipsum {Constants.expoConfig?.version ?? `b${Constants.expoConfig?.android?.versionCode ?? '?'}`}
                </Text>
              </View>
              <View style={[s.rowItem, s.rowDivider]}>
                <Text style={s.rowTitle}>{t('settings.activeEclipse')}</Text>
                <Text style={s.aboutValue}>{activeEclipse.label}</Text>
              </View>
              <View style={{ padding: 16 }}>
                <Text style={s.aboutNote}>{t('settings.aboutNote')}</Text>
              </View>
            </View>
          </Pressable>
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
  hint: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim },
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
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  soundMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 0,
  },
  soundHint: { fontFamily: F.regular, fontSize: 12, color: C.dim, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { borderColor: 'rgba(38,38,58,0.45)' },
  stepTxt: { fontFamily: F.bold, fontSize: 17, color: C.text, lineHeight: 20 },
  stepTxtOff: { color: C.knobTrack },
  stepValue: {
    fontFamily: F.semibold,
    fontSize: 13,
    color: C.corona,
    fontVariant: ['tabular-nums'],
    minWidth: 54,
    textAlign: 'center',
  },
  drillCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.45)',
    backgroundColor: 'rgba(255,184,77,0.10)',
  },
  drillCtaIcon: { fontFamily: F.bold, fontSize: 11, color: C.corona },
  drillCtaText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1.5, color: C.corona },
  drillNote: { fontFamily: F.regular, fontSize: 11, lineHeight: 16, color: C.dim, marginTop: 8 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,196,87,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,196,87,0.35)',
  },
  playIcon: { fontFamily: F.bold, fontSize: 12, color: C.corona, marginLeft: 2 },
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
  langWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  langChipOn: { borderColor: 'rgba(255,196,87,0.55)', backgroundColor: 'rgba(255,196,87,0.12)' },
  langChipTxt: { fontFamily: F.semibold, fontSize: 13, color: C.dim },
  langChipTxtOn: { color: C.corona },
  activeTag: { fontFamily: F.medium, fontSize: 12, color: C.ok },
  deniedTag: { fontFamily: F.medium, fontSize: 12, color: C.danger },
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
  affiliateNote: { fontFamily: F.regular, fontSize: 11, color: C.dim, marginTop: 4 },
  aboutValue: { fontFamily: F.medium, fontSize: 13, color: C.dim },
  upcomingActive: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2, color: C.corona },
  upcomingNote: { fontFamily: F.regular, fontSize: 11, lineHeight: 16, color: C.dim, marginTop: 8 },
  aboutNote: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim },
});
