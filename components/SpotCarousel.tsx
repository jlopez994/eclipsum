import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { computeLocalEclipse } from '../lib/eclipse';
import { listSpotOptions, type Spot, type SpotOption } from '../lib/spots';
import { cloudCoverAt, fetchCloudCoverBatch } from '../lib/weather';
import { bearingLabel, type TotalityDirection } from '../lib/totality';
import { C, F } from './theme';

interface SpotCarouselProps {
  userLat: number;
  userLon: number;
  gpsPlace: string;
  activeSpot: Spot | null;
  totality: TotalityDirection | 'none' | null;
  onSelect: (spot: Spot | null) => void;
}

interface Card extends SpotOption {
  cloudPct: number | null;
  /** null en onSelect = volver a GPS */
  selectValue: Spot | null;
}

const fmtHM = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function isActive(card: Card, activeSpot: Spot | null): boolean {
  if (card.selectValue === null) return activeSpot === null;
  if (activeSpot === null) return false;
  return Math.abs(activeSpot.lat - card.lat) < 0.01 && Math.abs(activeSpot.lon - card.lon) < 0.01;
}

export function SpotCarousel({ userLat, userLon, gpsPlace, activeSpot, totality, onSelect }: SpotCarouselProps) {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gpsOption: Card = {
        ...(() => {
          const ec = computeLocalEclipse(userLat, userLon);
          const max = ec.events.find((e) => e.key === 'MAX');
          return {
            name: gpsPlace,
            lat: userLat,
            lon: userLon,
            origin: 'gps' as const,
            distanceKm: 0,
            kind: ec.kind,
            obscuration: ec.obscuration,
            totalityDurationSec: ec.totalityDurationSec,
            maxTime: max?.time ?? null,
          };
        })(),
        cloudPct: null,
        selectValue: null,
      };

      const nearestCard: Card | null =
        totality !== null && totality !== 'none'
          ? {
              name: `Totalidad más cercana (${totality.distanceKm} km ${bearingLabel(totality.bearingDeg)})`,
              lat: totality.lat,
              lon: totality.lon,
              origin: 'nearest',
              distanceKm: totality.distanceKm,
              kind: 'total',
              obscuration: 1,
              totalityDurationSec: totality.durationSec,
              maxTime: null,
              cloudPct: null,
              selectValue: { name: 'Totalidad más cercana', lat: totality.lat, lon: totality.lon, origin: 'nearest' },
            }
          : null;

      const options = await listSpotOptions(userLat, userLon);
      if (cancelled) return;

      const base: Card[] = [
        gpsOption,
        ...(nearestCard ? [nearestCard] : []),
        ...options.map((o) => ({ ...o, cloudPct: null, selectValue: { name: o.name, lat: o.lat, lon: o.lon, origin: o.origin } })),
      ];
      setCards(base);

      try {
        const forecasts = await fetchCloudCoverBatch(base.map((c) => ({ lat: c.lat, lon: c.lon })));
        if (cancelled) return;
        setCards(
          base.map((c, i) => {
            const f = forecasts[i];
            const when = c.maxTime ?? base[0].maxTime;
            return f && when ? { ...c, cloudPct: cloudCoverAt(f, when) } : c;
          }),
        );
      } catch {
        // sin red: tarjetas sin dato de nubes
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userLat, userLon, gpsPlace, totality]);

  if (!cards) {
    return (
      <View style={s.wrap}>
        <Text style={s.kicker}>LUGARES PARA VERLO</Text>
        <Text style={s.loading}>Calculando lugares cercanos…</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.kicker}>LUGARES PARA VERLO</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {cards.map((card) => {
          const active = isActive(card, activeSpot);
          const cloudColor =
            card.cloudPct === null ? C.dim : card.cloudPct < 25 ? C.ok : card.cloudPct < 60 ? C.corona : C.danger;
          return (
            <Pressable
              key={`${card.origin}-${card.name}`}
              onPress={() => onSelect(card.selectValue)}
              style={[s.card, active && s.cardActive]}
            >
              <Text style={s.cardName} numberOfLines={1}>
                {card.name}
              </Text>
              <Text style={s.cardMeta}>
                {card.origin === 'gps' ? 'aquí' : `${card.distanceKm} km`}
                {card.maxTime ? ` · máx ${fmtHM(card.maxTime)}` : ''}
              </Text>
              <View style={s.cardStats}>
                {card.kind === 'total' ? (
                  <Text style={s.cardTotal}>
                    TOTAL{card.totalityDurationSec != null
                      ? ` ${Math.floor(card.totalityDurationSec / 60)}m${String(card.totalityDurationSec % 60).padStart(2, '0')}s`
                      : ''}
                  </Text>
                ) : (
                  <Text style={s.cardPartial}>{(card.obscuration * 100).toFixed(0)}% parcial</Text>
                )}
                <Text style={[s.cardCloud, { color: cloudColor }]}>
                  {card.cloudPct !== null ? `${card.cloudPct}% ☁` : '—'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  kicker: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 2.5, color: C.dim, paddingHorizontal: 20 },
  loading: { fontFamily: F.medium, fontSize: 12, color: C.dim, paddingHorizontal: 20 },
  row: { gap: 10, paddingHorizontal: 20 },
  card: {
    width: 168,
    backgroundColor: 'rgba(21,21,30,0.92)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 12,
    gap: 3,
  },
  cardActive: { borderColor: C.corona, backgroundColor: 'rgba(255,184,77,0.08)' },
  cardName: { fontFamily: F.bold, fontSize: 14, color: C.text },
  cardMeta: { fontFamily: F.medium, fontSize: 11, color: C.dim, fontVariant: ['tabular-nums'] },
  cardStats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 },
  cardTotal: { fontFamily: F.bold, fontSize: 13, color: C.violet },
  cardPartial: { fontFamily: F.bold, fontSize: 13, color: C.corona },
  cardCloud: { fontFamily: F.semibold, fontSize: 12, fontVariant: ['tabular-nums'] },
});
