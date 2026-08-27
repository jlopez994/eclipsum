import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Accelerometer } from 'expo-sensors';
import { useHeading } from '../../hooks/useHeading';
import {
  horizontalityFromGravity,
  MIN_COMPASS_HORIZONTALITY,
  smoothBearing,
} from '../../lib/skyProjection';
import { t } from '../../lib/i18n';
import { bearingLabel } from '../../lib/totality';
import { C, CARD, F } from '../theme';

/** Refresco de la inclinación: solo decide si el rumbo vale, 5 Hz sobra y no cuesta batería. */
const TILT_INTERVAL_MS = 200;
/**
 * Peso de la muestra nueva en la aguja. El magnetómetro ronda ±10-20°: en crudo la aguja
 * tiembla parada. A ~5 muestras/s, 0,25 ≈ 0,8 s de constante — sigue el giro sin vibrar.
 */
const HEADING_SMOOTHING = 0.25;

interface CompassChipProps {
  targetAzimuthDeg: number;
  /** Abre el visor de cámara. Sin handler (sin GPS o sol bajo el horizonte) el chip es inerte. */
  onPress?: () => void;
  /**
   * Suelta el sensor mientras otra pantalla lo necesita.
   *
   * OBLIGATORIO, no una optimización: expo-location guarda UN solo `mHeadingId` para todo
   * el módulo (LocationModule.kt). Con dos observadores vivos, el segundo se lleva los
   * eventos y, al cerrarse, su `removeWatchAsync` entra por `watchId == mHeadingId` y
   * ejecuta `destroyHeadingWatch()`: apaga el sensor y deja al primero suscrito pero mudo
   * —la aguja congelada hasta remontar—. Nunca dos brújulas a la vez.
   */
  paused?: boolean;
}

/**
 * Brújula de observación: la aguja apunta al azimut del sol en el máximo.
 * Con sensor, gira respecto al rumbo del móvil — cuando miras bien, la aguja queda arriba.
 * Sin sensor (emulador) o con el móvil siempre a plomo, donde el rumbo del sistema no
 * significa nada: muestra el rumbo cardenal fijo (arriba = N del diagrama).
 */
export function CompassChip({ targetAzimuthDeg, onPress, paused = false }: CompassChipProps) {
  const [heading, setHeading] = useState<number | null>(null);
  /**
   * true de inicio: hasta la primera lectura LIMPIA del acelerómetro no se sabe nada de la
   * inclinación, y horizontalityFromGravity devuelve null mientras el móvil se mueve. Con
   * false, andando o en coche esa lectura podía no llegar nunca: la brújula ignoraba todos
   * los rumbos y la aguja se quedaba en modo fijo aun con sensor sano. El coste de asumir
   * bien es unos ms de rumbo dudoso si arrancas con el móvil a plomo — la primera lectura
   * limpia lo corrige.
   */
  const [upright, setUpright] = useState(true);
  const target = ((targetAzimuthDeg % 360) + 360) % 360;
  const label = bearingLabel(target);

  /**
   * La brújula del sistema mide el rumbo del EJE SUPERIOR del móvil, no el de la cámara.
   * Sostenido a plomo —mirando el mapa de pie— ese eje apunta al cenit, su proyección
   * horizontal tiende a cero y el rumbo pasa a ser ruido que además se invierte 180° al
   * cruzar la vertical. El acelerómetro es lo que dice cuándo hay que callarse.
   *
   * Sin acelerómetro (o sin lectura limpia aún) se asume inclinación válida: ver el estado
   * `upright` — callarse por defecto dejaba la aguja muerta en movimiento.
   */
  useEffect(() => {
    if (paused) return;
    Accelerometer.setUpdateInterval(TILT_INTERVAL_MS);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const horizontality = horizontalityFromGravity(x, y, z);
      // Lectura con el móvil en movimiento: no dice nada de la inclinación, se conserva la anterior
      if (horizontality !== null) setUpright(horizontality >= MIN_COMPASS_HORIZONTALITY);
    });
    return () => sub.remove();
  }, [paused]);

  // A plomo la aguja se congela en el último rumbo bueno: un error estático que se corrige
  // inclinando el móvil, en vez de una aguja girando sola.
  useHeading(!paused, (deg) => {
    if (!upright) return;
    setHeading((prev) => smoothBearing(prev, deg, HEADING_SMOOTHING));
  });

  // Con sensor: ángulo relativo (0° = ya miras al sol). Sin sensor: rumbo sobre el diagrama (N arriba).
  const rotateDeg = heading !== null ? target - heading : target;

  const dirLabel =
    heading === null ? t('map.compass.fixed', { dir: label }) : t('map.compass.live', { dir: label });

  return (
    <Pressable
      style={s.compass}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={dirLabel}
      accessibilityHint={onPress ? t('map.compass.a11yHint') : undefined}
    >
      <View style={[s.needleWrap, { transform: [{ rotate: `${rotateDeg}deg` }] }]}>
        <Svg width={13} height={15} viewBox="0 0 12 14" fill={C.corona}>
          <Path d="M6 0 L11 13 L6 10.4 L1 13 Z" />
        </Svg>
        <Text style={s.needleN}>{label}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  compass: {
    ...CARD,
    width: 40,
    height: 40,
    borderRadius: 20, // círculo: pisa el radio de CARD
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** Aguja + rumbo: la punta señala hacia dónde mirar el sol en el máximo */
  needleWrap: { alignItems: 'center', justifyContent: 'center' },
  needleN: { fontFamily: F.bold, fontSize: 11, lineHeight: 12, color: C.text, marginTop: 1 },
});
