import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { nextEvent, type LocalEclipse } from '../../lib/eclipse';
import { bearingLabel, type TotalityDirection } from '../../lib/totality';
import { Countdown } from '../Countdown';
import { C, F } from '../theme';

const SHEET_MIN = 236;
const SHEET_MAX = 560;
const SHEET_SNAP_THRESHOLD = 380;

/** Ancla visual bajo la banda (guía / escala de distancia). */
const BAND_ANCHOR = 0.355;
/** Punto sobre la banda cuando hay totalidad. */
const DOT_TOTAL = 0.26;
/** Casi en el borde de la banda (pocos km). */
const DOT_NEAR = 0.34;
/** Lo más lejos que cabe en el diagrama (sobre el pill de estado). */
const DOT_FAR = 0.56;
/** km que mapean a DOT_FAR; más allá se satura. */
const DIST_SCALE_KM = 200;

const EVENT_ACCENT: Record<string, string> = {
  C1: C.corona,
  C2: C.totality,
  MAX: C.totality,
  C3: C.danger,
  C4: C.corona,
};

interface MapScreenProps {
  eclipse: LocalEclipse;
  /** Puesto deseado (cálculos) */
  place: string;
  /** Etiqueta GPS real si difiere del puesto; null = misma ubicación o sin GPS */
  realPlace: string | null;
  /** El puesto activo es un snapshot GPS */
  spotIsGps: boolean;
  cloudPct: number | null;
  totality: TotalityDirection | 'none' | null;
  now: Date;
  onOpenSelector: () => void;
  onOpenMaps: () => void;
  /** km entre GPS real y spot activo el día del eclipse; null = sin aviso */
  divergenceKm: number | null;
  onRecalcHere: () => void;
}

const fmtHM = (d: Date) =>
  d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** Fracción vertical del punto: más cerca de la banda cuanto menor sea la distancia. */
function dotTopFraction(isTotal: boolean, totality: TotalityDirection | 'none' | null): number {
  if (isTotal) return DOT_TOTAL;
  if (totality === null || totality === 'none') return DOT_FAR;
  const t = Math.min(1, totality.distanceKm / DIST_SCALE_KM);
  return DOT_NEAR + t * (DOT_FAR - DOT_NEAR);
}

function useSheet() {
  const height = useRef(new Animated.Value(SHEET_MIN)).current;
  const current = useRef(SHEET_MIN);
  useEffect(() => {
    const id = height.addListener(({ value }) => {
      current.current = value;
    });
    return () => height.removeListener(id);
  }, [height]);

  const snapTo = (v: number) =>
    Animated.spring(height, { toValue: v, useNativeDriver: false, bounciness: 6 }).start();

  const startH = useRef(SHEET_MIN);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        height.stopAnimation();
        startH.current = current.current;
      },
      onPanResponderMove: (_e, g) => {
        height.setValue(Math.min(SHEET_MAX, Math.max(SHEET_MIN, startH.current - g.dy)));
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dy) < 6) {
          snapTo(startH.current > SHEET_SNAP_THRESHOLD ? SHEET_MIN : SHEET_MAX);
        } else {
          snapTo(startH.current - g.dy > SHEET_SNAP_THRESHOLD ? SHEET_MAX : SHEET_MIN);
        }
      },
    }),
  ).current;

  return { height, pan };
}

function UserDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 2400, useNativeDriver: true }),
    ).start();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  return (
    <View style={s.dotWrap}>
      <Animated.View style={[s.dotRing, { transform: [{ scale }], opacity }]} />
      <View style={s.dot} />
    </View>
  );
}

