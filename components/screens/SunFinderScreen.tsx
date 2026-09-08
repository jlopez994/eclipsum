import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { DeviceMotion } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import {
  bearingOf,
  cameraBasis,
  compassReading,
  fovFor,
  MIN_COMPASS_HORIZONTALITY,
  norm360,
  project,
  shortDelta,
  skyVector,
  smoothBasis,
  smoothBearing,
  withCompassBearing,
  yawRateFromRotationRate,
  type CameraBasis,
  type Fov,
} from '../../lib/skyProjection';
import { sunArc, toPixel } from '../../lib/sunArc';
import { sunPosition } from '../../lib/eclipse';
import { SunArcOverlay } from '../sun/SunArcOverlay';
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
 * Filtro del OFFSET de guiñado, no del guiñado. La brújula es el sensor más ruidoso
 * (±10-20°, peor cerca de metal) pero lo que mide —cuánto se aleja del norte el guiñado
 * relativo del giroscopio— varía despacio, así que se puede filtrar muy fuerte: quita el
 * ruido entero sin frenar el paneo, que sigue viniendo del giroscopio sin filtrar.
 */
const YAW_OFFSET_SMOOTHING = 0.06;
/**
 * Filtro para cuando el sistema declara la brújula mal calibrada: casi congelada. Con más de
 * ~35° de error, seguir cada muestra sería perseguir ruido; así la guía queda estable y
 * derivando despacio, que es un error que el usuario puede corregir girando el móvil.
 */
const YAW_OFFSET_SMOOTHING_NOISY = 0.015;
/**
 * expo-sensors documenta `rotation` en GRADOS, pero algunas versiones han devuelto
 * radianes. En cuanto vemos una magnitud imposible en radianes (>2π) fijamos grados;
 * hasta entonces asumimos radianes. Con el móvil plano ambos dan ~0, así que el
 * criterio se resuelve solo en cuanto lo inclinas — antes de que el error importe.
 */
const RADIAN_CEILING = 7;
/**
 * ANCLA DE GUIÑADO (estilo flecha de navegación de Maps): el rumbo de la escena solo se
 * mueve lo que mida el giroscopio puro (`rotationRate`); todo lo que el fusor gire DE MÁS
 * es reanclaje magnético (TV, metal, cargador) y se resta del offset en el mismo instante.
 * Sin esto la marca «navegaba» sola por la escena aunque el móvil no girase.
 * El error absoluto que el ancla congela lo siguen corrigiendo, despacio, la brújula
 * (YAW_OFFSET_SMOOTHING) y la calibración contra el sol real.
 */
/**
 * Reposo: giro por debajo de este ritmo (°/s) cuenta como móvil quieto. En reposo el
 * ritmo restante es sesgo del giroscopio: se espera rumbo clavado (esperado = 0) en vez
 * de integrar ese sesgo, y la brújula deja de perseguirse (ver useHeading).
 */
const STILL_RATE_DEG_S = 2;
/**
 * Residuo máximo por muestra (°) que el ancla acepta como reanclaje. Más que esto en 50 ms
 * no es deriva sino discontinuidad (giro de pantalla, salto del filtro de base, vuelta de
 * segundo plano con dt capado): cancelarla destrozaría el offset.
 */
const RESIDUAL_MAX_DEG = 3;
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
 * Semiancho angular de la FRANJA de error. No es estético: es el error que el visor NO puede
 * evitar — magnetómetro (±10-20°) y FOV estimada, porque expo-camera no expone la real.
 * Pintarla a escala convierte «clava este punto» en «el sol pasará por esta zona», que es
 * lo único que los sensores permiten prometer.
 */
const AIM_TOLERANCE_DEG = 12;
/** Con la brújula descalibrada el error sube a ~35°: la franja se ensancha en vez de mentir. */
const AIM_TOLERANCE_NOISY_DEG = 20;
/**
 * Tras calibrar contra el sol real queda el error de FOV y el del propio gesto de centrar.
 * El sol ocupa 0,5°: centrarlo a ojo es fácil a ±2-3°.
 */
const AIM_TOLERANCE_CAL_DEG = 5;
/**
 * Cabeceo máximo entre el eje de la cámara y el sol real para aceptar una calibración.
 * El cabeceo lo fija la gravedad y no se calibra: si difiere tanto es que el usuario no
 * ha centrado el sol, y medir el guiñado en ese momento daría una corrección inventada.
 */
