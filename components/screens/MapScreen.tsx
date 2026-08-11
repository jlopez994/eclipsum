import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { nextEvent, type LocalEclipse } from '../../lib/eclipse';
import { bandOf, getActiveEclipse } from '../../lib/eclipseCatalog';
import { fmtFixed1, localeTag, t, type I18nKey } from '../../lib/i18n';
import { type TotalityDirection } from '../../lib/totality';
import { track, type Sponsor } from '../../lib/firebase';
import { windyEclipseCloudsUrl } from '../../lib/weather';
import { useSheet } from '../../hooks/useSheet';
import { Countdown } from '../Countdown';
import { RealMap, type RealMapHandle } from '../RealMap';
import { CompassChip } from '../map/CompassChip';
import { HorizonDiagram } from '../map/HorizonDiagram';
import { C, F } from '../theme';

const IGN_URL = 'https://eclipses.ign.es/como-observar-eclipses.html';

/** Fallback bajo: mejor recortar un instante que asomar la cronología. */
const SHEET_MIN_FALLBACK = 140;
/** Mínimo de mapa visible con la hoja estirada */
const SHEET_TOP_GAP = 150;

const EVENT_ACCENT: Record<string, string> = {
  C1: C.corona,
  C2: C.totality,
  MAX: C.totality,
  C3: C.danger,
  C4: C.corona,
  OC: C.danger,
};

interface MapScreenProps {
  eclipse: LocalEclipse;
  /** Puesto deseado (cálculos) */
  place: string;
  /** Nombre corto del GPS cuando difiere del puesto; se pinta en el punto «TÚ» */
  hereLabel: string | null;
  cloudPct: number | null;
  /** Antigüedad en horas del dato de nubes cuando viene de caché sin red; null = fresco */
  cloudAgeHours: number | null;
  /** Nubosidad del puesto en curso de carga */
  cloudLoading: boolean;
  totality: TotalityDirection | 'none' | null;
  now: Date;
  /** Coordenadas del puesto activo (para el mapa real) */
  spotCoords: { lat: number; lon: number };
  /** Coordenadas GPS cuando difiere del puesto; null = sin segundo marcador */
  hereCoords: { lat: number; lon: number } | null;
  /** Posición GPS real (botón de recentrar); null = sin GPS, botón oculto */
  gpsCoords: { lat: number; lon: number } | null;
  onOpenSelector: () => void;
  onOpenMaps: () => void;
  /** Punto tocado en el mapa real elegido como puesto de observación */
  onSelectMapPoint: (p: { lat: number; lon: number }) => void;
  /** km entre GPS real y spot activo el día del eclipse; null = sin aviso */
  divergenceKm: number | null;
  onRecalcHere: () => void;
  /** Patrocinador del eclipse (Remote Config); null = sin tarjeta de patrocinio */
  sponsor?: Sponsor | null;
  /** URL de gafas certificadas (afiliado, vía Remote Config); vacío = solo el aviso, sin enlace */
  glassesUrl?: string;
  /** Alto de los avisos flotantes de App: los chips bajan para no quedar debajo */
  topOffset?: number;
}

