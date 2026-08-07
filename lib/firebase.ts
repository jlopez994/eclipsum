import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { fetchAndActivate, getRemoteConfig, getString } from '@react-native-firebase/remote-config';

const FETCH_INTERVAL_MS = 5 * 60_000; // corto para probar estos días; subir a 12h en producción

/**
 * Mensaje remoto configurable desde consola Firebase (parámetro `eclipse_message`).
 * Vacío = sin banner. Nunca lanza: sin red devuelve el último valor activado o ''.
 */
export async function fetchEclipseMessage(): Promise<string> {
  try {
    const rc = getRemoteConfig();
    rc.settings.minimumFetchIntervalMillis = FETCH_INTERVAL_MS;
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
