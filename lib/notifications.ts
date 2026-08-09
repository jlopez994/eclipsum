import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { LocalEclipse } from './eclipse';
import type { AlertLeads, AlertSound, AlertToggles, C1PlanAlerts } from './prefs';
import { DEFAULT_ALERT_LEADS, DEFAULT_C1_PLAN_ALERTS } from './prefs';

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

function fmtLead(min: number): string {
  if (min <= 0) return 'ahora';
  if (min === 1) return 'en 1 min';
  if (min < 60) return `en ${min} min`;
  if (min === 60) return 'en 1 hora';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return h === 1 ? 'en 1 hora' : `en ${h} horas`;
  return `en ${h}h ${m}m`;
}

/** Etiqueta corta para el chip de UI (anticipo). */
export function alertLeadChipLabel(min: number): string {
  if (min <= 0) return 'en el momento';
  if (min < 60) return `−${min} min`;
  if (min === 60) return '−1 h';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `−${h} h` : `−${h}h ${m}m`;
}

function buildAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  leads: AlertLeads,
  c1Plan: C1PlanAlerts,
): Alert[] {
  const byKey = (k: keyof AlertToggles) => (enabled[k] ? eclipse.events.find((e) => e.key === k) : undefined);
  const c1 = byKey('C1');
  const c2 = byKey('C2');
  const max = byKey('MAX');
  const c3 = byKey('C3');
  const c4 = byKey('C4');
  const minus = (d: Date, min: number) => new Date(d.getTime() - min * 60_000);

  const alerts: Alert[] = [];
  if (c1) {
    if (c1Plan.before24h) {
      alerts.push({
        title: 'Eclipse mañana',
        body: 'El eclipse solar empieza mañana a esta hora. Prepara las gafas.',
        time: minus(c1.time, 24 * 60),
      });
    }
    if (c1Plan.before1h) {
      alerts.push({
        title: 'Eclipse en 1 hora',
        body: 'Primer contacto (parcial) en 1 hora. Busca horizonte oeste despejado.',
        time: minus(c1.time, 60),
      });
    }
    alerts.push({
      title: leads.C1 <= 0 ? '☀️ Empieza el eclipse' : `☀️ Empieza ${fmtLead(leads.C1)}`,
      body: 'GAFAS DE ECLIPSE PUESTAS para mirar al sol.',
      time: minus(c1.time, leads.C1),
    });
  }
  if (c2) {
    alerts.push({
      title: leads.C2 <= 0 ? '🌑 Totalidad' : `🌑 Totalidad ${fmtLead(leads.C2)}`,
      body: 'Prepárate: durante la totalidad puedes mirar sin gafas.',
      time: minus(c2.time, leads.C2),
    });
  }
  if (max) {
    alerts.push({
      title: leads.MAX <= 0 ? '🌗 Máximo' : `🌗 Máximo ${fmtLead(leads.MAX)}`,
      body: 'Punto culminante del eclipse.',
      time: minus(max.time, leads.MAX),
    });
  }
  if (c3) {
    alerts.push({
      title: leads.C3 <= 0 ? '⚠️ FIN DE TOTALIDAD' : `⚠️ Fin de totalidad ${fmtLead(leads.C3)}`,
      body: 'GAFAS PUESTAS YA. El sol vuelve a ser peligroso.',
      time: minus(c3.time, leads.C3),
    });
  }
  if (c4) {
    alerts.push({
      title: leads.C4 <= 0 ? 'Fin del eclipse' : `Fin del eclipse ${fmtLead(leads.C4)}`,
      body: 'Último contacto. Gracias por mirar al cielo con Eclipsum.',
      time: minus(c4.time, leads.C4),
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

/** Cuántos avisos se programarían con estos toggles/anticipos (mismo filtro que al agendar). */
export function countEclipseAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  leads: AlertLeads = DEFAULT_ALERT_LEADS,
  c1Plan: C1PlanAlerts = DEFAULT_C1_PLAN_ALERTS,
): number {
  return buildAlerts(eclipse, enabled, leads, c1Plan).length;
}

/** Programa alertas locales según toggles y anticipos. Devuelve cuántas quedaron programadas. */
export async function scheduleEclipseAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  sound: AlertSound = 'eclipse',
  leads: AlertLeads = DEFAULT_ALERT_LEADS,
  c1Plan: C1PlanAlerts = DEFAULT_C1_PLAN_ALERTS,
): Promise<number> {
  const channelId = await ensurePermissionAndChannel(sound);

  // Reprogramar desde cero para evitar duplicados al cambiar toggles
  await Notifications.cancelAllScheduledNotificationsAsync();

  const alerts = buildAlerts(eclipse, enabled, leads, c1Plan);
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
