/**
 * i18n mínimo propio: diccionarios JSON planos (locales/<lang>.json) con
 * interpolación {var}. Sin imports de react-native (selfcheck lo ejecuta en
 * Node): el idioma del sistema se resuelve en la capa UI (usePrefs,
 * expo-localization) y entra por setLang. Los textos de notificaciones se
 * hornean al programar — al cambiar de idioma, App reprograma.
 *
 * AÑADIR UN IDIOMA (ver README «Añadir un idioma»):
 *   1. Copia locales/en.json a locales/<código>.json y tradúcelo.
 *   2. Añade el código a LANGS y su entrada en LANG_META.
 *   3. Importa el JSON y regístralo en DICTS.
 * El compilador exige LANG_META y DICTS completos; npm run selfcheck
 * verifica la paridad de claves con es.
 */
import es from '../locales/es.json';
import en from '../locales/en.json';

export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * Metadatos por idioma: endónimo para el selector, etiqueta BCP-47 para
 * toLocaleTimeString y separador decimal. Los meses viven en el diccionario
 * (claves month.0–month.11).
 */
export const LANG_META: Record<Lang, { name: string; tag: string; decimalComma: boolean }> = {
  es: { name: 'Español', tag: 'es-ES', decimalComma: true },
  en: { name: 'English', tag: 'en-GB', decimalComma: false }, // en-GB: 24 h, como es-ES
};

export type I18nKey = keyof typeof es;

const DICTS: Record<Lang, Record<I18nKey, string>> = { es, en };

let lang: Lang = 'es';

export function setLang(next: Lang): void {
  lang = next;
}

export function getLang(): Lang {
  return lang;
}

/** Etiqueta BCP-47 para toLocaleTimeString y similares. */
export function localeTag(): string {
  return LANG_META[lang].tag;
}

/** toFixed(1) con el separador decimal del idioma activo. */
export function fmtFixed1(n: number): string {
  const s = n.toFixed(1);
  return LANG_META[lang].decimalComma ? s.replace('.', ',') : s;
}

/** Mes abreviado (0-11) en el idioma activo. */
export function monthShort(m: number): string {
  return t(`month.${m}` as I18nKey);
}

/** Traducción con interpolación {var}. Clave desconocida (nunca debería): la propia clave. */
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let out: string = DICTS[lang][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** Para selfcheck: paridad de claves entre idiomas. */
export function dictKeys(l: Lang): string[] {
  return Object.keys(DICTS[l]).sort();
}
