import { useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePulseOpacity } from '../../lib/anim';
import { barLayout, type BarPart } from '../../lib/eclipseBar';
import { eventAt, type EclipseEvent, type LocalEclipse } from '../../lib/eclipse';
import { fmtDurCompact, fmtDurHM, fmtHM } from '../../lib/format';
import { t } from '../../lib/i18n';
import { C, F } from '../theme';

/** Duración total de la serie en ms; null si le faltan contactos. */
function spanMs(c1?: EclipseEvent, c4?: EclipseEvent): number | null {
  return c1 && c4 ? c4.time.getTime() - c1.time.getTime() : null;
}

/** Etiqueta «1h 48m» de la serie completa, para el bloque de datos de la pantalla. */
export function totalSpanLabel(eclipse: LocalEclipse): string {
  const ms = spanMs(eventAt(eclipse, 'C1'), eventAt(eclipse, 'C4'));
  return fmtDurHM(Math.round((ms ?? 0) / 1000));
}

/** Tramo parcial: rojo que sube hacia la totalidad, como en el diseño. */
function PartialLeg({ part, toward }: { part: BarPart; toward: 'right' | 'left' }) {
  const colors =
    toward === 'right'
      ? (['rgba(255,107,94,0.35)', 'rgba(255,107,94,0.7)'] as const)
      : (['rgba(255,107,94,0.7)', 'rgba(255,107,94,0.3)'] as const);
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={[
        s.leg,
        { left: part.left, width: part.width },
        toward === 'right' ? s.legStart : s.legEnd,
      ]}
    />
  );
}

interface Props {
  eclipse: LocalEclipse;
  now: Date;
}

/**
 * La serie entera en una barra a escala real: cuánto parcial antes, la astilla de
 * totalidad y cuánto parcial después. Lo que aún no ha pasado va velado, así que de un
 * vistazo se ve dónde estás dentro del evento sin leer una sola hora.
 */
