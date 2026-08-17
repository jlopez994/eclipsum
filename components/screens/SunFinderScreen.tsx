import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import {
  cameraBasis,
  fovFor,
  norm360,
  project,
  skyVector,
  smoothBasis,
  smoothBearing,
  withCompassBearing,
  type CameraBasis,
} from '../../lib/skyProjection';
import { calibrate, isCalibrationFresh, type CompassCalibration } from '../../lib/compassCalibration';
import { sunPosition } from '../../lib/eclipse';
import { useHeading } from '../../hooks/useHeading';
import { track } from '../../lib/firebase';
import { bearingLabel } from '../../lib/totality';
import { t } from '../../lib/i18n';
import { C, F } from '../theme';

/** Refresco de la orientación: 20 Hz va sobrado y no calienta el móvil. */
const MOTION_INTERVAL_MS = 50;
/**
 * Peso de la muestra nueva en el filtro (media exponencial). Sin filtro la marca nada
 * aunque el móvil esté quieto: los sensores llegan crudos a 20 Hz.
 * 0,18 a 20 Hz ≈ 0,25 s de constante de tiempo — imperceptible para un sol que no se mueve.
 */
const MOTION_SMOOTHING = 0.18;
/**
 * La brújula es el sensor MÁS ruidoso (±10-20°, peor cerca de metal) y `withCompassBearing`
 * mete su ruido en toda la escena, así que se filtra bastante más fuerte que la orientación.
 */
const HEADING_SMOOTHING = 0.06;
/**
 * Filtro para cuando el sistema declara la brújula mal calibrada: casi congelada. Con más de
 * ~35° de error, seguir cada muestra sería perseguir ruido; así la guía queda estable y
 * derivando despacio, que es un error que el usuario puede corregir girando el móvil.
 */
const HEADING_SMOOTHING_NOISY = 0.015;
/**
 * expo-sensors documenta `rotation` en GRADOS, pero algunas versiones han devuelto
 * radianes. En cuanto vemos una magnitud imposible en radianes (>2π) fijamos grados;
 * hasta entonces asumimos radianes. Con el móvil plano ambos dan ~0, así que el
 * criterio se resuelve solo en cuanto lo inclinas — antes de que el error importe.
 */
const RADIAN_CEILING = 7;
/**
 * Calibración mínima para fiarse de la brújula. `accuracy` de expo-location NO son grados:
 * es un nivel 0-3 (3 alta, <20° de incertidumbre; 2 media, <35°; 1 baja, <50°; 0 ninguna).
 * Avisamos por debajo de 2 —más de ~35° de error—, el triple de la tolerancia que promete
 * el círculo de puntería: por encima de ahí la marca ya no significa nada.
 *
 * Es lo que ocurre con el móvil cargando: el campo del cargador satura el magnetómetro y
 * el sistema baja este nivel.
 */
const COMPASS_MIN_ACCURACY = 2;
/**
 * Radio angular del círculo de puntería. No es estético: es el error que el visor NO puede
 * evitar — magnetómetro (±10-20°) y FOV estimada, porque expo-camera no expone la real.
 * Pintarlo a escala convierte «clava este punto» en «el sol está en esta zona», que es lo
 * único que los sensores permiten prometer.
 */
const AIM_TOLERANCE_DEG = 12;
/**
 * Radio con calibración solar vigente: el término dominante (el magnetómetro) está medido
 * contra el sol real y compensado, así que el círculo puede prometer bastante más. No baja
 * de ~5°: la calibración se hizo centrando el sol «a ojo» y ese pulso, más la FOV estimada,
 * también tienen su error.
 */
const AIM_TOLERANCE_CAL_DEG = 5;
/**
 * Refresco del modo «sol ahora». El sol se mueve ~0,25°/min: a 30 s la marca queda siempre
 * a <0,15° de la posición real — muy por debajo de lo que la brújula deja distinguir.
 */
const SUN_NOW_REFRESH_MS = 30_000;

/**
 * Muestra del sol de ahora CON su instante: el reloj entra al render como estado, no como
 * Date.now() suelto (regla de pureza), y la calibración queda fechada con la misma muestra
 * de sol contra la que se midió.
 */
