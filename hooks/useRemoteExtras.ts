import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { fetchCdnCandidates, pickUpdate, type ApkUpdate, type UpdateCandidate } from '../lib/cdnUpdate';
import { fetchRemoteExtras, type RemoteExtras, type Sponsor, type SuggestedSpot } from '../lib/firebase';
import type { UpdateChannel } from '../lib/prefs';

export type { ApkUpdate };

/**
 * En desarrollo la app se hace pasar por una build antigua para que el aviso de
 * actualización sea visible sin publicar nada. Inerte en release (`__DEV__` = false);
 * si estorba mientras trabajas, la ✕ lo quita hasta el siguiente arranque.
 */
const PREVIEW_UPDATE_IN_DEV = __DEV__;

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
  /** APK nueva cuando el CDN o RC anuncian un versionCode mayor; null = sin aviso */
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
 * Candidatos de RC (GitHub) según el canal. En beta entran las dos: quien prueba betas no debe
 * perderse una estable posterior (al publicar la estable de una beta su versionCode es mayor).
 */
function rcCandidates(r: RemoteExtras, channel: UpdateChannel): UpdateCandidate[] {
  const candidates = [{ vc: r.latestVersionCode, url: r.latestApkUrl, sha256: r.latestApkSha256 }];
  if (channel === 'beta') {
    candidates.push({ vc: r.latestBetaVersionCode, url: r.latestBetaApkUrl, sha256: r.latestBetaApkSha256 });
  }
  return candidates;
}

/**
 * Remote Config y el CDN al arrancar, al volver a primer plano y bajo demanda con checkNow (botón
 * «Buscar actualizaciones»). Nunca lanza: sin red se queda con lo último activado.
 */
export function useRemoteExtras(
  channel: UpdateChannel,
): RemoteExtrasState & { /** false = no respondieron ni RC ni el CDN */ checkNow: () => Promise<boolean> } {
  const [state, setState] = useState<RemoteExtrasState>(EMPTY);
  const lastPull = useRef(0);

  // channel en las deps: cambiarlo en Ajustes reevalúa el aviso sin esperar a otro arranque
  const pull = useCallback(
    (force: boolean) => {
      const id = ++lastPull.current;
      return Promise.all([fetchRemoteExtras(force), fetchCdnCandidates(channel)]).then(([r, cdn]) => {
        const fetched = r.fetched || cdn !== null;
        // Una consulta anterior que acabe tarde (p. ej. con el canal de antes) no pisa la última
        if (id !== lastPull.current) return fetched;
        // Actualización sin tienda: el CDN (y RC, con la copia de GitHub) anuncian versionCode, URL y sha256
        const ownVc = PREVIEW_UPDATE_IN_DEV ? 0 : Constants.expoConfig?.android?.versionCode ?? 0;
        setState((prev) => ({
          message: r.message,
          glassesUrl: r.glassesUrl,
          donateUrl: r.donateUrl,
          sponsor: r.sponsor,
          suggestedSpots: r.suggestedSpots,
          update: pickUpdate(cdn ?? [], rcCandidates(r, channel), ownVc),
          catalogEpoch: prev.catalogEpoch + 1,
        }));
        return fetched;
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