export function EclipseTimeline({ eclipse, now }: Props) {
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => barLayout(eclipse, width), [eclipse, width]);

  const tms = now.getTime();
  // El punto late mientras el evento corre y se queda quieto al acabar: es el «estás aquí»
  const finishedAt = eventAt(eclipse, 'C4')?.time.getTime();
  const dotOpacity = usePulseOpacity(800, finishedAt === undefined || tms < finishedAt);
  const c1 = eventAt(eclipse, 'C1');
  const c2 = eventAt(eclipse, 'C2');
  const c3 = eventAt(eclipse, 'C3');
  const c4 = eventAt(eclipse, 'C4');
  const inTotality = !!c2 && !!c3 && tms >= c2.time.getTime() && tms < c3.time.getTime();
  const totalityDone = !!c3 && tms >= c3.time.getTime();
  const finished = !!c4 && tms >= c4.time.getTime();
  const spanMin = Math.round((spanMs(c1, c4) ?? 0) / 60_000);

  const x = layout ? layout.xAt(tms) : 0;

  // Etiqueta de la astilla: anuncia la totalidad, luego marca dónde estás, luego la recuerda
  const markLabel = !c2
    ? t('mode.bar.max', { pct: Math.round(eclipse.obscuration * 100) })
    : inTotality && c3
      ? t('mode.bar.here', {
          dur: fmtDurCompact(Math.max(0, Math.round((c3.time.getTime() - tms) / 1000))),
        })
      : totalityDone && !finished
        ? t('mode.bar.seen')
        : t('mode.bar.totality', { dur: fmtDurCompact(eclipse.totalityDurationSec ?? 0) });
  const markColor = finished ? C.dim : totalityDone && !inTotality ? C.faint : C.warm;

  const inMin = c1 && c2 ? Math.round((c2.time.getTime() - c1.time.getTime()) / 60_000) : spanMin;
  const outMin = c3 && c4 ? Math.round((c4.time.getTime() - c3.time.getTime()) / 60_000) : spanMin;
  const leftDone = c2 ? tms >= c2.time.getTime() : finished;
  const leftSub = leftDone ? t('mode.bar.done') : t('mode.bar.glassesFor', { min: inMin });
  const rightSub = finished
    ? t('mode.bar.done')
    : totalityDone && c4
      ? t('mode.bar.glassesLeft', {
          min: Math.max(1, Math.round((c4.time.getTime() - tms) / 60_000)),
        })
      : t('mode.bar.glassesFor', { min: outMin });

  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      <View style={s.markRow}>
        {layout && (
          <View style={[s.markBox, { left: layout.markX - 80 }]}>
            <Text style={[s.markTxt, { color: markColor }]} numberOfLines={1}>
              {markLabel}
            </Text>
            <View style={[s.markTick, { backgroundColor: finished || totalityDone ? C.faint : C.warm }]} />
          </View>
        )}
      </View>

      <View style={s.bar}>
        {layout?.parts.map((p) =>
          p.key === 'tot' ? (
            <View
              key={p.key}
              style={[
                s.sliver,
                { left: p.left, width: p.width },
                inTotality && s.sliverLive,
                totalityDone && !finished && s.sliverSpent,
                finished && s.sliverPast,
              ]}
            />
          ) : finished ? (
            <View key={p.key} style={[s.leg, s.legOff, { left: p.left, width: p.width }]} />
          ) : (
            <PartialLeg key={p.key} part={p} toward={p.key === 'out' ? 'left' : 'right'} />
          ),
        )}

        {/* Velo sobre lo que aún no ha ocurrido */}
        {layout && !finished && <View style={[s.veil, { left: x }]} />}
        {/* En totalidad manda la astilla: el marcador ahí solo sería ruido encima */}
        {layout && !inTotality && (
          <View style={[s.now, finished && s.nowPast, { left: x - 1 }]}>
            <Animated.View style={[s.nowDot, finished && s.nowDotPast, { opacity: dotOpacity }]} />
          </View>
        )}
      </View>

      <View style={s.legend}>
        <View style={s.legendCol}>
          <Text style={[s.legendKey, !leftDone && { color: C.danger }]}>
            C1 {c1 ? fmtHM(c1.time) : '--:--'}
          </Text>
          <Text style={[s.legendSub, leftDone && { color: C.faint }]}>{leftSub}</Text>
        </View>
        <View style={[s.legendCol, s.legendRight]}>
          <Text style={[s.legendKey, totalityDone && !finished && { color: C.danger }]}>
            C4 {c4 ? fmtHM(c4.time) : '--:--'}
          </Text>
          <Text style={[s.legendSub, finished && { color: C.faint }]}>{rightSub}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  markRow: { height: 24, justifyContent: 'flex-end', marginBottom: 5 },
  markBox: { position: 'absolute', bottom: 0, width: 160, alignItems: 'center' },
  markTxt: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 1.4 },
  markTick: { width: 1, height: 6, marginTop: 3 },
  bar: { height: 12 },
  leg: {
    position: 'absolute',
    top: 0,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.5)',
  },
  legStart: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  legEnd: { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  legOff: { backgroundColor: 'rgba(139,136,152,0.35)', borderColor: 'rgba(139,136,152,0.4)' },
  // Sin `elevation`: en Android dibuja la sombra del RECTÁNGULO, no un resplandor, y a la
  // astilla la rodeaba de gris sucio. El brillo iOS se queda; Android va a color plano.
  sliver: {
    position: 'absolute',
    top: -3,
    height: 18,
    borderRadius: 2,
    backgroundColor: '#FFFDF7',
    shadowColor: C.warm,
    shadowOpacity: 0.95,
    shadowRadius: 12,
  },
  sliverLive: { top: -6, height: 24, shadowRadius: 18 },
  sliverSpent: { backgroundColor: C.dim, opacity: 0.7, shadowOpacity: 0 },
  sliverPast: { backgroundColor: C.warm, opacity: 0.85, shadowOpacity: 0 },
  veil: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  now: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  nowPast: { backgroundColor: 'rgba(255,255,255,0.6)', shadowOpacity: 0 },
  nowDot: {
    position: 'absolute',
    top: -11,
    left: -3.5,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#fff',
  },
  nowDotPast: { backgroundColor: 'rgba(255,255,255,0.7)' },
  legend: { flexDirection: 'row', marginTop: 7 },
  legendCol: { flex: 1 },
  legendRight: { alignItems: 'flex-end' },
  legendKey: {
    fontFamily: F.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.dim,
    fontVariant: ['tabular-nums'],
  },
  legendSub: { fontFamily: F.semibold, fontSize: 9.5, color: C.dim, marginTop: 3 },
});
