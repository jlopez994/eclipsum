import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useKeepAwake } from 'expo-keep-awake';
import { currentPhase, nextEvent, type EclipseEvent, type LocalEclipse } from '../../lib/eclipse';
import { Countdown } from '../Countdown';
import { C, F } from '../theme';

const NEXT_LABEL: Record<string, string> = {
  C1: 'INICIO PARCIAL (C1) EN',
  C2: 'TOTALIDAD (C2) EN',
  MAX: 'MÁXIMO (MÁX) EN',
  C3: 'FIN DE TOTALIDAD (C3) EN',
  C4: 'FIN DEL ECLIPSE (C4) EN',
};

const AFTER_LABEL: Record<string, { label: string; color: string }> = {
  C1: { label: 'GAFAS PUESTAS', color: C.danger },
  C2: { label: 'TOTALIDAD — sin gafas', color: C.totality },
  MAX: { label: 'Máximo del eclipse', color: C.totality },
  C3: { label: 'GAFAS PUESTAS', color: C.danger },
  C4: { label: 'Fin del eclipse', color: C.corona },
};

const EVENT_ACCENT: Record<string, string> = {
  C1: C.corona,
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
}: {
  eclipse: LocalEclipse;
  now: Date;
  onJump: ((key: EclipseEvent['key']) => void) | null;
}) {
  const nextKey = nextEvent(eclipse, now)?.key;
  const fmt = (d: Date) =>
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <View>
      <View style={s.rail}>
        <View style={s.railLine} />
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
              accessibilityLabel={onJump ? `Saltar a ${e.label}` : e.label}
            >
              <View
                style={[
                  s.railDot,
                  passed && { backgroundColor: accent, borderColor: accent },
                  isNext && { borderColor: accent, width: 14, height: 14, borderRadius: 7, marginTop: -2 },
                ]}
              />
              <Text style={[s.railKey, (passed || isNext) && { color: accent }]}>
                {e.key === 'MAX' ? 'MÁX' : e.key}
              </Text>
              <Text style={[s.railTime, isNext && { color: C.text }]}>{fmt(e.time)}</Text>
            </Pressable>
          );
        })}
      </View>
      {onJump && <Text style={s.railHint}>TOCA UN HITO PARA SALTAR A ESA FASE</Text>}
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
  return (
    <Text style={s.clock}>
      {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </Text>
  );
}

function CoronaRing({ glow, border, inner }: { glow: string; border: string; inner: string }) {
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
      <Svg width={320} height={320} viewBox="0 0 320 320">
        <Defs>
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="52%" stopColor="transparent" />
            <Stop offset="60%" stopColor={glow} />
            <Stop offset="78%" stopColor="transparent" />
          </RadialGradient>
          <RadialGradient id="ringGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="52%" stopColor="transparent" />
            <Stop offset="56%" stopColor={inner} />
            <Stop offset="68%" stopColor="transparent" />
          </RadialGradient>
        </Defs>
        <Circle cx={160} cy={160} r={158} fill="url(#halo)" />
        <Circle cx={160} cy={160} r={150} fill="url(#ringGrad)" />
        <Circle cx={160} cy={160} r={98} fill="#000" stroke={border} strokeWidth={2} />
      </Svg>
    </Animated.View>
  );
}

export function EclipseModeScreen({ eclipse, place, now, exitLabel, onExitDemo, onJumpToEvent }: EclipseModeScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const phase = currentPhase(eclipse, now);
  const upcoming = nextEvent(eclipse, now);
  const inTotality = phase?.safeToLook === true;

  const banner = inTotality
    ? { bg: C.totality, fase: 'TOTALIDAD', sub: 'MIRA SIN GAFAS' }
    : phase
      ? { bg: C.danger, fase: 'GAFAS PUESTAS', sub: 'ECLIPSE PARCIAL EN CURSO' }
      : upcoming
        ? { bg: C.surface, fase: 'PREPÁRATE', sub: 'GAFAS LISTAS · EMPIEZA EN BREVE' }
        : { bg: C.surface, fase: 'FINALIZADO', sub: 'HASTA EL PRÓXIMO ECLIPSE' };

  const ring = inTotality
    ? { glow: 'rgba(255,184,77,0.5)', border: 'rgba(255,216,160,0.85)', inner: 'rgba(255,184,77,0.28)' }
    : { glow: 'rgba(255,107,94,0.32)', border: 'rgba(255,107,94,0.6)', inner: 'rgba(255,107,94,0.22)' };

  const after = upcoming ? AFTER_LABEL[upcoming.key] : null;
  const fmtHMS = (d: Date) =>
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <View style={s.root}>
      <View style={[s.topRow, { paddingTop: insets.top + 14 }]}>
        <Clock />
        {exitLabel ? (
          <Pressable onPress={onExitDemo} hitSlop={10} style={s.exitPill} accessibilityLabel={`Salir del ${exitLabel.toLowerCase()}`}>
            <Text style={s.exitPillTxt}>{exitLabel} · SALIR ✕</Text>
          </Pressable>
        ) : (
          <Text style={s.modeTag}>MODO ECLIPSE · {place.toUpperCase()}</Text>
        )}
      </View>

      <View style={[s.banner, { backgroundColor: banner.bg, shadowColor: banner.bg }]}>
        <Text style={s.bannerFase}>{banner.fase}</Text>
        <Text style={s.bannerSub}>{banner.sub}</Text>
      </View>

      <View style={s.center}>
        <CoronaRing {...ring} />
        {upcoming && (
          <>
            <Text style={s.cdLabel}>{NEXT_LABEL[upcoming.key]}</Text>
            <Countdown
              target={upcoming.time}
              format={upcoming.time.getTime() - now.getTime() < 3_600_000 ? 'mmss' : 'auto'}
              style={[s.chrono, { textShadowColor: inTotality ? 'rgba(124,108,255,0.5)' : 'rgba(255,107,94,0.45)' }]}
            />
          </>
        )}
        {!upcoming && <Text style={s.cdLabel}>ECLIPSE FINALIZADO</Text>}
      </View>

      <View style={s.footer}>
        <EventRail eclipse={eclipse} now={now} onJump={onJumpToEvent} />
        {upcoming && after && (
          <View style={s.nextCard}>
            <View>
              <Text style={s.nextKicker}>DESPUÉS</Text>
              <Text style={[s.nextLabel, { color: after.color }]}>{after.label}</Text>
            </View>
            <Text style={s.nextTime}>{fmtHMS(upcoming.time)}</Text>
          </View>
        )}
        <Text style={s.awakeNote}>LA PANTALLA PERMANECE ENCENDIDA</Text>
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
  railItem: { flex: 1, alignItems: 'center', gap: 4 },
  railDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#3A3A4C',
    backgroundColor: '#0B0B10',
  },
  railKey: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 1, color: C.dim },
  railHint: {
    textAlign: 'center',
    fontFamily: F.medium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: '#55525F',
    marginBottom: 12,
  },
  railTime: { fontFamily: F.medium, fontSize: 9.5, color: C.dim, fontVariant: ['tabular-nums'] },
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
  bannerFase: { fontFamily: F.bold, fontSize: 40, letterSpacing: 2, color: '#FFFFFF' },
  bannerSub: { fontFamily: F.bold, fontSize: 17, letterSpacing: 3, color: 'rgba(255,255,255,0.92)', marginTop: 10 },
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
