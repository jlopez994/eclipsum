import { useEffect, useRef } from 'react';
import { Animated, LayoutAnimation } from 'react-native';

/** Anima el siguiente cambio de layout (puntos que se mueven, filas que aparecen). */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/**
 * Opacidad que late entre 1 y 0,25 — el «parpadeo» de lo que está vivo ahora mismo
 * (punto de estado y marcador de la serie). `enabled: false` la deja fija en 1: lo
 * terminado no parpadea. Driver nativo, así que no compite con el reloj de 1 s.
 */
export function usePulseOpacity(halfMs: number, enabled = true): Animated.Value {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.25, duration: halfMs, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: halfMs, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, halfMs, enabled]);
  return v;
}

/** Cede el hilo JS un tick: trocea trabajo pesado para no congelar animaciones ni toques. */
export const yieldUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