const sunNowSample = (lat: number, lon: number) => {
  const at = Date.now();
  return { at, ...sunPosition(lat, lon, 0, new Date(at)) };
};

/** Posición del sol en un hito del eclipse, con su etiqueta y hora local ya formateadas. */
export interface SunTarget {
  /** Azimut del sol en el instante buscado, grados horarios desde el norte */
  azimuthDeg: number;
  /** Altura del sol sobre el horizonte, grados */
  altitudeDeg: number;
  /** Hito al que corresponde la posición (p. ej. «MÁXIMO») */
  label: string;
  /** Hora local del hito */
  time: string;
}

interface SunFinderScreenProps {
  /** Hito del eclipse a proyectar; null ⇒ el visor arranca (y se queda) en «sol ahora» */
  target: SunTarget | null;
  /** Posición GPS real: el cielo que calcula el modo live y el ancla de la calibración */
  gps: { lat: number; lon: number };
  /**
   * Distancia y nombre del puesto elegido cuando el GPS está lejos de él. El visor
   * SIEMPRE pinta el cielo de donde estás; esto evita creer que enseña el del destino.
   * null = estás prácticamente en tu puesto, no hay nada que aclarar.
   */
  awayFromSpot: { km: number; place: string } | null;
  /** Última calibración solar guardada; la vigencia se reevalúa aquí, no en el llamante */
  calibration: CompassCalibration | null;
  /** Calibración recién medida contra el sol real, para persistir */
  onCalibrate: (cal: CompassCalibration) => void;
  onClose: () => void;
}

interface GateProps {
  insets: { top: number; bottom: number };
  /** Botón principal opcional (aceptar aviso, pedir permiso); el de cerrar siempre está */
  primaryAction?: { label: string; onPress: () => void };
  onClose: () => void;
  children: ReactNode;
}

/**
 * Pantalla de bloqueo a pantalla completa: aviso de seguridad, permiso de cámara y sol bajo
 * el horizonte comparten este mismo chrome (kicker + acciones); solo cambia el cuerpo.
 */
