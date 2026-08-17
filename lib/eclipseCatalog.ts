/**
 * Catálogo de eclipses: entradas empaquetadas + Remote Config + autogeneradas con el motor.
 * Los horarios locales salen de astronomy-engine con `searchStart`;
 * banda, ciudades, nubes y copy usan el resto de campos.
 */
import { NextGlobalSolarEclipse, SearchGlobalSolarEclipse, type GlobalSolarEclipseInfo } from 'astronomy-engine';
import { bandForEclipse, type BandSlice } from './bandGeo';
import { getLang, monthShort, t, type I18nKey } from './i18n';

export interface EclipseEntry {
  id: string;
  /** Ancla ISO para SearchLocalSolarEclipse (primer eclipse local tras esta fecha). */
  searchStart: string;
  /** Día civil UTC del evento (Open-Meteo / Windy / caché). */
  civilDate: string;
  /** Tipo del eclipse; presente → los labels se regeneran en el idioma activo (allEclipses). */
  kind?: 'total' | 'annular' | 'partial';
  /** Texto «Acerca de» / próximo eclipse. */
  label: string;
  /** Etiqueta de la banda en el diagrama. */
  bandLabel: string;
  /** Tooltip corto de la banda en el mapa real. */
  bandTooltip: string;
  /** Abreviatura en chips de nubes y cronología (p. ej. «12 AGO»). */
  shortDateLabel: string;
  /** Fallback ISO si aún no hay evento MAX calculado (Windy). */
  windyFallbackMax: string;
  /** Lat/lon del pico global (solo entradas autogeneradas; orienta la lista de futuros). */
  peakLat?: number;
  peakLon?: number;
  /** Banda de totalidad publicable por RC (~5 KB); ausente → se usa la empaquetada (bandGeo). */
  band?: BandSlice[];
}

/** Banda del eclipse: la de su entrada (RC) o la empaquetada por id; null = sin polígono. */
export function bandOf(e: EclipseEntry): BandSlice[] | null {
  return e.band ?? bandForEclipse(e.id);
}

/**
 * Un punto desde el que SÍ se ve el eclipse, para reubicar al usuario cuando su puesto
 * cae fuera: centro de la rodaja central de la banda o, sin banda, el pico global.
 *
 * La rodaja central y no un extremo porque la banda se recorta por longitud y en sus bordes
 * el sol sale a ras de horizonte. Puede caer en mar —es geometría, no geografía—: sirve para
 * centrar el mapa con cifras reales, y desde ahí el usuario ajusta. null = no sabemos dónde,
 * así que no se reubica y queda el aviso de fuera de zona.
 */
export function visiblePointFor(e: EclipseEntry): { lat: number; lon: number } | null {
  const band = bandOf(e);
  if (band && band.length > 0) {
    const mid = band[Math.floor(band.length / 2)];
    return { lat: (mid.latS + mid.latN) / 2, lon: mid.lon };
  }
  if (typeof e.peakLat === 'number' && typeof e.peakLon === 'number') {
    return { lat: e.peakLat, lon: e.peakLon };
  }
  return null;
}

export const ECLIPSES: EclipseEntry[] = [
  {
    id: '2026-08-12-iberia',
    searchStart: '2026-08-01T00:00:00Z',
    civilDate: '2026-08-12',
    kind: 'total',
    // Labels de fábrica en español; allEclipses() los regenera en el idioma activo vía kind
    label: 'Total · 12 ago 2026',
    bandLabel: 'BANDA DE TOTALIDAD · 12 AGO 2026',
    bandTooltip: 'Banda de totalidad · 12 ago 2026',
    shortDateLabel: '12 AGO',
    windyFallbackMax: '2026-08-12T18:00:00Z',
  },
];

/** Override desde Remote Config (`active_eclipse_id`); vacío = resolución local. */
let remoteActiveId = '';

export function setRemoteActiveEclipseId(id: string): void {
  remoteActiveId = id.trim();
}

/**
 * Selección del usuario (prefs `selectedEclipseDay`); vacío = automático (el más próximo).
 * La identidad persistida es el DÍA CIVIL, no el id: el mismo eclipse puede tener id de
 * catálogo («2026-08-12-iberia») o autogenerado («2026-08-12-total») según de dónde salga.
 */
