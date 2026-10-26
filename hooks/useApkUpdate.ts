import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import Updater, { type InstallStatusError } from '../modules/eclipsum-updater';
import type { ApkUpdate } from './useRemoteExtras';

export type ApkUpdateState =
  | { kind: 'available' }
  | { kind: 'needsPermission' }
  /** percent -1 = tamaño desconocido */
  | { kind: 'downloading'; percent: number }
  | { kind: 'installing' }
  | { kind: 'failed'; error: 'download' | 'prepare' | InstallStatusError; detail: string };

export interface ApkUpdateUi {
  state: ApkUpdateState;
  install: () => void;
  openSettings: () => void;
}

/**
 * Descarga e instala la APK nueva dentro de la app (módulo nativo eclipsum-updater). Vive en App
 * para que una descarga en curso no pierda su estado si el aviso se desmonta (modo eclipse).
 */
export function useApkUpdate(update: ApkUpdate | null): ApkUpdateUi | null {
  const [state, setState] = useState<ApkUpdateState>({ kind: 'available' });

  useEffect(() => {
    if (!Updater) return;
    const subs = [
      // Solo mientras descarga: un evento rezagado no debe pisar «instalando»
      Updater.addListener('onProgress', ({ percent }) =>
        setState((s) => (s.kind === 'downloading' ? { kind: 'downloading', percent } : s)),
      ),
      Updater.addListener('onStatus', ({ error, detail }) => setState({ kind: 'failed', error, detail })),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  if (!update) return null;

  const install = () => {
    // Sin módulo nativo (fuera de Android) queda el aviso de siempre: abrir la descarga
    if (!Updater) {
      Linking.openURL(update.url).catch(() => {});
      return;
    }
    if (state.kind === 'downloading' || state.kind === 'installing') return;
    if (!Updater.canInstall()) {
      setState({ kind: 'needsPermission' });
      return;
    }
    setState({ kind: 'downloading', percent: -1 });
    Updater.install(update.url, update.sha256).then(
      // Condicional: si Android ya rechazó la instalación (onStatus), ese error manda
      () => setState((s) => (s.kind === 'downloading' ? { kind: 'installing' } : s)),
      (e: { code?: string; message?: string }) =>
        setState({
          kind: 'failed',
          error: e.code === 'ERR_DOWNLOAD' ? 'download' : 'prepare',
          // Expo antepone «Call to function … has been rejected → Caused by: …»; vale lo último
          detail: e.message?.split('Caused by: ').pop() ?? '',
        }),
    );
  };

  return { state, install, openSettings: () => Updater?.openInstallSettings() };
}