function Gate({ insets, primaryAction, onClose, children }: GateProps) {
  return (
    <View style={[s.gate, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Text style={s.gateKicker}>{t('sun.title')}</Text>
      {children}
      <View style={s.gateActions}>
        {primaryAction && (
          <Pressable style={s.gateCta} onPress={primaryAction.onPress}>
            <Text style={s.gateCtaText}>{primaryAction.label}</Text>
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={s.gateDismiss}>{t('sun.close')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Visor: dibuja sobre la cámara dónde estará el sol en el instante del eclipse — o dónde
 * está AHORA MISMO (modo «sol ahora», pill superior para alternar). Sirve para elegir
 * sitio —¿me tapa ese árbol?—, NO para observar: la advertencia de seguridad es previa
 * y obligatoria, y se repite en pantalla.
 *
 * Precisión: el magnetómetro ronda ±10-20° (peor cerca de metal) y expo-camera no
 * expone el campo de visión real, así que se estima. La marca cae en la zona correcta,
 * no clavada al grado; por eso el círculo es amplio y el copy dice «aproximada».
 * El modo «sol ahora» permite además calibrar: centrando el sol real y pulsando, el error
 * de brújula queda medido y el círculo puede estrecharse (AIM_TOLERANCE_CAL_DEG).
 */
export function SunFinderScreen({
  target,
  gps,
  awayFromSpot,
  calibration,
  onCalibrate,
  onClose,
}: SunFinderScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [accepted, setAccepted] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Base y rumbo YA filtrados: el filtro vive en el listener, no en el render, para que
  // cada muestra se acumule sobre la anterior en vez de recalcularse desde cero
  const [basis, setBasis] = useState<CameraBasis | null>(null);
  const basisRef = useRef<CameraBasis | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const headingRef = useRef<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [sensorsOff, setSensorsOff] = useState(false);
  const degreeUnits = useRef(false);
  // Modo «sol ahora»: sin hito es el único que existe; con hito se alterna desde la pill
  const [showNow, setShowNow] = useState(target === null);
  const [sunNow, setSunNow] = useState(() => sunNowSample(gps.lat, gps.lon));

  const live = accepted && permission?.granted === true;

  // El sol de ahora se refresca aunque el modo visible sea el hito: decide si la pill puede
  // alternar (de noche no) y la calibración lo necesita fresco al pulsar
  useEffect(() => {
    if (!live) return;
    // Muestra inmediata al hacerse live: los gates previos (aviso de seguridad, permiso de
    // cámara) retienen el mount un tiempo arbitrario y setInterval no dispara hasta su
    // primer tick — sin esto, la primera pantalla y una calibración temprana usarían un
    // sol de hace minutos (0,25°/min contra un círculo que promete 5°).
    setSunNow(sunNowSample(gps.lat, gps.lon));
    const id = setInterval(() => setSunNow(sunNowSample(gps.lat, gps.lon)), SUN_NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, [live, gps.lat, gps.lon]);

  useEffect(() => {
    if (!live) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      const available = await DeviceMotion.isAvailableAsync();
      // Cerrado mientras resolvía: sin este corte el listener queda a 20 Hz para siempre
      // (addListener es síncrono, así que después del corte ya no hay ventana de carrera)
      if (cancelled) return;
      if (!available) {
        setSensorsOff(true);
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
        const k = degreeUnits.current ? 1 : 180 / Math.PI;
        const next = smoothBasis(basisRef.current, cameraBasis(alpha * k, beta * k, gamma * k), MOTION_SMOOTHING);
        basisRef.current = next;
        setBasis(next);
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [live]);

  // Sin brújula el hook no emite nunca: el guiñado se queda con el de DeviceMotion
  // (relativo, pero usable)
  useHeading(live, (deg, acc) => {
    // Brújula descalibrada (cargador, coche, altavoz): endurecemos el filtro en vez de
    // seguirla. Preferimos que la guía derive despacio a que dé bandazos — un error
    // constante se corrige girando; uno que salta hace la marca inservible.
    const f = acc !== null && acc < COMPASS_MIN_ACCURACY ? HEADING_SMOOTHING_NOISY : HEADING_SMOOTHING;
    const next = smoothBearing(headingRef.current, deg, f);
    headingRef.current = next;
    setHeading(next);
    setHeadingAccuracy(acc);
  });

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
      <Gate
        insets={insets}
        onClose={onClose}
        primaryAction={{ label: t('sun.warn.cta'), onPress: () => setAccepted(true) }}
      >
        <Text style={s.gateTitle}>{t('sun.warn.title')}</Text>
        {/* Antes de nada, de qué cielo hablamos */}
        <Text style={s.gateFromHere}>{t('sun.fromHere')}</Text>
        {awayFromSpot && (
          <Text style={s.gateAway}>{t('sun.awayFromSpot', awayFromSpot)}</Text>
        )}
        <Text style={s.gateBody}>{t('sun.warn.body')}</Text>
      </Gate>
    );
  }

  // --- Permiso de cámara ---
  if (!permission?.granted) {
    const denied = permission !== null && !permission.canAskAgain;
    return (
      <Gate
        insets={insets}
        onClose={onClose}
        primaryAction={denied ? undefined : { label: t('sun.perm.cta'), onPress: () => void requestPermission() }}
      >
        <Text style={s.gateBody}>{denied ? t('sun.perm.denied') : t('sun.perm.body')}</Text>
      </Gate>
    );
  }

  // Posición proyectada: la del hito, o la del sol de ahora mismo
  const shown = !showNow && target ? target : sunNow;

  // Sol bajo el horizonte en ese instante: no hay nada que señalar y decirlo es la
  // única respuesta honesta — una marca bajo el suelo haría creer que se verá algo.
  if (shown.altitudeDeg <= 0) {
    return (
      <Gate insets={insets} onClose={onClose}>
        <Text style={s.gateBody}>{showNow ? t('sun.below.now') : t('sun.below')}</Text>
      </Gate>
    );
  }

  // --- Visor ---
  // Vigencia reevaluada con cada muestra del sol (30 s): caduca sola en pantalla, sin
  // temporizador dedicado, y con margen de sobra frente a un TTL de horas
  const activeCal = isCalibrationFresh(calibration, sunNow.at, gps.lat, gps.lon) ? calibration : null;

  // El compás manda en el rumbo (en Android el alpha de DeviceMotion es relativo), corregido
  // con el offset solar ANTES de reanclar: la corrección es del SENSOR, no del objetivo,
  // así que vale igual apuntando al hito del eclipse que al sol de ahora
  const aimed =
    basis === null
      ? null
      : heading === null
        ? basis
        : withCompassBearing(basis, norm360(heading + (activeCal?.offsetDeg ?? 0)));

  const fov = fovFor(size.w, size.h);
  const shot =
    aimed !== null && size.w > 0 ? project(skyVector(shown.azimuthDeg, shown.altitudeDeg), aimed, fov) : null;

  // Normalizado (−1..1, y hacia arriba) → píxeles (y hacia abajo)
  const markerX = shot ? size.w / 2 + (shot.x * size.w) / 2 : 0;
  const markerY = shot ? size.h / 2 - (shot.y * size.h) / 2 : 0;
  const tolDeg = activeCal ? AIM_TOLERANCE_CAL_DEG : AIM_TOLERANCE_DEG;
  // El círculo mide la tolerancia REAL vigente (12° a pelo, 5° con calibración solar), no un
  // tamaño bonito: proyectar tolDeg con la misma escala que la marca. Así crece en pantallas
  // anchas y con FOV estrecha, y lo que se le pide al usuario es apuntar a una zona — no
  // clavar un punto que los sensores no dan. El suelo visual baja con calibración: con los
  // 44 px de siempre el círculo apenas encogería y la precisión ganada no se vería.
  const markerR = Math.max(
    activeCal ? 26 : 44,
    Math.min(
      120,
      ((size.w / 2) * Math.tan((tolDeg * Math.PI) / 180)) /
        Math.tan((fov.horizontalDeg * Math.PI) / 360),
    ),
  );
  const noisyCompass = headingAccuracy !== null && headingAccuracy < COMPASS_MIN_ACCURACY;

  // «Centrar en el sol»: solo con el sol REAL a la vista (modo live y dentro del encuadre)
  // y con brújula — sin ella no hay rumbo que corregir. Gate Y medición van contra la base
  // reanclada a la brújula CRUDA, sin el offset vigente: recalibrar sustituye, no acumula.
  // El gate NO puede derivar de `shot` (que lleva el offset): una calibración pasada muy
  // mala sacaría la marca del encuadre justo cuando el usuario apunta bien al sol real, y
  // el botón para arreglarla no aparecería hasta que caducase sola (2 h / 1 km).
  const rawAimed = basis !== null && heading !== null ? withCompassBearing(basis, heading) : null;
  const rawShot =
    rawAimed !== null && size.w > 0
      ? project(skyVector(sunNow.azimuthDeg, sunNow.altitudeDeg), rawAimed, fov)
      : null;
  const canCalibrate = showNow && rawShot?.inFrame === true;
  const handleCalibrate = () => {
    if (rawAimed === null) return;
    const cal = calibrate(
      sunNow.azimuthDeg,
      sunNow.altitudeDeg,
      rawAimed,
      fov.verticalDeg,
      sunNow.at,
      gps.lat,
      gps.lon,
    );
    // null = por cabeceo el sol no podía estar encuadrado (p. ej. mirando al suelo con la
    // brújula mintiendo en el azimut): mejor sin calibrar que calibrado con basura
    if (cal) {
      track('sunfinder_calibrated');
      onCalibrate(cal);
    }
  };

  // Alternar hacia «sol ahora» exige sol sobre el horizonte: si no, se aterrizaría en la
  // pantalla de «es de noche» sin camino de vuelta al hito
  const canToggle = target !== null && (showNow || sunNow.altitudeDeg > 0);

  return (
    <View style={s.root} onLayout={onLayout}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      {shot?.inFrame && (
        <>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* El círculo ES la tolerancia vigente (±tolDeg): señala una zona, no un punto */}
            <Circle cx={markerX} cy={markerY} r={markerR} stroke={C.corona} strokeWidth={2} fill="none" />
            <Circle
              cx={markerX}
              cy={markerY}
              r={markerR}
              stroke={C.corona}
              strokeWidth={10}
              fill="none"
              opacity={0.14}
            />
            <Line x1={markerX - markerR - 20} y1={markerY} x2={markerX - markerR - 6} y2={markerY} stroke={C.corona} strokeWidth={2} />
            <Line x1={markerX + markerR + 6} y1={markerY} x2={markerX + markerR + 20} y2={markerY} stroke={C.corona} strokeWidth={2} />
            <Line x1={markerX} y1={markerY - markerR - 20} x2={markerX} y2={markerY - markerR - 6} stroke={C.corona} strokeWidth={2} />
            <Line x1={markerX} y1={markerY + markerR + 6} x2={markerX} y2={markerY + markerR + 20} stroke={C.corona} strokeWidth={2} />
          </Svg>
          <View style={[s.markerLabel, { left: markerX - 60, top: markerY + markerR + 28 }]} pointerEvents="none">
            <Text style={s.markerLabelText}>{t('sun.marker')}</Text>
            {/* Sutil a propósito: el círculo encogido ya es el aviso; esto solo le pone nombre */}
            <Text style={s.markerApprox}>{activeCal ? t('sun.calibrated') : t('sun.approx')}</Text>
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
            {t('sun.turnTo', { dir: bearingLabel(shown.azimuthDeg), alt: Math.round(shown.altitudeDeg) })}
          </Text>
        </View>
      )}

      {sensorsOff && (
        <View style={s.away} pointerEvents="none">
          <Text style={s.awayText}>{t('sun.noSensors')}</Text>
        </View>
      )}

      <View style={[s.top, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        {/* La pill es el conmutador de modo: hito del eclipse ⇄ sol de ahora mismo */}
        <Pressable
          style={s.targetPill}
          onPress={canToggle ? () => setShowNow((v) => !v) : undefined}
          disabled={!canToggle}
          accessibilityRole={canToggle ? 'button' : 'text'}
          accessibilityLabel={canToggle ? t('sun.switchTarget') : undefined}
        >
          <View style={s.targetRow}>
            <Text style={s.targetText}>
              {!showNow && target ? t('sun.target', { label: target.label, time: target.time }) : t('sun.now')}
            </Text>
            {canToggle && <Text style={s.targetSwap}>⇄</Text>}
          </View>
          {/* Permanente: la hora y la posición son las de aquí, no las del puesto elegido */}
          <Text style={s.targetFromHere} numberOfLines={2}>
            {awayFromSpot ? t('sun.awayFromSpot', awayFromSpot) : t('sun.fromHere')}
          </Text>
        </Pressable>
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={10} accessibilityLabel={t('sun.close')}>
          <Text style={s.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* Con el sol real encuadrado: céntralo en el círculo y pulsa — el error de brújula queda medido */}
      {canCalibrate && (
        <View style={[s.calWrap, { bottom: insets.bottom + 76 }]} pointerEvents="box-none">
          <Pressable style={s.calBtn} onPress={handleCalibrate} hitSlop={8}>
            <Text style={s.calBtnText}>{t('sun.calibrate.cta')}</Text>
          </Pressable>
        </View>
      )}

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
  gateFromHere: { fontFamily: F.bold, fontSize: 13, letterSpacing: 0.5, color: C.corona },
  gateAway: { fontFamily: F.semibold, fontSize: 13, lineHeight: 19, color: C.text },
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
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetText: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.2, color: C.text },
  targetSwap: { fontFamily: F.bold, fontSize: 12, color: C.dim },
  targetFromHere: { fontFamily: F.medium, fontSize: 10.5, lineHeight: 14, color: C.corona, marginTop: 2 },
  calWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  calBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.6)',
    backgroundColor: 'rgba(11,11,16,0.75)',
  },
  calBtnText: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.4, color: C.corona },
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
