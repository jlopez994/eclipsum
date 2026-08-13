import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { C, F } from './theme';

/**
 * Aviso flotante de la parte superior. Escala de intensidad:
 * `info` = te cuento algo · `action` = puedes hacer algo · `warn` = lo que estás viendo
 * no vale · `quiet` = te pido algo.
 */
export type NoticeTone = 'info' | 'action' | 'warn' | 'quiet';

/**
 * Fondos OPACOS: los avisos flotan sobre el mapa y un tinte translúcido dejaba pasar
 * las teselas hasta volver ilegible el texto. Cada color es su acento ya fundido
 * sobre el fondo de la app.
 */
const TONE: Record<NoticeTone, { bg: string; border: string; color: string; font: string }> = {
  info: { bg: '#1D1A33', border: 'rgba(124,108,255,0.45)', color: C.text, font: F.semibold },
  action: { bg: '#2B2116', border: 'rgba(255,184,77,0.5)', color: C.text, font: F.semibold },
  warn: { bg: '#2E1A18', border: 'rgba(255,107,94,0.55)', color: C.text, font: F.semibold },
  quiet: { bg: C.surface, border: C.border, color: C.dim, font: F.regular },
};

interface NoticeProps {
  tone: NoticeTone;
  text: string;
  /** ✕ que lo oculta hasta reiniciar; sin ella el aviso se cierra desde sus acciones */
  onClose?: () => void;
  /** Acciones bajo el texto (`NoticeLink`, `NoticeActions`) */
  children?: ReactNode;
}

export function Notice({ tone, text, onClose, children }: NoticeProps) {
  const c = TONE[tone];
  return (
    <View style={[s.card, { backgroundColor: c.bg, borderColor: c.border }]}>
      {/* Con ✕ el texto reserva su hueco para no pasar por debajo */}
      <Text style={[s.text, { color: c.color, fontFamily: c.font }, !!onClose && s.textInset]}>
        {text}
      </Text>
      {children}
      {onClose && (
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={s.close}
          accessibilityRole="button"
          accessibilityLabel={t('app.bannerClose')}
        >
          <Text style={s.closeTxt}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Fila para varias acciones; una sola no la necesita */
export function NoticeActions({ children }: { children: ReactNode }) {
  return <View style={s.actions}>{children}</View>;
}

/** Acción del aviso; `soft` = secundaria (descartar) */
export function NoticeLink({
  label,
  onPress,
  soft,
  danger,
}: {
  label: string;
  onPress: () => void;
  soft?: boolean;
  /** Acción que corrige un dato equivocado; hereda el rojo del aviso */
  danger?: boolean;
}) {
  return (
    // Pressable y no Text-con-onPress: las acciones del aviso (donar, recalcular…) son
    // pequeñas y el hitSlop les da el objetivo táctil que el resto de la app ya tiene
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[soft ? s.linkSoft : s.link, danger && { color: C.danger }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    // Sombra: al flotar sobre el mapa hace falta despegarlos del contenido
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  text: { fontSize: 13, lineHeight: 18 },
  textInset: { paddingRight: 26 },
  close: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: { fontFamily: F.semibold, fontSize: 13, color: C.dim },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 18 },
  link: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1, color: C.corona, paddingVertical: 2 },
  linkSoft: {
    fontFamily: F.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: C.dim,
    paddingVertical: 2,
  },
});