const CAL_MAX_PITCH_ERROR_DEG = 15;
/** Píxeles de la franja: suelo para que se vea, techo para que no tape la escena. */
const BAND_MIN_PX = 24;
const BAND_MAX_PX = 200;
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

/** Recorrido del sol durante el eclipse, con el máximo etiquetado. Instantes en ms epoch. */
export interface SunTarget {
  /** Primer contacto: donde arranca el arco */
  startMs: number;
  /** Máximo: se marca sobre el arco */
  maxMs: number;
  /** Último contacto: donde acaba el arco */
  endMs: number;
  /** Etiqueta del máximo (p. ej. «MÁXIMO») */
  label: string;
  /** Hora local del máximo */
  time: string;
}

/** Corrección medida contra el sol real: cuánto giraba de más la escena y cuánto se ha aplicado. */
interface Calibration {
  /** Giro extra del guiñado, acumulado sobre el de la brújula */
  offsetDeg: number;
  /** Desvío que se midió en la última calibración, para enseñárselo al usuario */
  errorDeg: number;
}

/** Semiancho de la franja en píxeles: misma escala que la proyección, así crece con el FOV. */
const bandPxFor = (tolDeg: number, widthPx: number, fov: Fov) =>
  Math.max(
    BAND_MIN_PX,
    Math.min(BAND_MAX_PX, ((widthPx / 2) * Math.tan((tolDeg * Math.PI) / 180)) / Math.tan((fov.horizontalDeg * Math.PI) / 360)),
  );

/** Hacia qué lado girar, a partir del ángulo de la flecha (0 = arriba, 90 = derecha). */
const turnHint = (turnDeg: number) => {
  if (turnDeg < 45 || turnDeg >= 315) return t('sun.turn.up');
  if (turnDeg < 135) return t('sun.turn.right');
  if (turnDeg < 225) return t('sun.turn.down');
  return t('sun.turn.left');
};

interface SunFinderScreenProps {
  /** Recorrido del eclipse a proyectar; null ⇒ solo hay sol real, sirve para calibrar */
  target: SunTarget | null;
  /** Posición GPS real: el cielo que calcula el modo live y el ancla de la calibración */
  gps: { lat: number; lon: number };
  /**
   * Distancia y nombre del puesto elegido cuando el GPS está lejos de él. El visor
   * SIEMPRE pinta el cielo de donde estás; esto evita creer que enseña el del destino.
   * null = estás prácticamente en tu puesto, no hay nada que aclarar.
   */
  awayFromSpot: { km: number; place: string } | null;
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
 * Visor: dibuja sobre la cámara el RECORRIDO del sol durante el eclipse, de primer a último
 * contacto, con el máximo marcado. Sirve para elegir sitio —¿me tapa ese árbol en algún
 * momento?—, NO para observar: la advertencia de seguridad es previa y obligatoria, y se
 * repite en pantalla.
 *
 * Precisión: el magnetómetro ronda ±10-20° (peor cerca de metal) y expo-camera no expone
 * el campo de visión real, así que se estima. Por eso el arco va dentro de una FRANJA a
 * escala del error: lo aproximado se ve, no se lee. Con el sol en alto se puede además
 * calibrar: centrando el sol real y tocando, el desvío queda medido y la franja se estrecha.
 */
export function SunFinderScreen({ target, gps, awayFromSpot, onClose }: SunFinderScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [accepted, setAccepted] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Base y rumbo YA filtrados: el filtro vive en el listener, no en el render, para que
  // cada muestra se acumule sobre la anterior en vez de recalcularse desde cero
  const [basis, setBasis] = useState<CameraBasis | null>(null);
  const basisRef = useRef<CameraBasis | null>(null);
  // Cuánto hay que girar el guiñado del giroscopio para que apunte al norte real
  const [yawOffset, setYawOffset] = useState<number | null>(null);
  const yawOffsetRef = useRef<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [sensorsOff, setSensorsOff] = useState(false);
  const degreeUnits = useRef(false);
  /** Móvil en reposo según el giroscopio; congela deriva y persecución de brújula */
  const stillRef = useRef(false);
  /** Última base CRUDA con su instante — el ancla mide residuos sin el retardo del filtro */
  const prevRawRef = useRef<{ at: number; basis: CameraBasis } | null>(null);
  const [sunNow, setSunNow] = useState(() => sunNowSample(gps.lat, gps.lon));
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calNotice, setCalNotice] = useState<string | null>(null);

  const live = accepted && permission?.granted === true;

