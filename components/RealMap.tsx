import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { BAND_2026 } from '../lib/bandGeo';
import { getActiveEclipse } from '../lib/eclipseCatalog';
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
}

/**
 * Mapa real (Leaflet embebido en el HTML + tiles Carto dark, sin API key) con
 * la banda de totalidad dibujada encima y marcadores de puesto y GPS.
 * Los tiles sí requieren red; la librería ya no depende de ningún CDN.
 */
export function RealMap({ spot, here }: RealMapProps) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // HTML congelado al montar: los cambios de puesto se inyectan (flyTo) sin recargar el mapa
  const [html] = useState(() => buildHtml(spot, here, getActiveEclipse().bandTooltip));

  useEffect(() => {
    if (!ready) return;
    const data = JSON.stringify({ spot, here });
    webRef.current?.injectJavaScript(`window.eclipsumUpdate && window.eclipsumUpdate(${data}); true;`);
  }, [ready, spot.lat, spot.lon, spot.label, here?.lat, here?.lon, here?.label]);

  return (
    <WebView
      ref={webRef}
      style={s.web}
      source={{ html }}
      originWhitelist={['*']}
      setSupportMultipleWindows={false}
      overScrollMode="never"
      onLoadEnd={() => setReady(true)}
    />
  );
}

function buildHtml(spot: MapPoint, here: MapPoint | null, bandTooltip: string): string {
  const north = BAND_2026.map((b) => [b.latN, b.lon]);
  const south = [...BAND_2026].reverse().map((b) => [b.latS, b.lon]);
  const center = BAND_2026.map((b) => [(b.latN + b.latS) / 2, b.lon]);
  const data = JSON.stringify({ polygon: [...north, ...south], center, spot, here, bandTooltip });
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<style>
  html, body, #map { margin: 0; height: 100%; background: ${C.bg}; }
  .lbl { background: rgba(11,11,18,0.85); color: ${C.text}; border: 1px solid ${C.border};
         border-radius: 6px; padding: 2px 7px; font: 600 11px system-ui; white-space: nowrap; }
  .leaflet-tooltip-top:before { display: none; }
  .leaflet-control-attribution { background: rgba(11,11,18,0.7); color: #666; font-size: 9px; }
  .leaflet-control-attribution a { color: #888; }
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

  L.polygon(D.polygon, {
    color: '${C.totality}', weight: 1.5, opacity: 0.9,
    fillColor: '${C.totality}', fillOpacity: 0.18,
  }).addTo(map).bindTooltip(D.bandTooltip, { sticky: true, className: 'lbl' });

  L.polyline(D.center, { color: '${C.corona}', weight: 2, dashArray: '6 6', opacity: 0.9 })
    .addTo(map).bindTooltip('Centro: máxima duración', { sticky: true, className: 'lbl' });

  var ptLayer = L.layerGroup().addTo(map);
  function draw(d, fly) {
    ptLayer.clearLayers();
    var pts = [];
    function dot(p, fill) {
      var m = L.circleMarker([p.lat, p.lon], {
        radius: 8, color: '${C.corona}', weight: 2.5,
        fillColor: fill ? '${C.text}' : 'transparent', fillOpacity: fill ? 1 : 0,
      }).addTo(ptLayer);
      m.bindTooltip(p.label, { permanent: true, direction: 'top', offset: [0, -10], className: 'lbl' });
      pts.push([p.lat, p.lon]);
    }
    dot(d.spot, true);
    if (d.here) dot(d.here, false);

    if (fly) {
      if (pts.length > 1) map.flyToBounds(pts, { padding: [70, 70], duration: 0.9 });
      else map.flyTo(pts[0], 7, { duration: 0.9 });
    } else {
      if (pts.length > 1) map.fitBounds(pts, { padding: [70, 70] });
      else map.setView(pts[0], 7);
    }
  }
  draw(D, false);
  window.eclipsumUpdate = function (d) { draw(d, true); };
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
