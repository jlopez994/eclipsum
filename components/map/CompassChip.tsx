import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Location from 'expo-location';
import { t } from '../../lib/i18n';
import { bearingLabel } from '../../lib/totality';
import { animateNextLayout } from '../../lib/anim';
import { C, F } from '../theme';

interface CompassChipProps {
  targetAzimuthDeg: number;
  /**
   * Altitud del sol en el instante al que apunta la aguja. La aguja resuelve el
   * «hacia dónde»; la altura, el «a qué altura» — un sol a 8° lo tapa cualquier
   * tejado. Se revela al tocar para no llenar el chip de números.
   */
  targetAltitudeDeg?: number;
  /** Abre el visor de cámara; ausente = solo se muestra la altura */
  onOpenFinder?: () => void;
}

/**
 * Brújula de observación: la aguja apunta al azimut del sol en el máximo.
 * Con sensor, gira respecto al rumbo del móvil — cuando miras bien, la aguja queda arriba.
 * Sin sensor (emulador): muestra el rumbo cardenal fijo (arriba = N del diagrama).
 */
export function CompassChip({ targetAzimuthDeg, targetAltitudeDeg, onOpenFinder }: CompassChipProps) {
  const [heading, setHeading] = useState<number | null>(null);
  const [showHeight, setShowHeight] = useState(false);
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

  const heightText =
    targetAltitudeDeg === undefined
      ? null
      : targetAltitudeDeg > 0
        ? t('map.compass.height', { deg: Math.round(targetAltitudeDeg) })
        : t('map.compass.belowHorizon');

  const dirLabel =
    heading === null ? t('map.compass.fixed', { dir: label }) : t('map.compass.live', { dir: label });

  return (
    <View>
      <Pressable
        style={s.compass}
        onPress={() => {
          if (heightText === null) return;
          animateNextLayout();
          setShowHeight((v) => !v);
        }}
        hitSlop={8}
        accessibilityRole={heightText === null ? 'image' : 'button'}
        accessibilityLabel={heightText === null ? dirLabel : `${dirLabel}. ${heightText}`}
        accessibilityHint={heightText === null ? undefined : t('map.compass.a11yHint')}
      >
        <View style={[s.needleWrap, { transform: [{ rotate: `${rotateDeg}deg` }] }]}>
          <Svg width={13} height={15} viewBox="0 0 12 14" fill={C.corona}>
            <Path d="M6 0 L11 13 L6 10.4 L1 13 Z" />
          </Svg>
          <Text style={s.needleN}>{label}</Text>
        </View>
      </Pressable>
      {/* Absoluto y anclado a la derecha: aparecer no debe mover la fila de chips ni el mapa */}
      {showHeight && heightText !== null && (
        <View style={s.height}>
          <Text style={s.heightText}>{heightText}</Text>
          {/* El visor solo tiene sentido con el sol sobre el horizonte */}
          {onOpenFinder && (targetAltitudeDeg ?? 0) > 0 && (
            <Pressable onPress={onOpenFinder} hitSlop={6}>
              <Text style={s.finderLink}>{t('map.compass.finder')}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
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
  height: {
    position: 'absolute',
    top: 46,
    right: 0,
    // Ancho explícito: el chip mide 40 px y Yoga encoge a él los hijos absolutos sin
    // medida propia — sin esto el texto se parte letra a letra
    width: 200,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(21,21,30,0.92)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heightText: { fontFamily: F.semibold, fontSize: 11.5, color: C.text, textAlign: 'right' },
  finderLink: {
    fontFamily: F.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: C.corona,
    marginTop: 6,
    textAlign: 'right',
  },
});
