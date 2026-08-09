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
  /** URL de gafas certificadas (afiliado); vacío = botón oculto */
  glassesUrl: string;
  /** Patrocinador del eclipse activo; null = sin patrocinio */
  sponsor: Sponsor | null;
  /** versionCode de la última APK publicada; 0 = sin dato */
  latestVersionCode: number;
  /** URL de descarga de la última APK; vacío = sin aviso de actualización */
  latestApkUrl: string;
}

export interface Sponsor {
  name: string;
  url: string;
}

/** RC `sponsor`: {"name","url"}; inválido o vacío → null (nunca rompe). */
function parseSponsor(json: string): Sponsor | null {
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || r.name.length === 0) return null;
    if (typeof r.url !== 'string' || !r.url.startsWith('https://')) return null;
    return { name: r.name, url: r.url };
  } catch {
    return null;
  }
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
    rc.defaultConfig = {
      eclipse_message: '',
      active_eclipse_id: '',
      eclipse_catalog: '[]',
      glasses_url: '',
      sponsor: '',
      latest_version_code: '0',
      latest_apk_url: '',
    };
    await fetchAndActivate(rc);
    const message = getString(rc, 'eclipse_message');
    const activeEclipseId = getString(rc, 'active_eclipse_id');
    const glassesUrl = getString(rc, 'glasses_url');
    const sponsor = parseSponsor(getString(rc, 'sponsor'));
    const latestVersionCode = Number.parseInt(getString(rc, 'latest_version_code'), 10) || 0;
    const latestApkUrl = getString(rc, 'latest_apk_url');
    // Orden: primero el catálogo extra, luego el id activo (puede apuntar a una entrada remota)
    setRemoteCatalog(getString(rc, 'eclipse_catalog'));
    setRemoteActiveEclipseId(activeEclipseId);
    return { message, activeEclipseId, glassesUrl, sponsor, latestVersionCode, latestApkUrl };
  } catch {
    return {
      message: '',
      activeEclipseId: '',
      glassesUrl: '',
      sponsor: null,
      latestVersionCode: 0,
      latestApkUrl: '',
    };
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
