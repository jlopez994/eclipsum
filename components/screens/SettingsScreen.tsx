import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bandOf, upcomingEclipses, type EclipseEntry } from '../../lib/eclipseCatalog';
import { ALERT_SOUND_OPTIONS, sendTestNotification } from '../../lib/notifications';
import { previewAlertSound } from '../../lib/soundPreview';
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
  onSoundChange: (sound: AlertSound) => void;
  onDemoEclipse: () => void;
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
  return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `En ${d} días`;
}

/** «Pico 41°N 3°O» a partir del pico global (solo entradas autogeneradas). */
function fmtPeak(e: EclipseEntry): string | null {
  if (e.peakLat === undefined || e.peakLon === undefined) return null;
  const lat = `${Math.abs(e.peakLat).toFixed(0)}°${e.peakLat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(e.peakLon).toFixed(0)}°${e.peakLon >= 0 ? 'E' : 'O'}`;
  return `Pico ${lat} ${lon}`;
}

/** 90 → «1m 30s»; 120 → «2 min» */
function fmtTotality(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

function Stepper({ onLess, onMore, a11y }: { onLess: () => void; onMore: () => void; a11y: string }) {
  return (
    <View style={s.stepper}>
      <Pressable style={s.stepBtn} onPress={onLess} hitSlop={6} accessibilityLabel={`Reducir ${a11y}`}>
        <Text style={s.stepTxt}>−</Text>
      </Pressable>
      <Pressable style={s.stepBtn} onPress={onMore} hitSlop={6} accessibilityLabel={`Aumentar ${a11y}`}>
        <Text style={s.stepTxt}>+</Text>
      </Pressable>
    </View>
  );
}

export function SettingsScreen({
  permissions,
  alertSound,
  glassesUrl,
  onSoundChange,
  onDemoEclipse,
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
      .catch(() => setDrillMsg('Sin permiso de notificaciones'));
  };

  // El tono de sistema no es reproducible en la app (content:// no carga en expo-audio):
  // se escucha con una notificación real, que además valida canal y permisos.
  const preview = (id: AlertSound) => {
    if (id === 'default') void sendTestNotification('default').catch(() => {});
    else void previewAlertSound(id);
  };

  return (
    <View style={s.root}>
      <Text style={[s.title, { paddingTop: insets.top + 14 }]}>Ajustes</Text>
      <ScrollView style={s.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 22, paddingBottom: 36 }}>
        <Text style={s.hint}>
          El puesto de observación se elige en el mapa, tocando el nombre del lugar arriba a la izquierda.
        </Text>

        <View>
          <Text style={s.section}>PERMISOS</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider]}>
              <Text style={s.rowTitle}>Ubicación</Text>
              <Text style={permissions.location ? s.activeTag : s.deniedTag}>
                {permissions.location ? 'PERMITIDO' : 'DENEGADO'}
              </Text>
            </View>
            <View style={s.rowItem}>
              <Text style={s.rowTitle}>Notificaciones</Text>
              <Text style={permissions.notifications ? s.activeTag : s.deniedTag}>
                {permissions.notifications ? 'PERMITIDO' : 'DENEGADO'}
              </Text>
            </View>
          </View>
        </View>

        <View>
          <Text style={s.section}>SONIDO DE ALERTAS</Text>
          <View style={s.card}>
            {ALERT_SOUND_OPTIONS.map((opt, i) => {
              const on = alertSound === opt.id;
              return (
                <View
                  key={opt.id}
                  style={[s.soundRow, i < ALERT_SOUND_OPTIONS.length - 1 && s.rowDivider]}
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
                    accessibilityLabel={`Escuchar ${opt.label}`}
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
            {!!glassesUrl && (
              <>
                <Pressable onPress={() => Linking.openURL(glassesUrl)}>
                  <Text style={s.safetyLink}>COMPRAR GAFAS CERTIFICADAS →</Text>
                </Pressable>
                <Text style={s.affiliateNote}>
                  Enlace de afiliado: apoya la app sin coste extra para ti.
                </Text>
              </>
            )}
          </View>
        </View>

        <View>
          <Text style={s.section}>SIMULACRO</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle}>Parcial (C1→C2)</Text>
                <Text style={s.soundHint}>{fmtTotality(drill.partialSec)} por tramo</Text>
              </View>
              <Stepper
                onLess={() => step('partialSec', -1)}
                onMore={() => step('partialSec', 1)}
                a11y="parcial del simulacro"
              />
            </View>
            <View style={[s.rowItem, s.rowDivider]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle}>Totalidad (C2→C3)</Text>
                <Text style={s.soundHint}>{fmtTotality(drill.totalitySec)}</Text>
              </View>
              <Stepper
                onLess={() => step('totalitySec', -1)}
                onMore={() => step('totalitySec', 1)}
                a11y="totalidad del simulacro"
              />
            </View>
            <Pressable style={s.rowItem} onPress={runDrill} accessibilityLabel="Iniciar simulacro">
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.rowTitle, { color: C.corona }]}>Iniciar simulacro</Text>
                <Text style={s.soundHint}>
                  {drillMsg ??
                    'Modo eclipse con C1 en 2 min y avisos [PRUEBA] según tus alertas. Las reales no se tocan.'}
                </Text>
              </View>
              <Text style={s.playIcon}>▶</Text>
            </Pressable>
          </View>
        </View>

        <View>
          <Text style={s.section}>PRÓXIMOS ECLIPSES</Text>
          <View style={s.card}>
            {upcoming.map((e, i) => {
              const on = e.civilDate === activeEclipse.civilDate;
              const sub = [fmtCountdown(e.civilDate), fmtPeak(e), bandOf(e) ? 'Banda en el mapa' : null]
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
                  {on && <Text style={s.upcomingActive}>ACTIVO</Text>}
                  <View style={[s.radio, on && s.radioOn, { marginLeft: 10 }]}>{on && <View style={s.radioDot} />}</View>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.upcomingNote}>
            Por defecto se sigue el más próximo{isManualSelection ? ' — ahora tienes uno elegido a mano' : ''}. Cada
            eclipse guarda su puesto y alertas; los avisos programados son los del activo.
          </Text>
        </View>

        <View>
          <Text style={s.section}>ACERCA DE</Text>
          <Pressable onLongPress={onDemoEclipse} delayLongPress={1500}>
            <View style={s.card}>
              <View style={[s.rowItem, s.rowDivider]}>
                <Text style={s.rowTitle}>Versión</Text>
                <Text style={s.aboutValue}>
                  Eclipsum {Constants.expoConfig?.version ?? '1.0'}
                  {Constants.expoConfig?.android?.versionCode ? ` (build ${Constants.expoConfig.android.versionCode})` : ''}
                </Text>
              </View>
              <View style={[s.rowItem, s.rowDivider]}>
                <Text style={s.rowTitle}>Eclipse activo</Text>
                <Text style={s.aboutValue}>{activeEclipse.label}</Text>
              </View>
              <View style={{ padding: 16 }}>
                <Text style={s.aboutNote}>
                  Los horarios del eclipse se calculan en tu móvil y funcionan sin conexión. Solo el
                  pronóstico de nubes y el buscador de lugares necesitan internet.
                </Text>
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
  stepper: { flexDirection: 'row', gap: 8 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: { fontFamily: F.bold, fontSize: 17, color: C.text, lineHeight: 20 },
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
