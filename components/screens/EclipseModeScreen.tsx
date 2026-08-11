import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useKeepAwake } from 'expo-keep-awake';
import { currentPhase, nextEvent, type EclipseEvent, type LocalEclipse } from '../../lib/eclipse';
import { fmtHMS } from '../../lib/format';
import { t, type I18nKey } from '../../lib/i18n';
import { Countdown } from '../Countdown';
import { C, EVENT_ACCENT, F } from '../theme';

/** Color de lo que pasa DESPUÉS del hito; no coincide con EVENT_ACCENT (tras C1 hay peligro). */
const AFTER_COLOR: Record<string, string> = {
  C1: C.danger,
  C2: C.totality,
  MAX: C.totality,
  C3: C.danger,
  C4: C.corona,
};

/**
 * Raíl de la serie completa: pasado (lleno), siguiente (anillo grande), futuro (tenue).
 * Con onJump (solo simulacro) cada hito es tocable y salta la serie a esa fase.
 */
function EventRail({
  eclipse,
  now,
  onJump,
  accent,
}: {
  eclipse: LocalEclipse;
  now: Date;
  onJump: ((key: EclipseEvent['key']) => void) | null;
  /** Color del avance recorrido (fase en curso) */
  accent: string;
}) {
  const nextKey = nextEvent(eclipse, now)?.key;
  // Avance entre el primer y el último contacto: da sensación de progreso en una serie que dura horas
  const first = eclipse.events[0]?.time.getTime() ?? 0;
  const last = eclipse.events[eclipse.events.length - 1]?.time.getTime() ?? 0;
  const span = last - first;
  const progress = span > 0 ? Math.min(1, Math.max(0, (now.getTime() - first) / span)) : 0;
  return (
    <View>
      <View style={s.rail}>
        <View style={s.railLine} />
        <View style={[s.railLineFill, { width: `${progress * 80}%`, backgroundColor: accent }]} />
        {eclipse.events.map((e) => {
          const accent = EVENT_ACCENT[e.key] ?? C.dim;
          const passed = e.time.getTime() <= now.getTime();
          const isNext = e.key === nextKey;
          return (
            <Pressable
              key={e.key}
              style={s.railItem}
              disabled={!onJump}
              onPress={onJump ? () => onJump(e.key) : undefined}
              hitSlop={8}
              accessibilityLabel={
                onJump
                  ? t('mode.railJumpA11y', { label: t(`event.${e.key}` as I18nKey) })
                  : t(`event.${e.key}` as I18nKey)
              }
            >
              <View
                style={[
                  s.railDot,
                  passed && { backgroundColor: accent, borderColor: accent },
                  isNext && { borderColor: accent, width: 14, height: 14, borderRadius: 7, marginTop: -2 },
                ]}
              />
              <Text style={[s.railKey, (passed || isNext) && { color: accent }]}>
                {e.key === 'MAX' ? t('event.maxShort') : e.key}
              </Text>
              <Text style={[s.railTime, isNext && { color: C.text }]}>{fmtHMS(e.time)}</Text>
            </Pressable>
          );
        })}
      </View>
      {onJump && <Text style={s.railHint}>{t('mode.railHint')}</Text>}
    </View>
  );
}

interface EclipseModeScreenProps {
  eclipse: LocalEclipse;
  place: string;
  now: Date;
  /** Texto del modo de prueba (DEMO/SIMULACRO); null = eclipse real, sin salida */
  exitLabel: string | null;
  onExitDemo: () => void;
  /** Salto de fase tocando el raíl; null = deshabilitado (eclipse real/demo) */
  onJumpToEvent: ((key: EclipseEvent['key']) => void) | null;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <Text style={s.clock}>{fmtHMS(now)}</Text>;
}

