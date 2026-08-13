import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useHeading } from '../../hooks/useHeading';
import { t } from '../../lib/i18n';
import { bearingLabel } from '../../lib/totality';
import { C, CARD, F } from '../theme';

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
 * Sin sensor (emulador): muestra el rumbo cardenal fijo (arriba = N del diagrama).
 */
export function CompassChip({ targetAzimuthDeg, onPress, paused = false }: CompassChipProps) {
  const [heading, setHeading] = useState<number | null>(null);
  const target = ((targetAzimuthDeg % 360) + 360) % 360;
  const label = bearingLabel(target);

  // Sin filtro: la aguja del chip es orientativa y el crudo del sensor le vale
  useHeading(!paused, (deg) => setHeading(deg));

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
