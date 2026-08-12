import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useKeepAwake } from 'expo-keep-awake';
import {
  currentPhase,
  eventAt,
  eventShortLabel,
  nextEvent,
  sunCoverage,
  type EclipseEvent,
  type LocalEclipse,
} from '../../lib/eclipse';
import { fmtDurCompact, fmtHM, fmtHMS } from '../../lib/format';
import { t, type I18nKey } from '../../lib/i18n';
import { Countdown } from '../Countdown';
import { CoronaHero, type HeroLook } from '../mode/CoronaHero';
import { EclipseTimeline, totalSpanLabel } from '../mode/EclipseTimeline';
import { C, F } from '../theme';

const WARM = '#FFF7E6';
const FAINT = '#55525F';

/** Segundos a los que el crono pasa a dos dígitos gigantes: quitarse o ponerse las gafas
 *  se juega al segundo, y ahí sobra todo lo demás en pantalla. */
const IMMINENT_C2_SEC = 60;
/** C3 cae dentro de una totalidad que puede durar poco más de un minuto: avisar con 60 s
 *  se comería el rótulo de TOTALIDAD entero. 15 s = la misma antelación del aviso sonoro. */
const IMMINENT_C3_SEC = 15;

/** Color del rótulo del crono según a qué hito apunta. */
const KICKER: Record<EclipseEvent['key'], string> = {
  C1: C.coronaLight,
  C2: C.violet,
  MAX: C.violet,
  C3: C.danger,
  C4: C.coronaLight,
};

/** Color de lo que pasa DESPUÉS del hito; no coincide con EVENT_ACCENT (tras C1 hay peligro). */
const AFTER_COLOR: Record<string, string> = {
  C1: C.danger,
  C2: C.totality,
  MAX: C.totality,
  C3: C.danger,
  C4: C.corona,
};

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <Text style={s.clock}>{fmtHMS(now)}</Text>;
}

/** Punto que parpadea: el estado de seguridad se lee de reojo, sin enfocar la pantalla. */
function Pulse({ color, fast }: { color: string; fast?: boolean }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const half = fast ? 400 : 700;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.25, duration: half, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, fast]);
  return <Animated.View style={[s.pulse, { backgroundColor: color, shadowColor: color, opacity: v }]} />;
}

interface EclipseModeScreenProps {
  eclipse: LocalEclipse;
  place: string;
  now: Date;
  /** Texto del modo de prueba (DEMO/SIMULACRO); null = eclipse real */
  exitLabel: string | null;
  /** Cierra la pantalla: sale del ensayo, o deja el modo real hasta la totalidad */
  onExit: () => void;
  /** Salto de fase tocando un hito; null = deshabilitado (eclipse real/demo) */
  onJumpToEvent: ((key: EclipseEvent['key']) => void) | null;
  /**
   * km entre tu GPS y el puesto del que salen ESTAS horas; null = sin discrepancia.
   * Es el dato que decide si el crono que tienes delante describe dónde estás.
   */
  divergenceKm: number | null;
  /** Hace de tu posición el puesto: recalcula cronología, nubes y alertas a la vez */
  onRecalcHere: () => void;
}

