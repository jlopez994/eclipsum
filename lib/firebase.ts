import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { getCrashlytics, recordError } from '@react-native-firebase/crashlytics';
import { fetchAndActivate, getRemoteConfig, getString } from '@react-native-firebase/remote-config';
import { setRemoteActiveEclipseId, setRemoteCatalog } from './eclipseCatalog';

// Dev sin caché para probar banners al momento; release 1 h: los avisos de
// actualización se ven el mismo día y sigue lejos del throttling de RC
const FETCH_INTERVAL_MS = __DEV__ ? 0 : 3_600_000;

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
  /** Línea de copy opcional bajo el nombre en la tarjeta */
  tagline?: string;
}

/** RC `sponsor`: {"name","url","tagline"?}; inválido o vacío → null (nunca rompe). */
function parseSponsor(json: string): Sponsor | null {
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || r.name.length === 0) return null;
    if (typeof r.url !== 'string' || !r.url.startsWith('https://')) return null;
    return {
      name: r.name,
      url: r.url,
      tagline: typeof r.tagline === 'string' && r.tagline.length > 0 ? r.tagline : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Remote Config: banner, eclipse activo, catálogo extra, gafas, patrocinador y aviso de actualización.
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
      latest_apk_url: 'https://github.com/jlopez994/eclipsum/releases/latest/download/eclipsum.apk',
    };
    try {
      await fetchAndActivate(rc);
    } catch {
      // Sin red el fetch lanza, pero los últimos valores activados persisten en disco:
      // seguimos y los leemos igual (arranque en frío offline conserva catálogo y banner)
    }
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
  } catch (e) {
    // Aquí solo se llega por fallo del SDK (la falta de red se traga arriba): reportable
    trackError('remote_config', e);
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

/** Analytics best-effort: nunca rompe la app por telemetría. */
export function track(event: string, params?: Record<string, string | number>): void {
  try {
    logEvent(getAnalytics(), event, params);
  } catch {
    // telemetría no crítica
  }
}

/**
 * Error no fatal a Crashlytics, best-effort. Solo para fallos INESPERADOS:
 * los errores normales de red (sin conexión) no se reportan — serían puro ruido.
 */
export function trackError(scope: string, e: unknown): void {
  try {
    recordError(getCrashlytics(), e instanceof Error ? e : new Error(String(e)), scope);
  } catch {
    // telemetría no crítica
  }
}
