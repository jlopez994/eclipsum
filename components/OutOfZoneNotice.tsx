import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { C, F } from './theme';

interface OutOfZoneNoticeProps {
  /** Puesto elegido desde el que NO se ve el eclipse activo */
  place: string;
  /** Abreviatura del eclipse activo (p. ej. «12 AGO») */
  date: string;
  /** Puesto cuyos datos siguen en pantalla detrás; null = no había ninguno previo */
  keepingPlace: string | null;
  /**
   * Etiqueta del eclipse que SÍ se ve desde el puesto elegido («Total · 22 jul 2028»).
   * null = el motor lo sitúa fuera del catálogo conocido: sin dato, sin acción.
   */
  otherLabel: string | null;
  onGoToOther: () => void;
  top: number;
}

/**
 * Velo semiopaco sobre el mapa: explica que el puesto elegido no ve el eclipse activo
 * y, si sabemos cuál sí se ve desde ahí, ofrece saltar a él.
 *
 * Se cierra con la ✕ para dejar ver el mapa. Detrás quedan los datos del último puesto
 * válido —nunca los del elegido—: sus cifras serían de otro eclipse. App lo remonta con
 * `key` al cambiar de puesto, así que un puesto nuevo vuelve a avisar aunque cerraras el anterior.
 */
export function OutOfZoneNotice({
  place,
  date,
  keepingPlace,
  otherLabel,
  onGoToOther,
  top,
}: OutOfZoneNoticeProps) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;

  return (
    <View style={s.scrim}>
      <View style={[s.card, { marginTop: top }]}>
        <View style={s.headRow}>
          <Text style={s.kicker}>{t('app.outOfZone.title')}</Text>
          <Pressable onPress={() => setClosed(true)} hitSlop={12} accessibilityLabel={t('sun.close')}>
            <Text style={s.close}>✕</Text>
          </Pressable>
        </View>
        <Text style={s.body}>{t('app.outOfZone', { place, date })}</Text>
        {otherLabel !== null && <Text style={s.body}>{t('app.outOfZone.here', { label: otherLabel })}</Text>}
        {keepingPlace !== null && (
          <Text style={s.keeping}>{t('app.outOfZone.keeping', { place: keepingPlace })}</Text>
        )}
        {otherLabel !== null && (
          <Pressable style={s.cta} onPress={onGoToOther}>
            <Text style={s.ctaText}>{t('app.outOfZone.otherEclipse')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /** Semiopaco: el mapa de detrás se intuye, así se entiende que sigue ahí */
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11,11,16,0.82)',
    paddingHorizontal: 20,
    zIndex: 30,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.45)',
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2.5, color: C.danger },
  close: { fontFamily: F.bold, fontSize: 15, color: C.dim },
  body: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.text },
  keeping: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 18, color: C.dim },
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
});
