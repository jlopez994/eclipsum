import { LayoutAnimation } from 'react-native';

/** Anima el siguiente cambio de layout (puntos que se mueven, filas que aparecen). */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/** Cede el hilo JS un tick: trocea trabajo pesado para no congelar animaciones ni toques. */
export const yieldUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
