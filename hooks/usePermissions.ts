import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';

export interface Permissions {
  location: boolean;
  notifications: boolean;
  /** Solo la usa el visor del sol; su ausencia no afecta a nada más */
  camera: boolean;
}

export type PermissionKind = keyof Permissions;

const CHECK: Record<PermissionKind, () => Promise<{ granted: boolean }>> = {
  location: Location.getForegroundPermissionsAsync,
  notifications: Notifications.getPermissionsAsync,
  camera: Camera.getCameraPermissionsAsync,
};

const ASK: Record<PermissionKind, () => Promise<{ granted: boolean; canAskAgain: boolean }>> = {
  location: Location.requestForegroundPermissionsAsync,
  notifications: Notifications.requestPermissionsAsync,
  camera: Camera.requestCameraPermissionsAsync,
};

const NONE: Permissions = { location: false, notifications: false, camera: false };

/**
 * Estado de permisos, releído al arrancar y al volver a primer plano: el usuario
 * puede cambiarlos en Ajustes del sistema. `locationGranted` entra desde useGeo para
 * reflejar su petición inicial sin esperar al refresco.
 *
 * `request` los pide desde Ajustes, para no obligar a ir a buscarlos a la pantalla que
 * los usa. Cada sitio de uso conserva SU petición (useGeo, ensurePermissionAndChannel,
 * el visor): quien entra por ahí no debería pasar antes por Ajustes.
 */
export function usePermissions(locationGranted: boolean) {
  const [permissions, setPermissions] = useState<Permissions>(NONE);

  useEffect(() => {
    setPermissions((p) => ({ ...p, location: locationGranted }));
  }, [locationGranted]);

  const refresh = useCallback(() => {
    for (const kind of Object.keys(CHECK) as PermissionKind[]) {
      void CHECK[kind]()
        .then(({ granted }) => setPermissions((p) => ({ ...p, [kind]: granted })))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  /**
   * Pide un permiso. Denegado de forma permanente (`canAskAgain` false) el diálogo del
   * sistema ya no aparece, así que llevamos al usuario a los ajustes: sin esto, tocar la
   * fila no haría absolutamente nada y parecería que la app está rota.
   */
  const request = useCallback(async (kind: PermissionKind) => {
    try {
      const res = await ASK[kind]();
      setPermissions((p) => ({ ...p, [kind]: res.granted }));
      if (!res.granted && !res.canAskAgain) await Linking.openSettings();
    } catch {
      // El módulo nativo puede fallar (emulador sin servicios): el estado se queda como estaba
    }
  }, []);

  return { permissions, request };
}
