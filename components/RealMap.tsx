import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { type BandSlice } from '../lib/bandGeo';
import { computeLocalEclipse } from '../lib/eclipse';
import { bandOf, getActiveEclipse } from '../lib/eclipseCatalog';
import { fmtFixed1, localeTag, t } from '../lib/i18n';
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
  /** Punto tocado en el mapa elegido como puesto de observación */
  onSelectPoint: (p: { lat: number; lon: number }) => void;
}

export interface RealMapHandle {
  /** Vuela a unas coordenadas (botón GPS); el zoom lo decide el mapa (mín. útil local) */
  flyTo: (lat: number, lon: number) => void;
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

const fmtHM = (d: Date) => d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });

/** JSON seguro para incrustar en <script>/injectJavaScript: un nombre de lugar con «</script>» no rompe el HTML. */
const toJs = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const fmtDur = (sec: number) => `${Math.floor(sec / 60)}m ${sec % 60}s`;

function tapInfo(lat: number, lon: number): TapInfo {
  const active = getActiveEclipse();
  const base = { lat, lon, warn: null, canSelect: true, cta: t('real.observeHere') };
  try {
    const ec = computeLocalEclipse(lat, lon);
    const max = ec.events.find((e) => e.key === 'MAX');
    // El motor devuelve el primer eclipse local tras searchStart: si no cae el día
    // del eclipse activo, desde este punto no se ve el evento.
    if (!max || max.time.toISOString().slice(0, 10) !== active.civilDate) {
      return {
        ...base,
        title: t('real.noEclipse'),
        color: C.dim,
        lines: [t('real.nothingVisible', { date: active.shortDateLabel })],
        canSelect: false,
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
export const RealMap = forwardRef<RealMapHandle, RealMapProps>(function RealMap(
  { spot, here, onSelectPoint }: RealMapProps,
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
    }),
    [],
  );

  useEffect(() => {
    if (!ready) return;
    const data = toJs({ spot, here });
    webRef.current?.injectJavaScript(`window.eclipsumUpdate && window.eclipsumUpdate(${data}); true;`);
  }, [ready, spot.lat, spot.lon, spot.label, here?.lat, here?.lon, here?.label]);

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
      onMessage={onMessage}
    />
  );
});

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
  .lbl { background: rgba(11,11,18,0.85); color: ${C.text}; border: 1px solid ${C.border};
         border-radius: 6px; padding: 2px 7px; font: 600 11px system-ui; white-space: nowrap; }
  .leaflet-tooltip-top:before { display: none; }
  .leaflet-control-attribution { background: rgba(11,11,18,0.7); color: #666; font-size: 9px; }
  .leaflet-control-attribution a { color: #888; }
  .leaflet-popup-content-wrapper { background: rgba(21,21,30,0.96); color: ${C.text};
    border: 1px solid ${C.border}; border-radius: 10px; box-shadow: 0 6px 22px rgba(0,0,0,0.55); }
  .leaflet-popup-content { margin: 10px 12px; line-height: 1.5; }
  .leaflet-popup-tip { background: rgba(21,21,30,0.96); }
  .pop-title { font: 700 12px system-ui; letter-spacing: 1px; }
  .pop-line { font: 500 11px system-ui; color: ${C.dim}; margin-top: 2px; }
  .pop-warn { font: 600 11px system-ui; color: ${C.danger}; margin-top: 2px; }
  .pop-btn { font: 700 11px system-ui; letter-spacing: 1px; color: ${C.corona}; margin-top: 8px; padding: 2px 0; }
</style>
</head><body>
<div id="map"></div>
<script>
  var D = ${data};
  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    attribution: '&copy; OSM &copy; CARTO',
  }).addTo(map);

  if (D.polygon) {
    // Marca fija y tenue, sin interacción: el tap pasa limpio al mapa (popup)
    // y el WebView no pinta el focus ring sobre el SVG de la banda.
    // Un solo relleno plano: capas superpuestas producen escalones visibles.
    L.polygon(D.polygon, {
      interactive: false, stroke: false, fillColor: '${C.totality}', fillOpacity: 0.05,
    }).addTo(map);

    // Límites reales de la banda (los cierres verticales del polígono son artefactos del dataset)
    L.polyline(D.north, { interactive: false, color: '${C.totality}', weight: 1, opacity: 0.5 }).addTo(map);
    L.polyline(D.south, { interactive: false, color: '${C.totality}', weight: 1, opacity: 0.5 }).addTo(map);

    // Línea central con glow: halos anchos translúcidos bajo la línea fina (Leaflet no tiene blur)
    L.polyline(D.center, { interactive: false, color: '${C.violet}', weight: 9, opacity: 0.1 }).addTo(map);
    L.polyline(D.center, { interactive: false, color: '${C.violet}', weight: 4.5, opacity: 0.22 }).addTo(map);
    L.polyline(D.center, { interactive: false, color: '${C.violet}', weight: 1.5, opacity: 0.9 }).addTo(map);
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
      m.bindTooltip(esc(p.label), { permanent: true, direction: 'top', offset: [0, -10], className: 'lbl' });
      pts.push([p.lat, p.lon]);
    }
    dot(d.spot, true);
    if (d.here) dot(d.here, false);

    // Encuadre abierto SIEMPRE (también al marcar destino): tramo de banda alrededor
    // del puesto (±12° de lon, robusto al antimeridiano) + marcadores. Sin banda
    // cerca, vista regional del puesto.
    var seg = [];
    if (D.polygon) {
      seg = D.north.concat(D.south).filter(function (p) {
        return Math.abs(((p[1] - d.spot.lon + 540) % 360) - 180) <= 12;
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
  window.eclipsumShowInfo = function (i) {
    var h = '<div class="pop-title" style="color:' + i.color + '">' + i.title + '</div>';
    for (var k = 0; k < i.lines.length; k++) h += '<div class="pop-line">' + i.lines[k] + '</div>';
    if (i.warn) h += '<div class="pop-warn">' + i.warn + '</div>';
    if (i.canSelect) h += '<div class="pop-btn" onclick="window.eclipsumPick(' + i.lat + ',' + i.lon + ')">' + esc(i.cta) + '</div>';
    L.popup({ closeButton: false }).setLatLng([i.lat, i.lon]).setContent(h).openOn(map);
    clearTimeout(popupTimer);
    popupTimer = setTimeout(function () { map.closePopup(); }, POPUP_HIDE_MS);
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
