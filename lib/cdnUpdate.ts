import type { UpdateChannel } from './prefs';

/** APK que la app puede descargar e instalar por sí misma */
export interface ApkUpdate {
  url: string;
  sha256: string;
  /** La misma APK en GitHub, por si la descarga del CDN falla */
  fallbackUrl?: string;
}

export interface UpdateCandidate {
  vc: number;
  url: string;
  sha256: string;
}

/** Manifiestos que escribe Jenkins (Jenkinsfile.cdn): latest.json estable y beta.json */
export const CDN_BASE = 'https://cdn.jlh.app/eclipsum';
// Corto: el resto de lo de RC (banner, catálogo) espera a esta consulta
const CDN_TIMEOUT_MS = 5_000;

/** Entrada `android` de un manifiesto del CDN; null = falta o no vale (mismas reglas que RC). */
export function parseCdnManifest(raw: unknown): UpdateCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = (raw as Record<string, unknown>).android;
  if (typeof a !== 'object' || a === null) return null;
  const { versionCode, url, sha256 } = a as Record<string, unknown>;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256.toLowerCase())) return null;
  return { vc: versionCode, url, sha256: sha256.toLowerCase() };
}

async function fetchManifest(name: string): Promise<UpdateCandidate | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CDN_TIMEOUT_MS);
  try {
    const res = await fetch(`${CDN_BASE}/${name}`, { signal: ctrl.signal, cache: 'no-store' });
    // Sin beta publicada beta.json da 404: no es un fallo del CDN
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCdnManifest(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Candidatos del CDN para el canal; null = el CDN no respondió (queda RC/GitHub). Nunca lanza. */
export async function fetchCdnCandidates(channel: UpdateChannel): Promise<UpdateCandidate[] | null> {
  try {
    const names = channel === 'beta' ? ['latest.json', 'beta.json'] : ['latest.json'];
    const found = await Promise.all(names.map(fetchManifest));
    return found.filter((c): c is UpdateCandidate => c !== null);
  } catch {
    return null;
  }
}

/**
 * La APK más nueva que la propia entre CDN y RC (GitHub); en empate gana el CDN, con la URL de
 * GitHub de respaldo si RC anuncia la misma build. Si el CDN se queda atrás, manda GitHub.
 */
export function pickUpdate(cdn: UpdateCandidate[], rc: UpdateCandidate[], ownVc: number): ApkUpdate | null {
  const best = [...cdn, ...rc]
    .filter((c) => c.url !== '' && c.sha256 !== '' && c.vc > ownVc)
    .reduce<UpdateCandidate | null>((b, c) => (b === null || c.vc > b.vc ? c : b), null);
  if (!best) return null;
  const twin = rc.find((c) => c.vc === best.vc && c.sha256 === best.sha256 && c.url !== '' && c.url !== best.url);
  return twin ? { url: best.url, sha256: best.sha256, fallbackUrl: twin.url } : { url: best.url, sha256: best.sha256 };
}