let userSelectedDay = '';
/**
 * true = el usuario eligió un eclipse YA pasado (modo consulta): se respeta aunque su día
 * quede atrás. false = selección de futuro normal, que al pasar rueda al siguiente como
 * siempre. Persistido en prefs (`selectedEclipsePast`): sin él, reabrir la app tras pasar
 * el eclipse elegido no distinguiría «consulto el histórico» de «mi eclipse ya fue».
 */
let userSelectedPast = false;
let userSelected: EclipseEntry | null = null;
/** Idioma con el que se hornearon los labels de userSelected; distinto → re-resolver. */
let userSelectedLang = '';

/** Rango en el que confiamos en el motor para navegar el catálogo (ampliable). */
const HISTORY_MIN_CIVIL = '1900-01-01';
const HISTORY_MAX_CIVIL = '2199-12-31';

/**
 * Entrada para un día civil arbitrario, calculada con el motor: primer eclipse global
 * tras «día − 2», que si existe uno ese día es él (dos eclipses distan ≥29 días).
 * Cubre los días que no están ni en catálogo ni en las listas: histórico y futuro lejano.
 */
function resolveByEngine(day: string): EclipseEntry | null {
  if (day < HISTORY_MIN_CIVIL || day > HISTORY_MAX_CIVIL) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  try {
    const entry = entryFromGlobalEclipse(SearchGlobalSolarEclipse(new Date(t - 2 * DAY_MS)));
    return entry.civilDate === day ? entry : null;
  } catch {
    return null;
  }
}

function resolveByDay(day: string): EclipseEntry | null {
  return (
    allEclipses().find((e) => e.civilDate === day) ??
    upcomingEclipses(UPCOMING_HORIZON).find((e) => e.civilDate === day) ??
    resolveByEngine(day)
  );
}

/**
 * Entrada conocida para ese día civil, o null si cae fuera del horizonte del catálogo.
 * null significa «no podemos llevar al usuario a ese eclipse»: la UI oculta la acción.
 */
export function eclipseForDay(day: string): EclipseEntry | null {
  return resolveByDay(day);
}

/** Resuelve una vez por cambio real de selección; llamadas repetidas con el mismo día son no-op. */
export function setUserSelectedEclipseDay(day: string, past = false): void {
  const trimmed = day.trim();
  if (trimmed === userSelectedDay && past === userSelectedPast) return;
  userSelectedDay = trimmed;
  userSelectedPast = past;
  userSelected = trimmed ? resolveByDay(trimmed) : null;
  userSelectedLang = getLang();
}

/** Entradas añadidas por Remote Config (`eclipse_catalog`); no requieren release. */
let remoteEntries: EclipseEntry[] = [];

const ENTRY_STRING_FIELDS = [
  'id',
  'searchStart',
  'civilDate',
  'label',
  'bandLabel',
  'bandTooltip',
  'shortDateLabel',
  'windyFallbackMax',
] as const;

function isValidEntry(e: unknown): e is EclipseEntry {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  if (!ENTRY_STRING_FIELDS.every((k) => typeof r[k] === 'string' && (r[k] as string).length > 0)) return false;
  return (
    !Number.isNaN(Date.parse(r.searchStart as string)) &&
    !Number.isNaN(Date.parse(`${r.civilDate}T00:00:00Z`)) &&
    !Number.isNaN(Date.parse(r.windyFallbackMax as string))
  );
}

/** Banda válida = ≥2 cortes con lon/latS/latN numéricos; si no, se descarta solo la banda. */
function sanitizeBand(raw: unknown): BandSlice[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const ok = raw.every(
    (s): s is BandSlice =>
      !!s &&
      typeof (s as BandSlice).lon === 'number' &&
      typeof (s as BandSlice).latS === 'number' &&
      typeof (s as BandSlice).latN === 'number',
  );
  return ok ? raw.map((s) => ({ lon: s.lon, latS: s.latS, latN: s.latN })) : undefined;
}

/** Valida el JSON de RC; entradas malformadas se descartan en silencio (nunca rompe la app). */
export function parseRemoteCatalog(json: string): EclipseEntry[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidEntry).map((e) => ({ ...e, band: sanitizeBand((e as EclipseEntry).band) }));
  } catch {
    return [];
  }
}

export function setRemoteCatalog(json: string): void {
  remoteEntries = parseRemoteCatalog(json);
  catalogVersion++;
  autoCache = null;
  // El catálogo nuevo puede contener (o retirar) la selección del usuario
  if (userSelectedDay) {
    userSelected = resolveByDay(userSelectedDay);
    userSelectedLang = getLang();
  }
}