  // El recorrido es determinista por posición e instantes: se calcula una vez, no a 20 Hz
  const arc = useMemo(
    () => (target ? sunArc(gps.lat, gps.lon, target.startMs, target.endMs) : []),
    [target, gps.lat, gps.lon],
  );
  const maxPos = useMemo(
    () => (target ? sunPosition(gps.lat, gps.lon, 0, new Date(target.maxMs)) : null),
    [target, gps.lat, gps.lon],
  );

  // El sol real se refresca siempre que hay cámara: es el disco «ahora» y el ancla de la calibración
  useEffect(() => {
    if (!live) return;
    // Muestra inmediata al hacerse live: los gates previos (aviso de seguridad, permiso de
    // cámara) retienen el mount un tiempo arbitrario y setInterval no dispara hasta su
    // primer tick — sin esto, una calibración temprana usaría un sol de hace minutos
    // (0,25°/min contra una franja que promete 5°).
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
        const raw = cameraBasis(alpha * k, beta * k, gamma * k);
        // `rotationRate` no comparte la ambigüedad de unidades de `rotation`: ambos módulos
        // nativos de expo-sensors 57 convierten a °/s antes de emitir.
        const rate = d.rotationRate;
        const rateOk =
          rate !== null &&
          Number.isFinite(rate.alpha) &&
          Number.isFinite(rate.beta) &&
          Number.isFinite(rate.gamma);
        stillRef.current =
          rateOk && Math.max(Math.abs(rate.alpha), Math.abs(rate.beta), Math.abs(rate.gamma)) < STILL_RATE_DEG_S;
        // Ancla de guiñado: el rumbo crudo solo debe moverse lo que integre el giroscopio;
        // el residuo es reanclaje magnético del fusor y se resta del offset ya (persistente:
        // no hay salto al moverse, y brújula/calibración siguen corrigiendo el absoluto).
        // Cabeceo y alabeo pasan tal cual — esos los fija la gravedad y no derivan.
        const now = Date.now();
        if (rateOk && prevRawRef.current !== null && yawOffsetRef.current !== null) {
          const dt = Math.min(0.2, (now - prevRawRef.current.at) / 1000);
          const expected = stillRef.current ? 0 : yawRateFromRotationRate(raw, rate) * dt;
          const residual = shortDelta(bearingOf(prevRawRef.current.basis.forward), bearingOf(raw.forward)) - expected;
          if (residual !== 0 && Math.abs(residual) < RESIDUAL_MAX_DEG) {
            yawOffsetRef.current = norm360(yawOffsetRef.current - residual);
            setYawOffset(yawOffsetRef.current);
          }
        }
        prevRawRef.current = { at: now, basis: raw };
        const next = smoothBasis(basisRef.current, raw, MOTION_SMOOTHING);
        basisRef.current = next;
        setBasis(next);
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [live]);

  /**
   * Filtro complementario. El giroscopio es rápido y sin ruido pero RELATIVO (deriva); la
   * brújula es absoluta pero ruidosa y lenta. En vez de sustituir el guiñado por el de la
   * brújula —que metía su ruido y su retardo en toda la escena—, la brújula solo corrige
   * la diferencia entre ambos. Esa diferencia varía despacio, así que se filtra fuerte sin
   * que la marca deje de seguir el paneo al instante.
   *
   * Sin brújula el hook no emite nunca: el guiñado se queda con el de DeviceMotion
   * (relativo, pero usable — y calibrable contra el sol real).
   */
  useHeading(live, (deg, acc) => {
    const raw = basisRef.current;
    // Aún no hay orientación: sin guiñado relativo no hay diferencia que medir
    if (raw === null) return;
    // En reposo y ya anclada, la brújula solo aporta su ruido (±10-20°): perseguirla era
    // la otra mitad de la deriva con el móvil quieto. La precisión sí se refresca — la
    // franja debe ensancharse aunque no se toque el offset.
    if (stillRef.current && yawOffsetRef.current !== null) {
      setHeadingAccuracy(acc);
      return;
    }
    // El offset se mide contra lo que la brújula MIRA —el eje superior del móvil—, no contra
    // el eje de la cámara: con la cámara alzada sobre el horizonte los dos van 180° aparte y
    // comparar con el equivocado desplazaba la marca justo al apuntar al sol.
    const compass = compassReading(raw);
    // Móvil casi a plomo en la primera muestra: entraría entera (smoothBearing ignora el peso)
    // y anclaría la escena a ruido. El resto ya se apagan solas —el peso va multiplicado por
    // la horizontalidad—, pero a la primera sí hay que ponerle suelo.
    if (yawOffsetRef.current === null && compass.horizontality < MIN_COMPASS_HORIZONTALITY) return;
    // Brújula descalibrada (cargador, coche, altavoz): endurecemos el filtro en vez de
    // seguirla. Preferimos que la guía derive despacio a que dé bandazos — un error
    // constante se corrige girando; uno que salta hace la marca inservible.
    const base = acc !== null && acc < COMPASS_MIN_ACCURACY ? YAW_OFFSET_SMOOTHING_NOISY : YAW_OFFSET_SMOOTHING;
    const f = base * compass.horizontality;
    const next = smoothBearing(yawOffsetRef.current, shortDelta(compass.bearingDeg, deg), f);
    yawOffsetRef.current = next;
    setYawOffset(next);
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

  // Sol bajo el horizonte: no hay nada que señalar y decirlo es la única respuesta honesta —
  // un arco bajo el suelo haría creer que se verá algo.
  const sunNowUp = sunNow.altitudeDeg > 0;
  const arcUp = maxPos !== null && maxPos.altitudeDeg > 0;
  if (!arcUp && !sunNowUp) {
    return (
      <Gate insets={insets} onClose={onClose}>
        <Text style={s.gateBody}>{target ? t('sun.below') : t('sun.below.now')}</Text>
      </Gate>
    );
  }

  // --- Visor ---
  // El guiñado del giroscopio, girado hasta el norte real (brújula) y después lo que haya
  // medido la calibración. Sin brújula todavía se usa crudo: relativo, pero sigue bien el
  // movimiento — y la calibración lo ancla igual.
  const totalYaw = (yawOffset ?? 0) + (calibration?.offsetDeg ?? 0);
  const aimed = basis === null ? null : withCompassBearing(basis, norm360(bearingOf(basis.forward) + totalYaw));

  const fov = fovFor(size.w, size.h);
  const ready = aimed !== null && size.w > 0;
  const shotOf = (azimuthDeg: number, altitudeDeg: number) =>
    ready ? project(skyVector(azimuthDeg, altitudeDeg), aimed, fov) : null;

  const noisyCompass = headingAccuracy !== null && headingAccuracy < COMPASS_MIN_ACCURACY;
  // La franja es el indicador de confianza: se ensancha con brújula mala, se estrecha calibrada
  const tolDeg = noisyCompass ? AIM_TOLERANCE_NOISY_DEG : calibration ? AIM_TOLERANCE_CAL_DEG : AIM_TOLERANCE_DEG;
  const bandPx = bandPxFor(tolDeg, size.w, fov);

  const maxShot = arcUp && maxPos ? shotOf(maxPos.azimuthDeg, maxPos.altitudeDeg) : null;
  const arcPixels = ready && arcUp ? arc.filter((p) => p.altitudeDeg > 0).map((p) => toPixel(shotOf(p.azimuthDeg, p.altitudeDeg)!, size)) : [];
  const arcVisible = arcPixels.some((p) => p.inFront && p.x >= 0 && p.x <= size.w && p.y >= 0 && p.y <= size.h);

  const nowShot = sunNowUp ? shotOf(sunNow.azimuthDeg, sunNow.altitudeDeg) : null;
  const nowPixel = nowShot ? toPixel(nowShot, size) : null;

  /**
   * Calibración: el usuario centra el sol REAL y toca. El cabeceo lo fija la gravedad, así
   * que si difiere mucho es que no está centrado y se rechaza; el guiñado que falte es
   * exactamente el error de brújula, y se acumula como offset.
   */
  const calibrate = () => {
    if (!aimed || !sunNowUp) return;
    const forwardAltDeg = (Math.asin(Math.max(-1, Math.min(1, aimed.forward.z))) * 180) / Math.PI;
    if (Math.abs(sunNow.altitudeDeg - forwardAltDeg) > CAL_MAX_PITCH_ERROR_DEG) {
      setCalNotice(t('sun.cal.notCentered'));
      return;
    }
    const yawErr = shortDelta(bearingOf(aimed.forward), sunNow.azimuthDeg);
    setCalibration({ offsetDeg: norm360((calibration?.offsetDeg ?? 0) + yawErr), errorDeg: Math.round(Math.abs(yawErr)) });
    setCalNotice(null);
    track('sunfinder_calibrate', { errorDeg: Math.round(Math.abs(yawErr)) });
  };

  return (
    <View style={s.root} onLayout={onLayout}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      {maxShot && (
        <SunArcOverlay
          size={size}
          points={arcPixels}
          max={{ ...toPixel(maxShot, size), label: t('sun.target', { label: target!.label, time: target!.time }) }}
          bandPx={bandPx}
        />
      )}

      {/* El sol de ahora mismo: disco punteado. Con hito es el ancla para calibrar; sin hito, lo único */}
      {nowPixel?.inFront && nowShot?.inFrame && (
        <>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Circle cx={nowPixel.x} cy={nowPixel.y} r={18} stroke={C.text} strokeWidth={2} strokeDasharray="5 4" fill="none" />
          </Svg>
          <View style={[s.nowLabel, { left: nowPixel.x - 50, top: nowPixel.y + 26 }]} pointerEvents="none">
            <Text style={s.nowLabelText}>{t('sun.now')}</Text>
          </View>
        </>
      )}

      {/* Nada del arco en pantalla: flecha hacia el máximo + hacia dónde girar, sin grados falsos */}
      {maxShot && !arcVisible && !maxShot.inFrame && (
        <View style={s.away} pointerEvents="none">
          <View style={{ transform: [{ rotate: `${maxShot.turnDeg}deg` }] }}>
            <Svg width={54} height={62} viewBox="0 0 12 14" fill={C.corona}>
              <Path d="M6 0 L11 13 L6 10.4 L1 13 Z" />
            </Svg>
          </View>
          <Text style={s.awayHeadline}>{maxShot.offAxisDeg > 120 ? t('sun.behind') : turnHint(maxShot.turnDeg)}</Text>
          <Text style={s.awayText}>
            {t('sun.turnTo', { dir: bearingLabel(maxPos!.azimuthDeg), alt: Math.round(maxPos!.altitudeDeg) })}
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
          <Text style={s.targetText}>{target ? t('sun.arcTitle') : t('sun.now')}</Text>
          {/* Permanente: la hora y la posición son las de aquí, no las del puesto elegido */}
          <Text style={s.targetFromHere} numberOfLines={2}>
            {awayFromSpot ? t('sun.awayFromSpot', awayFromSpot) : t('sun.fromHere')}
          </Text>
        </View>
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={10} accessibilityLabel={t('sun.close')}>
          <Text style={s.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* Degradado bajo los textos: sobre cielo claro o paisaje soleado eran ilegibles */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.78)']}
        style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        {target && <Text style={s.hint}>{t('sun.band')}</Text>}
        {noisyCompass && <Text style={s.calibrate}>{t('sun.calibrate')}</Text>}
        {/* Calibración: una acción, un resultado visible. Solo con sol real en alto y sensores */}
        {sunNowUp && ready && (
          <View style={s.calBox}>
            {calNotice && <Text style={s.calNotice}>{calNotice}</Text>}
            {calibration && !calNotice && (
              <Text style={s.calDone}>{t('sun.cal.done', { deg: calibration.errorDeg })}</Text>
            )}
            <Pressable style={s.calBtn} onPress={calibrate} accessibilityRole="button" accessibilityHint={t('sun.cal.hint')}>
              <Text style={s.calBtnText}>{calibration ? t('sun.cal.redo') : t('sun.cal.cta')}</Text>
            </Pressable>
            <Text style={s.calHint}>{t('sun.cal.hint')}</Text>
          </View>
        )}
        <Text style={s.safety}>{t('sun.safety')}</Text>
      </LinearGradient>
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
  nowLabel: { position: 'absolute', width: 100, alignItems: 'center' },
  nowLabelText: {
    fontFamily: F.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: C.text,
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
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
  targetFromHere: { fontFamily: F.medium, fontSize: 10.5, lineHeight: 14, color: C.corona, marginTop: 2 },
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
  /** paddingTop: que el degradado nazca por encima del primer texto, no cortado en él */
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 40, gap: 8 },
  hint: {
    fontFamily: F.medium,
    fontSize: 12.5,
    color: C.text,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  calBox: { alignItems: 'center', gap: 6, marginTop: 4 },
  calBtn: {
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(11,11,16,0.75)',
  },
  calBtnText: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.4, color: C.corona },
  calHint: { fontFamily: F.medium, fontSize: 11, color: 'rgba(242,239,233,0.75)', textAlign: 'center' },
  calDone: { fontFamily: F.semibold, fontSize: 12, color: C.text, textShadowColor: '#000', textShadowRadius: 6 },
  calNotice: { fontFamily: F.semibold, fontSize: 12, color: C.corona, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 6 },
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
