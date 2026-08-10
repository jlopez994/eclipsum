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
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { nextEvent, type LocalEclipse } from '../../lib/eclipse';
import { getActiveEclipse } from '../../lib/eclipseCatalog';
import { type TotalityDirection } from '../../lib/totality';
import { track, type Sponsor } from '../../lib/firebase';
import { windyEclipseCloudsUrl } from '../../lib/weather';
import { useSheet } from '../../hooks/useSheet';
import { Countdown } from '../Countdown';
import { RealMap } from '../RealMap';
import { CompassChip } from '../map/CompassChip';
import { HereDot, UserDot } from '../map/Dots';
import { HorizonDiagram } from '../map/HorizonDiagram';
import { TotalPill } from '../map/TotalPill';
import { UmbraSweep } from '../map/UmbraSweep';
import { C, F } from '../theme';

/** Fallback bajo: mejor recortar un instante que asomar la cronología. */
const SHEET_MIN_FALLBACK = 140;
/** Mínimo de mapa visible con la hoja estirada */
const SHEET_TOP_GAP = 150;

/**
 * Fracciones verticales relativas al lienzo del diagrama (zona sobre la hoja).
 * Así el contenido usa toda la altura libre sin el hueco muerto encima de la tarjeta.
 */
const BAND_ANCHOR = 0.38;
const DOT_TOTAL = 0.3;
const DOT_NEAR = 0.56;
const DOT_FAR = 0.84;
/** km que mapean a DOT_FAR; más allá se satura. */
const DIST_SCALE_KM = 150;

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
  /** El puesto activo es un snapshot GPS */
  spotIsGps: boolean;
  /**
   * Posición GPS en la escala del diagrama cuando difiere del puesto.
   * null = solapados / sin segundo punto.
   */
  hereOnMap: {
    isTotal: boolean;
    totality: TotalityDirection | 'none' | null;
    km: number;
    obscuration: number | null;
  } | null;
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
  /** Vista elegida: diagrama esquemático o mapa real */
  mapView: 'diagram' | 'real';
  onToggleMapView: () => void;
  onOpenSelector: () => void;
  onOpenMaps: () => void;
  /** Punto tocado en el mapa real elegido como puesto de observación */
  onSelectMapPoint: (p: { lat: number; lon: number }) => void;
  /** km entre GPS real y spot activo el día del eclipse; null = sin aviso */
  divergenceKm: number | null;
  onRecalcHere: () => void;
  /** Patrocinador del eclipse (Remote Config); null = sin tarjeta de patrocinio */
  sponsor?: Sponsor | null;
}

const fmtHM = (d: Date) =>
  d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const fmtPct = (o: number) => `${(o * 100).toFixed(1).replace('.', ',')}%`;

/** Fracción vertical para una distancia a la banda dada. */
function kmFraction(km: number): number {
  const t = Math.min(1, km / DIST_SCALE_KM);
  return DOT_NEAR + t * (DOT_FAR - DOT_NEAR);
}

/** Fracción vertical del punto: más cerca de la banda cuanto menor sea la distancia. */
function dotTopFraction(isTotal: boolean, totality: TotalityDirection | 'none' | null): number {
  if (isTotal) return DOT_TOTAL;
  if (totality === null || totality === 'none') return DOT_FAR;
  return kmFraction(totality.distanceKm);
}