const fmtHM = (d: Date) =>
  d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function MapScreen({
  eclipse,
  place,
  hereLabel,
  cloudPct,
  cloudAgeHours,
  cloudLoading,
  totality,
  now,
  spotCoords,
  hereCoords,
  gpsCoords,
  onOpenSelector,
  onOpenMaps,
  onSelectMapPoint,
  divergenceKm,
  onRecalcHere,
  sponsor,
  glassesUrl,
  topOffset = 0,
}: MapScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [sheetMin, setSheetMin] = useState(SHEET_MIN_FALLBACK);
  const mapRef = useRef<RealMapHandle>(null);

  // Fundido al cambiar de puesto: los datos nuevos entran suaves en vez de saltar
  const fade = useRef(new Animated.Value(1)).current;
  const spotKey = `${spotCoords.lat},${spotCoords.lon}`;
  const prevSpotKey = useRef(spotKey);
  useEffect(() => {
    if (prevSpotKey.current === spotKey) return;
    prevSpotKey.current = spotKey;
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [spotKey, fade]);
  // Hoja estirada: ocupa todo menos un asomo de mapa; en pantallas altas cabe la cronología sin scroll
  const sheetMax = Math.max(560, winH - insets.top - SHEET_TOP_GAP);
  const { height, pan } = useSheet(sheetMax, sheetMin);

  const onPeekLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h > 40 && Math.abs(h - sheetMin) > 1) setSheetMin(h);
  };
  const isTotal = eclipse.kind === 'total';
  const upcoming = nextEvent(eclipse, now);
  const maxEvent = eclipse.events.find((e) => e.key === 'MAX');
  // Cronología con el ocaso intercalado; los contactos bajo el horizonte no se ven
  const cronoRows = [
    ...eclipse.events.map((e) => ({
      key: e.key as string,
      label: t(`event.${e.key}` as I18nKey),
      time: e.time,
      belowHorizon: e.altitude < 0,
    })),
    ...(eclipse.sunset
      ? [{ key: 'OC', label: t('event.OC'), time: eclipse.sunset, belowHorizon: false }]
      : []),
  ].sort((a, b) => a.time.getTime() - b.time.getTime());

  const bandDuration = isTotal
    ? eclipse.totalityDurationSec
    : totality !== null && totality !== 'none'
      ? totality.durationSec
      : null;

  // Dato de caché sin red: se marca la antigüedad para no fiarse de nubes viejas
  const activeEclipseMeta = getActiveEclipse();
  const cloudStale = cloudAgeHours !== null ? ` · ${cloudAgeHours}h` : '';
  const cloudLevel = cloudPct === null ? null : cloudPct < 25 ? 'few' : cloudPct < 60 ? 'mid' : 'many';
  const cloud =
    cloudLevel === null || cloudPct === null
      ? {
          color: C.dim,
          label: cloudLoading ? t('map.clouds.loading') : t('map.clouds.none'),
          a11y: t('map.clouds.noneA11y'),
        }
      : {
          color: cloudLevel === 'few' ? C.ok : cloudLevel === 'mid' ? C.corona : C.danger,
          label: t(`map.clouds.${cloudLevel}` as I18nKey, { pct: cloudPct, stale: cloudStale }),
          a11y: t('map.clouds.a11y', {
            level: t(`map.clouds.${cloudLevel}.word` as I18nKey),
            pct: cloudPct,
            date: activeEclipseMeta.shortDateLabel.toLowerCase(),
          }),
        };

  const obscuracion = fmtFixed1(eclipse.obscuration * 100);

  return (
    <View style={s.root}>
      <Animated.View style={[s.fadeFill, { opacity: fade }]}>
      <RealMap
        ref={mapRef}
        // Remount al cambiar de eclipse Y al llegar la banda por RC (el HTML se
        // congela al montar: sin esto, un catálogo activado con el mapa abierto
        // no pinta la banda hasta cambiar de eclipse)
        key={`${activeEclipseMeta.id}${bandOf(activeEclipseMeta) ? ':band' : ''}`}
        spot={{ ...spotCoords, label: place }}
        here={hereCoords ? { ...hereCoords, label: hereLabel ?? t('map.you') } : null}
        onSelectPoint={onSelectMapPoint}
      />

      {/* Botón GPS: recentra el mapa en la posición actual */}
      {gpsCoords && (
        <Pressable
          style={[s.gpsBtn, { bottom: sheetMin + 14 }]}
          onPress={() => mapRef.current?.flyTo(gpsCoords.lat, gpsCoords.lon)}
          hitSlop={8}
          accessibilityLabel={t('map.recenter')}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth={2}>
            <Circle cx={12} cy={12} r={7} />
            <Circle cx={12} cy={12} r={2} fill={C.text} stroke="none" />
            <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </Svg>
        </Pressable>
      )}

      {/* Overlay superior: chips + lugares + aviso divergencia */}
      <View style={[s.topOverlay, { top: insets.top + 8 + topOffset }]} pointerEvents="box-none">
        <View style={s.chipsRow} pointerEvents="box-none">
          <View style={s.chipGroup}>
            <Pressable style={s.chipLocation} onPress={onOpenSelector}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.corona} strokeWidth={2.4}>
                <Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              </Svg>
              <Text style={s.chipText} numberOfLines={1}>
                {place}
              </Text>
              <Text style={s.chipChevron}>▾</Text>
            </Pressable>
          </View>
          <CompassChip targetAzimuthDeg={maxEvent?.azimuth ?? 270} />
        </View>
        {divergenceKm !== null && (
          <View style={s.divergence}>
            <Text style={s.divergenceText}>{t('map.divergence', { km: Math.round(divergenceKm) })}</Text>
            <Text style={s.divergenceAction} onPress={onRecalcHere}>
              {t('map.recalc')}
            </Text>
          </View>
        )}
      </View>

      {/* Hoja inferior: peek medido = colapsada (solo countdown + stats) */}
      <Animated.View style={[s.sheet, { height }]}>
        <View onLayout={onPeekLayout}>
          <View {...pan.panHandlers} style={s.handleArea}>
            <View style={s.handle} />
            <Text style={s.sheetKicker}>
              {upcoming
                ? t('map.kicker', {
                    label: t(`event.${upcoming.key}` as I18nKey).toUpperCase(),
                    key: upcoming.key === 'MAX' ? t('event.maxShort') : upcoming.key,
                  })
                : t('map.finished')}
            </Text>
            {upcoming && <Countdown target={upcoming.time} style={s.sheetCountdown} />}
          </View>
          <View style={s.sheetPeekBody}>
            <View style={s.statsRow}>
              <View style={s.stat}>
                <Text style={s.statValue}>{obscuracion}%</Text>
                <Text style={s.statLabel}>{t('map.hiddenHere')}</Text>
              </View>
              <View style={s.stat}>
                <Text style={[s.statValue, { color: C.violet }]}>
                  {bandDuration != null ? `${Math.floor(bandDuration / 60)}m ${bandDuration % 60}s` : '—'}
                </Text>
                <Text style={s.statLabel}>{t('map.inBand')}</Text>
              </View>
              <Pressable
                style={[s.cloudChip, { borderColor: cloud.color + '66' }]}
                hitSlop={6}
                accessibilityLabel={t('map.clouds.openWindy', { a11y: cloud.a11y })}
                onPress={() => {
                  const when = maxEvent?.time ?? new Date(activeEclipseMeta.windyFallbackMax);
                  Linking.openURL(windyEclipseCloudsUrl(spotCoords.lat, spotCoords.lon, when)).catch(() => {});
                }}
              >
                <View style={[s.cloudDot, { backgroundColor: cloud.color, shadowColor: cloud.color }]} />
                <Text style={s.cloudText}>{cloud.label}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <ScrollView
          style={s.sheetBody}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.sheetBodyContent}
        >
          <View style={s.divider} />
          <View style={s.cronoHeader}>
            <Text style={[s.cronoTitle, { flex: 1 }]} numberOfLines={1}>
              {t('map.crono', { place: place.toUpperCase(), date: activeEclipseMeta.shortDateLabel })}
            </Text>
            <Pressable onPress={onOpenMaps} hitSlop={8}>
              <Text style={s.mapsLink}>{t('map.directions')}</Text>
            </Pressable>
          </View>
          {cronoRows.map((e) => (
            <View key={e.key} style={s.cronoRow}>
              <Text style={[s.cronoLabel, (e.time <= now || e.belowHorizon) && { color: C.dim }]}>
                <Text style={{ color: EVENT_ACCENT[e.key] ?? C.dim }}>
                  {e.key === 'MAX' ? t('event.maxShort') : e.key}
                </Text>
                {'  '}
                {e.label}
                {e.belowHorizon ? t('map.belowHorizon') : ''}
              </Text>
              <Text style={[s.cronoTime, e.belowHorizon && { color: C.dim }]}>{fmtHM(e.time)}</Text>
            </View>
          ))}
          {maxEvent && maxEvent.altitude > 0 && (
            <>
              <View style={s.divider} />
              <Text style={s.cronoTitle}>{t('map.sunAtMax')}</Text>
              <HorizonDiagram altitudeDeg={maxEvent.altitude} azimuthDeg={maxEvent.azimuth} />
            </>
          )}
          {/* Cierre de la cronología: cuándo mirar ya está resuelto arriba; aquí, cómo mirar */}
          <View style={s.safetyCard}>
            <Text style={s.safetyTitle}>
              {t('map.safety.title')}
              <Text style={{ color: C.danger }}>ISO 12312-2</Text>
            </Text>
            <Text style={s.safetyBody}>{t('map.safety.body')}</Text>
            <Pressable onPress={() => Linking.openURL(IGN_URL).catch(() => {})} accessibilityRole="link">
              <Text style={s.safetyLink}>{t('map.safety.guide')}</Text>
            </Pressable>
            {!!glassesUrl && (
              <>
                <Pressable
                  onPress={() => {
                    track('glasses_click', { from: 'map' });
                    Linking.openURL(glassesUrl).catch(() => {});
                  }}
                  accessibilityRole="link"
                >
                  <Text style={s.safetyLink}>{t('map.safety.buy')}</Text>
                </Pressable>
                <Text style={s.affiliateNote}>{t('map.safety.affiliate')}</Text>
              </>
            )}
          </View>
          {sponsor && (
            <Pressable
              style={s.sponsorCard}
              onPress={() => {
                track('sponsor_click', { name: sponsor.name });
                Linking.openURL(sponsor.url).catch(() => {});
              }}
              accessibilityRole="link"
              accessibilityLabel={t('map.sponsor.a11y', { name: sponsor.name })}
            >
              <Text style={s.sponsorKicker}>{t('map.sponsor.kicker')}</Text>
              <Text style={s.sponsorName}>{sponsor.name}</Text>
              {!!sponsor.tagline && <Text style={s.sponsorTagline}>{sponsor.tagline}</Text>}
              <Text style={s.sponsorCta}>{t('map.sponsor.cta')}</Text>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
  fadeFill: { flex: 1 },
  gpsBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(21,21,30,0.9)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  topOverlay: { position: 'absolute', left: 0, right: 0, gap: 12, zIndex: 2 },
  chipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  divergence: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,107,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.5)',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  divergenceText: { fontFamily: F.semibold, fontSize: 13, color: C.text },
  divergenceAction: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1, color: C.danger },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  chipLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    height: 36,
    paddingHorizontal: 16,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 260,
  },
  chipText: { fontFamily: F.semibold, fontSize: 13, color: C.text, flexShrink: 1 },
  chipChevron: { fontFamily: F.semibold, fontSize: 12, color: C.dim, marginLeft: 2 },
  cronoHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mapsLink: {
    fontFamily: F.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: C.corona,
    paddingBottom: 4,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(21,21,30,0.97)',
    borderTopWidth: 1,
    borderTopColor: C.border,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    zIndex: 3,
  },
  handleArea: { paddingHorizontal: 24, paddingBottom: 4 },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: C.knobTrack,
    marginTop: 12,
    marginBottom: 10,
  },
  sheetKicker: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim },
  sheetCountdown: {
    fontFamily: F.bold,
    fontSize: 54,
    lineHeight: 58,
    color: C.corona,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    marginTop: 2,
    textShadowColor: 'rgba(255,184,77,0.35)',
    textShadowRadius: 24,
  },
  sheetPeekBody: { paddingHorizontal: 24, paddingBottom: 14 },
  sheetBody: { paddingHorizontal: 24 },
  /** Aire final: las tarjetas no deben morir pegadas al borde de la hoja */
  sheetBodyContent: { paddingBottom: 32 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 4, alignItems: 'center' },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: F.bold, fontSize: 22, color: C.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: F.medium, fontSize: 10, letterSpacing: 1.5, color: C.dim },
  cloudChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(11,11,16,0.7)',
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  cloudDot: { width: 9, height: 9, borderRadius: 5, shadowOpacity: 1, shadowRadius: 4, elevation: 4 },
  cloudText: { fontFamily: F.semibold, fontSize: 12, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginBottom: 20 },
  cronoTitle: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.dim,
    paddingBottom: 4,
  },
  cronoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(38,38,58,0.5)',
  },
  cronoLabel: { fontFamily: F.semibold, fontSize: 14, color: C.text },
  safetyCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.4)',
    backgroundColor: 'rgba(255,107,94,0.06)',
  },
  safetyTitle: { fontFamily: F.bold, fontSize: 15, lineHeight: 20, color: C.text },
  safetyBody: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 18, color: C.dim, marginTop: 8 },
  safetyLink: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1, color: C.corona, marginTop: 12 },
  affiliateNote: { fontFamily: F.regular, fontSize: 10.5, color: C.dim, marginTop: 4 },
  sponsorCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    gap: 4,
  },
  sponsorKicker: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2.5, color: C.dim },
  sponsorName: { fontFamily: F.bold, fontSize: 18, letterSpacing: -0.3, color: C.text },
  sponsorTagline: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim },
  sponsorCta: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.corona, marginTop: 8 },
  cronoTime: { fontFamily: F.medium, fontSize: 14, color: C.dim, fontVariant: ['tabular-nums'] },
});
