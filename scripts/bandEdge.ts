/** Borde de banda por bisección entre un lat dentro y uno fuera (~0.01°). Compartido
 * por genBand (banda empaquetada) y syncBands (bandas RC): mismo algoritmo, un solo sitio. */
export function refineEdge(
  inBand: (lat: number, lon: number) => boolean,
  lon: number,
  inside: number,
  outside: number,
): number {
  let a = inside;
  let b = outside;
  for (let i = 0; i < 12; i++) {
    const mid = (a + b) / 2;
    if (inBand(mid, lon)) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}
