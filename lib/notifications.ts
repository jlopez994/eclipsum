import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { LocalEclipse } from './eclipse';
import type { AlertToggles } from './prefs';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// v2: canal con sonido propio — los canales Android son inmutables una vez creados
const CHANNEL_ID = 'eclipse-alerts-v2';
const SOUND = 'eclipse.wav';

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

async function ensurePermissionAndChannel(): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Permiso de notificaciones denegado');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Alertas de eclipse',
      importance: Notifications.AndroidImportance.MAX,
      sound: SOUND,
      vibrationPattern: [0, 250, 150, 250, 150, 500],
    });
  }
}

/** Notificación de prueba en 5 s — para validar canal/permisos antes del día del eclipse. */
export async function sendTestNotification(): Promise<void> {
  await ensurePermissionAndChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title: '🔔 Prueba Eclipsum', body: 'Las alertas funcionan. Listo para el eclipse.', sound: SOUND },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: CHANNEL_ID,
    },
  });
}

/** Programa alertas locales según toggles. Devuelve cuántas quedaron programadas. */
export async function scheduleEclipseAlerts(eclipse: LocalEclipse, enabled: AlertToggles): Promise<number> {
  await ensurePermissionAndChannel();

  // Reprogramar desde cero para evitar duplicados al cambiar toggles
  await Notifications.cancelAllScheduledNotificationsAsync();

  const alerts = buildAlerts(eclipse, enabled);
  for (const a of alerts) {
    await Notifications.scheduleNotificationAsync({
      content: { title: a.title, body: a.body, sound: SOUND },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: a.time,
        channelId: CHANNEL_ID,
      },
    });
  }
  return alerts.length;
}
