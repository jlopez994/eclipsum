import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { eventAt, eventShortLabel, type LocalEclipse } from '../../lib/eclipse';
import { fmtHMS } from '../../lib/format';
import { t, type I18nKey } from '../../lib/i18n';
import { track, type Sponsor } from '../../lib/firebase';
import { HorizonDiagram } from './HorizonDiagram';
import { C, EVENT_ACCENT, F } from '../theme';

const IGN_URL = 'https://eclipses.ign.es/como-observar-eclipses.html';

interface SheetDetailProps {
  eclipse: LocalEclipse;
  /** Nombre del puesto pintado, tal cual va en el encabezado de la cronología */
  place: string;
  /** Abreviatura del eclipse activo («12 AGO») */
  dateLabel: string;
  now: Date;
  onOpenMaps: () => void;
  /** Patrocinador del eclipse (Remote Config); null = sin tarjeta */
  sponsor?: Sponsor | null;
  /** URL de gafas certificadas (afiliado); vacío = solo el aviso, sin enlace */
  glassesUrl?: string;
}

/**
 * Mitad desplegable de la hoja del mapa: cronología de contactos, altura del sol en el
 * máximo, aviso de seguridad y patrocinio. Todo lo de aquí es lectura —ni estado propio ni
 * nada que el mapa necesite saber—, así que vive aparte del cromo de la hoja (arrastre,
 * cuenta atrás y estadísticas), que sí se coordina con el mapa.
 */
export function SheetDetail({
  eclipse,
  place,
  dateLabel,
  now,
  onOpenMaps,
  sponsor,
  glassesUrl,
}: SheetDetailProps) {
  const maxEvent = eventAt(eclipse, 'MAX');
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

  return (
    <ScrollView style={s.body} showsVerticalScrollIndicator={false} contentContainerStyle={s.bodyContent}>
      <View style={s.divider} />
      <View style={s.cronoHeader}>
        <Text style={[s.cronoTitle, { flex: 1 }]} numberOfLines={1}>
          {t('map.crono', { place: place.toUpperCase(), date: dateLabel })}
        </Text>
        <Pressable onPress={onOpenMaps} hitSlop={8}>
          <Text style={s.mapsLink}>{t('map.directions')}</Text>
        </Pressable>
      </View>
      {cronoRows.map((e) => (
        <View key={e.key} style={s.cronoRow}>
          <Text style={[s.cronoLabel, (e.time <= now || e.belowHorizon) && { color: C.dim }]}>
            <Text style={{ color: EVENT_ACCENT[e.key] ?? C.dim }}>{eventShortLabel(e.key)}</Text>
            {'  '}
            {e.label}
            {e.belowHorizon ? t('map.belowHorizon') : ''}
          </Text>
          <Text style={[s.cronoTime, e.belowHorizon && { color: C.dim }]}>{fmtHMS(e.time)}</Text>
        </View>
      ))}
      {maxEvent && maxEvent.altitude > 0 && (
        <>
          <View style={s.divider} />
          <Text style={s.cronoTitle}>{t('map.sunAtMax')}</Text>
          {/* El aviso de sol bajo lo da el propio diagrama (horizon.noteLow) */}
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
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 24 },
  /** Aire final: las tarjetas no deben morir pegadas al borde de la hoja */
  bodyContent: { paddingBottom: 32 },
  divider: { height: 1, backgroundColor: C.border, marginBottom: 20 },
  cronoHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cronoTitle: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.dim,
    paddingBottom: 4,
  },
  mapsLink: {
    fontFamily: F.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: C.corona,
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
  cronoTime: { fontFamily: F.medium, fontSize: 14, color: C.dim, fontVariant: ['tabular-nums'] },
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
});