function CoronaRing({ glow, border, inner }: { glow: string; border: string; inner: string }) {
  const { width, height } = useWindowDimensions();
  // El anillo respira dentro de la zona libre: en móviles estrechos no se recorta
  const size = Math.max(220, Math.min(340, width - 56, height * 0.42));
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1750, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1750, useNativeDriver: true }),
      ]),
    ).start();
  }, [breath]);
  const opacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.95] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity }]}>
      <Svg width={size} height={size} viewBox="0 0 320 320">
        <Defs>
          {/* El resplandor vive FUERA del disco (r=118): antes quedaba tapado y solo
              asomaba un filo, con el crono cruzándolo por encima */}
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="70%" stopColor="transparent" />
            <Stop offset="79%" stopColor={glow} />
            <Stop offset="94%" stopColor="transparent" />
          </RadialGradient>
          <RadialGradient id="ringGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="70%" stopColor="transparent" />
            <Stop offset="75%" stopColor={inner} />
            <Stop offset="86%" stopColor="transparent" />
          </RadialGradient>
        </Defs>
        <Circle cx={160} cy={160} r={158} fill="url(#halo)" />
        <Circle cx={160} cy={160} r={150} fill="url(#ringGrad)" />
        <Circle cx={160} cy={160} r={118} fill="#000" stroke={border} strokeWidth={2} />
      </Svg>
    </Animated.View>
  );
}

