import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { LocalEclipse } from './eclipse';
import type { AlertEarly, AlertSound, AlertToggles, C1PlanAlerts } from './prefs';
import { ALERT_EARLY_SECONDS, DEFAULT_ALERT_EARLY, DEFAULT_C1_PLAN_ALERTS } from './prefs';

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

function leadSeconds(early: boolean): number {
  return early ? ALERT_EARLY_SECONDS : 0;
}

function minusSeconds(d: Date, sec: number): Date {
  return new Date(d.getTime() - sec * 1000);
}

function minusMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() - min * 60_000);
}

function buildAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  early: AlertEarly,
  c1Plan: C1PlanAlerts,
): Alert[] {
  const byKey = (k: keyof AlertToggles) => (enabled[k] ? eclipse.events.find((e) => e.key === k) : undefined);
  const c1 = byKey('C1');
  const c2 = byKey('C2');
  const max = byKey('MAX');
  const c3 = byKey('C3');
  const c4 = byKey('C4');

  const alerts: Alert[] = [];
  if (c1) {
    if (c1Plan.before24h) {
      alerts.push({
        title: 'Eclipse mañana',
        body: 'El eclipse solar empieza mañana a esta hora. Prepara las gafas.',
        time: minusMinutes(c1.time, 24 * 60),
      });
    }
    if (c1Plan.before1h) {
      alerts.push({
        title: 'Eclipse en 1 hora',
        body: 'Primer contacto (parcial) en 1 hora. Busca horizonte oeste despejado.',
        time: minusMinutes(c1.time, 60),
      });
    }
    alerts.push({
      title: early.C1 ? '☀️ Empieza en unos segundos' : '☀️ Empieza el eclipse',
      body: 'GAFAS DE ECLIPSE PUESTAS para mirar al sol.',
      time: minusSeconds(c1.time, leadSeconds(early.C1)),
    });
  }
  if (c2) {
    alerts.push({
      title: early.C2 ? '🌑 Totalidad en unos segundos' : '🌑 Totalidad',
      body: 'Prepárate: durante la totalidad puedes mirar sin gafas.',
      time: minusSeconds(c2.time, leadSeconds(early.C2)),
    });
  }
  if (max) {
    alerts.push({
      title: early.MAX ? '🌗 Máximo en unos segundos' : '🌗 Máximo',
      body: 'Punto culminante del eclipse.',
      time: minusSeconds(max.time, leadSeconds(early.MAX)),
    });
  }
  if (c3) {
    alerts.push({
      title: early.C3 ? '⚠️ Fin de totalidad en unos segundos' : '⚠️ FIN DE TOTALIDAD',
      body: 'GAFAS PUESTAS YA. El sol vuelve a ser peligroso.',
      time: minusSeconds(c3.time, leadSeconds(early.C3)),
    });
  }
  if (c4) {
    alerts.push({
      title: early.C4 ? 'Fin del eclipse en unos segundos' : 'Fin del eclipse',
      body: 'Último contacto. Gracias por mirar al cielo con Eclipsum.',
      time: minusSeconds(c4.time, leadSeconds(early.C4)),
    });
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

/** Notificación de prueba inmediata — valida canal/permisos. */
export async function sendTestNotification(sound: AlertSound = 'eclipse'): Promise<void> {
  const channelId = await ensurePermissionAndChannel(sound);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🔔 Prueba Eclipsum',
      body: 'Las alertas funcionan. Listo para el eclipse.',
      sound: soundFile(sound),
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    // null = presentar ya (sin TIME_INTERVAL, que en Android añade latencia)
    trigger: null,
  });
}

/** Cuántos avisos se programarían con estos toggles (mismo filtro que al agendar). */
export function countEclipseAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  early: AlertEarly = DEFAULT_ALERT_EARLY,
  c1Plan: C1PlanAlerts = DEFAULT_C1_PLAN_ALERTS,
): number {
  return buildAlerts(eclipse, enabled, early, c1Plan).length;
}

/** Programa alertas locales según toggles. Devuelve cuántas quedaron programadas. */
export async function scheduleEclipseAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  sound: AlertSound = 'eclipse',
  early: AlertEarly = DEFAULT_ALERT_EARLY,
  c1Plan: C1PlanAlerts = DEFAULT_C1_PLAN_ALERTS,
): Promise<number> {
  const channelId = await ensurePermissionAndChannel(sound);

  // Reprogramar desde cero para evitar duplicados al cambiar toggles
  await Notifications.cancelAllScheduledNotificationsAsync();

  const alerts = buildAlerts(eclipse, enabled, early, c1Plan);
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
