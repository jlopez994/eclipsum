import { LayoutAnimation, Platform, UIManager } from 'react-native';

// Arquitectura antigua de Android lo necesita activado; en Fabric es no-op
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Anima el siguiente cambio de layout (puntos que se mueven, filas que aparecen). */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}
