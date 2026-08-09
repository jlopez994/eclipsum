import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { LocalEclipse } from './eclipse';
import type { AlertSound, AlertToggles } from './prefs';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Canales distintos por sonido: en Android el audio del canal es inmutable una vez creado
const CHANNEL_BASE = 'eclipse-alerts-v3';

export const ALERT_SOUND_OPTIONS: { id: AlertSound; label: string; hint: string }[] = [
  { id: 'eclipse', label: 'Eclipsum', hint: 'Sonido propio de la app' },
  { id: 'default', label: 'Sistema', hint: 'Tono por defecto del móvil' },
];

function channelIdFor(sound: AlertSound): string {
  return `${CHANNEL_BASE}-${sound}`;
}

/** Nombre de fichero (custom) o 'default' (sistema). */
function soundFile(sound: AlertSound): string {
  return sound === 'eclipse' ? 'eclipse.wav' : 'default';
}

interface Alert {
  title: string;
  body: string;
  time: Date;
}

function buildAlerts(eclipse: LocalEclipse, enabled: AlertToggles): Alert[] {
  const byKey = (k: keyof AlertToggles) => (enabled[k] ? eclipse.events.find((e) => e.key === k) : undefined);
  const c1 = byKey('C1');
  const c2 = byKey('C2');
  const max = byKey('MAX');
  const c3 = byKey('C3');
  const c4 = byKey('C4');
  const minus = (d: Date, min: number) => new Date(d.getTime() - min * 60_000);

  const alerts: Alert[] = [];
  if (c1) {
    alerts.push(
      { title: 'Eclipse mañana', body: 'El eclipse solar empieza mañana a esta hora. Prepara las gafas.', time: minus(c1.time, 24 * 60) },
      { title: 'Eclipse en 1 hora', body: 'Primer contacto (parcial) en 1 hora. Busca horizonte oeste despejado.', time: minus(c1.time, 60) },
      { title: '☀️ Empieza en 10 min', body: 'GAFAS DE ECLIPSE PUESTAS para mirar al sol.', time: minus(c1.time, 10) },
    );
  }
  if (c2) {
    alerts.push({ title: '🌑 Totalidad en 2 min', body: 'Prepárate: durante la totalidad puedes mirar sin gafas.', time: minus(c2.time, 2) });
  }
  if (max) {
    alerts.push({ title: '🌗 Máximo en 1 min', body: 'Punto culminante del eclipse.', time: minus(max.time, 1) });
  }
  if (c3) {
    alerts.push({ title: '⚠️ FIN DE TOTALIDAD', body: 'GAFAS PUESTAS YA. El sol vuelve a ser peligroso.', time: c3.time });
  }
  if (c4) {
    alerts.push({ title: 'Fin del eclipse', body: 'Último contacto. Gracias por mirar al cielo con Eclipsum.', time: c4.time });
  }
  return alerts.filter((a) => a.time.getTime() > Date.now());
}

async function ensurePermissionAndChannel(sound: AlertSound): Promise<string> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Permiso de notificaciones denegado');
  const id = channelIdFor(sound);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(id, {
      name: sound === 'eclipse' ? 'Alertas de eclipse (Eclipsum)' : 'Alertas de eclipse (sistema)',
      importance: Notifications.AndroidImportance.MAX,
      sound: soundFile(sound),
      vibrationPattern: [0, 250, 150, 250, 150, 500],
    });
  }
  return id;
}

/** Notificación de prueba en 5 s — para validar canal/permisos antes del día del eclipse. */
export async function sendTestNotification(sound: AlertSound = 'eclipse'): Promise<void> {
  const channelId = await ensurePermissionAndChannel(sound);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🔔 Prueba Eclipsum',
      body: 'Las alertas funcionan. Listo para el eclipse.',
      sound: soundFile(sound),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId,
    },
  });
}

/** Programa alertas locales según toggles. Devuelve cuántas quedaron programadas. */
export async function scheduleEclipseAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  sound: AlertSound = 'eclipse',
): Promise<number> {
  const channelId = await ensurePermissionAndChannel(sound);

  // Reprogramar desde cero para evitar duplicados al cambiar toggles
  await Notifications.cancelAllScheduledNotificationsAsync();

  const alerts = buildAlerts(eclipse, enabled);
  for (const a of alerts) {
    await Notifications.scheduleNotificationAsync({
      content: { title: a.title, body: a.body, sound: soundFile(sound) },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: a.time,
        channelId,
      },
    });
  }
  return alerts.length;
}
