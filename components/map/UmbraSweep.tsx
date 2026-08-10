import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Barrido ambiental de la umbra a lo largo de la banda (O→E, como el 12-ago). */
export function UmbraSweep() {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(2200),
      ]),
    ).start();
  }, [x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-160, 760] });
  return (
    <Animated.View pointerEvents="none" style={[s.umbra, { transform: [{ translateX }] }]}>
      <Svg width={140} height={140}>
        <Defs>
          <RadialGradient id="umbraGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.55} />
            <Stop offset="55%" stopColor="#000" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={140} height={140} fill="url(#umbraGlow)" />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  umbra: { position: 'absolute', top: '50%', marginTop: -70, left: 0, width: 140, height: 140 },
});
