import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Location from 'expo-location';
import { t } from '../../lib/i18n';
import { bearingLabel } from '../../lib/totality';
import { C, F } from '../theme';

interface CompassChipProps {
  targetAzimuthDeg: number;
  /**
   * Despliega el detalle (altura del sol y acceso al visor). El panel lo pinta
   * MapScreen: aquí no cabe — el chip mide 40 px y Yoga encoge a ese ancho a los
   * hijos absolutos sin medida propia, partiendo el texto letra a letra.
   */
  onPress?: () => void;
  /** Detalle abierto: solo para el estado accesible del botón */
  expanded?: boolean;
}

/**
 * Brújula de observación: la aguja apunta al azimut del sol en el máximo.
 * Con sensor, gira respecto al rumbo del móvil — cuando miras bien, la aguja queda arriba.
 * Sin sensor (emulador): muestra el rumbo cardenal fijo (arriba = N del diagrama).
 */
export function CompassChip({ targetAzimuthDeg, onPress, expanded = false }: CompassChipProps) {
  const [heading, setHeading] = useState<number | null>(null);
  const target = ((targetAzimuthDeg % 360) + 360) % 360;
  const label = bearingLabel(target);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      try {
        sub = await Location.watchHeadingAsync((h) => {
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (!cancelled && Number.isFinite(deg)) setHeading(((deg % 360) + 360) % 360);
        });
        // Desmontado mientras resolvía: la limpieza ya corrió con sub=null y el
        // magnetómetro se quedaría suscrito para siempre
        if (cancelled) sub.remove();
      } catch {
        // sin brújula disponible
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

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
      accessibilityState={onPress ? { expanded } : undefined}
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** Aguja + rumbo: la punta señala hacia dónde mirar el sol en el máximo */
  needleWrap: { alignItems: 'center', justifyContent: 'center' },
  needleN: { fontFamily: F.bold, fontSize: 11, lineHeight: 12, color: C.text, marginTop: 1 },
});
