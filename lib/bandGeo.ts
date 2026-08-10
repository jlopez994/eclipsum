/** Generado por scripts/genBand.ts — bandas de totalidad por id de eclipse (no editar a mano). */
export interface BandSlice {
  lon: number;
  latS: number;
  latN: number;
}

/**
 * Bandas empaquetadas. Añadir/regenerar: `npx tsx scripts/genBand.ts --id <id>`
 * (conserva las demás bandas). Eclipses solo-RC sin banda: el mapa real pinta marcadores sin polígono.
 */
const BANDS_BY_ECLIPSE: Record<string, BandSlice[]> = {
  '2026-08-12-iberia': [{"lon":-25,"latS":59.229,"latN":60},{"lon":-24.5,"latS":58.461,"latN":60},{"lon":-24,"latS":57.715,"latN":60},{"lon":-23.5,"latS":56.991,"latN":60},{"lon":-23,"latS":56.288,"latN":60},{"lon":-22.5,"latS":55.607,"latN":60},{"lon":-22,"latS":54.945,"latN":60},{"lon":-21.5,"latS":54.304,"latN":60},{"lon":-21,"latS":53.681,"latN":60},{"lon":-20.5,"latS":53.078,"latN":60},{"lon":-20,"latS":52.492,"latN":60},{"lon":-19.5,"latS":51.924,"latN":59.638},{"lon":-19,"latS":51.373,"latN":58.737},{"lon":-18.5,"latS":50.839,"latN":57.888},{"lon":-18,"latS":50.32,"latN":57.083},{"lon":-17.5,"latS":49.817,"latN":56.32},{"lon":-17,"latS":49.329,"latN":55.592},{"lon":-16.5,"latS":48.856,"latN":54.898},{"lon":-16,"latS":48.396,"latN":54.234},{"lon":-15.5,"latS":47.95,"latN":53.599},{"lon":-15,"latS":47.517,"latN":52.989},{"lon":-14.5,"latS":47.097,"latN":52.404},{"lon":-14,"latS":46.689,"latN":51.842},{"lon":-13.5,"latS":46.293,"latN":51.301},{"lon":-13,"latS":45.909,"latN":50.78},{"lon":-12.5,"latS":45.536,"latN":50.279},{"lon":-12,"latS":45.173,"latN":49.795},{"lon":-11.5,"latS":44.821,"latN":49.329},{"lon":-11,"latS":44.479,"latN":48.879},{"lon":-10.5,"latS":44.147,"latN":48.444},{"lon":-10,"latS":43.825,"latN":48.025},{"lon":-9.5,"latS":43.512,"latN":47.619},{"lon":-9,"latS":43.207,"latN":47.227},{"lon":-8.5,"latS":42.912,"latN":46.847},{"lon":-8,"latS":42.625,"latN":46.481},{"lon":-7.5,"latS":42.346,"latN":46.126},{"lon":-7,"latS":42.076,"latN":45.782},{"lon":-6.5,"latS":41.813,"latN":45.45},{"lon":-6,"latS":41.558,"latN":45.128},{"lon":-5.5,"latS":41.31,"latN":44.816},{"lon":-5,"latS":41.069,"latN":44.514},{"lon":-4.5,"latS":40.835,"latN":44.221},{"lon":-4,"latS":40.608,"latN":43.938},{"lon":-3.5,"latS":40.388,"latN":43.664},{"lon":-3,"latS":40.174,"latN":43.398},{"lon":-2.5,"latS":39.967,"latN":43.14},{"lon":-2,"latS":39.765,"latN":42.891},{"lon":-1.5,"latS":39.57,"latN":42.649},{"lon":-1,"latS":39.381,"latN":42.415},{"lon":-0.5,"latS":39.197,"latN":42.188},{"lon":0,"latS":39.019,"latN":41.968},{"lon":0.5,"latS":38.846,"latN":41.756},{"lon":1,"latS":38.679,"latN":41.55},{"lon":1.5,"latS":38.517,"latN":41.35},{"lon":2,"latS":38.359,"latN":41.157},{"lon":2.5,"latS":38.207,"latN":40.97},{"lon":3,"latS":38.06,"latN":40.789},{"lon":3.5,"latS":37.918,"latN":40.614},{"lon":4,"latS":37.78,"latN":40.445},{"lon":4.5,"latS":37.648,"latN":40.281},{"lon":5,"latS":37.519,"latN":40.123},{"lon":5.5,"latS":37.395,"latN":39.97},{"lon":6,"latS":37.275,"latN":39.823},{"lon":6.5,"latS":37.16,"latN":39.68},{"lon":7,"latS":37.049,"latN":39.543},{"lon":7.5,"latS":36.942,"latN":39.41},{"lon":8,"latS":36.839,"latN":39.283}],
};

export function bandForEclipse(id: string): BandSlice[] | null {
  return BANDS_BY_ECLIPSE[id] ?? null;
}
