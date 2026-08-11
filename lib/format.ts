/**
 * Formateadores compartidos de hora y duración. Sin imports de react-native
 * (selfcheck lo ejecuta en Node): el idioma entra por localeTag() de i18n.
 */
import { localeTag } from './i18n';

/** Hora local «21:36» (filas compactas, popups del mapa). */
export const fmtHM = (d: Date) =>
  d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });

/** Hora local «21:36:30»: los contactos importan al segundo. */
export const fmtHMS = (d: Date) =>
  d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Duración «1m 47s»; segundos con cero a la izquierda para que no baile en columnas. */
export const fmtDur = (sec: number) => `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
