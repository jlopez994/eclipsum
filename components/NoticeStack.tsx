import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { t } from '../lib/i18n';
import { DIVERGENCE_KM } from '../lib/spots';
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
  /** El eclipse está en curso y el usuario cerró el modo: camino de vuelta */
  showBackToMode: boolean;
  onBackToMode: () => void;
  /** km entre el GPS y el puesto elegido el día D; null = sin discrepancia */
  divergenceKm: number | null;
  /** Identidad del puesto medido: al cambiar de puesto el aviso cerrado vuelve a salir */
  divergenceSpotKey: string;
  /** Hace de tu posición el puesto: recalcula cronología, nubes y alertas a la vez */
  onRecalcHere: () => void;
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
export function NoticeStack({
  message,
  updateUrl,
  showDonate,
  onDonateResolve,
  showBackToMode,
  onBackToMode,
  divergenceKm,
  divergenceSpotKey,
  onRecalcHere,
  top,
}: NoticeStackProps) {
  const [messageHidden, setMessageHidden] = useState(false);
  const [updateHidden, setUpdateHidden] = useState(false);
  /** Puesto y distancia con los que se cerró el aviso de divergencia; null = no cerrado */
  const [divergeHidden, setDivergeHidden] = useState<{ key: string; km: number } | null>(null);

  /**
   * Cerrar la divergencia NO cambia el puesto: sigues calculando para el sitio elegido,
   * y el mapa lo sigue diciendo con dos marcadores («TÚ» y el puesto). Se cierra porque
   * el aviso tapa los chips del mapa y hay que poder usarlos; el camino de corregirlo
   * no se pierde (chip de lugar → «Mi posición»).
   *
   * Vuelve solo, sin ✕ que lo silencie para siempre, cuando la situación ya no es la que
   * descartaste: otro puesto, otros DIVERGENCE_KM de alejamiento, o un arranque nuevo
   * (estado en memoria). Y el modo eclipse pinta su propio aviso al margen de este: el
   * día D, en la ventana del evento, la discrepancia se ve sí o sí.
   */
  const divergeDismissed =
    divergenceKm !== null &&
    divergeHidden !== null &&
    divergeHidden.key === divergenceSpotKey &&
    Math.abs(divergenceKm - divergeHidden.km) < DIVERGENCE_KM;

  const showMessage = message !== '' && !messageHidden;
  const showUpdate = updateUrl !== '' && !updateHidden;
  // La divergencia va primero: mientras el puesto no sea el correcto, TODO lo que hay
  // debajo —cronología, nubes, alertas y el propio modo eclipse— describe otro sitio.
  // Después, volver al modo: mientras el evento ocurre no hay nada más urgente.
  const notice =
    divergenceKm !== null && !divergeDismissed
      ? 'diverge'
      : showBackToMode
        ? 'mode'
        : showMessage
          ? 'info'
          : showUpdate
            ? 'update'
            : showDonate
              ? 'donate'
              : null;
  if (notice === null) return null;

  return (
    <View style={[s.stack, { top: top + 8 }]} pointerEvents="box-none">
      {/* Con ✕ porque flota sobre los chips del mapa: dejarlo fijo inutiliza el selector de
          puesto y la brújula justo cuando quieres cambiar de sitio */}
      {notice === 'diverge' && (
        <Notice
          tone="warn"
          text={t('map.divergence', { km: Math.round(divergenceKm ?? 0) })}
          onClose={() =>
            setDivergeHidden({ key: divergenceSpotKey, km: divergenceKm ?? 0 })
          }
        >
          <NoticeLink label={t('map.recalc')} onPress={onRecalcHere} danger />
        </Notice>
      )}
      {/* Sin ✕: cerrarlo ya se hizo al salir del modo, y el evento sigue ocurriendo */}
      {notice === 'mode' && (
        <Notice tone="action" text={t('app.eclipseRunning')}>
          <NoticeLink label={t('app.backToMode')} onPress={onBackToMode} />
        </Notice>
      )}
      {notice === 'info' && (
        <Notice tone="info" text={message} onClose={() => setMessageHidden(true)} />
      )}
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
