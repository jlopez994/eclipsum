/**
 * HTML del mapa real (Leaflet embebido + tiles Esri Dark Gray, sin API key), separado del
 * componente WebView: aquí no entra nada de react-native, así que el HTML se puede generar
 * y abrir en un navegador de escritorio para depurar encuadre y colores.
 */
import { type BandSlice } from './bandGeo';
import { LEAFLET_CSS, LEAFLET_JS } from './leafletVendor';
import { C } from '../components/theme';

export interface MapPoint {
  lat: number;
  lon: number;
  label: string;
}

/** JSON seguro para incrustar en <script>/injectJavaScript: un nombre de lugar con «</script>» no rompe el HTML. */
export const toJs = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export function buildHtml(spot: MapPoint, here: MapPoint | null, band: BandSlice[] | null): string {
  // Eclipse sin banda empaquetada (p. ej. añadido por Remote Config): solo marcadores
  const north = band?.map((b) => [b.latN, b.lon]) ?? [];
  const south = band ? [...band].reverse().map((b) => [b.latS, b.lon]) : [];
  const center = band?.map((b) => [(b.latN + b.latS) / 2, b.lon]) ?? null;
  const polygon = band ? [...north, ...south] : null;
  const data = toJs({ polygon, north, south, center, spot, here });
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<style>
  html, body, #map { margin: 0; height: 100%; background: ${C.bg}; -webkit-tap-highlight-color: transparent; }
  .leaflet-container path, .leaflet-interactive { outline: none; }
  /* La base Esri es más clara que el tema: se oscurece por CSS para que no parta la
     pantalla en una franja gris. Solo la base — los rótulos siguen legibles. */
  .dim { filter: brightness(0.52) saturate(0.85); }
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
  // Una sola copia del mundo: sin límites, al alejar el planeta se repetía en horizontal
  // (banda y marcadores incluidos por duplicado). minZoom acorde: más lejos solo hay fondo.
  var map = L.map('map', {
    zoomControl: false, attributionControl: true,
    minZoom: 2, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1.0,
  });
  // Esri Dark Gray Canvas, sin API key. La base viene SIN rótulos (van en la capa
  // Reference), así que las etiquetas son una capa fija encima de cualquier base.
  // maxNativeZoom 16: más cerca Esri ya no sirve teselas y Leaflet sobreamplía las últimas.
  var baseDark = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 16, maxZoom: 18, zIndex: 1, noWrap: true, className: 'dim', attribution: '&copy; Esri' }
  ).addTo(map);
  // Modo relieve: hillshade oscuro de Esri.
  // maxNativeZoom 15: más cerca Esri ya no sirve teselas y Leaflet sobreamplía las últimas.
  var terrainBase = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 15, maxZoom: 18, zIndex: 1, noWrap: true, attribution: '&copy; Esri' }
  );
  var labels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 16, maxZoom: 18, zIndex: 2, noWrap: true, attribution: '&copy; Esri' }
  ).addTo(map);
  window.eclipsumSetTerrain = function (on) {
    if (on) { map.removeLayer(baseDark); terrainBase.addTo(map); }
    else { map.removeLayer(terrainBase); baseDark.addTo(map); }
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
    // clearLayers no retira los tooltips PERMANENTES (viven en el mapa, no en el grupo):
    // sin el unbind, cada redibujo dejaba una etiqueta fantasma en la posición vieja.
    ptLayer.eachLayer(function (l) { l.unbindTooltip(); });
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
  // Los cambios de puesto se guardan en D: cualquier reencuadre posterior (resize) debe
  // razonar sobre el puesto vigente, no sobre el del primer render.
  window.eclipsumUpdate = function (d) { D.spot = d.spot; D.here = d.here; draw(D, true); };

  // El WebView puede medir 0 px cuando corre este script (carrera con el layout de RN):
  // fitBounds a tamaño 0 clava zoom 0 y el mapa nace en «mundo». En un WebView el HTML
  // ES la ventana, así que cada cambio de layout de RN (inicial, banners) llega como
  // resize de window — se revalida el tamaño y se reencuadra, salvo que el usuario ya
  // haya tocado el mapa o pedido volar a un punto: su vista manda.
  // (window.resize y no ResizeObserver: el observer depende del ciclo de pintado y en
  // WebViews/pestañas sin render activo no llega a disparar.)
  window.eclipsumMoved = false;
  document.getElementById('map').addEventListener('touchstart', function () {
    window.eclipsumMoved = true;
  }, { passive: true, once: true });
  window.addEventListener('resize', function () {
    map.invalidateSize();
    if (!window.eclipsumMoved) draw(D, false);
  });

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
