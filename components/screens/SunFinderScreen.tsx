import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { cameraBasis, fovFor, project, skyVector, withCompassBearing } from '../../lib/skyProjection';
import { track } from '../../lib/firebase';
import { bearingLabel } from '../../lib/totality';
import { t } from '../../lib/i18n';
import { C, F } from '../theme';

/** Refresco de la orientación: 20 Hz va sobrado y no calienta el móvil. */
const MOTION_INTERVAL_MS = 50;
/**
 * expo-sensors documenta `rotation` en GRADOS, pero algunas versiones han devuelto
 * radianes. En cuanto vemos una magnitud imposible en radianes (>2π) fijamos grados;
 * hasta entonces asumimos radianes. Con el móvil plano ambos dan ~0, así que el
 * criterio se resuelve solo en cuanto lo inclinas — antes de que el error importe.
 */
const RADIAN_CEILING = 7;
/** Por encima de este error declarado (grados) la brújula no es fiable y se avisa. */
const COMPASS_NOISE_DEG = 25;

interface SunFinderScreenProps {
  /** Azimut del sol en el instante buscado, grados horarios desde el norte */
  azimuthDeg: number;
  /** Altura del sol sobre el horizonte, grados */
  altitudeDeg: number;
  /** Hito al que corresponde la posición (p. ej. «MÁXIMO») */
  momentLabel: string;
  /** Hora local del hito */
  momentTime: string;
  onClose: () => void;
}

/**
 * Visor: dibuja sobre la cámara dónde estará el sol en el instante del eclipse.
 * Sirve para elegir sitio —¿me tapa ese árbol?—, NO para observar: la advertencia
 * de seguridad es previa y obligatoria, y se repite en pantalla.
 *
 * Precisión: el magnetómetro ronda ±10-20° (peor cerca de metal) y expo-camera no
 * expone el campo de visión real, así que se estima. La marca cae en la zona correcta,
 * no clavada al grado; por eso el círculo es amplio y el copy dice «aproximada».
 */
