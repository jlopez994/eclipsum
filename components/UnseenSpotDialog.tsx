import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { computeLocalEclipse, eclipseDayOf } from '../lib/eclipse';
import { dateLabelOf, eclipseForDay, getActiveEclipse } from '../lib/eclipseCatalog';
import { cleanPlaceLabel, type Spot } from '../lib/spots';
import { t } from '../lib/i18n';
import { C, F } from './theme';

interface UnseenSpotDialogProps {
  /** Puesto elegido desde el que NO se ve el eclipse activo */
  spot: Spot;
  /**
   * Punto desde el que SÍ se ve el eclipse activo, ya resuelto por quien abre el diálogo;
   * null = todavía sin resolver (o sin red), y esa salida no se ofrece.
   */
  visibleSpot: Spot | null;
  /** Mantiene el eclipse, mueve el puesto */
  onGoVisible: (spot: Spot) => void;
  /** Mantiene el puesto, mueve el eclipse al que sí se ve desde ahí */
  onGoOtherEclipse: (spot: Spot, day: string) => void;
  onCancel: () => void;
}

/**
 * Diálogo de «ahí no se ve»: se interpone entre elegir un puesto sin visibilidad y la
 * pantalla que lo explicaba después (OutOfZoneNotice), y ofrece las DOS salidas que sí
 * acaban en un mapa con cifras.
 *
 * No tiene «elegirlo igualmente». Ese botón existió y no compraba nada: fuera de zona App
 * anula el eclipse local, así que el único destino posible era el aviso a pantalla completa
 * cuya acción principal es —otra vez— elegir otro lugar. Un botón cuya única consecuencia
 * era deshacerse a sí mismo.
 */
export function UnseenSpotDialog({
  spot,
  visibleSpot,
  onGoVisible,
  onGoOtherEclipse,
  onCancel,
}: UnseenSpotDialogProps) {
  /**
   * Próximo eclipse visible desde el puesto, contando DESDE HOY.
   *
   * El ancla es hoy y no el eclipse activo: con el activo por delante el motor devolvería
   * el siguiente a ESA fecha y se saltaría los de en medio (mismo razonamiento que
   * `nextHere` en App). El día civil como ancla mantiene estable la clave del memo del
   * motor durante toda la vida del diálogo.
   */
  const other = useMemo(() => {
    try {
      const todayKey = new Date().toISOString().slice(0, 10);
      const day = eclipseDayOf(computeLocalEclipse(spot.lat, spot.lon, 0, new Date(`${todayKey}T00:00:00Z`)));
      return day !== null ? eclipseForDay(day) : null;
    } catch {
      return null; // sin entrada no hay adónde llevar a nadie: la acción se oculta
    }
  }, [spot.lat, spot.lon]);

  const place = cleanPlaceLabel(spot.name) || spot.name;
  // Sin salida hacia el eclipse activo manda la otra: siempre hay un botón con relleno
  const otherIsPrimary = visibleSpot === null;

  return (
    <View style={s.wrap}>
      <Pressable style={s.backdrop} onPress={onCancel} />
      <View style={s.card}>
        <Text style={s.title}>{t('spot.unseen.title')}</Text>
        <Text style={s.body}>{t('spot.unseen.body', { place, date: dateLabelOf(getActiveEclipse()) })}</Text>
        {other !== null && <Text style={s.body}>{t('app.outOfZone.here', { label: other.label })}</Text>}
        {/* Principal la salida hacia el eclipse elegido: se abrió esto para verlo, no para
            plantarse en un sitio desde el que no se ve */}
        {visibleSpot !== null && (
          <Pressable style={s.cta} onPress={() => onGoVisible(visibleSpot)}>
            <Text style={s.ctaText}>{t('spot.unseen.goVisible')}</Text>
          </Pressable>
        )}
        {other !== null && (
          <Pressable style={otherIsPrimary ? s.cta : s.ghost} onPress={() => onGoOtherEclipse(spot, other.civilDate)}>
            <Text style={otherIsPrimary ? s.ctaText : s.ghostText}>{t('spot.unseen.goOther')}</Text>
          </Pressable>
        )}
        <Pressable style={s.ghost} onPress={onCancel} hitSlop={8}>
          <Text style={s.ghostText}>{t('spot.unseen.cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.45)',
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  title: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2.5, color: C.danger },
  body: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.text },
  cta: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,184,77,0.45)',
    backgroundColor: 'rgba(255,184,77,0.10)',
  },
  ctaText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1.4, color: C.corona },
  ghost: { alignItems: 'center', paddingVertical: 11 },
  ghostText: { fontFamily: F.bold, fontSize: 12.5, letterSpacing: 1.4, color: C.dim },
});
