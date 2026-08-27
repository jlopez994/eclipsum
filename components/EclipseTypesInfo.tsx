import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t, type I18nKey } from '../lib/i18n';
import { C, F } from './theme';

interface EclipseTypesInfoProps {
  visible: boolean;
  onClose: () => void;
}

/** Grupos y tipos en orden de lectura; cada uno resuelve a types.<grupo>.<tipo>.{name,body}. */
const GROUPS = [
  { key: 'solar', kinds: ['total', 'annular', 'partial'] },
  { key: 'lunar', kinds: ['total', 'partial', 'penumbral'] },
] as const;

/**
 * Hoja informativa: qué tipos de eclipse existen y qué implica cada uno (seguridad incluida).
 * Solo lectura; el filtro por tipo de la pestaña Eclipses es quien la enlaza.
 */
export function EclipseTypesInfo({ visible, onClose }: EclipseTypesInfoProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.panel}>
        <View style={s.handle} />
        <Text style={s.title}>{t('types.title')}</Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
          {GROUPS.map((g) => (
            <View key={g.key}>
              <Text style={s.groupTitle}>{t(`types.${g.key}` as I18nKey)}</Text>
              {g.kinds.map((k) => (
                <View key={k} style={s.typeRow}>
                  <Text style={s.typeName}>{t(`types.${g.key}.${k}.name` as I18nKey)}</Text>
                  <Text style={s.typeBody}>{t(`types.${g.key}.${k}.body` as I18nKey)}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // Mismo velo/panel que SpotEclipses: la pestaña se intuye detrás
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    maxHeight: '78%',
    backgroundColor: 'rgba(21,21,30,0.92)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.knobTrack,
    marginTop: 10,
  },
  title: { fontFamily: F.bold, fontSize: 18, letterSpacing: -0.3, color: C.text, marginTop: 16 },
  body: { paddingBottom: 12 },
  groupTitle: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: C.dim,
    marginTop: 18,
    marginBottom: 6,
  },
  typeRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(38,38,58,0.5)',
  },
  typeName: { fontFamily: F.bold, fontSize: 15, color: C.corona },
  typeBody: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.text, marginTop: 4 },
});