export function SunFinderScreen({
  azimuthDeg,
  altitudeDeg,
  momentLabel,
  momentTime,
  onClose,
}: SunFinderScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [accepted, setAccepted] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rotation, setRotation] = useState<{ alpha: number; beta: number; gamma: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [sensorsOff, setSensorsOff] = useState(false);
  const degreeUnits = useRef(false);

  const live = accepted && permission?.granted === true;

  useEffect(() => {
    if (!live) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      if (!(await DeviceMotion.isAvailableAsync())) {
        if (!cancelled) setSensorsOff(true);
        return;
      }
      DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
      sub = DeviceMotion.addListener((d) => {
        if (cancelled || !d.rotation) return;
        const { alpha, beta, gamma } = d.rotation;
        if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
        if (Math.max(Math.abs(alpha), Math.abs(beta), Math.abs(gamma)) > RADIAN_CEILING) {
          degreeUnits.current = true;
        }
        setRotation({ alpha, beta, gamma });
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [live]);

  useEffect(() => {
    if (!live) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      try {
        sub = await Location.watchHeadingAsync((h) => {
          const d = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (cancelled || !Number.isFinite(d)) return;
          setHeading(((d % 360) + 360) % 360);
          setHeadingAccuracy(typeof h.accuracy === 'number' ? h.accuracy : null);
        });
      } catch {
        // sin brújula: el guiñado se queda con el de DeviceMotion (relativo, pero usable)
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [live]);

  useEffect(() => {
    if (live) track('sunfinder_open');
  }, [live]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: Math.round(width), h: Math.round(height) });
  };

  // --- Aviso de seguridad: siempre antes de encender la cámara ---
  if (!accepted) {
    return (
      <View style={[s.gate, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text style={s.gateKicker}>{t('sun.title')}</Text>
        <Text style={s.gateTitle}>{t('sun.warn.title')}</Text>
        <Text style={s.gateBody}>{t('sun.warn.body')}</Text>
        <View style={s.gateActions}>
          <Pressable style={s.gateCta} onPress={() => setAccepted(true)}>
            <Text style={s.gateCtaText}>{t('sun.warn.cta')}</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.gateDismiss}>{t('sun.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- Permiso de cámara ---
  if (!permission?.granted) {
    const denied = permission !== null && !permission.canAskAgain;
    return (
      <View style={[s.gate, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text style={s.gateKicker}>{t('sun.title')}</Text>
        <Text style={s.gateBody}>{denied ? t('sun.perm.denied') : t('sun.perm.body')}</Text>
        <View style={s.gateActions}>
          {!denied && (
            <Pressable style={s.gateCta} onPress={() => void requestPermission()}>
              <Text style={s.gateCtaText}>{t('sun.perm.cta')}</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.gateDismiss}>{t('sun.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Sol bajo el horizonte en ese instante: no hay nada que señalar y decirlo es la
  // única respuesta honesta — una marca bajo el suelo haría creer que se verá algo.
  if (altitudeDeg <= 0) {
    return (
      <View style={[s.gate, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text style={s.gateKicker}>{t('sun.title')}</Text>
        <Text style={s.gateBody}>{t('sun.below')}</Text>
        <View style={s.gateActions}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.gateDismiss}>{t('sun.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- Visor ---
  const toDeg = degreeUnits.current ? 1 : 180 / Math.PI;
  const basis =
    rotation === null
      ? null
      : (() => {
          const b = cameraBasis(rotation.alpha * toDeg, rotation.beta * toDeg, rotation.gamma * toDeg);
          // El compás manda en el rumbo: en Android el alpha de DeviceMotion es relativo
          return heading === null ? b : withCompassBearing(b, heading);
        })();

  const shot =
    basis !== null && size.w > 0
      ? project(skyVector(azimuthDeg, altitudeDeg), basis, fovFor(size.w, size.h))
      : null;

  // Normalizado (−1..1, y hacia arriba) → píxeles (y hacia abajo)
  const markerX = shot ? size.w / 2 + (shot.x * size.w) / 2 : 0;
  const markerY = shot ? size.h / 2 - (shot.y * size.h) / 2 : 0;
  const noisyCompass = headingAccuracy !== null && headingAccuracy > COMPASS_NOISE_DEG;

  return (
    <View style={s.root} onLayout={onLayout}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      {shot?.inFrame && (
        <>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Círculo amplio: la marca señala una zona, no un punto */}
            <Circle cx={markerX} cy={markerY} r={54} stroke={C.corona} strokeWidth={2} fill="none" />
            <Circle
              cx={markerX}
              cy={markerY}
              r={54}
              stroke={C.corona}
              strokeWidth={10}
              fill="none"
              opacity={0.14}
            />
            <Line x1={markerX - 74} y1={markerY} x2={markerX - 60} y2={markerY} stroke={C.corona} strokeWidth={2} />
            <Line x1={markerX + 60} y1={markerY} x2={markerX + 74} y2={markerY} stroke={C.corona} strokeWidth={2} />
            <Line x1={markerX} y1={markerY - 74} x2={markerX} y2={markerY - 60} stroke={C.corona} strokeWidth={2} />
            <Line x1={markerX} y1={markerY + 60} x2={markerX} y2={markerY + 74} stroke={C.corona} strokeWidth={2} />
          </Svg>
          <View style={[s.markerLabel, { left: markerX - 60, top: markerY + 82 }]} pointerEvents="none">
            <Text style={s.markerLabelText}>{t('sun.marker')}</Text>
            <Text style={s.markerApprox}>{t('sun.approx')}</Text>
          </View>
        </>
      )}

      {/* Fuera de encuadre: flecha girada hacia donde buscar + cuánto girar, tipo navegación */}
      {shot !== null && !shot.inFrame && (
        <View style={s.away} pointerEvents="none">
          <View style={{ transform: [{ rotate: `${shot.turnDeg}deg` }] }}>
            <Svg width={54} height={62} viewBox="0 0 12 14" fill={C.corona}>
              <Path d="M6 0 L11 13 L6 10.4 L1 13 Z" />
            </Svg>
          </View>
          <Text style={s.awayHeadline}>
            {shot.offAxisDeg > 120 ? t('sun.behind') : t('sun.turnBy', { deg: Math.round(shot.offAxisDeg) })}
          </Text>
          <Text style={s.awayText}>
            {t('sun.turnTo', { dir: bearingLabel(azimuthDeg), alt: Math.round(altitudeDeg) })}
          </Text>
        </View>
      )}

      {sensorsOff && (
        <View style={s.away} pointerEvents="none">
          <Text style={s.awayText}>{t('sun.noSensors')}</Text>
        </View>
      )}

      <View style={[s.top, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <View style={s.targetPill}>
          <Text style={s.targetText}>{t('sun.target', { label: momentLabel, time: momentTime })}</Text>
        </View>
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={10} accessibilityLabel={t('sun.close')}>
          <Text style={s.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="none">
        {noisyCompass && <Text style={s.calibrate}>{t('sun.calibrate')}</Text>}
        <Text style={s.safety}>{t('sun.safety')}</Text>
      </View>
    </View>
  );
}

/** Ocupar el hueco entero; StyleSheet.absoluteFillObject no está tipado en esta versión */
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const s = StyleSheet.create({
  root: { ...FILL, backgroundColor: '#000', zIndex: 40 },
  gate: {
    ...FILL,
    backgroundColor: C.bg,
    paddingHorizontal: 28,
    justifyContent: 'center',
    gap: 14,
    zIndex: 40,
  },
  gateKicker: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim },
  gateTitle: { fontFamily: F.bold, fontSize: 26, letterSpacing: -0.4, color: C.text },
  gateBody: { fontFamily: F.regular, fontSize: 14, lineHeight: 21, color: C.dim },
  gateActions: { marginTop: 10, gap: 18, alignItems: 'center' },
  gateCta: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.5)',
    backgroundColor: 'rgba(255,107,94,0.12)',
  },
  gateCtaText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1.4, color: C.danger },
  gateDismiss: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.4, color: C.dim },
  markerLabel: { position: 'absolute', width: 120, alignItems: 'center' },
  markerLabelText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 2, color: C.corona },
  markerApprox: { fontFamily: F.medium, fontSize: 10, color: 'rgba(242,239,233,0.75)', marginTop: 2 },
  away: { ...FILL, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 },
  awayHeadline: {
    fontFamily: F.bold,
    fontSize: 20,
    color: C.text,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 10,
  },
  awayText: {
    fontFamily: F.semibold,
    fontSize: 13,
    lineHeight: 19,
    color: C.text,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 8,
  },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 12,
  },
  targetPill: {
    backgroundColor: 'rgba(11,11,16,0.75)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexShrink: 1,
  },
  targetText: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.2, color: C.text },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(11,11,16,0.75)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontFamily: F.bold, fontSize: 15, color: C.text },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, gap: 8 },
  calibrate: {
    fontFamily: F.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: C.corona,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  safety: {
    fontFamily: F.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: C.danger,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
});
