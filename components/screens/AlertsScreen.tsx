import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LocalEclipse } from '../../lib/eclipse';
import { scheduleEclipseAlerts, sendTestNotification } from '../../lib/notifications';
import type { AlertToggles } from '../../lib/prefs';
import { track } from '../../lib/firebase';
import { C, F } from '../theme';

const ALERT_META: Record<string, { accent: string; desc: string }> = {
  C1: { accent: C.corona, desc: 'Gafas de eclipse puestas para mirar al sol.' },
  C2: { accent: C.totality, desc: 'En la banda: prepárate para mirar sin gafas.' },
  MAX: { accent: C.totality, desc: 'Punto culminante del eclipse.' },
  C3: { accent: C.danger, desc: 'GAFAS PUESTAS YA. El sol vuelve a ser peligroso.' },
  C4: { accent: C.corona, desc: 'Fin del eclipse.' },
};

interface AlertsScreenProps {
  eclipse: LocalEclipse;
  toggles: AlertToggles;
  onToggle: (key: keyof AlertToggles, value: boolean) => void;
}

const fmtHM = (d: Date) =>
  d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function AlertsScreen({ eclipse, toggles, onToggle }: AlertsScreenProps) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<string | null>(null);
  // Solo cuentan los eventos que existen en esta ubicación (parcial no tiene C2/C3)
  const activeCount = eclipse.events.filter((e) => toggles[e.key]).length;

  const reschedule = async (next: AlertToggles) => {
    try {
      const n = await scheduleEclipseAlerts(eclipse, next);
      track('alerts_scheduled', { count: n });
      setStatus(`${n} notificaciones programadas`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error al programar alertas');
    }
  };

  const handleToggle = (key: keyof AlertToggles) => {
    const next = { ...toggles, [key]: !toggles[key] };
    onToggle(key, !toggles[key]);
    void reschedule(next);
  };

  const onTest = async () => {
    try {
      await sendTestNotification();
      setStatus('Notificación de prueba en 5 segundos…');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error en notificación de prueba');
    }
  };

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Text style={s.title}>Alertas</Text>
        <View style={s.countRow}>
          <View style={s.countDot} />
          <Text style={s.countText}>{activeCount} alertas programadas</Text>
        </View>
      </View>
      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        {eclipse.events.map((e, i) => {
          const meta = ALERT_META[e.key];
          const on = toggles[e.key];
          return (
            <View key={e.key} style={[s.row, !on && { opacity: 0.45 }]}>
              <View style={s.leftCol}>
                {i > 0 && <View style={[s.connector, { top: 0, height: '50%' }]} />}
                {i < eclipse.events.length - 1 && <View style={[s.connector, { bottom: 0, height: '50%' }]} />}
                <View
                  style={[
                    s.rowDot,
                    {
                      backgroundColor: on ? meta.accent : C.bg,
                      borderColor: on ? meta.accent : C.knobTrack,
                      shadowColor: on ? meta.accent : 'transparent',
                    },
                  ]}
                />
              </View>
              <View style={s.rowBody}>
                <View style={s.rowTitleLine}>
                  <Text style={s.rowTitle}>
                    {e.key === 'MAX' ? 'MÁX' : e.key} · {e.label}
                  </Text>
                  <Text style={[s.rowTime, { color: meta.accent }]}>{fmtHM(e.time)}</Text>
                </View>
                <Text style={s.rowDesc}>{meta.desc}</Text>
              </View>
              <Pressable
                onPress={() => handleToggle(e.key)}
                style={[
                  s.track,
                  { backgroundColor: on ? meta.accent : C.surface, borderColor: on ? meta.accent : C.border },
                ]}
              >
                <View style={[s.knob, { left: on ? 25 : 3 }]} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={s.footer}>
        <Pressable style={s.testButton} onPress={onTest}>
          <Text style={s.testButtonText}>PROBAR NOTIFICACIÓN</Text>
        </Pressable>
        {status && <Text style={s.status}>{status}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 24 },
  title: { fontFamily: F.bold, fontSize: 32, letterSpacing: -0.5, color: C.text },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  countDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.ok,
    shadowColor: C.ok,
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 4,
  },
  countText: { fontFamily: F.medium, fontSize: 14, color: C.dim },
  list: { flex: 1, paddingHorizontal: 24, marginTop: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  leftCol: {
    width: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { position: 'absolute', left: 7, width: 2, backgroundColor: C.border },
  rowDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    shadowOpacity: 0.55,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 1,
  },
  rowBody: { flex: 1, minWidth: 0, paddingVertical: 12 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowTitle: { fontFamily: F.bold, fontSize: 16, color: C.text },
  rowTime: { fontFamily: F.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  rowDesc: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 17, color: C.dim, marginTop: 2 },
  track: { width: 52, height: 30, borderRadius: 99, borderWidth: 1 },
  knob: {
    position: 'absolute',
    top: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.text,
  },
  footer: { paddingHorizontal: 24, paddingBottom: 20 },
  testButton: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
  },
  testButtonText: { fontFamily: F.bold, fontSize: 14, letterSpacing: 1, color: C.text },
  status: { fontFamily: F.medium, fontSize: 12, color: C.corona, textAlign: 'center', marginTop: 10 },
});
