import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { fmtFixed1, t } from '../../lib/i18n';
import { C, F } from '../theme';

interface TerrainProfileProps {
  /** Silueta hacia el azimut del máximo (lib/horizon profileAngles) */
  points: { distKm: number; angleDeg: number }[];
  sunAltDeg: number;
  horizonDeg: number;
}

const W = 300;
const H = 84;
/** Línea de horizonte (0°) del lienzo */
const OY = 66;
const X0 = 8;
const X1 = 292;
/** Mismos extremos que el muestreo de lib/horizon (NEAR_KM/FAR_KM) */
const NEAR = 0.2;
const FAR = 20;

/**
 * Silueta del terreno hacia el sol en el máximo: el perfil que ya se descargó para el
 * veredicto, pintado. Eje x logarítmico —las mismas proporciones que el muestreo, denso
 * cerca— y eje y en grados aparentes, la magnitud que decide si tapa. El sol va como
 * línea de puntos a su altura: si la silueta la cruza, ahí está el monte del aviso.
 */
export function TerrainProfile({ points, sunAltDeg, horizonDeg }: TerrainProfileProps) {
  const x = (d: number) => X0 + (Math.log(d / NEAR) / Math.log(FAR / NEAR)) * (X1 - X0);
  // Techo con aire sobre lo más alto (sol o monte); suelo de 4° para que un llano no
  // dispare la escala y pinte ruido de decimales como cordillera
  const yMax = Math.max(sunAltDeg, horizonDeg, 4) * 1.25;
  const y = (a: number) => OY - (Math.max(a, 0) / yMax) * (OY - 14);
  const silhouette =
    `M${X0} ${OY} ` +
    points.map((p) => `L${x(p.distKm).toFixed(1)} ${y(p.angleDeg).toFixed(1)}`).join(' ') +
    ` L${X1} ${OY} Z`;
  const sunY = y(sunAltDeg);
  return (
    <View
      style={s.wrap}
      accessibilityLabel={t('horizon.profile.a11y', { h: fmtFixed1(horizonDeg), alt: fmtFixed1(sunAltDeg) })}
    >
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={OY} width={W} height={H - OY} fill="#101019" />
        <Path d={silhouette} fill="#1D1D2C" stroke="#3A3A50" strokeWidth={1} />
        <Path d={`M0 ${OY} H${W}`} stroke="#2A2A3C" strokeWidth={1.5} />
        {/* El sol a su altura aparente; la silueta por encima = el monte del aviso */}
        <Path
          d={`M${X0} ${sunY} H${X1 - 18}`}
          stroke="rgba(255,184,77,0.5)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <Circle cx={X1 - 9} cy={sunY} r={7} fill={C.corona} />
        {/* Marcas de distancia: el eje comprimido necesita referencias */}
        {[1, 5, 20].map((d) => (
          <SvgText key={d} x={x(d)} y={OY + 13} fill={C.dim} fontSize={9} textAnchor="middle">
            {d} km
          </SvgText>
        ))}
      </Svg>
      <Text style={s.note}>{t('horizon.profile.note')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  /** Aire sobre la nota del veredicto, que llega pegada (marginTop negativo propio) */
  wrap: { marginTop: 12 },
  note: { fontFamily: F.regular, fontSize: 11, lineHeight: 16, color: C.dim, marginTop: 4 },
});
