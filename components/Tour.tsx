import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { track } from '../lib/firebase';
import { t, type I18nKey } from '../lib/i18n';
import { ALERT_EARLY_SECONDS } from '../lib/prefs';
import { animateNextLayout } from '../lib/anim';
import { C, F } from './theme';

/**
 * Tutorial de bienvenida: una tarjeta por pestaña con lo que no se ve a simple vista
 * (tocar el mapa, arrastrar la hoja, chips de anticipo, simulacro…). Se enseña una vez
 * y se puede repetir desde Ajustes.
 */
const STEPS: { tab: I18nKey; title: I18nKey; bullets: I18nKey[] }[] = [
  {
    tab: 'tab.map',
    title: 'tour.map.title',
    bullets: ['tour.map.b1', 'tour.map.b2', 'tour.map.b3', 'tour.map.b4'],
  },
  {
    tab: 'tab.alerts',
    title: 'tour.alerts.title',
    bullets: ['tour.alerts.b1', 'tour.alerts.b2', 'tour.alerts.b3'],
  },
  {
    tab: 'tab.settings',
    title: 'tour.settings.title',
    bullets: ['tour.settings.b1', 'tour.settings.b2', 'tour.settings.b3'],
  },
];

interface TourProps {
  /** Cierra el tutorial y lo marca como visto */
  onClose: () => void;
}

export function Tour({ onClose }: TourProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const finish = (skipped: boolean) => {
    track('tour_finish', { step: step + 1, skipped: skipped ? 1 : 0 });
    onClose();
  };

  return (
    <View style={[s.scrim, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.card}>
        <Text style={s.kicker}>
          {t(current.tab)} · {t('tour.step', { n: step + 1, total: STEPS.length })}
        </Text>
        <Text style={s.title}>{t(current.title)}</Text>
        <View style={s.bullets}>
          {current.bullets.map((key) => (
            <View key={key} style={s.bulletRow}>
              <View style={s.bulletDot} />
              {/* El anticipo se interpola: el copy y la constante no pueden divergir */}
              <Text style={s.bulletText}>{t(key, { sec: ALERT_EARLY_SECONDS })}</Text>
            </View>
          ))}
        </View>
        <View style={s.dots}>
          {STEPS.map((st, i) => (
            <View key={st.title} style={[s.dot, i === step && s.dotOn]} />
          ))}
        </View>
        <View style={s.actions}>
          {/* Atrás solo desde la segunda tarjeta: en la primera no hay nada detrás y un
              botón muerto ahí haría dudar de si el tutorial responde */}
          <View style={s.actionsLeft}>
            {step > 0 && (
              <Pressable
                onPress={() => {
                  animateNextLayout();
                  setStep((v) => v - 1);
                }}
                hitSlop={10}
                accessibilityRole="button"
              >
                <Text style={s.back}>{t('tour.back')}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => finish(true)} hitSlop={10} accessibilityRole="button">
              <Text style={s.skip}>{t('tour.skip')}</Text>
            </Pressable>
          </View>
          <Pressable
            style={s.nextBtn}
            accessibilityRole="button"
            onPress={() => {
              if (isLast) return finish(false);
              animateNextLayout();
              setStep((v) => v + 1);
            }}
          >
            <Text style={s.nextTxt}>{isLast ? t('tour.done') : t('tour.next')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Encima de todo (la hoja del mapa va a zIndex 3) y casi opaco: el fondo distrae
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    backgroundColor: 'rgba(11,11,16,0.94)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 22,
    padding: 24,
  },
  kicker: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim },
  title: {
    fontFamily: F.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: C.text,
    marginTop: 8,
  },
  bullets: { gap: 12, marginTop: 18 },
  bulletRow: { flexDirection: 'row', gap: 12 },
  bulletDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.corona, marginTop: 6 },
  bulletText: { flex: 1, fontFamily: F.regular, fontSize: 13.5, lineHeight: 20, color: C.text },
  dots: { flexDirection: 'row', gap: 6, marginTop: 22 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.knobTrack },
  dotOn: { backgroundColor: C.corona, width: 18 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  skip: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.5, color: C.dim, paddingVertical: 6 },
  /** Volver es secundario frente a seguir, pero más visible que «saltar»: es navegación, no salida */
  back: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.corona, paddingVertical: 6 },
  nextBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.45)',
    backgroundColor: 'rgba(255,184,77,0.12)',
  },
  nextTxt: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1.5, color: C.corona },
});
