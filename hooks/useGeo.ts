import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface Geo {
  lat: number;
  lon: number;
  place: string;
}

/** Resuelve la posición GPS una vez al arrancar; geo null = sin permiso o sin señal. */
export function useGeo() {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [locating, setLocating] = useState(true);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Evita que el geocoder lento de la posición vieja pise a la nueva
    let applySeq = 0;

    const apply = async (lat: number, lon: number) => {
      const seq = ++applySeq;
      let place = 'GPS';
      try {
        const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (addr?.city) place = `${addr.city} · GPS`;
      } catch {
        // sin geocoder: mostramos solo GPS
      }
      if (!cancelled && seq === applySeq) setGeo({ lat, lon, place });
    };

    (async () => {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        setGranted(status === 'granted');
        if (status !== 'granted') {
          setGeo(null);
          return;
        }
        // Última posición conocida primero: pinta al instante mientras llega el fix fresco
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (cancelled) return;
        if (last) {
          setGeo({ lat: last.coords.latitude, lon: last.coords.longitude, place: 'GPS' });
          setLocating(false);
          void apply(last.coords.latitude, last.coords.longitude);
        }
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (!cancelled) await apply(pos.coords.latitude, pos.coords.longitude);
        } catch {
          // sin fix fresco (interiores, emulador): nos quedamos con la última conocida
          if (!last && !cancelled) setGeo(null);
        }
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { geo, locating, granted };
}
