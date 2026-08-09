import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { fetchAndActivate, getRemoteConfig, getString } from '@react-native-firebase/remote-config';

// Dev sin caché para probar banners al momento; release respeta 12 h
const FETCH_INTERVAL_MS = __DEV__ ? 0 : 12 * 3_600_000;

/**
 * Mensaje remoto configurable desde consola Firebase (parámetro `eclipse_message`).
 * Vacío = sin banner. Nunca lanza: sin red devuelve el último valor activado o ''.
 */
export async function fetchEclipseMessage(): Promise<string> {
  try {
    const rc = getRemoteConfig();
    // Asignar el objeto completo: en RNFirebase `settings` es un setter; mutar una propiedad no aplica nada
    rc.settings = { minimumFetchIntervalMillis: FETCH_INTERVAL_MS, fetchTimeoutMillis: 30_000 };
    rc.defaultConfig = { eclipse_message: '' };
    await fetchAndActivate(rc);
    return getString(rc, 'eclipse_message');
  } catch {
    return '';
  }
}

/** Analytics best-effort: nunca rompe la app por telemetría. */
export function track(event: string, params?: Record<string, string | number>): void {
  try {
    logEvent(getAnalytics(), event, params);
  } catch {
    // telemetría no crítica
  }
}
