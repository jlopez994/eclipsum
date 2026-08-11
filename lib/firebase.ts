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
  /** URL de gafas certificadas (afiliado); vacío = botón oculto */
  glassesUrl: string;
  /** URL de donaciones (Buy Me a Coffee); vacío = sección oculta */
  donateUrl: string;
  /** Patrocinador del eclipse activo; null = sin patrocinio */
  sponsor: Sponsor | null;
  /** versionCode de la última APK estable publicada; 0 = sin dato */
  latestVersionCode: number;
  /** URL de descarga de la última APK estable; vacío = sin aviso de actualización */
  latestApkUrl: string;
  /** versionCode de la última beta (pre-release); solo lo mira el canal beta */
  latestBetaVersionCode: number;
  /** URL de la APK de la última beta (asset de su tag); vacío = sin aviso de beta */
  latestBetaApkUrl: string;
  /** Puestos recomendados para el selector; vacío = sección oculta */
  suggestedSpots: SuggestedSpot[];
}

/** Puesto curado que viaja en RC: el selector calcula sus circunstancias en local. */
export interface SuggestedSpot {
  name: string;
  lat: number;
  lon: number;
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

/** Tope de la lista curada: son sugerencias, no un directorio. */
const MAX_SUGGESTED_SPOTS = 6;

/**
 * Lista curada empaquetada: el día del eclipse la red falla justo cuando importa,
 * así que el default del cliente lleva ya las sugerencias del 12-ago-2026.
 * RC la sobrescribe sin publicar APK; el filtro por banda evita que se cuele en otro eclipse.
 */
const BUNDLED_SUGGESTED_SPOTS = JSON.stringify([
  { name: 'Palencia', lat: 42.0096, lon: -4.5288 },
  { name: 'Burgos', lat: 42.3439, lon: -3.6969 },
  { name: 'Soria', lat: 41.7665, lon: -2.479 },
  { name: 'Zaragoza', lat: 41.6488, lon: -0.8891 },
  { name: 'Teruel', lat: 40.3456, lon: -1.1065 },
  { name: 'Peñíscola', lat: 40.3583, lon: 0.4067 },
]);

/** RC `suggested_spots`: [{"name","lat","lon"}]; entradas inválidas se descartan (nunca rompe). */
function parseSuggestedSpots(json: string): SuggestedSpot[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    const out: SuggestedSpot[] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      if (typeof r.name !== 'string' || r.name.length === 0) continue;
      if (typeof r.lat !== 'number' || !Number.isFinite(r.lat) || Math.abs(r.lat) > 90) continue;
      if (typeof r.lon !== 'number' || !Number.isFinite(r.lon) || Math.abs(r.lon) > 180) continue;
      out.push({ name: r.name, lat: r.lat, lon: r.lon });
      if (out.length === MAX_SUGGESTED_SPOTS) break;
    }
    return out;
  } catch {
    return [];
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
      donate_url: '',
      sponsor: '',
      latest_version_code: '0',
      suggested_spots: BUNDLED_SUGGESTED_SPOTS,
      latest_apk_url: 'https://github.com/jlopez994/eclipsum/releases/latest/download/eclipsum.apk',
      // Sin default útil: la URL de una beta apunta al asset de SU tag, así que la escribe
      // el workflow en cada publicación. 0 + vacío = el canal beta no avisa de nada.
      latest_beta_version_code: '0',
      latest_beta_apk_url: '',
    };
    try {
      await fetchAndActivate(rc);
    } catch {
      // Sin red el fetch lanza, pero los últimos valores activados persisten en disco:
      // seguimos y los leemos igual (arranque en frío offline conserva catálogo y banner)
    }
    const message = getString(rc, 'eclipse_message');
    const glassesUrl = getString(rc, 'glasses_url');
    const donateUrl = getString(rc, 'donate_url');
    const sponsor = parseSponsor(getString(rc, 'sponsor'));
    const latestVersionCode = Number.parseInt(getString(rc, 'latest_version_code'), 10) || 0;
    const latestApkUrl = getString(rc, 'latest_apk_url');
    const latestBetaVersionCode = Number.parseInt(getString(rc, 'latest_beta_version_code'), 10) || 0;
    const latestBetaApkUrl = getString(rc, 'latest_beta_apk_url');
    const suggestedSpots = parseSuggestedSpots(getString(rc, 'suggested_spots'));
    // Orden: primero el catálogo extra, luego el id activo (puede apuntar a una entrada remota)
    setRemoteCatalog(getString(rc, 'eclipse_catalog'));
    setRemoteActiveEclipseId(getString(rc, 'active_eclipse_id'));
    return {
      message,
      glassesUrl,
      donateUrl,
      sponsor,
      latestVersionCode,
      latestApkUrl,
      latestBetaVersionCode,
      latestBetaApkUrl,
      suggestedSpots,
    };
  } catch (e) {
    // Aquí solo se llega por fallo del SDK (la falta de red se traga arriba): reportable
    trackError('remote_config', e);
    return {
      message: '',
      glassesUrl: '',
      donateUrl: '',
      sponsor: null,
      latestVersionCode: 0,
      latestApkUrl: '',
      latestBetaVersionCode: 0,
      latestBetaApkUrl: '',
      suggestedSpots: [],
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
