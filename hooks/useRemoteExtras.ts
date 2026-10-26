import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { fetchRemoteExtras, type RemoteExtras, type Sponsor, type SuggestedSpot } from '../lib/firebase';
import type { UpdateChannel } from '../lib/prefs';

/**
 * En desarrollo la app se hace pasar por una build antigua para que el aviso de
 * actualización sea visible sin publicar nada. Inerte en release (`__DEV__` = false);
 * si estorba mientras trabajas, la ✕ lo quita hasta el siguiente arranque.
 */
const PREVIEW_UPDATE_IN_DEV = __DEV__;

/** APK que la app puede descargar e instalar por sí misma */
export interface ApkUpdate {
  url: string;
  sha256: string;
}

export interface RemoteExtrasState {
  /** Banner superior servido por RC; vacío = sin aviso */
  message: string;
  /** URL de gafas certificadas (afiliado); vacío = sin enlace */
  glassesUrl: string;
  /** URL de donaciones; vacío = sin sección ni aviso de propina */
  donateUrl: string;
  /** Patrocinador del eclipse; null = sin tarjeta */
  sponsor: Sponsor | null;
  /** Puestos recomendados; vacío = el selector no enseña la sección */
  suggestedSpots: SuggestedSpot[];
  /** APK nueva cuando RC anuncia un versionCode mayor; null = sin aviso */
  update: ApkUpdate | null;
  /** Sube en cada lectura: RC puede cambiar el eclipse activo → recalcular circunstancias */
  catalogEpoch: number;
}

const EMPTY: RemoteExtrasState = {
  message: '',
  glassesUrl: '',
  donateUrl: '',
  sponsor: null,
  suggestedSpots: [],
  update: null,
  catalogEpoch: 0,
};

/**
 * APK a anunciar según el canal elegido. En beta gana la más nueva de las dos: quien
 * prueba betas no debe perderse una estable posterior (al publicar la estable de una
 * beta su versionCode es mayor, así que el aviso lleva a la definitiva).
 */
function updateFor(r: RemoteExtras, channel: UpdateChannel, ownVc: number): ApkUpdate | null {
  const candidates = [{ vc: r.latestVersionCode, url: r.latestApkUrl, sha256: r.latestApkSha256 }];
  if (channel === 'beta') {
    candidates.push({ vc: r.latestBetaVersionCode, url: r.latestBetaApkUrl, sha256: r.latestBetaApkSha256 });
  }
  const best = candidates
    .filter((c) => c.url !== '' && c.sha256 !== '' && c.vc > ownVc)
    .sort((a, b) => b.vc - a.vc)[0];
  return best ? { url: best.url, sha256: best.sha256 } : null;
}

/**
 * Remote Config al arrancar, al volver a primer plano y bajo demanda con checkNow (botón
 * «Buscar actualizaciones»). Nunca lanza: sin red se queda con lo último activado.
 */
export function useRemoteExtras(
  channel: UpdateChannel,
): RemoteExtrasState & { /** false = RC no respondió */ checkNow: () => Promise<boolean> } {
  const [state, setState] = useState<RemoteExtrasState>(EMPTY);
  const lastPull = useRef(0);

  // channel en las deps: cambiarlo en Ajustes reevalúa el aviso sin esperar a otro arranque
  const pull = useCallback(
    (force: boolean) => {
      const id = ++lastPull.current;
      return fetchRemoteExtras(force).then((r) => {
        // Una consulta anterior que acabe tarde (p. ej. con el canal de antes) no pisa la última
        if (id !== lastPull.current) return r.fetched;
        // Actualización sin tienda: RC anuncia versionCode, URL y sha256 de la APK
        const ownVc = PREVIEW_UPDATE_IN_DEV ? 0 : Constants.expoConfig?.android?.versionCode ?? 0;
        setState((prev) => ({
          message: r.message,
          glassesUrl: r.glassesUrl,
          donateUrl: r.donateUrl,
          sponsor: r.sponsor,
          suggestedSpots: r.suggestedSpots,
          update: updateFor(r, channel, ownVc),
          catalogEpoch: prev.catalogEpoch + 1,
        }));
        return r.fetched;
      });
    },
    [channel],
  );

  useEffect(() => {
    void pull(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void pull(false);
    });
    return () => sub.remove();
  }, [pull]);

  return { ...state, checkNow: () => pull(true) };
}
