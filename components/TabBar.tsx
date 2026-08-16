import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { t, type I18nKey } from '../lib/i18n';
import { C, F } from './theme';

export type TabKey = 'mapa' | 'eclipses' | 'alertas' | 'ajustes';

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

function Icon({ tab, color }: { tab: TabKey; color: string }) {
  if (tab === 'mapa') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
        <Circle cx={12} cy={10} r={2.4} />
      </Svg>
    );
  }
  if (tab === 'eclipses') {
    // Sol eclipsado: disco con la luna (relleno de fondo) mordiéndolo desde el NE
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <Circle cx={12} cy={12} r={7} />
        <Circle cx={17} cy={7} r={5.5} fill={C.bg} stroke={color} />
      </Svg>
    );
  }
  if (tab === 'alertas') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <Path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
        <Path d="M10.3 20a2 2 0 0 0 3.4 0" />
      </Svg>
    );
  }
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path d="M4 8 H20 M4 16 H20" />
      <Circle cx={9} cy={8} r={2.6} fill={C.bg} />
      <Circle cx={15} cy={16} r={2.6} fill={C.bg} />
    </Svg>
  );
}

const TABS: { key: TabKey; labelKey: I18nKey }[] = [
  { key: 'mapa', labelKey: 'tab.map' },
  { key: 'eclipses', labelKey: 'tab.eclipses' },
  { key: 'alertas', labelKey: 'tab.alerts' },
  { key: 'ajustes', labelKey: 'tab.settings' },
];

export function TabBar({ active, onChange }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { height: 68 + insets.bottom, paddingBottom: insets.bottom }]}>
      {TABS.map((tab) => {
        const on = active === tab.key;
        const color = on ? C.corona : C.dim;
        return (
          // El estado activo iba SOLO en el color: sin rol ni selected, un lector de pantalla
          // lee las tres pestañas idénticas y no dice en cuál estás
          <Pressable
            key={tab.key}
            style={s.tab}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(tab.labelKey)}
          >
            <Icon tab={tab.key} color={color} />
            <Text style={[s.label, { color }]}>{t(tab.labelKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(11,11,16,0.96)',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 1.5 },
});
