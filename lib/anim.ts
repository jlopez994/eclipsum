import { LayoutAnimation } from 'react-native';

/** Anima el siguiente cambio de layout (puntos que se mueven, filas que aparecen). */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}
