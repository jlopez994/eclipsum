import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bandOf, upcomingEclipses, type EclipseEntry } from '../../lib/eclipseCatalog';
import { alertSoundOptions, sendTestNotification } from '../../lib/notifications';
import { previewAlertSound } from '../../lib/soundPreview';
import { track } from '../../lib/firebase';
import { LANG_META, LANGS, t, type I18nKey, type Lang } from '../../lib/i18n';
import type { PermissionKind, Permissions } from '../../hooks/usePermissions';
import type { AlertSound, UpdateChannel } from '../../lib/prefs';
import { C, F } from '../theme';

/** Filas de la sección PERMISOS: qué es y para qué lo usa la app. */
const PERMISSION_ROWS: { kind: PermissionKind; label: I18nKey; why: I18nKey }[] = [
  { kind: 'location', label: 'settings.location', why: 'settings.location.why' },
  { kind: 'notifications', label: 'settings.notifications', why: 'settings.notifications.why' },
  { kind: 'camera', label: 'settings.camera', why: 'settings.camera.why' },
];

/** Canal de avisos de actualización; beta incluye también las estables más nuevas. */
const UPDATE_CHANNELS: { id: UpdateChannel; label: I18nKey; hint: I18nKey }[] = [
  { id: 'stable', label: 'settings.channel.stable', hint: 'settings.channel.stableHint' },
  { id: 'beta', label: 'settings.channel.beta', hint: 'settings.channel.betaHint' },
];

