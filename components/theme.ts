/** Paleta Eclipsum — oscuro con acento corona solar */
export const C = {
  bg: '#0B0B10',
  surface: '#15151E',
  text: '#F2EFE9',
  dim: '#8B8898',
  corona: '#FFB84D',
  coronaLight: '#FFD9A0',
  danger: '#FF6B5E',
  totality: '#7C6CFF',
  violet: '#A99EFF',
  ok: '#5ECC8F',
  border: '#26263A',
  knobTrack: '#3A3A50',
  warm: '#FFF7E6',
  faint: '#55525F',
} as const;

/**
 * Color por hito de la serie: mismo código en cronología, raíl del modo eclipse
 * y pantalla de alertas. OC (ocaso) solo aparece en la cronología del mapa.
 */
export const EVENT_ACCENT: Record<string, string> = {
  C1: C.corona,
  C2: C.totality,
  MAX: C.totality,
  C3: C.danger,
  C4: C.corona,
  OC: C.danger,
};

/** Color del semáforo de nubes por nivel (los umbrales viven en lib/weather cloudLevel). */
export const CLOUD_COLOR: Record<'few' | 'mid' | 'many', string> = {
  few: C.ok,
  mid: C.corona,
  many: C.danger,
};

/** Chrome de tarjeta/chip flotante sobre el mapa y el modo eclipse (mismo cristal oscuro) */
export const CARD = {
  backgroundColor: 'rgba(21,21,30,0.85)',
  borderWidth: 1,
  borderColor: C.border,
  borderRadius: 18,
} as const;

/** Familias Space Grotesk cargadas en App vía expo-font */
export const F = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
} as const;
