import { Linking, Platform } from 'react-native';

/** Abre lat/lon en Maps del sistema (Apple Maps / geo: / Google Maps). */
export async function openInMaps(lat: number, lon: number, label?: string): Promise<void> {
  const q = encodeURIComponent(label?.trim() || `${lat},${lon}`);
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?ll=${lat},${lon}&q=${q}`
      : `geo:${lat},${lon}?q=${lat},${lon}(${q})`;
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // caemos al fallback web
  }
  await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`);
}
