import { useEffect, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

/**
 * Hoja inferior arrastrable: altura animada entre minH (peek) y maxH con snap
 * al soltar. Si cambia el peek medido y estaba colapsada, se reancla al mínimo.
 */
export function useSheet(maxH: number, minH: number) {
  const height = useRef(new Animated.Value(minH)).current;
  const current = useRef(minH);
  const maxRef = useRef(maxH);
  const minRef = useRef(minH);
  const prevMinRef = useRef(minH);
  maxRef.current = maxH;
  minRef.current = minH;

  useEffect(() => {
    const id = height.addListener(({ value }) => {
      current.current = value;
    });
    return () => height.removeListener(id);
  }, [height]);

  // Al medir el peek (p. ej. al volver al tab), reancorar si estaba colapsada.
  // Ojo: el fallback inicial suele ser MAYOR que el peek real — no basta con
  // `current <= minH + 8` porque entonces no encoje y asoma la cronología.
  useEffect(() => {
    const prevMin = prevMinRef.current;
    prevMinRef.current = minH;
    if (minH === prevMin) return;
    const collapsed = Math.abs(current.current - prevMin) <= 10 || current.current <= minH + 10;
    if (collapsed) {
      height.stopAnimation();
      height.setValue(minH);
      current.current = minH;
    }
  }, [minH, height]);

  const snapTo = (v: number) =>
    Animated.spring(height, { toValue: v, useNativeDriver: false, bounciness: 6 }).start();

  const startH = useRef(minH);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        height.stopAnimation();
        startH.current = current.current;
      },
      onPanResponderMove: (_e, g) => {
        height.setValue(Math.min(maxRef.current, Math.max(minRef.current, startH.current - g.dy)));
      },
      onPanResponderRelease: (_e, g) => {
        const mid = (minRef.current + maxRef.current) / 2;
        if (Math.abs(g.dy) < 6) {
          snapTo(startH.current > mid ? minRef.current : maxRef.current);
        } else {
          snapTo(startH.current - g.dy > mid ? maxRef.current : minRef.current);
        }
      },
    }),
  ).current;

  return { height, pan };
}
