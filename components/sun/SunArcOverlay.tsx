import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { arcPath, type ArcPixel } from '../../lib/sunArc';
import { C, F } from '../theme';

interface SunArcOverlayProps {
  size: { w: number; h: number };
  /** Puntos del recorrido, en orden temporal */
  points: ArcPixel[];
  /** El máximo: se marca sobre el arco con su etiqueta */
  max: ArcPixel & { label: string };
  /** Semiancho de la franja de error, en píxeles — ES la tolerancia, no decoración */
  bandPx: number;
}

/**
 * Recorrido del sol durante el eclipse sobre la cámara. La FRANJA es el mensaje: su
 * anchura es el error que los sensores no permiten bajar, así que lo aproximado se ve
 * en el dibujo y no hace falta decirlo en letra pequeña. Dentro, el trazo fino es la
 * estimación central y el disco, el máximo.
 */
export function SunArcOverlay({ size, points, max, bandPx }: SunArcOverlayProps) {
  const d = arcPath(points);
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h} pointerEvents="none">
        {d !== '' && (
          <>
            <Path d={d} stroke={C.corona} strokeWidth={bandPx * 2} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.16} />
            <Path d={d} stroke={C.corona} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
          </>
        )}
        {max.inFront && (
          <>
            <Circle cx={max.x} cy={max.y} r={9} fill={C.corona} />
            <Circle cx={max.x} cy={max.y} r={15} stroke={C.corona} strokeWidth={2} fill="none" opacity={0.7} />
          </>
        )}
      </Svg>
      {max.inFront && (
        <View style={[s.label, { left: max.x - 70, top: max.y + 24 }]} pointerEvents="none">
          <Text style={s.labelText} numberOfLines={1}>{max.label}</Text>
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  label: { position: 'absolute', width: 140, alignItems: 'center' },
  labelText: {
    fontFamily: F.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: C.corona,
    textShadowColor: '#000',
    textShadowRadius: 8,
  },
});
