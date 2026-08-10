import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { bearingLabel } from '../../lib/totality';
import { C, F } from '../theme';

/** Píldora «TOTAL a X km al N» con flecha orientada al rumbo real. */
export function TotalPill({ distanceKm, bearingDeg }: { distanceKm: number; bearingDeg: number }) {
  return (
    <View style={s.totalPill}>
      <View style={{ transform: [{ rotate: `${bearingDeg}deg` }] }}>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.violet} strokeWidth={2.5}>
          <Path d="M12 19V5M6 11l6-6 6 6" />
        </Svg>
      </View>
      <Text style={s.totalPillText}>
        <Text style={{ color: C.violet, fontFamily: F.bold }}>TOTAL</Text> a{' '}
        <Text style={{ color: C.corona }}>{distanceKm} km</Text> al {bearingLabel(bearingDeg)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  totalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(21,21,30,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(124,108,255,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  totalPillText: { fontFamily: F.semibold, fontSize: 11, color: C.text },
});
