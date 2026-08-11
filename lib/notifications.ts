import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t, type I18nKey } from './i18n';
import { eventAt, shiftEclipse, type LocalEclipse } from './eclipse';
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

/** Opciones de sonido con labels en el idioma activo (resueltas al render). */
export function alertSoundOptions(): { id: AlertSound; label: string; hint: string }[] {
  return [
    { id: 'eclipse', label: t('sound.eclipse'), hint: t('sound.eclipseHint') },
    { id: 'default', label: t('sound.default'), hint: t('sound.defaultHint') },
  ];
}

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
 * Copys por hito, resueltos en el idioma activo al PROGRAMAR: `exact` en el
 * contacto (instrucción), `early` unos segundos antes (aviso previo).
 * Cambio de idioma → App reprograma (prefs.language en las deps del efecto).
 */
function copyFor(key: keyof AlertToggles) {
  return {
    early: {
      title: t(`notif.${key}.early.title` as I18nKey),
      body: t(`notif.${key}.early.body` as I18nKey),
    },
    exact: {
      title: t(`notif.${key}.title` as I18nKey),
      body: t(`notif.${key}.body` as I18nKey),
    },
  };
}

function buildAlerts(
  eclipse: LocalEclipse,
  enabled: AlertToggles,
  early: AlertEarly,
  c1Plan: C1PlanAlerts,
): Alert[] {
  const alerts: Alert[] = [];
  const c1 = enabled.C1 ? eventAt(eclipse, 'C1') : undefined;
  if (c1) {
    if (c1Plan.before24h) {
      alerts.push({
        title: t('notif.plan24h.title'),
        body: t('notif.plan24h.body'),
        time: minusMinutes(c1.time, 24 * 60),
      });
    }
    if (c1Plan.before1h) {
      alerts.push({
        title: t('notif.plan1h.title'),
        body: t('notif.plan1h.body'),
        time: minusMinutes(c1.time, 60),
      });
    }
  }
  // Por hito activo: alerta en el contacto exacto y, con el chip, aviso previo adicional
  for (const ev of eclipse.events) {
    if (!enabled[ev.key]) continue;
    const copy = copyFor(ev.key);
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
  if (status !== 'granted') throw new Error(t('notif.permissionDenied'));
  await deleteLegacyChannels();
  const id = channelIdFor(sound);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(id, {
      name: sound === 'eclipse' ? t('notif.channel.eclipse') : t('notif.channel.default'),
      importance: Notifications.AndroidImportance.MAX,
      sound: soundFile(sound),
      vibrationPattern: [0, 250, 150, 250, 150, 500],
    });
  }
  return id;
}

/**
 * Agenda la tanda y devuelve sus ids. `prefix` antepone [PRUEBA] en el simulacro.
 * En serie a propósito: expo-notifications no garantiza orden con llamadas en paralelo.
 */
async function scheduleAll(
  alerts: Alert[],
  sound: AlertSound,
  channelId: string,
  prefix = '',
): Promise<string[]> {
  const ids: string[] = [];
  for (const a of alerts) {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { title: prefix ? `${prefix} ${a.title}` : a.title, body: a.body, sound: soundFile(sound) },
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

/** Notificación de prueba inmediata — valida canal/permisos. */
export async function sendTestNotification(sound: AlertSound = 'eclipse'): Promise<void> {
  const channelId = await ensurePermissionAndChannel(sound);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: t('notif.test.title'),
      body: t('notif.test.body'),
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
  const c1 = eventAt(eclipse, 'C1');
  if (!c1) return [];
  const shifted = shiftEclipse(eclipse, c1At.getTime() - c1.time.getTime());
  // Sin avisos de planificación (24h/1h): el simulacro es la serie del día
  const alerts = buildAlerts(shifted, enabled, early, { before24h: false, before1h: false });
  return scheduleAll(alerts, sound, channelId, t('notif.drillPrefix'));
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

  const ids = await scheduleAll(buildAlerts(eclipse, enabled, early, c1Plan), sound, channelId);
  return ids.length;
}
