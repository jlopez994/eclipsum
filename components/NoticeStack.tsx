import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { t } from '../lib/i18n';
import { Notice, NoticeActions, NoticeLink } from './Notice';

interface NoticeStackProps {
  /** Mensaje remoto (Remote Config); vacío = sin aviso */
  message: string;
  /** URL de la APK nueva; vacío = sin aviso de actualización */
  updateUrl: string;
  /** Petición de propina pendiente (ya filtrada por umbral de aperturas y URL) */
  showDonate: boolean;
  /** true = donó, false = «ahora no»; en ambos casos el aviso no vuelve nunca */
  onDonateResolve: (donated: boolean) => void;
  /** Desplazamiento superior (safe area) */
  top: number;
}

/**
 * UN aviso cada vez: apilados taparían el tercio superior de la pantalla. Manda el
 * mensaje remoto (lo envío yo y puede ser urgente), luego la actualización (accionable
 * y se resuelve sola al instalar) y por último la propina, que puede esperar siempre.
 * Al cerrar el de arriba aparece el siguiente.
 *
 * Ocultar un aviso con la ✕ dura lo que dure la sesión (estado en memoria a propósito):
 * al reiniciar vuelve si sigue vigente.
 *
 * Los avisos FLOTAN sobre el contenido: si empujaran el layout, el WebView del mapa se
 * redimensionaría en cada aparición. Tapan el cromo de la pantalla a propósito, y por eso
 * su fondo es opaco. box-none = los toques pasan al contenido salvo en los propios banners.
 */
export function NoticeStack({ message, updateUrl, showDonate, onDonateResolve, top }: NoticeStackProps) {
  const [messageHidden, setMessageHidden] = useState(false);
  const [updateHidden, setUpdateHidden] = useState(false);

  const showMessage = message !== '' && !messageHidden;
  const showUpdate = updateUrl !== '' && !updateHidden;
  const notice = showMessage ? 'info' : showUpdate ? 'update' : showDonate ? 'donate' : null;
  if (notice === null) return null;

  return (
    <View style={[s.stack, { top: top + 8 }]} pointerEvents="box-none">
      {notice === 'info' && <Notice tone="info" text={message} onClose={() => setMessageHidden(true)} />}
      {notice === 'update' && (
        <Notice tone="action" text={t('app.updateBanner')} onClose={() => setUpdateHidden(true)}>
          <NoticeLink
            label={t('app.updateCta')}
            onPress={() => Linking.openURL(updateUrl).catch(() => {})}
          />
        </Notice>
      )}
      {/* Propina: solo tras varios usos, una vez en la vida y nunca en modo eclipse (App no
          monta este bloque allí). Sin ✕: su «ahora no» es definitivo, y un icono ambiguo
          aquí haría dudar si vuelve. */}
      {notice === 'donate' && (
        <Notice tone="quiet" text={t('app.donateBanner')}>
          <NoticeActions>
            <NoticeLink label={t('app.donateLater')} onPress={() => onDonateResolve(false)} soft />
            <NoticeLink label={t('app.donateCta')} onPress={() => onDonateResolve(true)} />
          </NoticeActions>
        </Notice>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  /**
   * Escala de intensidad de los avisos: violeta = informativo, corona = hay algo que
   * puedes hacer, rojo = atención (aviso de distancia del mapa), neutro = petición.
   * Mismo molde en todos: tinte del acento, borde translúcido, texto blanco y acción en color.
   */
  stack: { position: 'absolute', left: 0, right: 0, zIndex: 20, gap: 8 },
});
