import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import type { LocalEclipse } from '../../lib/eclipse';
import {
  countEclipseAlerts,
  scheduleEclipseAlerts,
  sendTestNotification,
} from '../../lib/notifications';
import type { AlertEarly, AlertSound, AlertToggles, C1PlanAlerts } from '../../lib/prefs';
import { ALERT_EARLY_SECONDS } from '../../lib/prefs';
import { track } from '../../lib/firebase';
import { fmtHMS } from '../../lib/format';
import { t, type I18nKey } from '../../lib/i18n';
import { C, EVENT_ACCENT, F } from '../theme';

interface AlertsScreenProps {
  eclipse: LocalEclipse;
  toggles: AlertToggles;
  early: AlertEarly;
  c1Plan: C1PlanAlerts;
  alertSound: AlertSound;
  onToggle: (key: keyof AlertToggles, value: boolean) => void;
  onEarlyChange: (key: keyof AlertEarly, value: boolean) => void;
  onC1PlanChange: (next: C1PlanAlerts) => void;
}

export function AlertsScreen({
  eclipse,
  toggles,
  early,
  c1Plan,
  alertSound,
  onToggle,
  onEarlyChange,
  onC1PlanChange,
}: AlertsScreenProps) {
  const insets = useSafeAreaInsets();
  /** Mensajes puntuales (prueba / error). El conteo va siempre en el footer. */
  const [flash, setFlash] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const testClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Solo cuentan los eventos que existen en esta ubicación (parcial no tiene C2/C3)
  const activeCount = eclipse.events.filter((e) => toggles[e.key]).length;
  const scheduledCount = countEclipseAlerts(eclipse, toggles, early, c1Plan);

  const clearTestFlash = () => {
    if (testClearRef.current) {
      clearTimeout(testClearRef.current);
      testClearRef.current = null;
    }
    setFlash(null);
    setTesting(false);
  };

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      if (n.request.content.title?.toLowerCase().includes(t('notif.test.match').toLowerCase())) clearTestFlash();
    });
    return () => {
      sub.remove();
      if (testClearRef.current) clearTimeout(testClearRef.current);
    };
  }, []);

  const reschedule = async (
    nextToggles: AlertToggles,
    nextEarly: AlertEarly,
    nextPlan: C1PlanAlerts,
  ) => {
    try {
      const n = await scheduleEclipseAlerts(eclipse, nextToggles, alertSound, nextEarly, nextPlan);
      track('alerts_scheduled', { count: n });
      setFlash(null);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : t('alerts.scheduleError'));
    }
  };

  const handleToggle = (key: keyof AlertToggles) => {
    const next = { ...toggles, [key]: !toggles[key] };
    onToggle(key, !toggles[key]);
    void reschedule(next, early, c1Plan);
  };

  const handleEarly = (key: keyof AlertEarly) => {
    const value = !early[key];
    const next = { ...early, [key]: value };
    onEarlyChange(key, value);
    void reschedule(toggles, next, c1Plan);
  };

  const handleC1Plan = (key: keyof C1PlanAlerts) => {
    const next = { ...c1Plan, [key]: !c1Plan[key] };
    onC1PlanChange(next);
    void reschedule(toggles, early, next);
  };

  const onTest = async () => {
    if (testing) return;
    setTesting(true);
    setFlash(t('alerts.testSending'));
    try {
      await sendTestNotification(alertSound);
      // Por si el listener no llega (app en background / OEM raro)
      if (testClearRef.current) clearTimeout(testClearRef.current);
      testClearRef.current = setTimeout(clearTestFlash, 1500);
    } catch (e) {
      setTesting(false);
      setFlash(e instanceof Error ? e.message : t('alerts.testError'));
    }
  };

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Text style={s.title}>{t('alerts.title')}</Text>
        <View style={s.countRow}>
          <View style={s.countDot} />
          <Text style={s.countText}>{t('alerts.count', { active: activeCount, scheduled: scheduledCount })}</Text>
        </View>
        <Text style={s.hint}>{t('alerts.hint', { sec: ALERT_EARLY_SECONDS })}</Text>
      </View>
      <ScrollView
        style={s.list}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      >
        {eclipse.events.map((e, i) => {
          const accent = EVENT_ACCENT[e.key] ?? C.dim;
          const on = toggles[e.key];
          const isEarly = early[e.key];
          // Contacto bajo el horizonte: el sol ya se habrá puesto — se marca, pero el
          // toggle sigue en manos del usuario (nada se descarta en silencio)
          const belowHorizon = e.altitude < 0;
          return (
            <View key={e.key} style={[s.row, !on && { opacity: 0.45 }]}>
              <View style={s.leftCol}>
                {i > 0 && <View style={[s.connector, { top: 0, height: '50%' }]} />}
                {i < eclipse.events.length - 1 && <View style={[s.connector, { bottom: 0, height: '50%' }]} />}
                <View
                  style={[
                    s.rowDot,
                    {
                      backgroundColor: on ? accent : C.bg,
                      borderColor: on ? accent : C.knobTrack,
                      shadowColor: on ? accent : 'transparent',
                    },
                  ]}
                />
              </View>
              <View style={s.rowBody}>
                <View style={s.rowTitleLine}>
                  <Text style={s.rowTitle}>
                    {e.key === 'MAX' ? t('event.maxShort') : e.key} · {t(`event.${e.key}` as I18nKey)}
                  </Text>
                  <Text style={[s.rowTime, { color: belowHorizon ? C.dim : accent }]}>{fmtHMS(e.time)}</Text>
                </View>
                <Text style={s.rowDesc}>{t(`alerts.desc.${e.key}` as I18nKey)}</Text>
                {belowHorizon && <Text style={s.rowBelowHorizon}>{t('alerts.belowHorizon')}</Text>}
                <View style={s.planRow}>
                  <Pressable
                    onPress={() => handleEarly(e.key)}
                    disabled={!on}
                    hitSlop={4}
                    style={[
                      s.planChip,
                      {
                        borderColor: isEarly && on ? accent + '88' : C.border,
                        backgroundColor: isEarly && on ? accent + '22' : 'transparent',
                      },
                    ]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isEarly, disabled: !on }}
                    accessibilityLabel={t('alerts.early.a11y', {
                      sec: ALERT_EARLY_SECONDS,
                      state: isEarly ? t('alerts.on') : t('alerts.off'),
                    })}
                  >
                    <Text style={[s.planChipText, { color: isEarly && on ? accent : C.dim }]}>
                      {t('alerts.early', { sec: ALERT_EARLY_SECONDS })}
                    </Text>
                  </Pressable>
                  {e.key === 'C1' &&
                    (
                      [
                        { key: 'before1h', labelKey: 'alerts.plan.1h' },
                        { key: 'before24h', labelKey: 'alerts.plan.24h' },
                      ] as const
                    ).map((opt) => {
                      const planOn = c1Plan[opt.key];
                      const label = t(opt.labelKey);
                      return (
                        <Pressable
                          key={opt.key}
                          onPress={() => handleC1Plan(opt.key)}
                          disabled={!on}
                          hitSlop={4}
                          style={[
                            s.planChip,
                            {
                              borderColor: planOn && on ? accent + '88' : C.border,
                              backgroundColor: planOn && on ? accent + '22' : 'transparent',
                            },
                          ]}
                          accessibilityRole="switch"
                          accessibilityState={{ checked: planOn, disabled: !on }}
                          accessibilityLabel={t('alerts.plan.a11y', {
                            label,
                            state: planOn ? t('alerts.on') : t('alerts.off'),
                          })}
                        >
                          <Text style={[s.planChipText, { color: planOn && on ? accent : C.dim }]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                </View>
              </View>
              <Pressable
                onPress={() => handleToggle(e.key)}
                style={[
                  s.track,
                  { backgroundColor: on ? accent : C.surface, borderColor: on ? accent : C.border },
                ]}
              >
                <View style={[s.knob, { left: on ? 25 : 3 }]} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={s.footer}>
        <Pressable
          style={[s.testButton, testing && s.testButtonDisabled]}
          onPress={onTest}
          disabled={testing}
          accessibilityState={{ disabled: testing, busy: testing }}
        >
          <Text style={[s.testButtonText, testing && s.testButtonTextDisabled]}>
            {testing ? t('alerts.testing') : t('alerts.test')}
          </Text>
        </Pressable>
        <Text style={s.status}>{flash ?? t('alerts.scheduled', { n: scheduledCount })}</Text>
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
  hint: { fontFamily: F.regular, fontSize: 12, lineHeight: 17, color: C.dim, marginTop: 10 },
  list: { flex: 1, paddingHorizontal: 24, marginTop: 18 },
  listContent: { paddingBottom: 28 },
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
  rowTitleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  rowTitle: { fontFamily: F.bold, fontSize: 16, color: C.text },
  rowTime: { fontFamily: F.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  rowDesc: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 17, color: C.dim, marginTop: 2 },
  rowBelowHorizon: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16, color: C.corona, marginTop: 3 },
  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  planChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  planChipText: { fontFamily: F.medium, fontSize: 12 },
  track: { width: 52, height: 30, borderRadius: 99, borderWidth: 1 },
  knob: {
    position: 'absolute',
    top: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.text,
  },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20 },
  testButton: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
  },
  testButtonDisabled: { opacity: 0.45 },
  testButtonText: { fontFamily: F.bold, fontSize: 14, letterSpacing: 1, color: C.text },
  testButtonTextDisabled: { color: C.dim },
  status: { fontFamily: F.medium, fontSize: 12, color: C.corona, textAlign: 'center', marginTop: 10 },
});
