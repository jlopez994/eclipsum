import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { C } from '../theme';

/** Punto del puesto activo con anillo pulsante. */
export function UserDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 2400, useNativeDriver: true }),
    ).start();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  return (
    <View style={s.dotWrap}>
      <Animated.View style={[s.dotRing, { transform: [{ scale }], opacity }]} />
      <View style={s.dot} />
    </View>
  );
}

/** Punto GPS sutil (anillo) cuando el puesto deseado está aparte. */
export function HereDot() {
  return (
    <View style={s.hereDotWrap}>
      <View style={s.hereDot} />
    </View>
  );
}

const s = StyleSheet.create({
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dotRing: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: C.text,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.text,
    shadowColor: C.text,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  hereDotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  hereDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.corona,
    backgroundColor: 'rgba(21,21,30,0.65)',
  },
});