interface SettingsScreenProps {
  permissions: Permissions;
  /** Pide un permiso desde aquí; cada pantalla que lo use sigue pidiéndolo por su cuenta */
  onRequestPermission: (kind: PermissionKind) => void;
  alertSound: AlertSound;
  /** Entrada activa resuelta por App (única fuente de verdad; no leer el catálogo aquí) */
  activeEclipse: EclipseEntry;
  /** URL de donaciones (Buy Me a Coffee, vía Remote Config); vacío = sección oculta */
  donateUrl?: string;
  onSoundChange: (sound: AlertSound) => void;
  /** Canal del que se aceptan avisos de actualización */
  updateChannel: UpdateChannel;
  onUpdateChannelChange: (channel: UpdateChannel) => void;
  onDemoEclipse: () => void;
  /** Idioma elegido; '' = automático (sistema) */
  language: Lang | '';
  onLanguageChange: (lang: Lang | '') => void;
  /** Recibe el día civil elegido; '' = automático */
  onSelectEclipse: (day: string) => void;
  /** Arranca el simulacro (modo eclipse + avisos [PRUEBA]); devuelve mensaje de resultado */
  onStartDrill: () => Promise<string>;
  /** Reabre el tutorial de bienvenida */
  onShowTour: () => void;
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

/** Chips del selector de idioma: «Automático» localizado + endónimo de cada idioma (LANG_META). */
function languageOptions(): { id: Lang | ''; label: string; a11y: string }[] {
  return [
    { id: '', label: t('settings.language.auto'), a11y: `${t('settings.language.auto')}. ${t('settings.language.autoHint')}` },
    ...LANGS.map((l) => ({ id: l, label: LANG_META[l].name, a11y: LANG_META[l].name })),
  ];
}

export function SettingsScreen({
  permissions,
  onRequestPermission,
  alertSound,
  donateUrl,
  onSoundChange,
  updateChannel,
  onUpdateChannelChange,
  onDemoEclipse,
  language,
  onLanguageChange,
  activeEclipse,
  onSelectEclipse,
  onStartDrill,
  onShowTour,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [drillMsg, setDrillMsg] = useState<string | null>(null);
  const missingPermission = PERMISSION_ROWS.some((r) => !permissions[r.kind]);
  // Sin memo: upcomingEclipses ya cachea por día+catálogo, y así un catálogo RC
  // recién activado refresca la lista sin esperar a remontar la pantalla
  const nextFew = upcomingEclipses(UPCOMING_COUNT);
  /**
   * El activo SIEMPRE en la lista. Se puede llegar a uno más lejano que los UPCOMING_COUNT
   * primeros (p. ej. desde el aviso de «aquí no se ve»), y sin su fila no habría ninguna
   * marcada como activa ni forma de volver a otro desde aquí.
   */
  const upcoming = nextFew.some((e) => e.civilDate === activeEclipse.civilDate)
    ? nextFew
    : [...nextFew, activeEclipse].sort((a, b) => a.civilDate.localeCompare(b.civilDate));
  // Elegir el más próximo (fila 0) equivale al modo automático; misma regla que getActiveEclipse
  const isManualSelection = activeEclipse.civilDate !== upcoming[0]?.civilDate;

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
          <Pressable style={s.drillCta} onPress={runDrill} accessibilityLabel={t('settings.drill.startA11y')}>
            <Text style={s.drillCtaIcon}>▶</Text>
            <Text style={s.drillCtaText}>{t('settings.drill.start')}</Text>
          </Pressable>
          <Text style={s.drillNote}>{drillMsg ?? t('settings.drill.startHint')}</Text>
        </View>

        <View>
          <Text style={s.section}>{t('settings.permissions')}</Text>
          <View style={s.card}>
            {PERMISSION_ROWS.map((row, i) => {
              const on = permissions[row.kind];
              return (
                // El peso visual va al que PIDE algo: concedido se resuelve con un check
                // discreto y sin robar ancho al texto, y solo lo pendiente se pinta como
                // llamada. Tocar la fila lo concede, sin ir a buscar la pantalla que lo usa.
                <Pressable
                  key={row.kind}
                  style={[
                    s.permRow,
                    !on && s.permRowPending,
                    i < PERMISSION_ROWS.length - 1 && s.rowDivider,
                  ]}
                  onPress={on ? undefined : () => onRequestPermission(row.kind)}
                  disabled={on}
                  accessibilityRole={on ? undefined : 'button'}
                  accessibilityLabel={`${t(row.label)}. ${on ? t('settings.granted') : t('settings.permissions.grant')}`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowTitle}>{t(row.label)}</Text>
                    <Text style={s.permWhy}>{t(row.why)}</Text>
                  </View>
                  {on ? (
                    <View style={s.permOk}>
                      <Text style={s.permOkIcon}>✓</Text>
                    </View>
                  ) : (
                    <View style={s.permCta}>
                      <Text style={s.permCtaTxt}>{t('settings.permissions.grant')}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
          {/* Con todo concedido la explicación sobra: sería ruido permanente */}
          {missingPermission && <Text style={s.upcomingNote}>{t('settings.permissions.hint')}</Text>}
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

        <View>
          <Text style={s.section}>{t('settings.channel')}</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider]}>
              <Text style={s.rowTitle}>{t('settings.version')}</Text>
              {/* La versión ES el build (b<versionCode>, ver release.sh) */}
              <Text style={s.aboutValue}>
                Eclipsum {Constants.expoConfig?.version ?? `b${Constants.expoConfig?.android?.versionCode ?? '?'}`}
              </Text>
            </View>
            {UPDATE_CHANNELS.map((opt, i) => {
              const on = updateChannel === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[s.permRow, i < UPDATE_CHANNELS.length - 1 && s.rowDivider]}
                  onPress={() => onUpdateChannelChange(opt.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t(opt.label)}. ${t(opt.hint)}`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowTitle}>{t(opt.label)}</Text>
                    <Text style={s.permWhy}>{t(opt.hint)}</Text>
                  </View>
                  <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
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
                <Text style={s.linkCta}>{t('settings.support.button')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View>
          <Text style={s.section}>{t('settings.about')}</Text>
          <Pressable onLongPress={onDemoEclipse} delayLongPress={1500}>
            <View style={s.card}>
              {/* Pressable propio dentro del de la demo: el toque corto es suyo,
                  la pulsación larga sigue siendo la del easter egg */}
              <Pressable
                style={[s.rowItem, s.rowDivider]}
                onPress={onShowTour}
                accessibilityRole="button"
                accessibilityLabel={t('settings.tour')}
              >
                <Text style={s.rowTitle}>{t('settings.tour')}</Text>
                <Text style={s.tourAction}>{t('settings.tour.action')}</Text>
              </Pressable>
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
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  /** Tinte tenue: de un vistazo se ve cuál falta sin leer nada */
  permRowPending: { backgroundColor: 'rgba(255,184,77,0.05)' },
  permWhy: { fontFamily: F.regular, fontSize: 12, lineHeight: 16, color: C.dim, marginTop: 3 },
  /** Concedido = confirmación callada; no compite con el texto ni le roba ancho */
  permOk: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(94,204,143,0.4)',
    backgroundColor: 'rgba(94,204,143,0.12)',
  },
  permOkIcon: { fontFamily: F.bold, fontSize: 12, lineHeight: 15, color: C.ok },
  permCta: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.45)',
    backgroundColor: 'rgba(255,184,77,0.12)',
  },
  permCtaTxt: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.2, color: C.corona },
  linkCta: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1, color: C.corona, marginTop: 12 },
  aboutValue: { fontFamily: F.medium, fontSize: 13, color: C.dim },
  tourAction: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.corona },
  upcomingActive: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2, color: C.corona },
  upcomingNote: { fontFamily: F.regular, fontSize: 11, lineHeight: 16, color: C.dim, marginTop: 8 },
  aboutNote: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim },
});
