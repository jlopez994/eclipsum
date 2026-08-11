import { useEffect, useState } from 'react';
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
  /** URL de la APK nueva cuando RC anuncia un versionCode mayor; vacío = sin aviso */
  updateUrl: string;
  /** Sube en cada lectura: RC puede cambiar el eclipse activo → recalcular circunstancias */
  catalogEpoch: number;
}

const EMPTY: RemoteExtrasState = {
  message: '',
  glassesUrl: '',
  donateUrl: '',
  sponsor: null,
  suggestedSpots: [],
  updateUrl: '',
  catalogEpoch: 0,
};

/**
 * APK a anunciar según el canal elegido. En beta gana la más nueva de las dos: quien
 * prueba betas no debe perderse una estable posterior (al publicar la estable de una
 * beta su versionCode es mayor, así que el aviso lleva a la definitiva).
 */
function updateFor(r: RemoteExtras, channel: UpdateChannel, ownVc: number): string {
  const candidates = [{ vc: r.latestVersionCode, url: r.latestApkUrl }];
  if (channel === 'beta') candidates.push({ vc: r.latestBetaVersionCode, url: r.latestBetaApkUrl });
  return candidates.filter((c) => c.url !== '' && c.vc > ownVc).sort((a, b) => b.vc - a.vc)[0]?.url ?? '';
}

/**
 * Remote Config al arrancar y al volver a primer plano (fetchRemoteExtras respeta
 * su propia caché). Nunca lanza: sin red se queda con lo último activado.
 */
export function useRemoteExtras(channel: UpdateChannel): RemoteExtrasState {
  const [state, setState] = useState<RemoteExtrasState>(EMPTY);

  useEffect(() => {
    const pull = () =>
      void fetchRemoteExtras().then((r) => {
        // Aviso de actualización sin tienda: RC anuncia versionCode y URL de la APK
        const ownVc = PREVIEW_UPDATE_IN_DEV ? 0 : Constants.expoConfig?.android?.versionCode ?? 0;
        setState((prev) => ({
          message: r.message,
          glassesUrl: r.glassesUrl,
          donateUrl: r.donateUrl,
          sponsor: r.sponsor,
          suggestedSpots: r.suggestedSpots,
          updateUrl: updateFor(r, channel, ownVc),
          catalogEpoch: prev.catalogEpoch + 1,
        }));
      });

    pull();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') pull();
    });
    return () => sub.remove();
    // channel en las deps: cambiarlo en Ajustes reevalúa el aviso sin esperar a otro arranque
  }, [channel]);

  return state;
}
