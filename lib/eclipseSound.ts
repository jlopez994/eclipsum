import Constants from 'expo-constants';
import type { AudioSource } from 'expo-audio';

const ANDROID_PKG = Constants.expoConfig?.android?.package ?? 'com.jlopez.eclipsum';

/** En Android, el wav que el plugin de expo-notifications ya deja en res/raw: un require lo empaquetaría dos veces */
export const ECLIPSE_SOUND: AudioSource = { uri: `android.resource://${ANDROID_PKG}/raw/eclipse` };
