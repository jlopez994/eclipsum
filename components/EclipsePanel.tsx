import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { currentPhase, nextEvent, type LocalEclipse } from '../lib/eclipse';
import { scheduleEclipseAlerts, sendTestNotification } from '../lib/notifications';
import { cloudCoverAt, fetchCloudCover, type CloudForecast } from '../lib/weather';
import { bearingLabel, findNearestTotality, type TotalityDirection } from '../lib/totality';
import { fetchEclipseMessage, track } from '../lib/firebase';
import { C } from './theme';

export interface EclipsePanelProps {
  eclipse: LocalEclipse;
  lat: number;
  lon: number;
  place: string;
  now: Date;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function cloudLabel(pct: number): string {
  if (pct < 25) return 'despejado';
  if (pct < 60) return 'nubes y claros';
  return 'nuboso';
}

/** Mantiene la pantalla encendida mientras esté montado (modo día de eclipse). */
function KeepAwake() {
  useKeepAwake();
  return null;
}

export function EclipsePanel({ eclipse, lat, lon, place, now }: EclipsePanelProps) {
  const [alertsMsg, setAlertsMsg] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudForecast | 'error' | null>(null);
  const [totality, setTotality] = useState<TotalityDirection | 'none' | null>(null);
  const [remoteMsg, setRemoteMsg] = useState('');

  useEffect(() => {
    track('eclipse_computed', { kind: eclipse.kind, obscuration: Math.round(eclipse.obscuration * 100) });
    let cancelled = false;
    fetchEclipseMessage().then((m) => !cancelled && setRemoteMsg(m));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTotal = eclipse.kind === 'total';
  const upcoming = nextEvent(eclipse, now);
  const phase = currentPhase(eclipse, now);
  const firstEvent = eclipse.events[0];
  const eclipseDayMode =
    phase !== null ||
    (firstEvent !== undefined && firstEvent.time.getTime() - now.getTime() < 30 * 60_000 && upcoming !== null);

  useEffect(() => {
    let cancelled = false;
    fetchCloudCover(lat, lon)
      .then((f) => !cancelled && setCloud(f))
      .catch(() => !cancelled && setCloud('error'));
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  useEffect(() => {
    if (isTotal) return;
    let cancelled = false;
    findNearestTotality(lat, lon)
      .then((t) => !cancelled && setTotality(t ?? 'none'))
      .catch(() => !cancelled && setTotality('none'));
    return () => {
      cancelled = true;
    };
  }, [isTotal, lat, lon]);

  const onSchedule = async () => {
    try {
      const n = await scheduleEclipseAlerts(eclipse);
      track('alerts_scheduled', { count: n });
      setAlertsMsg(n > 0 ? `${n} alertas programadas` : 'Sin alertas futuras que programar');
    } catch (e) {
      setAlertsMsg(e instanceof Error ? e.message : 'Error al programar alertas');
    }
  };

  const onTest = async () => {
    try {
      await sendTestNotification();
      setAlertsMsg('Notificación de prueba en 5 segundos…');
    } catch (e) {
      setAlertsMsg(e instanceof Error ? e.message : 'Error en notificación de prueba');
    }
  };

  const maxEvent = eclipse.events.find((e) => e.key === 'MAX');
  const cloudAtMax =
    cloud && cloud !== 'error' && maxEvent ? cloudCoverAt(cloud, maxEvent.time) : null;

  return (
    <View>
      {eclipseDayMode && <KeepAwake />}

      {remoteMsg !== '' && (
        <View style={s.remoteBanner}>
          <Text style={s.remoteBannerText}>{remoteMsg}</Text>
        </View>
      )}

      {phase && (
        <View style={[s.phaseBanner, { backgroundColor: phase.safeToLook ? C.totality : C.danger }]}>
          <Text style={s.phaseBannerText}>{phase.label}</Text>
        </View>
      )}

      <View style={[s.badge, { backgroundColor: isTotal ? C.totality : C.corona }]}>
        <Text style={s.badgeText}>{isTotal ? 'TOTALIDAD EN TU UBICACIÓN' : 'PARCIAL EN TU UBICACIÓN'}</Text>
      </View>
      <Text style={s.dimText}>{place}</Text>

      <Text style={s.obscuration}>{(eclipse.obscuration * 100).toFixed(1)}%</Text>
      <Text style={s.dimText}>del sol quedará oculto</Text>
      {isTotal && eclipse.totalityDurationSec != null && (
        <Text style={s.totalityDur}>
          {Math.floor(eclipse.totalityDurationSec / 60)}m {eclipse.totalityDurationSec % 60}s de totalidad
        </Text>
      )}

      {!isTotal && totality !== null && totality !== 'none' && (
        <View style={[s.card, { borderLeftWidth: 3, borderLeftColor: C.totality }]}>
          <Text style={s.cardTitle}>Totalidad al alcance</Text>
          <Text style={s.totalityHint}>
            A ~{totality.distanceKm} km al {bearingLabel(totality.bearingDeg)} verías el eclipse TOTAL
          </Text>
          <Text style={s.dimText}>
            Punto: {totality.lat.toFixed(3)}, {totality.lon.toFixed(3)}
          </Text>
        </View>
      )}

      {upcoming ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>{upcoming.label} en</Text>
          <Text style={s.countdown}>{fmtCountdown(upcoming.time.getTime() - now.getTime())}</Text>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>Eclipse finalizado</Text>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.cardTitle}>Cronología local</Text>
        {eclipse.events.map((e) => (
          <View key={e.key} style={s.timelineRow}>
            <Text style={[s.timelineLabel, e.time <= now && { color: C.dim }]}>{e.label}</Text>
            <Text style={[s.timelineTime, e.time <= now && { color: C.dim }]}>
              {fmtTime(e.time)}
              {e.altitude < 0 ? ' · bajo horizonte' : ` · sol ${e.altitude.toFixed(0)}°`}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Nubosidad prevista</Text>
        {cloud === null && <Text style={s.dimText}>Consultando Open-Meteo…</Text>}
        {cloud === 'error' && <Text style={s.dimText}>Sin conexión — no se pudo obtener el pronóstico</Text>}
        {cloudAtMax !== null && (
          <Text style={s.cloudText}>
            <Text style={{ color: cloudAtMax < 25 ? C.ok : cloudAtMax < 60 ? C.corona : C.danger }}>
              {cloudAtMax}%
            </Text>
            {'  '}de nubes al máximo · {cloudLabel(cloudAtMax)}
          </Text>
        )}
        {cloud !== null && cloud !== 'error' && cloudAtMax === null && (
          <Text style={s.dimText}>Pronóstico sin datos para la hora del eclipse</Text>
        )}
      </View>

      <Pressable style={s.button} onPress={onSchedule}>
        <Text style={s.buttonText}>Programar alertas</Text>
      </Pressable>
      <Pressable style={s.buttonGhost} onPress={onTest}>
        <Text style={s.buttonGhostText}>Probar notificación</Text>
      </Pressable>
      {alertsMsg && <Text style={s.alertsMsg}>{alertsMsg}</Text>}

      <View style={s.safety}>
        <Text style={s.safetyText}>
          ⚠️ Nunca mires al sol sin gafas de eclipse certificadas (ISO 12312-2).
          {isTotal ? ' Solo durante la totalidad es seguro mirar sin protección.' : ''}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  remoteBanner: {
    backgroundColor: C.surface,
    borderColor: C.corona,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  remoteBannerText: { color: C.corona, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  phaseBanner: { borderRadius: 12, padding: 14, marginBottom: 16 },
  phaseBannerText: { color: C.text, fontWeight: '800', fontSize: 16, textAlign: 'center', letterSpacing: 0.5 },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  badgeText: { color: C.bg, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  obscuration: { color: C.text, fontSize: 72, fontWeight: '800', marginTop: 16, fontVariant: ['tabular-nums'] },
  totalityDur: { color: C.totality, fontSize: 18, fontWeight: '700', marginTop: 4 },
  totalityHint: { color: C.text, fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 20, marginTop: 20 },
  cardTitle: { color: C.dim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 },
  countdown: { color: C.corona, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timelineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  timelineLabel: { color: C.text, fontSize: 15, fontWeight: '600' },
  timelineTime: { color: C.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  cloudText: { color: C.text, fontSize: 18, fontWeight: '700' },
  dimText: { color: C.dim, fontSize: 14, marginTop: 4 },
  button: { backgroundColor: C.corona, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: C.bg, fontWeight: '800', fontSize: 16, letterSpacing: 1 },
  buttonGhost: {
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonGhostText: { color: C.dim, fontWeight: '700', fontSize: 14, letterSpacing: 1 },
  alertsMsg: { color: C.corona, marginTop: 12, textAlign: 'center' },
  safety: { marginTop: 28, borderLeftWidth: 3, borderLeftColor: C.danger, paddingLeft: 12 },
  safetyText: { color: C.dim, fontSize: 13, lineHeight: 19 },
});