export function MapScreen({
  eclipse,
  place,
  realPlace,
  spotIsGps,
  cloudPct,
  totality,
  now,
  onOpenSelector,
  onOpenMaps,
  divergenceKm,
  onRecalcHere,
}: MapScreenProps) {
  const { height, pan } = useSheet();
  const isTotal = eclipse.kind === 'total';
  const upcoming = nextEvent(eclipse, now);
  const maxEvent = eclipse.events.find((e) => e.key === 'MAX');
  const [sunHint] = useState(() =>
    maxEvent && maxEvent.altitude > 0
      ? `El sol estará a ${maxEvent.altitude.toFixed(0)}° sobre el horizonte oeste durante el máximo.`
      : 'El sol estará muy bajo: busca horizonte oeste totalmente despejado.',
  );

  const bandDuration = isTotal
    ? eclipse.totalityDurationSec
    : totality !== null && totality !== 'none'
      ? totality.durationSec
      : null;

  const cloud =
    cloudPct === null
      ? { color: C.dim, label: 'SIN DATOS' }
      : cloudPct < 25
        ? { color: C.ok, label: `${cloudPct}% NUBES` }
        : cloudPct < 60
          ? { color: C.corona, label: `${cloudPct}% NUBES` }
          : { color: C.danger, label: `${cloudPct}% NUBES` };

  const obscuracion = (eclipse.obscuration * 100).toFixed(1).replace('.', ',');
  const dotFrac = dotTopFraction(isTotal, totality);
  const guideHeightFrac = Math.max(0, dotFrac - BAND_ANCHOR);

  return (
    <View style={s.root}>
      {/* Fondo + costa esquemática */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 390 780" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="bgGlow" cx="75%" cy="12%" r="90%">
            <Stop offset="0%" stopColor="#12121C" />
            <Stop offset="55%" stopColor={C.bg} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={390} height={780} fill="url(#bgGlow)" />
        <Path
          d="M0 130 H390 M0 260 H390 M0 390 H390 M0 520 H390 M78 0 V780 M156 0 V780 M234 0 V780 M312 0 V780"
          stroke="#191926"
          strokeWidth={1}
        />
        <Path
          d="M-20 560 C 60 520, 120 585, 205 545 S 350 585, 410 540 L 410 800 L -20 800 Z"
          fill="#101019"
          stroke="#1D1D2C"
          strokeWidth={1}
        />
        <Path
          d="M-20 250 C 80 215, 170 265, 260 230 S 380 250, 420 225"
          fill="none"
          stroke="#1D1D2C"
          strokeWidth={1.5}
        />
      </Svg>

      {/* Banda de totalidad */}
      <View style={s.band}>
        <LinearGradient
          colors={[
            'transparent',
            'rgba(124,108,255,0.10)',
            'rgba(124,108,255,0.20)',
            'rgba(255,184,77,0.16)',
            'rgba(124,108,255,0.20)',
            'rgba(124,108,255,0.10)',
            'transparent',
          ]}
          locations={[0, 0.22, 0.4, 0.5, 0.6, 0.78, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.bandLine} />
        <Text style={s.bandLabel}>BANDA DE TOTALIDAD · 12 AGO 2026</Text>
      </View>

      {/* Guía hacia la banda (solo parcial): longitud = hueco hasta el punto */}
      {!isTotal && totality !== null && totality !== 'none' && guideHeightFrac > 0.02 && (
        <View
          style={[
            s.guide,
            {
              top: `${BAND_ANCHOR * 100}%`,
              height: `${guideHeightFrac * 100}%`,
            },
          ]}
        />
      )}

      {/* Estado: en banda o distancia a totalidad — encima de la hoja */}
      {isTotal ? (
        <View style={s.statusWrap}>
          <View style={[s.statusPill, { borderColor: 'rgba(124,108,255,0.6)' }]}>
            <Text style={[s.pillText, { color: C.violet }]} numberOfLines={1}>
              ESTÁS EN LA BANDA DE TOTALIDAD
            </Text>
          </View>
        </View>
      ) : totality !== null && totality !== 'none' ? (
        <View style={s.statusWrap}>
          <View style={s.statusPill}>
            <Text style={s.pillText} numberOfLines={1}>
              a <Text style={{ color: C.corona }}>{totality.distanceKm} km al {bearingLabel(totality.bearingDeg)}</Text>
              {' '}verías el <Text style={{ color: C.violet }}>TOTAL</Text>
            </Text>
          </View>
        </View>
      ) : null}

      <View style={[s.userArea, { top: `${dotFrac * 100}%` }]}>
        <UserDot />
        <Text style={s.userLabel}>{spotIsGps ? 'TU POSICIÓN' : 'PUESTO'}</Text>
      </View>

      {/* Overlay superior: chips + lugares + aviso divergencia */}
      <View style={s.topOverlay} pointerEvents="box-none">
        <View style={s.chipsRow} pointerEvents="box-none">
          <View style={s.chipGroup}>
            <Pressable style={s.chipLocation} onPress={onOpenSelector}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.corona} strokeWidth={2.4}>
                <Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              </Svg>
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Text style={s.chipText} numberOfLines={1}>
                  {place}
                </Text>
                {realPlace !== null && <Text style={s.chipReal}>Tú: {realPlace}</Text>}
              </View>
              <Text style={s.chipChevron}>▾</Text>
            </Pressable>
            <Pressable style={s.chipMaps} onPress={onOpenMaps} hitSlop={6}>
              <Text style={s.chipMapsText}>MAPS</Text>
            </Pressable>
          </View>
          <View style={s.chipNorth}>
            <Text style={s.chipNorthText}>N</Text>
          </View>
        </View>
        {divergenceKm !== null && (
          <View style={s.divergence}>
            <Text style={s.divergenceText}>
              Estás a {Math.round(divergenceKm)} km de tu puesto de observación
            </Text>
            <Text style={s.divergenceAction} onPress={onRecalcHere}>
              RECALCULAR AQUÍ →
            </Text>
          </View>
        )}
      </View>

      {/* Hoja inferior */}
      <Animated.View style={[s.sheet, { height }]}>
        <View {...pan.panHandlers} style={s.handleArea}>
          <View style={s.handle} />
          <Text style={s.sheetKicker}>
            {upcoming ? `${upcoming.label.toUpperCase()} · ${upcoming.key} EN` : 'ECLIPSE FINALIZADO'}
          </Text>
          {upcoming && <Countdown target={upcoming.time} style={s.sheetCountdown} />}
        </View>
        <ScrollView style={s.sheetBody} showsVerticalScrollIndicator={false}>
          <View style={s.statsRow}>
            <View style={s.stat}>
              <Text style={s.statValue}>{obscuracion}%</Text>
              <Text style={s.statLabel}>OCULTO AQUÍ</Text>
            </View>
            <View style={s.stat}>
              <Text style={[s.statValue, { color: C.violet }]}>
                {bandDuration != null ? `${Math.floor(bandDuration / 60)}m ${bandDuration % 60}s` : '—'}
              </Text>
              <Text style={s.statLabel}>EN LA BANDA</Text>
            </View>
            <View style={[s.cloudChip, { borderColor: cloud.color + '66' }]}>
              <View style={[s.cloudDot, { backgroundColor: cloud.color, shadowColor: cloud.color }]} />
              <Text style={s.cloudText}>{cloud.label}</Text>
            </View>
          </View>
          <View style={s.divider} />
          <Text style={s.cronoTitle}>CRONOLOGÍA LOCAL · 12 AGO</Text>
          {eclipse.events.map((e) => (
            <View key={e.key} style={s.cronoRow}>
              <Text style={[s.cronoLabel, e.time <= now && { color: C.dim }]}>
                <Text style={{ color: EVENT_ACCENT[e.key] }}>{e.key === 'MAX' ? 'MÁX' : e.key}</Text>
                {'  '}
                {e.label}
              </Text>
              <Text style={s.cronoTime}>{fmtHM(e.time)}</Text>
            </View>
          ))}
          <Text style={s.hint}>Arrastra la hoja para ver más. {sunHint}</Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
  band: {
    position: 'absolute',
    top: '16%',
    left: '-32%',
    width: '164%',
    height: 200,
    transform: [{ rotate: '-13deg' }],
  },
  bandLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 3,
    marginTop: -1,
    backgroundColor: C.corona,
    shadowColor: C.corona,
    shadowOpacity: 0.45,
    shadowRadius: 13,
    elevation: 8,
  },
  bandLabel: {
    position: 'absolute',
    alignSelf: 'center',
    top: 14,
    fontFamily: F.semibold,
    fontSize: 10,
    letterSpacing: 3,
    color: C.violet,
  },
  guide: {
    position: 'absolute',
    left: '50%',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(242,239,233,0.32)',
    borderStyle: 'dashed',
  },
  statusWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: SHEET_MIN + 36,
    alignItems: 'center',
  },
  statusPill: {
    maxWidth: '100%',
    backgroundColor: 'rgba(21,21,30,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.5)',
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: { fontFamily: F.semibold, fontSize: 12, color: C.text, textAlign: 'center' },
  userArea: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 10 },
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dotRing: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: C.text,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.text,
    shadowColor: C.text,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  userLabel: { fontFamily: F.medium, fontSize: 11, letterSpacing: 1, color: C.dim },
  topOverlay: { position: 'absolute', top: 44, left: 0, right: 0, gap: 12 },
  chipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  divergence: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,107,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.5)',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  divergenceText: { fontFamily: F.semibold, fontSize: 13, color: C.text },
  divergenceAction: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1, color: C.danger },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  chipLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 99,
    paddingHorizontal: 16,
    paddingVertical: 9,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 240,
  },
  chipText: { fontFamily: F.semibold, fontSize: 13, color: C.text },
  chipReal: { fontFamily: F.medium, fontSize: 10, color: C.dim, marginTop: 1 },
  chipChevron: { fontFamily: F.semibold, fontSize: 12, color: C.dim, marginLeft: 2 },
  chipMaps: {
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipMapsText: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1, color: C.dim },
  chipNorth: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipNorthText: { fontFamily: F.bold, fontSize: 13, color: C.dim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(21,21,30,0.97)',
    borderTopWidth: 1,
    borderTopColor: C.border,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  handleArea: { paddingHorizontal: 24, paddingBottom: 4 },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: C.knobTrack,
    marginTop: 12,
    marginBottom: 10,
  },
  sheetKicker: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim },
  sheetCountdown: {
    fontFamily: F.bold,
    fontSize: 54,
    lineHeight: 58,
    color: C.corona,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    marginTop: 2,
    textShadowColor: 'rgba(255,184,77,0.35)',
    textShadowRadius: 24,
  },
  sheetBody: { paddingHorizontal: 24 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'center' },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: F.bold, fontSize: 22, color: C.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: F.medium, fontSize: 10, letterSpacing: 1.5, color: C.dim },
  cloudChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(11,11,16,0.7)',
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  cloudDot: { width: 9, height: 9, borderRadius: 5, shadowOpacity: 1, shadowRadius: 4, elevation: 4 },
  cloudText: { fontFamily: F.semibold, fontSize: 12, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 20 },
  cronoTitle: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.dim,
    paddingBottom: 4,
  },
  cronoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(38,38,58,0.5)',
  },
  cronoLabel: { fontFamily: F.semibold, fontSize: 14, color: C.text },
  cronoTime: { fontFamily: F.medium, fontSize: 14, color: C.dim, fontVariant: ['tabular-nums'] },
  hint: { fontFamily: F.regular, fontSize: 12, lineHeight: 18, color: C.dim, marginVertical: 14 },
});
