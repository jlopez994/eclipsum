import { useEffect, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

/** Cierra con un arrastre largo o con un tirón corto pero rápido. */
const CLOSE_DY = 90;
const CLOSE_VY = 0.8;

/**
 * Cierre por arrastre de una hoja modal. Los panHandlers van en la cabecera (asa + título),
 * no en el panel entero, para no pelear con el ScrollView de la lista.
 */
export function useDragToClose(visible: boolean, onClose: () => void) {
  const dy = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Se cierra desde donde se soltó; al reabrir vuelve a su sitio
  useEffect(() => {
    if (visible) dy.setValue(0);
  }, [visible, dy]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => dy.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > CLOSE_DY || g.vy > CLOSE_VY) onCloseRef.current();
        else Animated.spring(dy, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(dy, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;

  return { translateY: dy, panHandlers: pan.panHandlers };
}
