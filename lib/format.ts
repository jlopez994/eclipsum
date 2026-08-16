/**
 * Formateadores compartidos de hora y duración. Sin imports de react-native
 * (selfcheck lo ejecuta en Node): el idioma entra por localeTag() de i18n.
 */
import { localeTag, t } from './i18n';

/** Hora local «21:36» (filas compactas, popups del mapa). */
export const fmtHM = (d: Date) =>
  d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });

/** Hora local «21:36:30»: los contactos importan al segundo. */
export const fmtHMS = (d: Date) =>
  d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Duración «1m 47s»; segundos con cero a la izquierda para que no baile en columnas. */
export const fmtDur = (sec: number) => `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;

/** Duración compacta «45s» / «1m 45s»: por debajo del minuto el «0m» solo estorba. */
export const fmtDurCompact = (sec: number) => (sec < 60 ? `${sec}s` : fmtDur(sec));

/** Duración larga «1h 48m» / «48m»: tramos de horas donde los segundos sobran. */
export const fmtDurHM = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

/**
 * Distancia legible a un día civil, en ambas direcciones: «Hoy» / «Mañana» / «En 12 días»
 * y «Ayer» / «Hace 9 días» / «Hace 3 meses» / «Hace 9 años». Compara días civiles UTC
 * enteros (no milisegundos): a media tarde, «ayer» debe seguir siendo ayer.
 */
export function fmtRelativeDay(civilDate: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const d = Math.round((Date.parse(`${civilDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (d >= 0) {
    if (d === 0) return t('settings.upcoming.today');
    if (d === 1) return t('settings.upcoming.tomorrow');
    return t('settings.upcoming.inDays', { n: d });
  }
  const p = -d;
  if (p === 1) return t('settings.ago.yesterday');
  if (p < 60) return t('settings.ago.days', { n: p });
  if (p < 730) return t('settings.ago.months', { n: Math.round(p / 30.44) });
  return t('settings.ago.years', { n: Math.round(p / 365.25) });
}