/**
 * Catálogo completo: empaquetado + RC, ordenado por fecha para el rollover.
 * Dedupe por id Y por día civil: genEclipse puede publicar el mismo eclipse con
 * id autogenerado («2026-08-12-total» vs «2026-08-12-iberia») — gana la empaquetada.
 * Entradas con `kind` salen con labels regenerados en el idioma activo.
 */
function allEclipses(): EclipseEntry[] {
  // El dedupe también aplica ENTRE entradas remotas (un copia-pega en RC no debe duplicar
  // un eclipse en la UI): la primera del array gana
  const extras: EclipseEntry[] = [];
  for (const r of remoteEntries) {
    if (ECLIPSES.some((e) => e.id === r.id || e.civilDate === r.civilDate)) continue;
    if (extras.some((e) => e.id === r.id || e.civilDate === r.civilDate)) continue;
    extras.push(r);
  }
  return [...ECLIPSES, ...extras]
    .map((e) => (e.kind ? { ...e, ...labelFields(e.kind, new Date(`${e.civilDate}T00:00:00Z`)) } : e))
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));
}

export function getEclipseById(id: string): EclipseEntry | undefined {
  return allEclipses().find((e) => e.id === id);
}

/** Fin del día civil UTC (+ cola) a partir del cual el eclipse se considera pasado. */
function eclipseEndMs(entry: EclipseEntry): number {
  return new Date(`${entry.civilDate}T23:59:59Z`).getTime() + 6 * 3_600_000;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Margen del ancla searchStart: SearchLocalSolarEclipse busca el primer eclipse local tras ella. */
const SEARCH_START_DAYS_BEFORE = 15;

/** Labels visibles (acerca de, banda, tooltip, abreviatura) en el idioma activo. */
function labelFields(
  kind: string,
  peak: Date,
): Pick<EclipseEntry, 'label' | 'bandLabel' | 'bandTooltip' | 'shortDateLabel'> {
  const d = peak.getUTCDate();
  const mes = monthShort(peak.getUTCMonth());
  const year = peak.getUTCFullYear();
  const fecha = `${d} ${mes} ${year}`;
  const fechaMayus = `${d} ${mes.toUpperCase()} ${year}`;
  const kindLabel = kind === 'total' || kind === 'annular' || kind === 'partial' ? t(`kind.${kind}` as I18nKey) : kind;
  const word = kind === 'total' || kind === 'annular' ? t(`band.word.${kind}` as I18nKey) : null;
  return {
    label: `${kindLabel} · ${fecha}`,
    bandLabel: word
      ? t('band.label', { word: word.toUpperCase(), date: fechaMayus })
      : t('band.label.partial', { date: fechaMayus }),
    bandTooltip: word ? t('band.tooltip', { word, date: fecha }) : t('band.tooltip.partial', { date: fecha }),
    shortDateLabel: `${d} ${mes.toUpperCase()}`,
  };
}

/** Entrada de catálogo derivada de un eclipse global del motor (labels en el idioma activo). */
export function entryFromGlobalEclipse(ev: GlobalSolarEclipseInfo): EclipseEntry {
  const peak = ev.peak.date;
  const kind = ev.kind;
  const civilDate = peak.toISOString().slice(0, 10);
  return {
    id: `${civilDate}-${kind}`,
    searchStart: `${new Date(peak.getTime() - SEARCH_START_DAYS_BEFORE * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`,
    civilDate,
    ...labelFields(kind, peak),
    windyFallbackMax: new Date(Math.round(peak.getTime() / HOUR_MS) * HOUR_MS)
      .toISOString()
      .replace('.000Z', 'Z'),
    peakLat: ev.latitude,
    peakLon: ev.longitude,
  };
}

/** Horizonte de generación con el motor; también tope de `upcomingEclipses` (~8 años). */
const UPCOMING_HORIZON = 20;
/** Se recalcula al cambiar de día civil o de catálogo RC (~12 pasos del motor, una vez). */
let catalogVersion = 0;
let upcomingCache: { key: string; list: EclipseEntry[] } | null = null;

/**
 * Próximos eclipses (máx. UPCOMING_HORIZON), catálogo ∪ motor, orden cronológico,
 * dedupe por día civil (gana la entrada de catálogo). Es LA definición de «próximo»:
 * la rama automática de getActiveEclipse usa upcomingEclipses(1).
 * Nunca lanza: motor fallando → solo catálogo.
 */
export function upcomingEclipses(count: number, now: Date = new Date()): EclipseEntry[] {
  // Idioma en la clave: las entradas del motor llevan labels horneados
  const key = `${now.toISOString().slice(0, 10)}:${catalogVersion}:${getLang()}`;
  if (upcomingCache?.key !== key) {
    const t = now.getTime();
    const out = allEclipses().filter((e) => eclipseEndMs(e) >= t);
    try {
      let ev = SearchGlobalSolarEclipse(now);
      for (let i = 0; i < UPCOMING_HORIZON; i++) {
        const entry = entryFromGlobalEclipse(ev);
        if (!out.some((e) => e.civilDate === entry.civilDate)) out.push(entry);
        ev = NextGlobalSolarEclipse(ev.peak);
      }
    } catch {
      // motor fallando: lista con lo que haya en catálogo
    }
    upcomingCache = { key, list: out.sort((a, b) => a.civilDate.localeCompare(b.civilDate)) };
  }
  return upcomingCache.list.slice(0, count);
}

/** Tope del histórico navegable (~25 años); subirlo = subir la constante. */
const PAST_HORIZON = 60;
/** Ritmo medio real: 2–5 eclipses solares al año; sirve para dimensionar la siembra. */
const ECLIPSES_PER_YEAR = 2.4;
const YEAR_MS = 365.25 * DAY_MS;
let pastCache: { key: string; list: EclipseEntry[] } | null = null;

/**
 * Eclipses ya pasados, del más reciente al más antiguo (máx. PAST_HORIZON), catálogo ∪
 * motor con dedupe por día civil (gana el catálogo: conserva banda y label propios).
 * El motor solo busca hacia DELANTE, así que se siembra con margen en el pasado y se
 * itera hasta hoy; se calcula una vez por día/catálogo/idioma, y solo si alguien lo pide.
 */
export function pastEclipses(count: number, now: Date = new Date()): EclipseEntry[] {
  if (count <= 0) return [];
  const key = `${now.toISOString().slice(0, 10)}:${catalogVersion}:${getLang()}`;
  if (pastCache?.key !== key) {
    const t = now.getTime();
    const out = allEclipses().filter((e) => eclipseEndMs(e) < t);
    try {
      const seedMs = Math.max(
        Date.parse(`${HISTORY_MIN_CIVIL}T00:00:00Z`),
        t - (PAST_HORIZON / ECLIPSES_PER_YEAR + 1) * YEAR_MS,
      );
      let ev = SearchGlobalSolarEclipse(new Date(seedMs));
      while (ev.peak.date.getTime() < t) {
        const entry = entryFromGlobalEclipse(ev);
        if (eclipseEndMs(entry) < t && !out.some((e) => e.civilDate === entry.civilDate)) out.push(entry);
        ev = NextGlobalSolarEclipse(ev.peak);
      }
    } catch {
      // motor fallando: lista con lo que haya en catálogo
    }
    pastCache = {
      key,
      list: out.sort((a, b) => b.civilDate.localeCompare(a.civilDate)).slice(0, PAST_HORIZON),
    };
  }
  return pastCache.list.slice(0, count);
}

/** Memo del automático hasta que pase (monótono en el tiempo; setRemoteCatalog lo invalida). */
let autoCache: EclipseEntry | null = null;
let autoCacheLang = '';

/**
 * Eclipse activo, por prioridad: selección del usuario (si sigue vigente, o pasada
 * elegida a propósito) → override RC → el más próximo (misma regla que upcomingEclipses).
 */
export function getActiveEclipse(now: Date = new Date()): EclipseEntry {
  if (userSelected && (userSelectedPast || eclipseEndMs(userSelected) >= now.getTime())) {
    if (userSelectedLang !== getLang()) {
      // Labels horneados al resolver: cambio de idioma → re-resuelve la misma selección
      userSelected = resolveByDay(userSelectedDay) ?? userSelected;
      userSelectedLang = getLang();
    }
    return userSelected;
  }
  if (remoteActiveId) {
    const forced = getEclipseById(remoteActiveId);
    if (forced) return forced;
  }
  if (!autoCache || autoCacheLang !== getLang() || eclipseEndMs(autoCache) < now.getTime()) {
    autoCache = upcomingEclipses(1, now)[0] ?? null;
    autoCacheLang = getLang();
  }
  if (autoCache) return autoCache;
  const all = allEclipses();
  return all[all.length - 1]; // motor fallando y catálogo pasado: último conocido antes que crash
}

export function activeSearchStart(now?: Date): Date {
  return new Date(getActiveEclipse(now).searchStart);
}
