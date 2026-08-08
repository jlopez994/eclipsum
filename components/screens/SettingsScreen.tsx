import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F } from '../theme';

const IGN_URL = 'https://eclipses.ign.es/como-observar-eclipses.html';

interface SettingsScreenProps {
  permissions: { location: boolean; notifications: boolean };
  onDemoEclipse: () => void;
}

export function SettingsScreen({ permissions, onDemoEclipse }: SettingsScreenProps) {
  return (
    <View style={s.root}>
      <Text style={s.title}>Ajustes</Text>
      <ScrollView style={s.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 22 }}>
        <Text style={s.hint}>
          El puesto de observación se elige en el mapa, tocando el nombre del lugar arriba a la izquierda.
        </Text>

        <View>
          <Text style={s.section}>PERMISOS</Text>
          <View style={s.card}>
            <View style={[s.rowItem, s.rowDivider]}>
              <Text style={s.rowTitle}>Ubicación</Text>
              <Text style={permissions.location ? s.activeTag : s.deniedTag}>
                {permissions.location ? 'PERMITIDO' : 'DENEGADO'}
              </Text>
            </View>
            <View style={s.rowItem}>
              <Text style={s.rowTitle}>Notificaciones</Text>
              <Text style={permissions.notifications ? s.activeTag : s.deniedTag}>
                {permissions.notifications ? 'PERMITIDO' : 'DENEGADO'}
              </Text>
            </View>
          </View>
        </View>

        <View>
          <Text style={[s.section, { color: C.danger }]}>SEGURIDAD OCULAR</Text>
          <View style={s.safetyCard}>
            <Text style={s.safetyTitle}>
              Nunca mires al sol sin gafas certificadas <Text style={{ color: C.danger }}>ISO 12312-2</Text>
            </Text>
            <Text style={s.safetyBody}>
              Solo durante la totalidad es seguro mirar sin protección. La app te avisará del inicio y del fin
              exactos.
            </Text>
            <Pressable onPress={() => Linking.openURL(IGN_URL)}>
              <Text style={s.safetyLink}>GUÍA DE SEGURIDAD (IGN) →</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onLongPress={onDemoEclipse} delayLongPress={1500}>
          <Text style={s.about}>
            Eclipsum 1.0 · Cálculo: astronomy-engine · Nubosidad: Open-Meteo{'\n'}
            Eclipse total de sol · 12 de agosto de 2026
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: {
    fontFamily: F.bold,
    fontSize: 32,
    letterSpacing: -0.5,
    color: C.text,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 8,
  },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  hint: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim },
  section: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.5, color: C.dim, marginBottom: 10 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  rowItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowTitle: { fontFamily: F.semibold, fontSize: 15, color: C.text },
  activeTag: { fontFamily: F.medium, fontSize: 12, color: C.ok },
  deniedTag: { fontFamily: F.medium, fontSize: 12, color: C.danger },
  safetyCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,107,94,0.4)',
    borderRadius: 18,
    padding: 18,
    backgroundColor: 'rgba(255,107,94,0.06)',
  },
  safetyTitle: { fontFamily: F.bold, fontSize: 16, lineHeight: 21, color: C.text },
  safetyBody: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim, marginTop: 8 },
  safetyLink: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1, color: C.corona, marginTop: 12 },
  about: { fontFamily: F.regular, fontSize: 12, lineHeight: 19, color: C.dim, paddingBottom: 24 },
});
