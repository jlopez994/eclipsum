import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { type BandSlice } from '../lib/bandGeo';
import { computeLocalEclipse, eventAt, isActiveEclipse } from '../lib/eclipse';
import { bandOf, getActiveEclipse } from '../lib/eclipseCatalog';
import { fmtDur, fmtHM } from '../lib/format';
import { fmtFixed1, t } from '../lib/i18n';
import { LEAFLET_CSS, LEAFLET_JS } from '../lib/leafletVendor';
import { C } from './theme';

interface MapPoint {
  lat: number;
  lon: number;
  label: string;
}

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

/** JSON seguro para incrustar en <script>/injectJavaScript: un nombre de lugar con «</script>» no rompe el HTML. */
const toJs = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

function tapInfo(lat: number, lon: number): TapInfo {
  const active = getActiveEclipse();
  const base = { lat, lon, warn: null, canSelect: true, cta: t('real.observeHere') };
  try {
    const ec = computeLocalEclipse(lat, lon);
    const max = eventAt(ec, 'MAX');
    // Desde este punto no se ve el eclipse activo. Se puede elegir igual (la pantalla
    // del mapa lo explica): así se puede explorar «¿y desde aquí?» sin pelearse con el mapa.
    if (!max || !isActiveEclipse(ec)) {
      return {
        ...base,
        title: t('real.noEclipse'),
        color: C.dim,
        lines: [t('real.nothingVisible', { date: active.shortDateLabel })],
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
 * Mapa real (Leaflet embebido en el HTML + tiles Carto dark, sin API key) con
 * la banda de totalidad dibujada encima y marcadores de puesto y GPS.
 * Los tiles sí requieren red; la librería ya no depende de ningún CDN.
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
        webRef.current?.injectJavaScript(
          `map.flyTo([${lat}, ${lon}], Math.max(map.getZoom(), 8), { duration: 0.8 }); true;`,
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
      // Al aparecer/ocultarse un banner el WebView cambia de alto: sin invalidateSize
      // Leaflet conserva el tamaño viejo y deja la franja nueva en gris
      onLayout={() => {
        if (ready) webRef.current?.injectJavaScript('map.invalidateSize(); true;');
      }}
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

function buildHtml(spot: MapPoint, here: MapPoint | null, band: BandSlice[] | null): string {
  // Eclipse sin banda empaquetada (p. ej. añadido por Remote Config): solo marcadores
  const north = band?.map((b) => [b.latN, b.lon]) ?? [];
  const south = band ? [...band].reverse().map((b) => [b.latS, b.lon]) : [];
  const center = band?.map((b) => [(b.latN + b.latS) / 2, b.lon]) ?? null;
  const polygon = band ? [...north, ...south] : null;
  const data = toJs({ polygon, north, south, center, spot, here });
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<style>
  html, body, #map { margin: 0; height: 100%; background: ${C.bg}; -webkit-tap-highlight-color: transparent; }
  .leaflet-container path, .leaflet-interactive { outline: none; }
  .lbl { background: rgba(11,11,18,0.92); color: ${C.text}; border: 1px solid rgba(38,38,58,0.9);
         border-radius: 8px; padding: 3px 9px; font: 600 11px/1.4 system-ui; letter-spacing: 0.3px;
         white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.55); }
  /* Puesto de observación: destacado. GPS: presente pero secundario */
  .lbl-spot { border-color: rgba(255,184,77,0.5); }
  .lbl-here { color: ${C.dim}; font-weight: 500; padding: 2px 8px; }
  .leaflet-tooltip-top:before { display: none; }
  .leaflet-control-attribution { background: rgba(11,11,18,0.7); color: #666; font-size: 9px; }
  .leaflet-control-attribution a { color: #888; }
  .leaflet-popup-content-wrapper { background: rgba(21,21,30,0.96); color: ${C.text};
    border: 1px solid ${C.border}; border-radius: 10px; box-shadow: 0 6px 22px rgba(0,0,0,0.55); }
  .leaflet-popup-content { margin: 10px 12px; line-height: 1.5; }
  .leaflet-popup-tip { background: rgba(21,21,30,0.96); }
  .pop-title { font: 700 12px system-ui; letter-spacing: 1.2px; text-transform: uppercase; }
  .pop-line { font: 500 11.5px system-ui; color: ${C.dim}; margin-top: 3px; }
  .pop-warn { font: 600 11.5px system-ui; color: ${C.danger}; margin-top: 3px; }
  .pop-btn { font: 700 11px system-ui; letter-spacing: 1.2px; color: ${C.corona}; margin-top: 10px;
    padding: 2px 0; }
  .pop-btn:active { opacity: 0.6; }
</style>
</head><body>
<div id="map"></div>
<script>
  var D = ${data};
  var map = L.map('map', { zoomControl: false, attributionControl: true });
  var baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    attribution: '&copy; OSM &copy; CARTO',
  }).addTo(map);
  // Modo relieve: hillshade oscuro de Esri (sin API key) + solo-etiquetas de Carto encima.
  // maxNativeZoom 15: más cerca Esri ya no sirve teselas y Leaflet sobreamplía las últimas.
  var terrainBase = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 15, maxZoom: 18, zIndex: 1, attribution: '&copy; Esri' }
  );
  var terrainLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    // Atribución propia: en modo relieve la base oscura (que la traía) no está en el mapa
    maxZoom: 18, zIndex: 2, attribution: '&copy; OSM &copy; CARTO',
  });
  window.eclipsumSetTerrain = function (on) {
    if (on) { map.removeLayer(baseDark); terrainBase.addTo(map); terrainLabels.addTo(map); }
    else { map.removeLayer(terrainBase); map.removeLayer(terrainLabels); baseDark.addTo(map); }
  };

  if (D.polygon) {
    // Marca fija y tenue, sin interacción: el tap pasa limpio al mapa (popup)
    // y el WebView no pinta el focus ring sobre el SVG de la banda.
    // Un solo relleno plano: capas superpuestas producen escalones visibles.
    L.polygon(D.polygon, {
      interactive: false, stroke: false, fillColor: '${C.totality}', fillOpacity: 0.11,
    }).addTo(map);

    // Límites reales de la banda (los cierres verticales del polígono son artefactos del dataset)
    L.polyline(D.north, { interactive: false, color: '${C.totality}', weight: 1.1, opacity: 0.38 }).addTo(map);
    L.polyline(D.south, { interactive: false, color: '${C.totality}', weight: 1.1, opacity: 0.38 }).addTo(map);

    // Línea central con glow: halos anchos translúcidos bajo la línea fina (Leaflet no tiene blur).
    // Más tenue que los bordes: la banda entera vale, el centro solo marca duración máxima.
    L.polyline(D.center, { interactive: false, color: '${C.violet}', weight: 12, opacity: 0.045 }).addTo(map);
    L.polyline(D.center, { interactive: false, color: '${C.violet}', weight: 6, opacity: 0.07 }).addTo(map);
    L.polyline(D.center, { interactive: false, color: '${C.violet}', weight: 1.2, opacity: 0.32 }).addTo(map);
  }

  var ptLayer = L.layerGroup().addTo(map);
  // bindTooltip interpreta HTML: los nombres de lugar (geocoder o texto del usuario) van escapados
  function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function draw(d, fly) {
    ptLayer.clearLayers();
    var pts = [];
    function dot(p, fill) {
      var m = L.circleMarker([p.lat, p.lon], {
        interactive: false, radius: 8, color: '${C.corona}', weight: 2.5,
        fillColor: fill ? '${C.text}' : 'transparent', fillOpacity: fill ? 1 : 0,
      }).addTo(ptLayer);
      m.bindTooltip(esc(p.label), {
        permanent: true, direction: 'top', offset: [0, -10],
        className: fill ? 'lbl lbl-spot' : 'lbl lbl-here',
      });
      pts.push([p.lat, p.lon]);
    }
    dot(d.spot, true);
    if (d.here) dot(d.here, false);

    // Encuadre abierto SIEMPRE (también al marcar destino): tramo de banda alrededor
    // del puesto (±BAND_LON_SPAN de lon, robusto al antimeridiano) + marcadores.
    // Sin banda cerca, vista regional del puesto.
    var seg = [];
    if (D.polygon) {
      seg = D.north.concat(D.south).filter(function (p) {
        return Math.abs(((p[1] - d.spot.lon + 540) % 360) - 180) <= BAND_LON_SPAN;
      });
    }
    var target = seg.concat(pts);
    if (seg.length) {
      if (fly) map.flyToBounds(target, { padding: [40, 40], maxZoom: 7, duration: 0.9 });
      else map.fitBounds(target, { padding: [40, 40], maxZoom: 7 });
    } else if (fly) {
      if (pts.length > 1) map.flyToBounds(pts, { padding: [70, 70], duration: 0.9 });
      else map.flyTo(pts[0], DEFAULT_ZOOM, { duration: 0.9 });
    } else {
      if (pts.length > 1) map.fitBounds(pts, { padding: [70, 70] });
      else map.setView(pts[0], DEFAULT_ZOOM);
    }
  }
  var DEFAULT_ZOOM = 6;
  /** Grados de longitud de banda a cada lado del puesto en el encuadre (ancho ≈ Iberia) */
  var BAND_LON_SPAN = 3;
  draw(D, false);
  window.eclipsumUpdate = function (d) { draw(d, true); };

  // Tap en el mapa → RN calcula el eclipse en ese punto → popup vía eclipsumShowInfo
  map.on('click', function (e) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'tap', lat: e.latlng.lat, lon: e.latlng.lng })
    );
  });
  // Autocierre del popup si no se pulsa nada; cada tap nuevo reinicia el temporizador
  var POPUP_HIDE_MS = 4000;
  var popupTimer = null;
  // esc() en TODO el texto: lines incluye shortDateLabel, que puede venir literal de
  // Remote Config (isValidEntry solo comprueba que sea string no vacía)
  window.eclipsumShowInfo = function (i) {
    var h = '<div class="pop-title" style="color:' + i.color + '">' + esc(i.title) + '</div>';
    for (var k = 0; k < i.lines.length; k++) h += '<div class="pop-line">' + esc(i.lines[k]) + '</div>';
    if (i.warn) h += '<div class="pop-warn">' + esc(i.warn) + '</div>';
    if (i.canSelect) h += '<div class="pop-btn" onclick="window.eclipsumPick(' + i.lat + ',' + i.lon + ')">' + esc(i.cta) + '</div>';
    L.popup({ closeButton: false }).setLatLng([i.lat, i.lon]).setContent(h).openOn(map);
    clearTimeout(popupTimer);
    popupTimer = setTimeout(function () { map.closePopup(); }, POPUP_HIDE_MS);
  };
  // Cierre desde RN: al tocar cualquier control de la app el globo estorba
  window.eclipsumHidePopup = function () {
    clearTimeout(popupTimer);
    map.closePopup();
  };
  window.eclipsumPick = function (lat, lon) {
    map.closePopup();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', lat: lat, lon: lon }));
  };
</script>
</body></html>`;
}

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
