import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { C, F } from './theme';

interface OutOfZoneNoticeProps {
  /** Puesto elegido desde el que NO se ve el eclipse activo */
  place: string;
  /** Abreviatura del eclipse activo (p. ej. «12 AGO») */
  date: string;
  /**
   * Etiqueta del eclipse que SÍ se ve desde el puesto elegido («Total · 22 jul 2028»).
   * null = el motor lo sitúa fuera del catálogo conocido: sin dato, sin acción.
   */
  otherLabel: string | null;
  onGoToOther: () => void;
  /** Abre el selector para buscar un puesto desde el que sí se vea este eclipse */
  onChoosePlace: () => void;
}

/**
 * Pantalla de la pestaña Mapa cuando el puesto elegido no ve el eclipse activo: explica el
 * porqué y ofrece las dos salidas —cambiar de puesto, o saltar al eclipse que sí se ve.
 *
 * Ocupa el hueco del mapa en vez de flotar sobre él porque fuera de zona no hay cifras que
 * enseñar: las del último puesto válido describirían otro sitio. Sin ✕, por lo mismo: no
 * tapa nada que se pueda recuperar cerrándola.
 */
export function OutOfZoneNotice({ place, date, otherLabel, onGoToOther, onChoosePlace }: OutOfZoneNoticeProps) {
  return (
    <View style={s.screen}>
      <View style={s.card}>
        <Text style={s.kicker}>{t('app.outOfZone.title')}</Text>
        <Text style={s.body}>{t('app.outOfZone', { place, date })}</Text>
        {otherLabel !== null && <Text style={s.body}>{t('app.outOfZone.here', { label: otherLabel })}</Text>}
        {/* Primera salida y siempre disponible: el usuario eligió ESTE eclipse, así que
            cambiar de puesto es lo que quiere. Saltar de eclipse es la alternativa. */}
        <Pressable style={s.cta} onPress={onChoosePlace}>
          <Text style={s.ctaText}>{t('app.choosePlace')}</Text>
        </Pressable>
        {otherLabel !== null && (
          <Pressable style={s.ctaGhost} onPress={onGoToOther}>
            <Text style={s.ctaGhostText}>{t('app.outOfZone.otherEclipse')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /** Centrada en el hueco del mapa: es el contenido de la pestaña, no una capa encima */
  screen: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.45)',
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  kicker: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2.5, color: C.danger },
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
  /** Secundaria: sin relleno, para que la de elegir puesto mande a primera vista */
  ctaGhost: { alignItems: 'center', paddingVertical: 11 },
  ctaGhostText: { fontFamily: F.bold, fontSize: 12.5, letterSpacing: 1.4, color: C.dim },
});