export function EclipseModeScreen({ eclipse, place, now, exitLabel, onExitDemo, onJumpToEvent }: EclipseModeScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const phase = currentPhase(eclipse, now);
  const upcoming = nextEvent(eclipse, now);
  const inTotality = phase?.safeToLook === true;

  const banner = inTotality
    ? { bg: C.totality, fase: t('mode.banner.totality'), sub: t('mode.banner.totalitySub') }
    : phase
      ? { bg: C.danger, fase: t('mode.banner.partial'), sub: t('mode.banner.partialSub') }
      : upcoming
        ? { bg: C.surface, fase: t('mode.banner.ready'), sub: t('mode.banner.readySub') }
        : { bg: C.surface, fase: t('mode.banner.done'), sub: t('mode.banner.doneSub') };

  const ring = inTotality
    ? { glow: 'rgba(255,184,77,0.5)', border: 'rgba(255,216,160,0.85)', inner: 'rgba(255,184,77,0.28)' }
    : phase || upcoming
      ? { glow: 'rgba(255,107,94,0.32)', border: 'rgba(255,107,94,0.6)', inner: 'rgba(255,107,94,0.22)' }
      : // Terminado: sin alarma de color, el rojo ya no advierte de nada
        { glow: 'rgba(139,136,152,0.16)', border: 'rgba(139,136,152,0.4)', inner: 'rgba(139,136,152,0.12)' };
  const railAccent = inTotality ? C.totality : phase || upcoming ? C.corona : C.dim;
  // El crono no puede desbordar en pantallas estrechas ni con formato «1d 01:23:42»
  const chronoSize = Math.min(100, Math.round(width * 0.25));

  const after = upcoming
    ? { label: t(`mode.after.${upcoming.key}` as I18nKey), color: AFTER_COLOR[upcoming.key] ?? C.corona }
    : null;

  return (
    <View style={s.root}>
      {/* Ensayo: filo violeta permanente para no confundirlo con el eclipse real */}
      {exitLabel && <View style={[s.drillEdge, { top: insets.top }]} pointerEvents="none" />}
      <View style={[s.topRow, { paddingTop: insets.top + 14 }]}>
        <Clock />
        {exitLabel ? (
          <Pressable
            onPress={onExitDemo}
            hitSlop={10}
            style={s.exitPill}
            accessibilityLabel={t('mode.exitA11y', { label: exitLabel.toLowerCase() })}
          >
            <Text style={s.exitPillTxt}>{t('mode.exit', { label: exitLabel })}</Text>
          </Pressable>
        ) : (
          <Text style={s.modeTag}>{t('mode.tag', { place: place.toUpperCase() })}</Text>
        )}
      </View>

      <View style={[s.banner, { backgroundColor: banner.bg, shadowColor: banner.bg }]}>
        {/* adjustsFontSizeToFit: «GAFAS PUESTAS» y otras traducciones largas no deben partirse */}
        <Text style={s.bannerFase} numberOfLines={1} adjustsFontSizeToFit>
          {banner.fase}
        </Text>
        <Text style={s.bannerSub}>{banner.sub}</Text>
      </View>

      <View style={s.center}>
        <CoronaRing {...ring} />
        {upcoming && (
          <>
            <Text style={s.cdLabel}>{t(`mode.next.${upcoming.key}` as I18nKey)}</Text>
            <Countdown
              target={upcoming.time}
              format={upcoming.time.getTime() - now.getTime() < 3_600_000 ? 'mmss' : 'auto'}
              style={[
                s.chrono,
                {
                  fontSize: chronoSize,
                  lineHeight: Math.round(chronoSize * 1.04),
                  textShadowColor: inTotality ? 'rgba(124,108,255,0.5)' : 'rgba(255,107,94,0.45)',
                },
              ]}
            />
          </>
        )}
        {!upcoming && <Text style={s.cdLabel}>{t('mode.finished')}</Text>}
      </View>

      <View style={s.footer}>
        <EventRail eclipse={eclipse} now={now} onJump={onJumpToEvent} accent={railAccent} />
        {upcoming && after && (
          <View style={s.nextCard}>
            <View>
              <Text style={s.nextKicker}>{t('mode.after')}</Text>
              <Text style={[s.nextLabel, { color: after.color }]}>{after.label}</Text>
            </View>
            <Text style={s.nextTime}>{fmtHMS(upcoming.time)}</Text>
          </View>
        )}
        <Text style={s.awakeNote}>{t('mode.keepAwake')}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  clock: { fontFamily: F.medium, fontSize: 13, color: C.text, fontVariant: ['tabular-nums'] },
  modeTag: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2, color: C.dim },
  exitPill: {
    borderWidth: 1,
    borderColor: 'rgba(124,108,255,0.55)',
    backgroundColor: 'rgba(124,108,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  exitPillTxt: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.violet },
  rail: {
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  railLine: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: 5,
    height: 2,
    backgroundColor: '#26263A',
  },
  /** Avance recorrido sobre el raíl (mismo origen y grosor que railLine) */
  railLineFill: { position: 'absolute', left: '10%', top: 5, height: 2, opacity: 0.55 },
  drillEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: C.violet,
    opacity: 0.9,
    zIndex: 5,
  },
  railItem: { flex: 1, alignItems: 'center', gap: 4 },
  railDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#3A3A4C',
    backgroundColor: '#0B0B10',
  },
  // Pantalla que se mira de noche y a distancia de brazo: sin miniaturas de 9 px
  railKey: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 1, color: C.dim },
  railHint: {
    textAlign: 'center',
    fontFamily: F.medium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: '#55525F',
    marginBottom: 12,
  },
  railTime: { fontFamily: F.medium, fontSize: 10.5, color: C.dim, fontVariant: ['tabular-nums'] },
  banner: {
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 20,
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 30,
    elevation: 12,
  },
  bannerFase: { fontFamily: F.bold, fontSize: 40, letterSpacing: 2, color: '#FFFFFF', textAlign: 'center' },
  bannerSub: {
    fontFamily: F.bold,
    fontSize: 15,
    letterSpacing: 2,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 10,
    textAlign: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cdLabel: { fontFamily: F.semibold, fontSize: 12, letterSpacing: 3, color: 'rgba(242,239,233,0.75)' },
  chrono: {
    fontFamily: F.bold,
    fontSize: 108,
    lineHeight: 112,
    letterSpacing: -3,
    color: C.text,
    fontVariant: ['tabular-nums'],
    textShadowRadius: 40,
  },
  footer: { paddingHorizontal: 24, paddingBottom: 30 },
  nextCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  nextKicker: { fontFamily: F.semibold, fontSize: 10.5, letterSpacing: 2, color: C.dim },
  nextLabel: { fontFamily: F.bold, fontSize: 17, marginTop: 4 },
  nextTime: { fontFamily: F.semibold, fontSize: 17, color: C.dim, fontVariant: ['tabular-nums'] },
  awakeNote: {
    textAlign: 'center',
    fontFamily: F.medium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#55525F',
    marginTop: 16,
  },
});
