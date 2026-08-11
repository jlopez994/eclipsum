import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

export interface Permissions {
  location: boolean;
  notifications: boolean;
}

/**
 * Estado de permisos, releído al arrancar y al volver a primer plano: el usuario
 * puede cambiarlos en Ajustes del sistema. Aquí NUNCA se piden — solo se consultan;
 * la petición vive donde hace falta (useGeo, ensurePermissionAndChannel).
 * `locationGranted` entra desde useGeo para reflejar su petición inicial sin esperar.
 */
export function usePermissions(locationGranted: boolean): Permissions {
  const [permissions, setPermissions] = useState<Permissions>({ location: false, notifications: false });

  useEffect(() => {
    setPermissions((p) => ({ ...p, location: locationGranted }));
  }, [locationGranted]);

  useEffect(() => {
    const refresh = () => {
      void Notifications.getPermissionsAsync().then(({ status }) =>
        setPermissions((p) => ({ ...p, notifications: status === 'granted' })),
      );
      void Location.getForegroundPermissionsAsync().then(({ status }) =>
        setPermissions((p) => ({ ...p, location: status === 'granted' })),
      );
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, []);

  return permissions;
}
