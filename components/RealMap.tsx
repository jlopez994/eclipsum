import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { computeLocalEclipse, eventAt, isActiveEclipse } from '../lib/eclipse';
import { bandOf, dateLabelOf, getActiveEclipse } from '../lib/eclipseCatalog';
import { fmtDur, fmtHM } from '../lib/format';
import { fmtFixed1, t } from '../lib/i18n';
import { buildHtml, toJs, type MapPoint } from '../lib/realMapHtml';
import { C } from './theme';

interface RealMapProps {
  spot: MapPoint;
  here: MapPoint | null;
  /** Base de relieve (hillshade) en vez de la base oscura lisa */
  terrain: boolean;
  /** Punto tocado en el mapa elegido como puesto de observación */
  onSelectPoint: (p: { lat: number; lon: number }) => void;
}

export interface RealMapHandle {
  /** Vuela a unas coordenadas (botón GPS); el zoom lo decide el mapa (mín. útil local) */
  flyTo: (lat: number, lon: number) => void;
  /** Cierra el globo de información sin esperar a que se agote su temporizador */
  closePopup: () => void;
}

/** Contenido del popup de un punto tocado; se calcula en el lado RN (motor memoizado). */
interface TapInfo {
  lat: number;
  lon: number;
  title: string;
  color: string;
  lines: string[];
  warn: string | null;
  canSelect: boolean;
  /** Texto del botón «observar aquí» (el HTML se congela al montar; el copy viaja con el popup) */
  cta: string;
}

function tapInfo(lat: number, lon: number): TapInfo {
  const active = getActiveEclipse();
  const base = { lat, lon, warn: null, canSelect: true, cta: t('real.observeHere') };
  try {
    const ec = computeLocalEclipse(lat, lon);
    const max = eventAt(ec, 'MAX');
    // Desde este punto no se ve el eclipse activo. Se puede tocar igual —explorar «¿y
    // desde aquí?» es la gracia del mapa—, pero elegirlo pasa por UnseenSpotDialog: antes
    // se aplicaba sin preguntar y el mapa desaparecía bajo el aviso de fuera de zona.
    if (!max || !isActiveEclipse(ec)) {
      return {
        ...base,
        title: t('real.noEclipse'),
        color: C.dim,
        lines: [t('real.nothingVisible', { date: dateLabelOf(active) })],
      };
    }
    const lines = [t('real.maxAt', { time: fmtHM(max.time) })];
    const warn = max.altitude < 0 ? t('real.belowHorizon') : null;
    if (ec.kind === 'total') {
      const title =
        ec.totalityDurationSec != null ? `${t('real.total')} · ${fmtDur(ec.totalityDurationSec)}` : t('real.total');
      return { ...base, title, color: C.totality, lines, warn };
    }
    const pct = fmtFixed1(ec.obscuration * 100);
    return {
      ...base,
      title: `${ec.kind === 'annular' ? t('real.annular') : t('real.partial')} · ${t('real.pctHidden', { pct })}`,
      color: C.corona,
      lines,
      warn,
    };
  } catch {
    return { ...base, title: t('real.noData'), color: C.dim, lines: [], canSelect: false };
  }
}

/**
 * Mapa real (Leaflet embebido en el HTML + tiles Esri Dark Gray, sin API key) con
 * la banda de totalidad dibujada encima y marcadores de puesto y GPS.
 * Los tiles sí requieren red; la librería ya no depende de ningún CDN.
 * (Antes Carto dark: empezó a servir «API KEY REQUIRED» en sus teselas anónimas.)
 */
const RealMapInner = forwardRef<RealMapHandle, RealMapProps>(function RealMap(
  { spot, here, terrain, onSelectPoint }: RealMapProps,
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // HTML congelado al montar: los cambios de puesto se inyectan (flyTo) sin recargar el mapa.
  // La banda queda fija — el caller remonta con key={eclipseId} al cambiar de eclipse (MapScreen).
  const [html] = useState(() => {
    return buildHtml(spot, here, bandOf(getActiveEclipse()));
  });

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (lat: number, lon: number) => {
        // eclipsumMoved: el vuelo pedido es vista del usuario — el reencuadre por resize no debe pisarla
        webRef.current?.injectJavaScript(
          `window.eclipsumMoved = true; map.flyTo([${lat}, ${lon}], Math.max(map.getZoom(), 8), { duration: 0.8 }); true;`,
        );
      },
      closePopup: () => {
        webRef.current?.injectJavaScript('window.eclipsumHidePopup && window.eclipsumHidePopup(); true;');
      },
    }),
    [],
  );

  useEffect(() => {
    if (!ready) return;
    const data = toJs({ spot, here });
    webRef.current?.injectJavaScript(`window.eclipsumUpdate && window.eclipsumUpdate(${data}); true;`);
    // spot/here por campos: son literales creados en el render del padre, y como objetos
    // reinyectarían el mapa continuamente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, spot.lat, spot.lon, spot.label, here?.lat, here?.lon, here?.label]);

  // La base de relieve se inyecta (no va horneada en el HTML): así sobrevive al remount
  // por cambio de eclipse — el padre conserva el estado y lo reaplica al cargar
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`window.eclipsumSetTerrain && window.eclipsumSetTerrain(${terrain}); true;`);
  }, [ready, terrain]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; lat: number; lon: number };
      if (msg.type === 'tap') {
        const info = tapInfo(msg.lat, msg.lon);
        webRef.current?.injectJavaScript(
          `window.eclipsumShowInfo && window.eclipsumShowInfo(${toJs(info)}); true;`,
        );
      } else if (msg.type === 'select') {
        onSelectPoint({ lat: msg.lat, lon: msg.lon });
      }
    } catch {
      // mensaje no-JSON del WebView: ignorar
    }
  };

  return (
    <WebView
      ref={webRef}
      style={s.web}
      source={{ html }}
      originWhitelist={['*']}
      setSupportMultipleWindows={false}
      overScrollMode="never"
      onLoadEnd={() => setReady(true)}
      // Los cambios de alto (banners, layout inicial) los ve el ResizeObserver del propio
      // HTML: revalida el tamaño y reencuadra si el encuadre inicial corrió a 0 px
      onMessage={onMessage}
    />
  );
});

const sameMapPoint = (a: MapPoint | null, b: MapPoint | null) =>
  a === b || (a !== null && b !== null && a.lat === b.lat && a.lon === b.lon && a.label === b.label);

/**
 * Durante la ventana del modo eclipse el reloj de App pasa a 1 s y todo el árbol del mapa
 * se re-renderiza con él. El WebView no pinta nada que dependa de la hora: comparar
 * spot/here por valor (el padre los crea como literales en cada render) lo deja quieto.
 */
export const RealMap = memo(
  RealMapInner,
  (prev, next) =>
    prev.onSelectPoint === next.onSelectPoint &&
    prev.terrain === next.terrain &&
    sameMapPoint(prev.spot, next.spot) &&
    sameMapPoint(prev.here, next.here),
);

const s = StyleSheet.create({
  web: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.bg,
  },
});
