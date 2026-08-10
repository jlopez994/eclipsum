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

// Canales distintos por sonido: en Android el audio del canal es inmutable una vez creado.
// Subir versión si cambia el wav o el id del canal (v3 podía quedar con tono de sistema).
const CHANNEL_BASE = 'eclipse-alerts-v4';
const LEGACY_CHANNELS = ['eclipse-alerts-v3-eclipse', 'eclipse-alerts-v3-default'];

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

function minusSeconds(d: Date, sec: number): Date {
  return new Date(d.getTime() - sec * 1000);
}

function minusMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() - min * 60_000);
}

/**
 * Copys por hito: `exact` en el contacto (instrucción), `early` unos segundos antes
 * (aviso previo — nunca ordena ponerse las gafas todavía).
 */
const ALERT_COPY: Record<keyof AlertToggles, { early: { title: string; body: string }; exact: { title: string; body: string } }> = {
  C1: {
    early: { title: '☀️ El eclipse empieza en unos segundos', body: 'Aviso previo: ten las gafas a mano.' },
    exact: { title: '☀️ Empieza el eclipse', body: 'GAFAS DE ECLIPSE PUESTAS para mirar al sol.' },
  },
  C2: {
    early: { title: '🌑 Totalidad en unos segundos', body: 'Aviso previo: en nada podrás mirar sin gafas.' },
    exact: { title: '🌑 Totalidad', body: 'Ya puedes mirar sin gafas. Disfruta.' },
  },
  MAX: {
    early: { title: '🌗 Máximo en unos segundos', body: 'Aviso previo del punto culminante.' },
    exact: { title: '🌗 Máximo', body: 'Punto culminante del eclipse.' },
  },
  C3: {
    early: { title: '⚠️ Fin de totalidad en unos segundos', body: 'Aviso previo: ve preparando las gafas.' },
    exact: { title: '⚠️ FIN DE TOTALIDAD', body: 'GAFAS PUESTAS YA. El sol vuelve a ser peligroso.' },
  },
  C4: {
    early: { title: 'Fin del eclipse en unos segundos', body: 'Aviso previo del último contacto.' },
    exact: { title: 'Fin del eclipse', body: 'Último contacto. Gracias por mirar al cielo con Eclipsum.' },
  },
};

function buildAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  early: AlertEarly,
  c1Plan: C1PlanAlerts,
): Alert[] {
  const alerts: Alert[] = [];
  const c1 = enabled.C1 ? eclipse.events.find((e) => e.key === 'C1') : undefined;
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
  }
  // Por hito activo: alerta en el contacto exacto y, con el chip, aviso previo adicional
  for (const ev of eclipse.events) {
    if (!enabled[ev.key]) continue;
    const copy = ALERT_COPY[ev.key];
    if (early[ev.key]) {
      alerts.push({ ...copy.early, time: minusSeconds(ev.time, ALERT_EARLY_SECONDS) });
    }
    alerts.push({ ...copy.exact, time: ev.time });
  }
  return alerts.filter((a) => a.time.getTime() > Date.now());
}

/**
 * Serializa las operaciones sobre el conjunto de notificaciones programadas.
 * Dos reprogramaciones solapadas (pantalla Alertas + efecto de App) podían
 * intercalar cancelAll/schedule y dejar avisos duplicados el día del eclipse.
 */
let opQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = opQueue.then(job);
  opQueue = run.catch(() => {});
  return run;
}

async function deleteLegacyChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(LEGACY_CHANNELS.map((id) => Notifications.deleteNotificationChannelAsync(id).catch(() => {})));
}

async function ensurePermissionAndChannel(sound: AlertSound): Promise<string> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Permiso de notificaciones denegado');
  await deleteLegacyChannels();
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
    },
    // En Android 8+ el sonido lo marca el canal: trigger con channelId (no content.channelId).
    // null solo vale en iOS; en Android sin canal cae en «Miscellaneous» → tono de sistema.
    trigger: Platform.OS === 'android' ? { channelId } : null,
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

/**
 * Simulacro: la serie real desplazada para que C1 caiga en `c1At`, con títulos [PRUEBA].
 * Aditiva — no cancela nada, las alertas reales del eclipse quedan intactas.
 */
export function scheduleFakeEclipseAlerts(
  eclipse: LocalEclipse,
  c1At: Date,
  enabled: AlertToggles,
  sound: AlertSound = 'eclipse',
  early: AlertEarly = DEFAULT_ALERT_EARLY,
): Promise<string[]> {
  return enqueue(() => doScheduleFake(eclipse, c1At, enabled, sound, early));
}

async function doScheduleFake(
  eclipse: LocalEclipse,
  c1At: Date,
  enabled: AlertToggles,
  sound: AlertSound,
  early: AlertEarly,
): Promise<string[]> {
  const channelId = await ensurePermissionAndChannel(sound);
  const c1 = eclipse.events.find((e) => e.key === 'C1');
  if (!c1) return [];
  const shift = c1At.getTime() - c1.time.getTime();
  const shifted: LocalEclipse = {
    ...eclipse,
    events: eclipse.events.map((e) => ({ ...e, time: new Date(e.time.getTime() + shift) })),
  };
  // Sin avisos de planificación (24h/1h): el simulacro es la serie del día
  const alerts = buildAlerts(shifted, enabled, early, { before24h: false, before1h: false });
  const ids: string[] = [];
  for (const a of alerts) {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { title: `[PRUEBA] ${a.title}`, body: a.body, sound: soundFile(sound) },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: a.time,
          channelId,
        },
      }),
    );
  }
  return ids;
}

/** Cancela solo los avisos indicados (p. ej. al salir del simulacro). */
export function cancelAlertsByIds(ids: string[]): Promise<void> {
  return enqueue(async () => {
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  });
}

/** Programa alertas locales según toggles. Devuelve cuántas quedaron programadas. */
export function scheduleEclipseAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  sound: AlertSound = 'eclipse',
  early: AlertEarly = DEFAULT_ALERT_EARLY,
  c1Plan: C1PlanAlerts = DEFAULT_C1_PLAN_ALERTS,
): Promise<number> {
  return enqueue(() => doScheduleEclipse(eclipse, enabled, sound, early, c1Plan));
}

async function doScheduleEclipse(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  sound: AlertSound,
  early: AlertEarly,
  c1Plan: C1PlanAlerts,
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
