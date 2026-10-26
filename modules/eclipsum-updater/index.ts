import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Motivo de un fallo de instalación que llega desde PackageInstaller */
export type InstallStatusError = 'aborted' | 'conflict' | 'failed';

type UpdaterEvents = {
  /** -1 = el servidor no dio el tamaño */
  onProgress: (e: { percent: number }) => void;
  onStatus: (e: { error: InstallStatusError; detail: string }) => void;
};

declare class EclipsumUpdaterModule extends NativeModule<UpdaterEvents> {
  canInstall(): boolean;
  openInstallSettings(): void;
  /** Rechaza con code ERR_DOWNLOAD (red o sha256) o ERR_PREPARE */
  install(url: string, sha256: string): Promise<void>;
}

/** null fuera de Android: no hay instalador in-app */
export default requireOptionalNativeModule<EclipsumUpdaterModule>('EclipsumUpdater');
