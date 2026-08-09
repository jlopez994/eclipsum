import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { fetchAndActivate, getRemoteConfig, getString } from '@react-native-firebase/remote-config';
import { setRemoteActiveEclipseId, setRemoteCatalog } from './eclipseCatalog';

// Dev sin caché para probar banners al momento; release respeta 12 h
const FETCH_INTERVAL_MS = __DEV__ ? 0 : 12 * 3_600_000;

export interface RemoteExtras {
  /** Banner superior; vacío = oculto */
  message: string;
  /** Id de catálogo forzado; vacío = resolución local */
  activeEclipseId: string;
}

/**
 * Remote Config: banner + eclipse activo opcional.
 * Nunca lanza: sin red devuelve últimos valores activados o defaults.
 */
export async function fetchRemoteExtras(): Promise<RemoteExtras> {
  try {
    const rc = getRemoteConfig();
    // Asignar el objeto completo: en RNFirebase `settings` es un setter; mutar una propiedad no aplica nada
    rc.settings = { minimumFetchIntervalMillis: FETCH_INTERVAL_MS, fetchTimeoutMillis: 30_000 };
    rc.defaultConfig = { eclipse_message: '', active_eclipse_id: '', eclipse_catalog: '[]' };
    await fetchAndActivate(rc);
    const message = getString(rc, 'eclipse_message');
    const activeEclipseId = getString(rc, 'active_eclipse_id');
    // Orden: primero el catálogo extra, luego el id activo (puede apuntar a una entrada remota)
    setRemoteCatalog(getString(rc, 'eclipse_catalog'));
    setRemoteActiveEclipseId(activeEclipseId);
    return { message, activeEclipseId };
  } catch {
    return { message: '', activeEclipseId: '' };
  }
}

/** @deprecated Prefer fetchRemoteExtras — se mantiene por scripts externos. */
export async function fetchEclipseMessage(): Promise<string> {
  return (await fetchRemoteExtras()).message;
}

/** Analytics best-effort: nunca rompe la app por telemetría. */
export function track(event: string, params?: Record<string, string | number>): void {
  try {
    logEvent(getAnalytics(), event, params);
  } catch {
    // telemetría no crítica
  }
}
