import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { fmtFixed1, t } from '../../lib/i18n';
import { bearingLabel } from '../../lib/totality';
import { C, F } from '../theme';

/** Altura del sol a escala: observador, horizonte y ángulo real. */
export function HorizonDiagram({ altitudeDeg, azimuthDeg }: { altitudeDeg: number; azimuthDeg: number }) {
  const rad = (altitudeDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const ox = 46;
  const oy = 84;
  // Radio limitado para que el sol no se salga del lienzo con alturas grandes
  const r = Math.min(205, sin > 0.05 ? (oy - 16) / sin : 205, cos > 0.05 ? (300 - 24 - ox) / cos : 205);
  const sx = ox + r * cos;
  const sy = oy - r * sin;
  const altTxt = fmtFixed1(altitudeDeg);
  // Referencia a ojo: un puño con el brazo estirado cubre ~10°
  const fistTxt =
    altitudeDeg < 7.5
      ? t('horizon.fist.less')
      : altitudeDeg < 12.5
        ? t('horizon.fist.about')
        : t('horizon.fist.n', { n: fmtFixed1(altitudeDeg / 10) });
  // Recorta el cielo vacío por encima del sol: menos margen con el título
  const minY = Math.max(0, Math.floor(sy) - 24);
  return (
    <View accessibilityLabel={t('horizon.a11y', { alt: altTxt, dir: bearingLabel(azimuthDeg) })}>
      <Svg width="100%" height={110 - minY} viewBox={`0 ${minY} 300 ${110 - minY}`}>
        <Rect x={0} y={oy} width={300} height={110 - oy} fill="#101019" />
        {/* Skyline: edificios y árbol para dar escala al horizonte */}
        <Path
          d={`M150 ${oy} v-10 h9 v10 Z M166 ${oy} v-7 h7 v7 Z M204 ${oy} v-13 h10 v13 Z M218 ${oy} v-9 h8 v9 Z`}
          fill="#1D1D2C"
        />
        <Circle cx={190} cy={oy - 8} r={5} fill="#1D1D2C" />
        <Rect x={189} y={oy - 5} width={2} height={5} fill="#1D1D2C" />
        <Path d={`M0 ${oy} H300`} stroke="#2A2A3C" strokeWidth={1.5} />
        {/* Cuña sombreada: hace tangible el ángulo real */}
        <Path
          d={`M${ox} ${oy} L${sx} ${sy} A${r} ${r} 0 0 1 ${ox + r} ${oy} Z`}
          fill="rgba(255,184,77,0.08)"
        />
        <Path
          d={`M${ox} ${oy} L${sx} ${sy}`}
          stroke="rgba(255,184,77,0.5)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <Path
          d={`M${ox + 40} ${oy} A40 40 0 0 0 ${(ox + 40 * cos).toFixed(1)} ${(oy - 40 * sin).toFixed(1)}`}
          stroke={C.corona}
          strokeWidth={1.5}
          fill="none"
        />
        <SvgText x={ox + 50} y={oy - 8} fill={C.corona} fontSize={11} fontWeight="600">
          {altTxt}°
        </SvgText>
        <Circle cx={sx} cy={sy} r={9} fill={C.corona} />
        <Circle cx={ox} cy={oy} r={4} fill={C.text} />
        <SvgText x={296} y={oy + 16} fill={C.dim} fontSize={9} textAnchor="end" letterSpacing={1}>
          {t('horizon.label', { dir: bearingLabel(azimuthDeg) })}
        </SvgText>
      </Svg>
      <Text style={s.horizonNote}>
        {t('horizon.note', { fist: fistTxt })}
        {altitudeDeg < 12 ? t('horizon.noteLow', { dir: bearingLabel(azimuthDeg) }) : ''}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  horizonNote: {
    fontFamily: F.regular,
    fontSize: 11,
    lineHeight: 16,
    color: C.dim,
    marginTop: 2,
    marginBottom: 14,
  },
});