export function MapScreen({
  eclipse,
  place,
  hereLabel,
  spotIsGps,
  hereOnMap,
  cloudPct,
  cloudAgeHours,
  cloudLoading,
  totality,
  now,
  spotCoords,
  hereCoords,
  mapView,
  onToggleMapView,
  onOpenSelector,
  onOpenMaps,
  onSelectMapPoint,
  divergenceKm,
  onRecalcHere,
  sponsor,
}: MapScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [sheetMin, setSheetMin] = useState(SHEET_MIN_FALLBACK);

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
      label: e.label,
      time: e.time,
      belowHorizon: e.altitude < 0,
    })),
    ...(eclipse.sunset
      ? [{ key: 'OC', label: 'Ocaso del sol', time: eclipse.sunset, belowHorizon: false }]
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
  const cloud =
    cloudPct === null
      ? { color: C.dim, label: cloudLoading ? 'NUBES…' : 'NUBES —', a11y: 'Previsión de nubes no disponible' }
      : cloudPct < 25
        ? {
            color: C.ok,
            label: `Pocas nubes · ${cloudPct}%${cloudStale}`,
            a11y: `Pocas nubes: nubosidad prevista ${cloudPct}% a la hora del máximo el ${activeEclipseMeta.shortDateLabel.toLowerCase()}`,
          }
        : cloudPct < 60
          ? {
              color: C.corona,
              label: `Nubes medias · ${cloudPct}%${cloudStale}`,
              a11y: `Nubes medias: nubosidad prevista ${cloudPct}% a la hora del máximo el ${activeEclipseMeta.shortDateLabel.toLowerCase()}`,
            }
          : {
              color: C.danger,
              label: `Muchas nubes · ${cloudPct}%${cloudStale}`,
              a11y: `Muchas nubes: nubosidad prevista ${cloudPct}% a la hora del máximo el ${activeEclipseMeta.shortDateLabel.toLowerCase()}`,
            };

  const obscuracion = (eclipse.obscuration * 100).toFixed(1).replace('.', ',');
  const showHere = hereOnMap !== null;
  const spotFrac = dotTopFraction(isTotal, totality);
  const hereFrac = showHere ? dotTopFraction(hereOnMap.isTotal, hereOnMap.totality) : spotFrac;
  // Si casi se solapan en vertical: lado a lado a la misma altura, sin guía
  const dotsCollide = showHere && Math.abs(spotFrac - hereFrac) < 0.09;
  const midFrac = (spotFrac + hereFrac) / 2;
  const spotTop = dotsCollide ? midFrac : spotFrac;
  const hereTop = dotsCollide ? midFrac : hereFrac;
  // Guía: con dos puntos conecta punto a punto; con uno, desde la banda al punto
  const guideTop = showHere ? Math.min(spotFrac, hereFrac) : BAND_ANCHOR;
  const guideHeightFrac = Math.max(0, Math.max(spotFrac, hereFrac) - guideTop);
  const showGuide =
    !dotsCollide &&
    guideHeightFrac > 0.02 &&
    (showHere || (!isTotal && totality !== null && totality !== 'none'));
  const guideKm = showHere
    ? hereOnMap.km
    : totality !== null && totality !== 'none'
      ? totality.distanceKm
      : null;

  return (
    <View style={s.root}>
      <Animated.View style={[s.fadeFill, { opacity: fade }]}>
      {mapView === 'real' && (
        <RealMap
          // Remount al cambiar de eclipse: el HTML (banda) se congela al montar
          key={activeEclipseMeta.id}
          spot={{ ...spotCoords, label: place }}
          here={hereCoords ? { ...hereCoords, label: hereLabel ?? 'TÚ' } : null}
          onSelectPoint={onSelectMapPoint}
        />

      )}
      {mapView === 'diagram' && (
      <View style={[s.diagramStage, { bottom: sheetMin }]} pointerEvents="box-none">
      {/* Fondo + costa esquemática */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 390 780" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="bgGlow" cx="75%" cy="12%" r="90%">
            <Stop offset="0%" stopColor="#12121C" />
            <Stop offset="55%" stopColor={C.bg} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={390} height={780} fill="url(#bgGlow)" />
        <Path
          d="M0 130 H390 M0 260 H390 M0 390 H390 M0 520 H390 M78 0 V780 M156 0 V780 M234 0 V780 M312 0 V780"
          stroke="#191926"
          strokeWidth={1}
        />
        <Path
          d="M-20 560 C 60 520, 120 585, 205 545 S 350 585, 410 540 L 410 800 L -20 800 Z"
          fill="#101019"
          stroke="#1D1D2C"
          strokeWidth={1}
        />
        <Path
          d="M-20 250 C 80 215, 170 265, 260 230 S 380 250, 420 225"
          fill="none"
          stroke="#1D1D2C"
          strokeWidth={1.5}
        />
      </Svg>

      {/* Banda de totalidad */}
      <View style={s.band}>
        <LinearGradient
          colors={[
            'transparent',
            'rgba(124,108,255,0.10)',
            'rgba(124,108,255,0.24)',
            'rgba(255,184,77,0.22)',
            'rgba(124,108,255,0.24)',
            'rgba(124,108,255,0.10)',
            'transparent',
          ]}
          locations={[0, 0.22, 0.4, 0.5, 0.6, 0.78, 1]}
          style={StyleSheet.absoluteFill}
        />
        <UmbraSweep />
        <View style={s.bandLine} />
        <Text style={s.bandLabel}>{activeEclipseMeta.bandLabel}</Text>
        <Text style={s.bandHint}>MÁS DURACIÓN CERCA DEL CENTRO</Text>
      </View>


      {/* Guía hacia la banda: longitud hasta el punto más alejado */}
      {showGuide && (
        <View
          style={[
            s.guide,
            {
              top: `${guideTop * 100}%`,
              height: `${guideHeightFrac * 100}%`,
            },
          ]}
        />
      )}
      {/* km sobre la guía: distancia puesto↔GPS, o puesto↔banda si solo hay un punto */}
      {showGuide && guideKm !== null && guideHeightFrac > 0.07 && (
        <View
          style={[s.guideKmWrap, { top: `${(guideTop + guideHeightFrac / 2) * 100}%` }]}
          pointerEvents="none"
        >
          {!showHere && totality !== null && totality !== 'none' ? (
            <TotalPill distanceKm={totality.distanceKm} bearingDeg={totality.bearingDeg} />
          ) : (
            <Text style={s.guideKmText}>{guideKm} km</Text>
          )}
        </View>
      )}

      {showHere && (
        <View style={[s.userArea, dotsCollide && s.hereArea, { top: `${hereTop * 100}%` }]}>
          <HereDot />
          <Text style={s.hereLabel}>{hereLabel ?? 'TÚ'}</Text>
          {!hereOnMap.isTotal && hereOnMap.obscuration !== null && (
            <Text style={s.dotPct}>{fmtPct(hereOnMap.obscuration)}</Text>
          )}
        </View>
      )}
      <View style={[s.userArea, dotsCollide && s.spotArea, { top: `${spotTop * 100}%` }]}>
        <UserDot />
        <Text style={s.userLabel} numberOfLines={1}>
          {showHere || !spotIsGps ? place : 'TU POSICIÓN'}
        </Text>
        {!isTotal && <Text style={s.dotPct}>{obscuracion}%</Text>}
      </View>
      {/* Con puntos lado a lado la guía se oculta: km a la banda anclados sobre la hoja */}
      {dotsCollide && !isTotal && totality !== null && totality !== 'none' && (
        <View style={s.totalAnchor} pointerEvents="none">
          <TotalPill distanceKm={totality.distanceKm} bearingDeg={totality.bearingDeg} />
        </View>
      )}
      </View>
      )}

      {/* Overlay superior: chips + lugares + aviso divergencia */}
      <View style={[s.topOverlay, { top: insets.top + 8 }]} pointerEvents="box-none">
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
            <Pressable
              style={s.viewToggle}
              onPress={onToggleMapView}
              hitSlop={8}
              accessibilityLabel={mapView === 'diagram' ? 'Ver mapa real' : 'Ver diagrama'}
            >
              {mapView === 'diagram' ? (
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth={2}>
                  <Path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" />
                  <Path d="M9 4v14M15 6v14" />
                </Svg>
              ) : (
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth={2}>
                  <Path d="M3 16L21 8" />
                  <Circle cx={7} cy={14.2} r={2.4} fill={C.dim} stroke="none" />
                </Svg>
              )}
            </Pressable>
          </View>
          <CompassChip targetAzimuthDeg={maxEvent?.azimuth ?? 270} />
        </View>
        {divergenceKm !== null && (
          <View style={s.divergence}>
            <Text style={s.divergenceText}>
              Estás a {Math.round(divergenceKm)} km de tu puesto de observación
            </Text>
            <Text style={s.divergenceAction} onPress={onRecalcHere}>
              RECALCULAR AQUÍ →
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
              {upcoming ? `${upcoming.label.toUpperCase()} · ${upcoming.key} EN` : 'ECLIPSE FINALIZADO'}
            </Text>
            {upcoming && <Countdown target={upcoming.time} style={s.sheetCountdown} />}
          </View>
          <View style={s.sheetPeekBody}>
            <View style={s.statsRow}>
              <View style={s.stat}>
                <Text style={s.statValue}>{obscuracion}%</Text>
                <Text style={s.statLabel}>OCULTO AQUÍ</Text>
              </View>
              <View style={s.stat}>
                <Text style={[s.statValue, { color: C.violet }]}>
                  {bandDuration != null ? `${Math.floor(bandDuration / 60)}m ${bandDuration % 60}s` : '—'}
                </Text>
                <Text style={s.statLabel}>EN LA BANDA</Text>
              </View>
              <Pressable
                style={[s.cloudChip, { borderColor: cloud.color + '66' }]}
                hitSlop={6}
                accessibilityLabel={`${cloud.a11y}; abrir en Windy`}
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
        <ScrollView style={s.sheetBody} showsVerticalScrollIndicator={false}>
          <View style={s.divider} />
          <View style={s.cronoHeader}>
            <Text style={[s.cronoTitle, { flex: 1 }]} numberOfLines={1}>
              CRONOLOGÍA EN {place.toUpperCase()} · {activeEclipseMeta.shortDateLabel}
            </Text>
            <Pressable onPress={onOpenMaps} hitSlop={8}>
              <Text style={s.mapsLink}>CÓMO LLEGAR →</Text>
            </Pressable>
          </View>
          {cronoRows.map((e) => (
            <View key={e.key} style={s.cronoRow}>
              <Text style={[s.cronoLabel, (e.time <= now || e.belowHorizon) && { color: C.dim }]}>
                <Text style={{ color: EVENT_ACCENT[e.key] ?? C.dim }}>{e.key === 'MAX' ? 'MÁX' : e.key}</Text>
                {'  '}
                {e.label}
                {e.belowHorizon ? ' · bajo el horizonte' : ''}
              </Text>
              <Text style={[s.cronoTime, e.belowHorizon && { color: C.dim }]}>{fmtHM(e.time)}</Text>
            </View>
          ))}
          {maxEvent && maxEvent.altitude > 0 && (
            <>
              <View style={s.divider} />
              <Text style={s.cronoTitle}>SOL EN EL MÁXIMO</Text>
              <HorizonDiagram altitudeDeg={maxEvent.altitude} azimuthDeg={maxEvent.azimuth} />
            </>
          )}
          {sponsor && (
            <Pressable
              style={s.sponsorCard}
              onPress={() => {
                track('sponsor_click', { name: sponsor.name });
                Linking.openURL(sponsor.url).catch(() => {});
              }}
              accessibilityRole="link"
              accessibilityLabel={`Patrocinador: ${sponsor.name}`}
            >
              <Text style={s.sponsorKicker}>CON EL APOYO DE</Text>
              <Text style={s.sponsorName}>{sponsor.name}</Text>
              {!!sponsor.tagline && <Text style={s.sponsorTagline}>{sponsor.tagline}</Text>}
              <Text style={s.sponsorCta}>CONOCER MÁS →</Text>
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
  /** Lienzo del diagrama: altura fija sobre la hoja colapsada (no se reescala al expandir). */
  diagramStage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: '20%',
    left: '-32%',
    width: '164%',
    height: 200,
    transform: [{ rotate: '-13deg' }],
  },
  bandLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 3,
    marginTop: -1,
    backgroundColor: C.corona,
    shadowColor: C.corona,
    shadowOpacity: 0.45,
    shadowRadius: 13,
    elevation: 8,
  },
  bandLabel: {
    position: 'absolute',
    alignSelf: 'center',
    top: 14,
    fontFamily: F.semibold,
    fontSize: 10,
    letterSpacing: 3,
    color: C.violet,
  },
  guide: {
    position: 'absolute',
    left: '50%',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(242,239,233,0.32)',
    borderStyle: 'dashed',
  },
  guideKmWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', marginTop: -10 },
  totalAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
  },
  guideKmText: {
    fontFamily: F.semibold,
    fontSize: 11,
    color: C.text,
    backgroundColor: 'rgba(11,11,18,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  bandHint: {
    position: 'absolute',
    alignSelf: 'center',
    top: 30,
    fontFamily: F.medium,
    fontSize: 9,
    letterSpacing: 2,
    color: 'rgba(124,108,255,0.6)',
  },
  viewToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(21,21,30,0.85)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPct: {
    fontFamily: F.semibold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: C.dim,
    backgroundColor: 'rgba(11,11,18,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  userArea: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8 },
  /** Lado a lado cuando las Y casi coinciden */
  hereArea: { transform: [{ translateX: -52 }] },
  spotArea: { transform: [{ translateX: 52 }] },
  userLabel: {
    fontFamily: F.medium,
    fontSize: 11,
    letterSpacing: 1,
    color: C.text,
    backgroundColor: 'rgba(11,11,18,0.85)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: 'hidden',
  },
  hereLabel: {
    fontFamily: F.semibold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: C.corona,
    backgroundColor: 'rgba(11,11,18,0.85)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: 'hidden',
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
