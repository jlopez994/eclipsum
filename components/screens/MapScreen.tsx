import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  computeLocalEclipse,
  eventAt,
  eventShortLabel,
  isActiveEclipse,
  nextEvent,
  type LocalEclipse,
} from '../../lib/eclipse';
import { bandOf, getActiveEclipse } from '../../lib/eclipseCatalog';
import { fmtDur, fmtHM } from '../../lib/format';
import { fmtFixed1, t, type I18nKey } from '../../lib/i18n';
import { bearingLabel, haversineKm, type TotalityDirection } from '../../lib/totality';
import type { Sponsor } from '../../lib/firebase';
import { cloudLevel, windyEclipseCloudsUrl } from '../../lib/weather';
import { useSheet } from '../../hooks/useSheet';
import { Countdown } from '../Countdown';
import { RealMap, type RealMapHandle } from '../RealMap';
import { CompassChip } from '../map/CompassChip';
import { SheetDetail } from '../map/SheetDetail';
import { SunFinderScreen } from './SunFinderScreen';
import { C, CARD, CLOUD_COLOR, F } from '../theme';

/** Fallback bajo: mejor recortar un instante que asomar la cronología. */
const SHEET_MIN_FALLBACK = 140;
/** Mínimo de mapa visible con la hoja estirada */
const SHEET_TOP_GAP = 150;
/** A partir de aquí (km) los obstáculos de donde estás no dicen nada del puesto elegido */
const FINDER_AWAY_KM = 5;

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
  /** Patrocinador del eclipse (Remote Config); null = sin tarjeta de patrocinio */
  sponsor?: Sponsor | null;
  /** URL de gafas certificadas (afiliado, vía Remote Config); vacío = solo el aviso, sin enlace */
  glassesUrl?: string;
}

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
  sponsor,
  glassesUrl,
}: MapScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [sheetMin, setSheetMin] = useState(SHEET_MIN_FALLBACK);
  const [finderOpen, setFinderOpen] = useState(false);

  /**
   * Tocar cualquier control de la app cierra el globo del mapa. Va en la fase de captura
   * y devuelve false: observa el toque sin robárselo al Pressable que lo reciba.
   */
  const dismissMapPopup = () => {
    mapRef.current?.closePopup();
    return false;
  };
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
  const maxEvent = eventAt(eclipse, 'MAX');

  /**
   * Máximo SOBRE TI, no sobre el puesto elegido. La brújula y el visor son instrumentos
   * de puntería: describen el cielo de donde apuntas el móvil. Con el puesto a 500 km, su
   * azimut se va 4° y su hora casi 5 min — la cabecera del visor daría una hora que no es
   * la tuya. null = sin GPS, o desde aquí no se ve este eclipse.
   */
  const sunHere = useMemo(() => {
    if (!gpsCoords) return null;
    try {
      const here = computeLocalEclipse(gpsCoords.lat, gpsCoords.lon);
      if (!isActiveEclipse(here)) return null;
      return eventAt(here, 'MAX') ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsCoords?.lat, gpsCoords?.lon, eclipse]);

  // La brújula tolera el respaldo del puesto (es orientativa); el visor no: solo abre con
  // posición real y sol por encima del horizonte
  const compassTarget = sunHere ?? maxEvent ?? null;
  const canOpenFinder = sunHere !== null && sunHere.altitude > 0;

  // A partir de unos km los obstáculos de aquí no dicen nada de los de allí: se avisa
  const awayFromSpot = (() => {
    if (!gpsCoords) return null;
    const km = Math.round(haversineKm(gpsCoords.lat, gpsCoords.lon, spotCoords.lat, spotCoords.lon));
    return km >= FINDER_AWAY_KM ? { km, place } : null;
  })();

  /**
   * Dentro de la banda: cuánto dura TU totalidad. Fuera: cuánto te falta para llegar.
   * La duración del punto de banda más cercano no vale aquí — ese punto cae en el borde,
   * donde la totalidad dura ~0, así que siempre daría segundos sueltos sin decir de dónde.
   */
  const bandStat =
    isTotal && eclipse.totalityDurationSec != null
      ? { value: fmtDur(eclipse.totalityDurationSec), label: t('map.inBand') }
      : !isTotal && totality !== null && totality !== 'none'
        ? {
            value: t('map.toBand.value', {
              km: totality.distanceKm,
              dir: bearingLabel(totality.bearingDeg),
            }),
            label: t('map.toBand'),
          }
        : { value: '—', label: t('map.inBand') };

  // Dato de caché sin red: se marca la antigüedad para no fiarse de nubes viejas
  const activeEclipseMeta = getActiveEclipse();
  const cloudStale = cloudAgeHours !== null ? ` · ${cloudAgeHours}h` : '';
  const level = cloudLevel(cloudPct);
  const cloud =
    level === null || cloudPct === null
      ? {
          color: C.dim,
          label: cloudLoading ? t('map.clouds.loading') : t('map.clouds.none'),
          a11y: t('map.clouds.noneA11y'),
        }
      : {
          color: CLOUD_COLOR[level],
          label: t(`map.clouds.${level}` as I18nKey, { pct: cloudPct, stale: cloudStale }),
          a11y: t('map.clouds.a11y', {
            level: t(`map.clouds.${level}.word` as I18nKey),
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
          onPress={() => {
            mapRef.current?.closePopup();
            mapRef.current?.flyTo(gpsCoords.lat, gpsCoords.lon);
          }}
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
      <View
        style={[s.topOverlay, { top: insets.top + 8 }]}
        pointerEvents="box-none"
        onStartShouldSetResponderCapture={dismissMapPopup}
      >
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
          {/* La brújula abre el visor directamente. El panel intermedio que había aquí solo
              repetía la altura del sol —que ya está en el diagrama de la hoja— y metía un
              toque de más antes de lo único que se quería hacer. */}
          <CompassChip
            targetAzimuthDeg={compassTarget?.azimuth ?? 270}
            // El visor exige posición REAL: sin GPS no sabemos qué cielo hay sobre la cámara,
            // y con el sol bajo el horizonte no hay nada que señalar. Sin eso, chip inerte.
            onPress={canOpenFinder ? () => setFinderOpen(true) : undefined}
            // El visor tapa el chip pero NO desmonta el mapa: sin esto quedan dos brújulas
            // vivas y al cerrarlo el sensor se apaga para las dos (ver CompassChip)
            paused={finderOpen}
          />
        </View>
      </View>

      {/* Hoja inferior: peek medido = colapsada (solo countdown + stats) */}
      <Animated.View style={[s.sheet, { height }]} onStartShouldSetResponderCapture={dismissMapPopup}>
        <View onLayout={onPeekLayout}>
          <View {...pan.panHandlers} style={s.handleArea}>
            <View style={s.handle} />
            <Text style={s.sheetKicker}>
              {upcoming
                ? t('map.kicker', {
                    label: t(`event.${upcoming.key}` as I18nKey).toUpperCase(),
                    key: eventShortLabel(upcoming.key),
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
                {/* «463 km NO» es más ancho que «1m 47s»: encoge antes que partirse */}
                <Text
                  style={[s.statValue, { color: C.violet }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {bandStat.value}
                </Text>
                <Text style={s.statLabel}>{bandStat.label}</Text>
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
        <SheetDetail
          eclipse={eclipse}
          place={place}
          dateLabel={activeEclipseMeta.shortDateLabel}
          now={now}
          onOpenMaps={onOpenMaps}
          sponsor={sponsor}
          glassesUrl={glassesUrl}
        />
      </Animated.View>
      </Animated.View>
      {/* Encima de todo, incluida la hoja: el visor es pantalla completa */}
      {/* Siempre con sunHere: azimut, altura y hora son los de DONDE ESTÁS */}
      {finderOpen && sunHere && (
        <SunFinderScreen
          azimuthDeg={sunHere.azimuth}
          altitudeDeg={sunHere.altitude}
          momentLabel={t('event.MAX').toUpperCase()}
          momentTime={fmtHM(sunHere.time)}
          awayFromSpot={awayFromSpot}
          onClose={() => setFinderOpen(false)}
        />
      )}
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
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  chipLocation: {
    ...CARD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 16,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 260,
  },
  chipText: { fontFamily: F.semibold, fontSize: 13, color: C.text, flexShrink: 1 },
  chipChevron: { fontFamily: F.semibold, fontSize: 12, color: C.dim, marginLeft: 2 },
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
});
