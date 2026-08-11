import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { fetchRemoteExtras, type Sponsor, type SuggestedSpot } from '../lib/firebase';

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
 * Remote Config al arrancar y al volver a primer plano (fetchRemoteExtras respeta
 * su propia caché). Nunca lanza: sin red se queda con lo último activado.
 */
export function useRemoteExtras(): RemoteExtrasState {
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
          updateUrl: r.latestVersionCode > ownVc && r.latestApkUrl ? r.latestApkUrl : '',
          catalogEpoch: prev.catalogEpoch + 1,
        }));
      });

    pull();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') pull();
    });
    return () => sub.remove();
  }, []);

  return state;
}
