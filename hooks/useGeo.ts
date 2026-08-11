import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export interface Geo {
  lat: number;
  lon: number;
  place: string;
}

/**
 * Resuelve la posición GPS al arrancar; geo null = sin permiso o sin señal.
 *
 * Reintenta al volver a primer plano SI seguimos sin posición: el permiso se puede
 * conceder desde Ajustes de la app o desde los del sistema, y sin este reintento la
 * app se quedaba sin ubicación hasta reiniciarla. Con posición ya resuelta no se
 * repite — un fix nuevo en cada vuelta a primer plano no aporta nada y gasta batería.
 */
export function useGeo() {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [locating, setLocating] = useState(true);
  const [granted, setGranted] = useState(false);

  const alive = useRef(true);
  const running = useRef(false);
  const hasGeo = useRef(false);
  // Evita que el geocoder lento de la posición vieja pise a la nueva
  const applySeq = useRef(0);

  const apply = useCallback(async (lat: number, lon: number) => {
    const seq = ++applySeq.current;
    let place = 'GPS';
    try {
      const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (addr?.city) place = `${addr.city} · GPS`;
    } catch {
      // sin geocoder: mostramos solo GPS
    }
    if (alive.current && seq === applySeq.current) {
      hasGeo.current = true;
      setGeo({ lat, lon, place });
    }
  }, []);

  /** `ask` true = pedir el permiso (arranque); false = solo consultarlo (reintento) */
  const locate = useCallback(
    async (ask: boolean) => {
      if (running.current) return;
      running.current = true;
      setLocating(true);
      try {
        const { status } = ask
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
        if (!alive.current) return;
        setGranted(status === 'granted');
        if (status !== 'granted') {
          setGeo(null);
          return;
        }
        // Última posición conocida primero: pinta al instante mientras llega el fix fresco
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (!alive.current) return;
        if (last) {
          hasGeo.current = true;
          setGeo({ lat: last.coords.latitude, lon: last.coords.longitude, place: 'GPS' });
          setLocating(false);
          void apply(last.coords.latitude, last.coords.longitude);
        }
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (alive.current) await apply(pos.coords.latitude, pos.coords.longitude);
        } catch {
          // sin fix fresco (interiores, emulador): nos quedamos con la última conocida
          if (!last && alive.current) setGeo(null);
        }
      } finally {
        running.current = false;
        if (alive.current) setLocating(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    alive.current = true;
    void locate(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !hasGeo.current) void locate(false);
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [locate]);

  return { geo, locating, granted };
}