export function EclipseModeScreen({
  eclipse,
  place,
  now,
  exitLabel,
  onExit,
  onJumpToEvent,
  divergenceKm,
  onRecalcHere,
}: EclipseModeScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const tms = now.getTime();
  const c1 = eventAt(eclipse, 'C1');
  const c3 = eventAt(eclipse, 'C3');
  const c4 = eventAt(eclipse, 'C4');
  const max = eventAt(eclipse, 'MAX');
  const started = !!c1 && tms >= c1.time.getTime();
  const finished = !!c4 && tms >= c4.time.getTime();
  const inTotality = currentPhase(eclipse, now)?.safeToLook === true;
  // Durante la totalidad el hito que importa es su FIN, no el máximo que hay por medio
  const target = inTotality && c3 ? c3 : nextEvent(eclipse, now);
  const toTargetSec = target ? (target.time.getTime() - tms) / 1000 : Infinity;
  const imminent =
    (target?.key === 'C2' && toTargetSec <= IMMINENT_C2_SEC) ||
    (target?.key === 'C3' && toTargetSec <= IMMINENT_C3_SEC);
  const afterTotality = !!c3 && tms >= c3.time.getTime() && !finished;

  const hero: HeroLook = finished
    ? { sky: ['#12121C', '#08080C', '#000'], opacity: 0.3, scale: 1.35, motion: 'drift' }
    : inTotality
      ? { sky: ['#2E2560', '#0A0814', '#000'], opacity: 1, scale: 1.5, motion: 'breathe' }
      : imminent
        ? { sky: ['#241A4E', '#09070F', '#000'], opacity: 0.8, scale: 1.35, motion: 'breathe' }
        : afterTotality
          ? { sky: ['#2E1216', '#0B0710', '#000'], opacity: 0.55, scale: 1.35, motion: 'drift' }
          : started
            ? { sky: ['#2A1220', '#0B0710', '#000'], opacity: 0.62, scale: 1.35, motion: 'drift' }
            : { sky: ['#1A1438', '#08070E', '#000'], opacity: 0.9, scale: 1.35, motion: 'drift' };

  // El crono no puede desbordar en pantallas estrechas ni con formato «1d 01:23:42»
  const chronoSize = imminent
    ? Math.min(168, Math.round(width * 0.4))
    : Math.min(112, Math.round(width * 0.26));
  const covered = sunCoverage(eclipse, now);
  const after = target
    ? { label: t(`mode.after.${target.key}` as I18nKey), color: AFTER_COLOR[target.key] ?? C.corona }
    : null;

  const at = target ? t('mode.meta.at', { time: fmtHMS(target.time) }) : '';
  const meta =
    !target || imminent
      ? null
      : inTotality
        ? `${at} · ${
            max && tms >= max.time.getTime()
              ? t('mode.meta.maxPast')
              : t('mode.meta.maxAt', { time: max ? fmtHM(max.time) : '--:--' })
          }`
        : started && covered !== null
          ? `${at} · ${t('mode.meta.covered', { pct: Math.round(covered * 100) })}`
          : `${at} · ${t('mode.meta.dur', { dur: totalSpanLabel(eclipse) })}`;

  return (
    <View style={s.root}>
      <CoronaHero look={hero} />

      {/* Ensayo: filo violeta permanente para no confundirlo con el eclipse real */}
      {exitLabel && <View style={[s.drillEdge, { top: insets.top }]} pointerEvents="none" />}

      <LinearGradient
        colors={['rgba(0,0,0,0.92)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0)']}
        style={[s.topFade, { height: insets.top + 92 }]}
        pointerEvents="none"
      />
      <View style={[s.topRow, { paddingTop: insets.top + 14 }]}>
        <View style={s.topLeft}>
          <Clock />
          <Text style={[s.tag, finished && { color: C.dim }]} numberOfLines={1}>
            {exitLabel
              ? t('mode.tagDrill', { label: exitLabel.toUpperCase(), place: place.toUpperCase() })
              : t('mode.tag', { place: place.toUpperCase() })}
          </Text>
        </View>
        <Pressable
          onPress={onExit}
          hitSlop={10}
          style={s.closeHit}
          accessibilityRole="button"
          accessibilityLabel={
            exitLabel ? t('mode.exitA11y', { label: exitLabel.toLowerCase() }) : t('mode.exitReal.a11y')
          }
        >
          <View style={[s.close, inTotality && s.closeQuiet]}>
            <Text style={[s.closeTxt, inTotality && { color: FAINT }]}>✕</Text>
          </View>
        </Pressable>
      </View>

      {/* Encima de todo a propósito: si las horas no son las de donde estás, eso invalida
          el resto de la pantalla. Un toque lo arregla de raíz — pasa el puesto a tu
          posición, así que cronología, nubes y alertas vuelven a contar lo mismo. */}
      {divergenceKm !== null && (
        <Pressable style={s.diverge} onPress={onRecalcHere} accessibilityRole="button">
          <Text style={s.divergeTxt}>{t('mode.diverge', { km: Math.round(divergenceKm), place })}</Text>
          <Text style={s.divergeCta}>{t('map.recalc')}</Text>
        </Pressable>
      )}

      <View style={s.stage}>
        {finished ? (
          <>
            <Text style={s.kicker}>{t('mode.done.kicker')}</Text>
            <Text style={s.doneTitle}>{t('mode.banner.done')}</Text>
            <Text style={s.doneSub}>{t('mode.banner.doneSub')}</Text>
            <View style={s.stats}>
              {eclipse.totalityDurationSec !== null && (
                <View>
                  <Text style={s.statKey}>{t('mode.done.totalitySeen')}</Text>
                  <Text style={s.statVal}>{fmtDurCompact(eclipse.totalityDurationSec)}</Text>
                </View>
              )}
              <View>
                <Text style={s.statKey}>{t('mode.done.total')}</Text>
                <Text style={s.statVal}>{totalSpanLabel(eclipse)}</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            {inTotality ? (
              <View style={s.statusRow}>
                <View style={s.totalityRing} />
                <View>
                  <Text style={s.totalityTitle}>{t('mode.banner.totality')}</Text>
                  <Text style={s.totalitySub}>{t('mode.banner.totalitySub')}</Text>
                </View>
              </View>
            ) : (
              <View style={s.statusRow}>
                <Pulse color={started ? C.danger : C.corona} fast={imminent} />
                <Text style={[s.statusTitle, started && { color: C.danger }]}>
                  {imminent
                    ? t('mode.status.stillGlasses')
                    : started
                      ? t('mode.banner.partial')
                      : t('mode.banner.ready')}
                </Text>
                {!imminent && (
                  <Text style={s.statusSub}>
                    {started ? t('mode.status.partialSub') : t('mode.status.readySub')}
                  </Text>
                )}
              </View>
            )}

            {target && (
              <>
                <Text style={[s.kicker, { color: KICKER[target.key] }]}>
                  {t(`mode.next.${target.key}` as I18nKey)}
                </Text>
                <Countdown
                  target={target.time}
                  format={imminent ? 'ss' : toTargetSec < 3600 ? 'mmss' : 'auto'}
                  style={[
                    s.chrono,
                    {
                      fontSize: chronoSize,
                      lineHeight: Math.round(chronoSize * 0.94),
                      textShadowColor: inTotality
                        ? 'rgba(255,247,230,0.35)'
                        : target.key === 'C2'
                          ? 'rgba(124,108,255,0.45)'
                          : 'rgba(255,184,77,0.32)',
                    },
                  ]}
                />
              </>
            )}
            {imminent && target && <Text style={s.warn}>{t(`mode.warn.${target.key}` as I18nKey)}</Text>}
            {meta && <Text style={s.meta}>{meta}</Text>}
          </>
        )}
      </View>

      <View style={[s.footer, { paddingBottom: Math.max(14, insets.bottom) }]}>
        <EclipseTimeline eclipse={eclipse} now={now} />

        {onJumpToEvent && (
          <View style={s.jumpRow}>
            {eclipse.events.map((e) => (
              <Pressable
                key={e.key}
                onPress={() => onJumpToEvent(e.key)}
                hitSlop={8}
                style={s.jumpChip}
                accessibilityRole="button"
                accessibilityLabel={t('mode.railJumpA11y', { label: t(`event.${e.key}` as I18nKey) })}
              >
                <Text style={s.jumpTxt}>{eventShortLabel(e.key)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {finished ? (
          <Pressable style={s.doneExit} onPress={onExit} accessibilityRole="button">
            <Text style={s.doneExitTxt}>{t('mode.done.exit')}</Text>
            <Text style={s.doneExitX}>✕</Text>
          </Pressable>
        ) : (
          target &&
          after && (
            <View
              style={[s.afterCard, { borderColor: `${after.color}66`, backgroundColor: `${after.color}1F` }]}
            >
              <View>
                <Text style={s.afterKicker}>{t('mode.after')}</Text>
                <Text style={[s.afterLabel, { color: after.color }]}>{after.label}</Text>
              </View>
              <Text style={s.afterTime}>{fmtHMS(target.time)}</Text>
            </View>
          )
        )}

        <Text style={s.awakeNote}>{finished ? t('mode.done.sleep') : t('mode.keepAwake')}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topLeft: { flex: 1, gap: 4 },
  clock: { fontFamily: F.medium, fontSize: 12.5, color: C.text, fontVariant: ['tabular-nums'] },
  tag: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2.4, color: C.violet },
  closeHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
    marginTop: -5,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(21,21,30,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeQuiet: { backgroundColor: 'rgba(21,21,30,0.6)' },
  closeTxt: { fontFamily: F.medium, fontSize: 15, color: C.dim, lineHeight: 18 },
  drillEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: C.violet,
    opacity: 0.9,
    zIndex: 5,
  },
  diverge: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.55)',
    backgroundColor: 'rgba(255,107,94,0.14)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  divergeTxt: { fontFamily: F.semibold, fontSize: 13, lineHeight: 18, color: C.text },
  divergeCta: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.2, color: C.danger },
  stage: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 24,
    minHeight: 0,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // Nada de `elevation` en los adornos: Android la pinta como sombra de caja —dentro del
  // anillo de TOTALIDAD salía un disco negro—. El resplandor queda solo en iOS.
  pulse: { width: 8, height: 8, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 6 },
  statusTitle: { fontFamily: F.bold, fontSize: 16, letterSpacing: 1.4, color: C.text },
  statusSub: { fontFamily: F.semibold, fontSize: 10.5, letterSpacing: 1.6, color: C.dim, flexShrink: 1 },
  totalityRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: WARM,
    shadowColor: WARM,
    shadowOpacity: 0.7,
    shadowRadius: 12,
  },
  totalityTitle: { fontFamily: F.bold, fontSize: 26, letterSpacing: 2, color: C.text },
  totalitySub: { fontFamily: F.bold, fontSize: 12, letterSpacing: 2, color: WARM, marginTop: 4 },
  kicker: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 3.2,
    color: C.coronaLight,
    marginTop: 18,
  },
  chrono: {
    fontFamily: F.bold,
    letterSpacing: -4,
    color: C.text,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
    textShadowRadius: 45,
  },
  warn: {
    fontFamily: F.semibold,
    fontSize: 12,
    letterSpacing: 1.4,
    color: C.text,
    marginTop: 10,
    lineHeight: 17,
  },
  meta: {
    fontFamily: F.semibold,
    fontSize: 12,
    letterSpacing: 1.4,
    color: C.dim,
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },
  doneTitle: { fontFamily: F.bold, fontSize: 52, letterSpacing: 1, color: C.text, marginTop: 12 },
  doneSub: { fontFamily: F.semibold, fontSize: 13, letterSpacing: 1.8, color: C.dim, marginTop: 12 },
  stats: { flexDirection: 'row', gap: 26, marginTop: 26 },
  statKey: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 1.8, color: FAINT },
  statVal: { fontFamily: F.bold, fontSize: 20, color: C.text, marginTop: 4, fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: 20 },
  jumpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 14 },
  jumpChip: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,108,255,0.45)',
    backgroundColor: 'rgba(124,108,255,0.12)',
    borderRadius: 999,
    paddingVertical: 7,
  },
  jumpTxt: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1, color: C.violet },
  afterCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 18,
    marginTop: 16,
  },
  afterKicker: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2.2, color: C.dim },
  afterLabel: { fontFamily: F.bold, fontSize: 18, marginTop: 5 },
  afterTime: { fontFamily: F.semibold, fontSize: 16, color: C.text, fontVariant: ['tabular-nums'] },
  doneExit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 18,
    marginTop: 16,
  },
  doneExitTxt: { fontFamily: F.bold, fontSize: 14, letterSpacing: 1.2, color: C.text },
  doneExitX: { fontFamily: F.medium, fontSize: 15, color: C.dim },
  awakeNote: {
    textAlign: 'center',
    fontFamily: F.medium,
    fontSize: 10,
    letterSpacing: 1.6,
    color: FAINT,
    paddingTop: 12,
  },
});
